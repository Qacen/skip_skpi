// Client of the recognition service (Python, ../ml: RF-DETR-Seg bottles -> per-bottle label embedding -> pgvector top-K -> re-ranking).
// Contract of POST {NUXT_ML_URL}/recognize (multipart field "file"); full spec: ml/ML_SERVICE.md
//   { status, slug, confidence, read,                 // copies of the PRIMARY bottle's match (what /predict returns)
//     primary: number,                                // index into detection.bottles
//     detection: { image: { width, height }, detector, bottles: [{ bbox, center, score, source: "detector"|"full_image",
//                  mask: { polygon, area } | null, label: { bbox, polygon, source } | null,           // segmentation / label zone
//                  match: { status, slug, confidence: { top1, margin, top5 }, neighbors: [{ slug, score }], read } }] },   // px, left -> right
//     timing_ms, model, demo }
// normalize() also accepts the older single-bottle shape. Without NUXT_ML_URL the server runs in demo mode (deterministic pseudo-result).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { catalog } from './catalog'

export interface Confidence { top1: number, margin: number, top5: { slug: string, score: number }[] }
export interface Neighbor { slug: string, score: number, embed_score?: number, source?: string }
export interface Mask { polygon?: number[][] | null, area?: number, rle?: unknown }
export interface LabelZone { bbox: number[], polygon?: number[][] | null, score?: number, source?: 'detector' | 'heuristic' }
export interface LabelRead { color?: string | null, sweetness?: string | null, vintage?: string | null, text?: string | null }
export interface BottleMatch { status: 'found' | 'not_found', slug: string | null, confidence: Confidence, neighbors?: Neighbor[], read?: LabelRead }
export interface Bottle { bbox: number[], label_bbox?: number[] | null, center?: number[], score?: number, source?: 'detector' | 'full_image',
  mask?: Mask | null, label?: LabelZone | null, match: BottleMatch }
export interface RecognizeResult extends BottleMatch {
  primary: number
  detection: { image: { width: number, height: number } | null, detector?: string, bottles: Bottle[] }
  timing_ms?: Record<string, number>
  model?: { name: string, version: string }
  demo?: boolean
}

// guarantee: >= 1 bottle, valid primary, every bottle has a match, top-level fields = primary's match
export function normalize(r: any): RecognizeResult {
  const top: BottleMatch = { status: r.status, slug: r.slug ?? null, confidence: r.confidence, read: r.read }
  const det = r.detection || {}
  const withNeighbors = (m: BottleMatch): BottleMatch => ({ ...m, neighbors: m.neighbors?.length ? m.neighbors : m.confidence?.top5 || [] })
  let bottles: Bottle[] = (det.bottles || []).map((b: any) => ({ ...b, mask: b.mask ?? null,
    label: b.label ?? (b.label_bbox ? { bbox: b.label_bbox, polygon: null, source: 'heuristic' } : null), match: withNeighbors(b.match || top) }))
  if (!bottles.length) bottles = [{ bbox: [], label_bbox: null, source: 'full_image', score: 0, mask: null, label: null, match: withNeighbors(top) }]   // UI centres the dot
  const primary = Number.isInteger(r.primary) && r.primary >= 0 && r.primary < bottles.length ? r.primary : 0
  const m = bottles[primary].match
  return { ...r, status: m.status, slug: m.slug, confidence: m.confidence, read: m.read, primary,
    detection: { image: det.image || null, detector: det.detector, bottles } }
}

// ML endpoints, tried in order:
//   1) ml-url.txt next to the app (NUXT_ML_URL_FILE) — re-read on every call, so a new Kaggle T4 tunnel URL
//      (https://<words>.trycloudflare.com, changes on every notebook run) is picked up without restarting the site;
//   2) NUXT_ML_URL (comma-separated), e.g. the local Mac service as the fallback.
// An endpoint that fails (cold start ~2 min, tunnel gone: connection errors, 502/503/504/530, timeouts) is taken out of
// rotation and probed via /health in the background every PROBE_MS; it comes back as soon as it answers. 4xx is returned as is.
const PROBE_MS = 15_000
const down = new Set<string>()
let probing = false
function markDown(url: string) {
  down.add(url)
  if (probing) return
  probing = true
  const probe = async () => {
    for (const u of [...down]) {
      try { await $fetch(`${u}/health`, { timeout: 4000 }); down.delete(u) } catch { /* still down */ }
    }
    if (down.size) setTimeout(probe, PROBE_MS)
    else probing = false
  }
  setTimeout(probe, PROBE_MS)
}

export function mlEndpoints(): string[] {
  const cfg = useRuntimeConfig()
  const list: string[] = []
  try { list.push(...readFileSync(String(cfg.mlUrlFile || 'ml-url.txt'), 'utf8').split(/[\s,]+/)) } catch { /* no override file */ }
  list.push(...String(cfg.mlUrl || '').split(','))
  return [...new Set(list.map(u => u.trim().replace(/\/+$/, '')).filter(u => /^https?:\/\//.test(u)))]
}

const retryable = (e: any) => {
  const code = Number(e?.statusCode || e?.status || e?.response?.status || 0)
  return !code || code >= 500 || code === 408 || code === 429
}

export async function callMl<T>(path: string, body: () => FormData, query?: Record<string, string>): Promise<{ data: T, url: string }> {
  const cfg = useRuntimeConfig()
  const urls = mlEndpoints()
  const alive = urls.filter(u => !down.has(u))
  const order = alive.length ? alive : urls           // everything is down -> still try, in order
  let last: any = new Error('no ML endpoint configured')
  for (const [n, url] of order.entries()) {
    try {
      const data = await $fetch<T>(`${url}${path}`, { method: 'POST', body: body(), query,
        // a fallback exists -> do not wait the full timeout on a hanging endpoint (T4 answers in ~1 s, p90 1.2 s)
        timeout: n === order.length - 1 ? Number(cfg.mlTimeoutMs) : Math.min(Number(cfg.mlTimeoutMs), 6_000) })
      down.delete(url)
      return { data, url }
    } catch (e: any) {
      last = e
      if (!retryable(e)) throw e
      markDown(url)
    }
  }
  throw last
}

export function photoForm(file: { data: Buffer, filename?: string, type?: string }) {
  return () => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(file.data)], { type: file.type || 'image/jpeg' }), file.filename || 'photo.jpg')
    return fd
  }
}

export async function recognize(file: { data: Buffer, filename?: string, type?: string }, force?: string, masks: 'none' | 'polygon' = 'none', maxBottles?: number): Promise<RecognizeResult> {
  if (!mlEndpoints().length) return normalize(await demo(file.data, force))
  const form = photoForm(file)
  // the photo page needs geometry + matches only (no mask contours, top-5 neighbours for the style of analogs);
  // the live AR asks for mask polygons: the label zone of each bottle is found from its silhouette
  // maxBottles: live AR frames match only the largest (front-row) bottles — a photo keeps the service's MAX_BOTTLES (32)
  const { data } = await callMl<any>('/recognize', form, { masks, k: '5', ...(force ? { force } : {}), ...(maxBottles ? { max_bottles: String(maxBottles) } : {}) })
  return normalize(data)
}

// user-facing reason for a failed call to the ML service
export function mlErrorMessage(e: any): string {
  const msg = String(e?.cause?.code || e?.message || e)
  const code = Number(e?.statusCode || e?.status || 0)
  if (/timeout|aborted|ETIMEDOUT/i.test(msg)) return 'Распознавание заняло слишком много времени. Попробуйте ещё раз'
  if (/ECONNREFUSED|ECONNRESET|socket hang up|fetch failed/i.test(msg) || [502, 503, 504, 530].includes(code)) return 'Сервис распознавания запускается. Попробуйте через минуту'
  return 'Сервис распознавания недоступен. Попробуйте ещё раз'
}

async function demo(bytes: Buffer, force?: string): Promise<any> {
  const items = await catalog()
  const h = createHash('sha1').update(bytes).digest()
  const pick = (k: number) => items[h.readUInt32BE(k) % items.length]
  const top = [0, 4, 8, 12, 16].map(pick)
  const found = force === 'found' ? true : force === 'not_found' ? false : h[0] % 6 !== 0
  const top1 = found ? 0.86 + (h[1] % 12) / 100 : 0.41 + (h[1] % 10) / 100
  const scores = [top1, top1 - (found ? 0.23 : 0.03), top1 - 0.27, top1 - 0.3, top1 - 0.33]
  return {
    status: found ? 'found' : 'not_found',
    slug: found ? top[0].slug : null,
    confidence: { top1, margin: scores[0] - scores[1], top5: top.map((w, i) => ({ slug: w.slug, score: +scores[i].toFixed(3) })) },
    read: { color: top[0].color, sweetness: top[0].sweetness, vintage: top[0].year || undefined },
    timing_ms: { total: 900 + (h[2] % 600) },
    demo: true,
  }
}
