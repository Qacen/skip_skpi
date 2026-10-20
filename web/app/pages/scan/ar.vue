<script setup lang="ts">
// /scan/ar — the live AR scanner, real time. The viewfinder is shown DELAY ms late (at most 300 ms, ?delay=0..300, default
// 300): every camera frame is buffered (picture + gray copy) and handed to the label tracker and to the screen only DELAY ms later,
// while the frames for the server are taken live and sent without waiting (up to INFLIGHT at once). An answer that arrives
// before its frame is shown is applied ON that frame — cards sit exactly where the detector found them;
// a later one is carried over by the tracker as before. The bottle's base / height for the
// panel are kept per label as a share of the label width, so the panel follows the bottle when it comes closer or goes away.
// One wine «in view» is judged against EVERY bottle of the last detector answer (not only the followed labels): on a shelf with
// many bottles the panel opens only when the bottle is alone or its box is >= 1.8x as wide as each other one.
// Turning the phone does not restart anything: the picture, cards and panel follow gravity (frames for the server stay upright),
// the controls stay where they are on the phone's body, as in the camera app.
// The wines found so far collect in the bar at the bottom («Отсканировано: N»); a tap opens them as the shelf result of the photo
// scanner shows a shelf (components/ArShelfSheet.vue: the same grid, «Фильтры», «Рекомендация» by your taste) over the frozen
// view; closed, the picks carry «✦ Рекомендация» on their bottles, the wines the filters leave out are dimmed, and the panel of a
// picked wine says why it is recommended.
// Geometry in utils/arRender.ts:
//  - a portrait «Своё вино» card on every followed label, as a 3D rectangle: one pinhole camera for the view, the world «up» from
//    the bottle axes (mask midlines of the detector) — every card stands parallel to its bottle and facing the camera; bottles of
//    one shelf row get their cards on one level and of one width; «AR · на этикетке» / «Вино» until the name arrives, «Нет в
//    каталоге» for a bottle outside the catalogue;
//  - when ONE recognised wine is alone in the view, or clearly dominates it (its label >= 1.8x any other), for 0.5 s, its card
//    grows into the full panel: a plate standing by the bottle, as tall as the bottle, its bottom on the bottle's base, the outer
//    edge turned 14° towards the viewer, the top 8° nearer; on the side where it stays on screen (it changes sides only when
//    clearly better, by a cross-fade); it folds back into the card when the wine stops dominating. No connector, no focus ring.
// The panel is opaque (asked for on the phone); the render's one is frosted glass.
// Detection + recognition: /api/wines/ar-frame (?id=0: tracking only). ?src=/path.mp4 (same origin) instead of the camera;
// ?as=<slug> (tests / demos) takes every bottle for that wine; ?debug=1 shows timings.
import { FramePyramids } from '~/utils/arPlanar'
import { GrayGrabber, type ArCard, type LabelRead } from '~/utils/arTracker'
import { LabelTracks, frontZonesIdx, type LabelView, type Meta } from '~/utils/arLabels'
import { AR_PAIR_ICON, AR_TASTE_ICON, arIcon } from '~/utils/arPanelIcons'
import { AR_LAND, AR_MAP } from '#shared/arMapLand'
import { Cam, axisLine, upFromAxes, tamePitch, slerpUp, cardQuad, panelQuad, onScreen, lerpQuad, quadMatrix, type V2, type V3, type Quad } from '~/utils/arRender'

useHead({ title: 'AR — Свои вина' })
const route = useRoute()
const qsrc = typeof route.query.src === 'string' ? route.query.src : ''
const testSrc = /^\/(?![/\\])[\w\-./%]+\.(mp4|webm)(\?[\w=&.%-]*)?$/i.test(qsrc) && !qsrc.includes('..') ? qsrc : ''
const debug = route.query.debug === '1'
const AS = typeof route.query.as === 'string' && /^[\w-]+$/.test(route.query.as) ? route.query.as : ''
const IDENTIFY = route.query.id !== '0' && !AS
const rate = Math.min(1, Math.max(0.1, Number(route.query.rate) || 1))   // test video playback rate (demos on a slow machine)
const SEND_SIDE = 896, TRACK_W = 360, SEND_EVERY_MS = 100, INFLIGHT = 2
const DELAY = Math.min(300, Math.max(0, Number(route.query.delay ?? 300) || 0))   // ms the viewfinder is shown late
const CARD_W = 160, CARD_H = 236            // CSS px of the card layout; mapped onto its 3D rectangle

interface FrameBottle { bbox: number[], polygon: number[][] | null, status: 'found' | 'not_found', slug: string | null, read: LabelRead }
interface FrameAnswer { image: { width: number, height: number } | null, bottles: FrameBottle[], cards: Record<string, ArCard>, ms: number }
interface Placed { l: LabelView, x: number, y: number, lw: number, wr: number, P: V2, q: Quad, m: string }
interface Item { id: number, ts: number, gray: Uint8Array, pic: HTMLCanvasElement }   // one buffered camera frame

const video = ref<HTMLVideoElement>()
const screen = ref<HTMLCanvasElement>()
const state = ref<'starting' | 'live' | 'fallback'>('starting')
const reason = ref('')
const banner = ref('')
const vw = ref(390), vh = ref(844)
const rot = ref(0)                                       // the screen's turn from the phone's portrait (0 / 90 / 270)
const placed = shallowRef<Placed[]>([])
const cards = shallowReactive<Record<string, ArCard>>({})
const stats = reactive({ fps: 0, track: 0, rtt: 0, ml: 0 })
let stream: MediaStream | null = null, running = false, gen = 0, lastTs = 0
let grab: GrayGrabber | null = null, lt: LabelTracks | null = null
const queue: Item[] = []                                 // frames waiting to be shown
const picPool: HTMLCanvasElement[] = []
const frameOf = new Map<number, number>()                // item id -> tracker frame, once shown
const posOf = new Map<number, Map<number, V2>>()         // item id -> label points on that frame
const early = new Map<number, FrameAnswer>()            // answers that came before their frame was shown
let qid = 0, inflight = 0, nextSend = 0, backoff = 0
// the last detector answer for dominance: every tall bottle box (screen px of its frame) and the label points on that frame
let lastDet: { at: number, boxes: number[][], pos: Map<number, V2> } | null = null

// ---------------- camera and per-label state (comp_scan.py) ----------------
let cam = new Cam(1000, 195, 422), fu = 1                 // fu: screen px per px of the render's 720 px short side
let upNow: V3 = [0, -1, 0], upMeas: V3 | null = null      // world «up»: eased towards the last measured one (σ 12 frames)
interface LabelGeo { off: V2, wr: number, rb: number, rh: number, hasB: boolean, pin?: V2 }   // pin: the eased label point the card sits on   // rb / rh: the bottle's base / height per label width
const geo = new Map<number, LabelGeo>()
let baseRatio = 1.3, heightRatio = 4.2                    // the bottle's base / height per label width, from the last measured bottle
const ema = (dt: number, sigma: number) => 1 - Math.pow(1 - 1 / (1 + sigma), dt / 33.3)   // the render's causal σ (frames at 30 fps)
function camera() {
  const v = video.value; if (!v?.videoWidth) return
  const k = Math.max(vw.value / v.videoWidth, vh.value / v.videoHeight), short = Math.min(v.videoWidth, v.videoHeight) * k
  fu = short / 720; cam = new Cam(1000 * fu, vw.value / 2, vh.value / 2)
}

// a track born where a recognised one was just lost (same place, within INHERIT_MS) takes its name at once: no new wait
const INHERIT_MS = 1200
const lostNamed: { slug: string, x: number, y: number, at: number }[] = []
const inherited = new Map<number, string>()
let prevNamed = new Map<number, { slug: string, x: number, y: number }>()
function inherit(ts: number, list: Placed[]) {
  const now = new Map<number, { slug: string, x: number, y: number }>()
  for (const p of list) { const sl = p.l.ident.status === 'found' && p.l.ident.slug ? p.l.ident.slug : inherited.get(p.l.id); if (sl) now.set(p.l.id, { slug: sl, x: p.x, y: p.y }) }
  for (const [id, v] of prevNamed) if (!list.some(p => p.l.id === id)) lostNamed.push({ ...v, at: ts })
  while (lostNamed.length && ts - lostNamed[0]!.at > INHERIT_MS) lostNamed.shift()
  for (const p of list) {
    if (now.has(p.l.id) || inherited.has(p.l.id)) continue
    const i = lostNamed.findIndex(v => Math.hypot(v.x - p.x, v.y - p.y) < 0.35 * vw.value)
    if (i >= 0) { inherited.set(p.l.id, lostNamed[i]!.slug); now.set(p.l.id, { slug: lostNamed[i]!.slug, x: p.x, y: p.y }); lostNamed.splice(i, 1) }
  }
  for (const id of inherited.keys()) if (!list.some(p => p.l.id === id)) inherited.delete(id)
  prevNamed = now
}
// what the card on a bottle says (comp_card.card): the wine; «AR · на этикетке» + «Вино» while recognising; «Нет в каталоге»
function face(l: LabelView) {
  const inh = l.ident.status !== 'found' ? inherited.get(l.id) : undefined
  const id = inh ? { ...l.ident, status: 'found' as const, slug: inh } : l.ident, card = AS ? cards[AS] ?? null : id.slug ? cards[id.slug] : null
  if ((AS || id.status === 'found') && card) return { kind: 'found', card, title: card.title, maker: card.manufacturer, note: 'AR · на этикетке' }
  if (IDENTIFY && id.status === 'not_found') return { kind: 'nf', card: null, title: 'Вино', maker: 'Своё вино', note: 'Нет в каталоге' }
  return { kind: 'pending', card: null, title: 'Вино', maker: 'Своё вино', note: 'AR · на этикетке' }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function visibleRect() {
  const v = video.value; if (!v || !v.videoWidth) return null
  const k = Math.max(vw.value / v.videoWidth, vh.value / v.videoHeight), sw = vw.value / k, sh = vh.value / k
  return { sx: (v.videoWidth - sw) / 2, sy: (v.videoHeight - sh) / 2, sw, sh }
}
function measure() {
  vw.value = window.innerWidth; vh.value = window.innerHeight
  const a = (screen.orientation?.angle ?? (((window as any).orientation ?? 0) + 360)) % 360
  rot.value = vw.value > vh.value && (a === 90 || a === 270) ? a : 0   // a turned phone (a desktop window is just wide: angle 0)
  const h = Math.round(TRACK_W * vh.value / vw.value)
  grab = new GrayGrabber(TRACK_W, h)
  lt = new LabelTracks(new FramePyramids(TRACK_W, h), 0.64, 90, 'similarity')
  geo.clear(); upMeas = null; upNow = [0, -1, 0]; baseRatio = 1.3; heightRatio = 4.2
}

function schedule(my: number) { (video.value as any).requestVideoFrameCallback((now: number) => tick(now, my)) }
let nowTs = 0                                            // the clock of the live frames (ms)
function tick(ts: number, my: number) {
  if (!running || my !== gen) return
  schedule(my)
  nowTs = ts
  if (sheetOpen.value) return                              // the view is frozen under the sheet
  const r = visibleRect(); if (!r || !grab || !lt) return
  // 1) the live frame: buffered (its picture for the screen, its gray copy for the tracker); a frame for the server now and then
  const pic = picPool.pop() || document.createElement('canvas'), pk = Math.min(1, 1600 / Math.max(r.sw, r.sh))
  if (pic.width !== Math.round(r.sw * pk) || pic.height !== Math.round(r.sh * pk)) { pic.width = Math.round(r.sw * pk); pic.height = Math.round(r.sh * pk) }
  pic.getContext('2d')!.drawImage(video.value!, r.sx, r.sy, r.sw, r.sh, 0, 0, pic.width, pic.height)
  const it: Item = { id: ++qid, ts, gray: grab.grab(pic, 0, 0, pic.width, pic.height).d, pic }
  queue.push(it)
  if (inflight < INFLIGHT && ts >= nextSend) { nextSend = ts + SEND_EVERY_MS; send(it, my) }
  // 2) the frames that are due: tracked in order; an answer that already came for one is applied on it
  let shown: Item | null = null
  while (queue.length && queue[0]!.ts <= ts - DELAY) {
    const q = queue.shift()!
    lt.push(q.gray); frameOf.set(q.id, lt.frame); frameOf.delete(q.id - 300); posOf.delete(q.id - 300)
    const a = early.get(q.id)
    if (a) { early.delete(q.id); apply(a, lt.frame, null) }
    if (shown) picPool.push(shown.pic)
    shown = q
  }
  if (!shown) return
  const dt = lastTs ? Math.min(100, shown.ts - lastTs) : 33
  if (lastTs) stats.fps = stats.fps * 0.9 + 100 / Math.max(1, shown.ts - lastTs)
  lastTs = shown.ts
  const t0 = performance.now()
  camera()
  const cv = screen.value
  if (cv) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(vw.value * dpr), h = Math.round(vh.value * dpr)
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
    cv.getContext('2d')!.drawImage(shown.pic, 0, 0, w, h)
  }
  picPool.push(shown.pic)
  const list = lt.view(TRACK_W / vw.value, shown.ts, 300, 193)
  posOf.set(shown.id, new Map(list.map(l => [l.id, [l.cx, l.cy] as V2])))
  ts = shown.ts
  // world «up»: eased towards the last measurement (render: σ 12 frames), pitch tamed as in the render
  if (upMeas) upNow = slerpUp(upNow, upMeas, ema(dt, 12))
  const up = tamePitch(upNow)
  // the labels: centre, width, bottom of the label (where the bottle stands on its row)
  const labs = list.flatMap(l => {
    const c = lt!.tracks.find(t => t.id === l.id)?.corners
    if (!c) return []
    const lw = (Math.hypot(c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]) + Math.hypot(c[2]![0] - c[3]![0], c[2]![1] - c[3]![1])) / 2   // corners: screen px
    return [{ l, C: [l.cx, l.cy] as V2, lw, lb: (c[2]![1] + c[3]![1]) / 2 }]
  })
  // rows (comp_scan.py): along the typical lean, bottles whose labels end on one line share the level and the width
  const c0 = cam.ray(cam.cx, cam.cy), pu = cam.px([c0[0] + 0.01 * up[0], c0[1] + 0.01 * up[1], c0[2] + 0.01 * up[2]])
  let dn: V2 = [cam.cx - pu[0], cam.cy - pu[1]]; const dl = Math.hypot(dn[0], dn[1]) || 1; dn = [dn[0] / dl, dn[1] / dl]
  const al: V2 = [-dn[1], dn[0]], dd = (p: V2, a: V2) => p[0] * a[0] + p[1] * a[1]
  const med = (xs: number[]) => { const a = xs.slice().sort((x, y) => x - y); return a.length % 2 ? a[(a.length - 1) / 2]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2 }
  const byV = labs.map(o => ({ o, v: dd([o.C[0], o.lb], dn) })).sort((a, b) => a.v - b.v)
  const rows: typeof byV[] = []
  for (const x of byV) { const last = rows[rows.length - 1]; if (last && Math.abs(x.v - med(last.map(y => y.v))) < 0.07 * vh.value) last.push(x); else rows.push([x]) }
  const out: Placed[] = []
  for (const row of rows) {
    const v = med(row.map(x => dd(x.o.C, dn))), wr = med(row.map(x => x.o.lw))
    for (const { o } of row) {
      const along = dd(o.C, al), P: V2 = [al[0] * along + dn[0] * v, al[1] * along + dn[1] * v], tgt: V2 = [P[0] - o.C[0], P[1] - o.C[1]]
      let g = geo.get(o.l.id)
      if (!g) { g = { off: tgt, wr, rb: baseRatio, rh: heightRatio, hasB: false }; geo.set(o.l.id, g) }
      const ko = ema(dt, 10), kw = ema(dt, 8)                        // the card is pinned to the label; only the alignment shift is smoothed
      g.off = [g.off[0] + (tgt[0] - g.off[0]) * ko, g.off[1] + (tgt[1] - g.off[1]) * ko]; g.wr += (wr - g.wr) * kw
      if (!g.hasB) { g.rb = baseRatio; g.rh = heightRatio }               // until its bottle is measured: as the last measured one
      // the label point eased a little (σ 3 frames): the tracker's sub-pixel noise does not shake the card; a big jump (a re-anchored
      // track, a fast pan) is followed at once
      const kp = Math.hypot(o.C[0] - (g.pin?.[0] ?? o.C[0]), o.C[1] - (g.pin?.[1] ?? o.C[1])) > 0.25 * g.wr ? 1 : ema(dt, 3)
      g.pin = g.pin ? [g.pin[0] + (o.C[0] - g.pin[0]) * kp, g.pin[1] + (o.C[1] - g.pin[1]) * kp] : [o.C[0], o.C[1]]
      const Pc: V2 = [g.pin[0] + g.off[0], g.pin[1] + g.off[1]]
      const cw = Math.max(92 * fu, Math.min(230 * fu, g.wr * 1.08)), q = cardQuad(cam, Pc, cw, cw * CARD_H / CARD_W, up)
      out.push({ l: o.l, x: o.C[0], y: o.C[1], lw: o.lw, wr: g.wr, P: Pc, q, m: quadMatrix(CARD_W, CARD_H, q) })
    }
  }
  for (const id of geo.keys()) if (!list.some(l => l.id === id)) geo.delete(id)
  placed.value = out
  inherit(ts, out)
  for (const p of out) { const fc = face(p.l); if (fc.kind === 'found' && fc.card && !scanned.value.includes(fc.card.slug)) scanned.value = [...scanned.value, fc.card.slug] }
  dominate(ts, dt, up)
  stats.track = stats.track * 0.9 + (performance.now() - t0) * 0.1
}

async function send(it: Item, my: number) {
  inflight++
  try {
    const k = Math.min(1, SEND_SIDE / Math.max(it.pic.width, it.pic.height)), cap = document.createElement('canvas')
    cap.width = Math.round(it.pic.width * k); cap.height = Math.round(it.pic.height * k)
    cap.getContext('2d')!.drawImage(it.pic, 0, 0, cap.width, cap.height)
    const blob = await new Promise<Blob | null>(res => cap.toBlob(res, 'image/jpeg', 0.82))
    if (!blob) return
    const t0 = performance.now(), fd = new FormData(); fd.append('file', blob, 'frame.jpg')
    const known = Object.keys(cards).slice(-40).join(',')
    const a = IDENTIFY
      ? await $fetch<FrameAnswer>('/api/wines/ar-frame', { method: 'POST', body: fd, query: known ? { known } : undefined, timeout: 12000 })
      : await $fetch<any>('/api/ar/detect', { method: 'POST', body: fd, timeout: 10000 })
        .then(d => ({ image: { width: d.width, height: d.height }, cards: {}, ms: d.ms?.total ?? 0,
          bottles: (d.bottles || []).map((b: any) => ({ bbox: b.bbox, polygon: b.polygon || null, status: 'not_found', slug: null, read: {} })) }) as FrameAnswer)
    if (!running || my !== gen) return
    stats.rtt = Math.round(performance.now() - t0); stats.ml = a.ms; banner.value = ''; backoff = 0
    const fr = frameOf.get(it.id)
    if (fr) apply(a, fr, posOf.get(it.id) || null)                     // its frame is already on screen: carried over by the tracker
    else early.set(it.id, a)                                           // still in the buffer: applied when its frame is shown
  } catch (e: any) {
    banner.value = e?.data?.statusMessage || 'Нет связи с сервисом распознавания'; backoff = Math.min(6000, backoff ? backoff * 2 : 1000)
    nextSend = nowTs + backoff
  } finally { inflight-- }
}
// a server answer for the tracker frame `sent`
function apply(a: FrameAnswer, sent: number, pos: Map<number, V2> | null) {
  if (!lt) return
  Object.assign(cards, a.cards)
  const W = a.image?.width || 1, H = a.image?.height || 1, k = TRACK_W / W
  const zs = frontZonesIdx(a.bottles, W, H)
  lt.answer(sent, zs.map(z => z.quad.map(([x, y]) => [x * k, y * k] as [number, number])),
    a.bottles.filter(b => b.bbox.length === 4 && b.bbox[3]! - b.bbox[1]! >= 0.3 * H).map(b => b.bbox.map(v => v * k)),
    IDENTIFY ? zs.map(z => ({ status: z.det.status, slug: z.det.slug, read: z.det.read } as Meta)) : [])
  const ps = pos || new Map(placed.value.map(p => [p.l.id, [p.x, p.y] as V2])), ks = vw.value / W
  bottlesSeen(a.bottles, ks, ps)
  lastDet = { at: nowTs, boxes: a.bottles.filter(b => b.bbox.length === 4 && b.bbox[3]! - b.bbox[1]! >= 0.3 * H).map(b => b.bbox.map(v => v * ks)), pos: ps }
}
/** the lead label's bottle alone in the last answer, or >= 1.8x as wide as each other bottle (one cut by the frame edge
 *  counts unless it is mostly out of view) */
function alone(id: number) {
  const d = lastDet; if (!d || nowTs - d.at > 2500) return false
  const p = d.pos.get(id); if (!p) return false
  const mine = d.boxes.find(b => b[0]! <= p[0] && p[0] <= b[2]! && b[1]! <= p[1] && p[1] <= b[3]!); if (!mine) return false
  const w0 = mine[2]! - mine[0]!
  return d.boxes.every(b => b === mine || (b[2]! - b[0]!) * 1.8 <= w0 && !((b[0]! <= 2 || b[2]! >= vw.value - 2) && (b[2]! - b[0]!) >= 0.25 * w0))
}
// what the masks of one answer give (comp_scan.py / comp_panel.py): the bottle axes -> world «up»; per label the bottle's base
// (px below the label point) and height, for the panel — from the box that holds the label point at the sent frame
function bottlesSeen(bs: FrameBottle[], k: number, pos: Map<number, V2>) {
  const W = vw.value, H = vh.value, lines: V3[] = []
  for (const b of bs) {
    if (b.bbox.length !== 4 || !b.polygon) continue
    const l = axisLine(b.polygon.map(([x, y]) => [x! * k, y! * k] as V2), b.bbox.map(v => v * k), W, H)
    if (l) lines.push(l)
  }
  const u = upFromAxes(lines, cam); if (u) upMeas = u
  for (const [id, [cx, cy]] of pos) {
    const g = geo.get(id); if (!g) continue
    const b = bs.find(b => b.bbox.length === 4 && b.bbox[0]! * k < cx && cx < b.bbox[2]! * k && b.bbox[1]! * k < cy && cy < b.bbox[3]! * k)
    if (!b) continue
    const y0 = b.bbox[1]! * k, y1 = b.bbox[3]! * k
    if (y1 >= H - 3 || y0 <= 2) continue                              // cut by the frame: the base / height are not known
    const rb = (y1 - cy) / g.wr, rh = (y1 - y0) / g.wr
    if (rh < 1.5 || rh > 9) continue                                  // a box that is not this bottle
    if (!g.hasB) { g.rb = rb; g.rh = rh; g.hasB = true }
    else { g.rb += (rb - g.rb) * 0.15; g.rh += (rh - g.rh) * 0.15 }  // a box per answer is noisy: eased over several answers
    baseRatio = g.rb; heightRatio = g.rh
  }
}

async function start() {
  halt(); const my = gen; measure()
  if (testSrc) {
    video.value!.src = testSrc; video.value!.muted = true; video.value!.loop = true; video.value!.playbackRate = rate
    await video.value!.play().catch(() => {})
  }
  else {
    if (!navigator.mediaDevices?.getUserMedia) { state.value = 'fallback'; reason.value = 'Браузер не даёт доступ к камере на этой странице (нужен https).'; return }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      if (my !== gen) { s.getTracks().forEach(t => t.stop()); return }
      stream = s; video.value!.srcObject = s; await video.value!.play()
    } catch (e: any) {
      state.value = 'fallback'
      reason.value = e?.name === 'NotAllowedError' ? 'Нет доступа к камере. Разрешите его в настройках браузера или сфотографируйте этикетку.' : 'Камера недоступна. Сфотографируйте этикетку или загрузите фото.'
      return
    }
  }
  if (my !== gen) return
  state.value = 'live'; running = true; schedule(my)
}
function halt() { gen++; running = false; stream?.getTracks().forEach(t => t.stop()); stream = null; queue.length = 0; early.clear(); frameOf.clear(); posOf.clear(); lastTs = 0 }
function close() { halt(); history.length > 1 ? useRouter().back() : navigateTo('/wines') }

// ---------------- one wine in view: its card grows into the panel (comp_panel.py) ----------------
const HOLD_MS = 500, GRACE_MS = 400, FADE_MS = 333
const ex = ref(0)                                    // 0 = the card, 1 = the panel
const domSlugR = ref('')                             // the wine the panel shows (kept while it folds)
const bigEl = ref<HTMLElement[]>([])
const pside = shallowRef<{ right: boolean, w: number, m: string, o: number }[]>([])
let domSlug = '', domSince = 0, domSeen = 0, anchor: Placed | null = null
let side: boolean | null = null, switchAt = -1e9
const pq: { l?: Quad, r?: Quad } = {}                  // the eased plate corners per side
const smooth = (x: number) => x * x * (3 - 2 * x)
function dominate(ts: number, dt: number, up: V3) {
  // every bottle in view counts for the size; the panel needs a recognised one; other tracks of the same wine do not compete
  const seen = placed.value.filter(p => p.l.opacity > 0.3)
  const named = seen.filter(p => face(p.l).kind === 'found')
  const lead = named.reduce<Placed | null>((b, p) => (!b || p.wr > b.wr ? p : b), null)
  const leadSlug = lead ? face(lead.l).card!.slug : ''
  const ok = !!lead && seen.every(p => (face(p.l).kind === 'found' && face(p.l).card!.slug === leadSlug) || lead.wr >= 1.8 * p.wr) && alone(lead.l.id)
  const slug = ok ? leadSlug : ''
  if (slug && slug !== domSlug) { domSlug = slug; domSince = ts }
  if (slug) domSeen = ts
  else if (domSlug && ts - domSeen > GRACE_MS) domSlug = ''           // a lost label waits like the render's GONE frames
  const on = !!domSlug && ts - domSince >= HOLD_MS && (!!slug || ts - domSeen <= GRACE_MS)
  ex.value = on ? Math.min(1, ex.value + dt / 300) : Math.max(0, ex.value - dt / 233)
  if (on) domSlugR.value = domSlug
  if (domSlugR.value) {                                                // the anchor: the newest track of that wine in view
    const ts_ = placed.value.filter(p => face(p.l).kind === 'found' && face(p.l).card!.slug === domSlugR.value)
    if (ts_.length) anchor = ts_.reduce((b, p) => (p.l.id > b.l.id ? p : b))
  }
  if (ex.value === 0 || !anchor) { domSlugR.value = ''; anchor = null; side = null; pside.value = []; pq.l = pq.r = undefined; return }
  const el = bigEl.value[0], pw = el?.offsetWidth || 266, ph = el?.offsetHeight || 600
  const g = geo.get(anchor.l.id), bb = (g?.rb ?? baseRatio) * anchor.wr, bh = (g?.rh ?? heightRatio) * anchor.wr
  const Q = (right: boolean) => panelQuad(cam, anchor!.P, anchor!.wr, bb, bh, pw / ph, up, right)
  // the side where the panel stays on screen; it changes only when more than 30% would be off screen there and clearly less on the
  // other side — by a cross-fade, never a jump
  const vr = onScreen(Q(true), vw.value, vh.value), vl = onScreen(Q(false), vw.value, vh.value)
  if (side === null) side = vr >= vl
  else if ((side ? vr : vl) < 0.7 && (side ? vl : vr) > (side ? vr : vl) + 0.15) { side = !side; switchAt = ts }
  const f = Math.min(1, (ts - switchAt) / FADE_MS), ek = smooth(ex.value)
  const sides = [{ right: side, w: smooth(f) }, ...(f < 1 ? [{ right: !side, w: smooth(1 - f) }] : [])]
  // the plate's corners eased in time (σ 4 frames): it stands still by the bottle instead of shivering with every estimate
  const kq = ema(dt, 4)
  pside.value = sides.map(sd => {
    const tgt = Q(sd.right), key = sd.right ? 'r' : 'l', prev = pq[key]
    const q = prev ? (prev.map((p, i) => [p[0] + (tgt[i]![0] - p[0]) * kq, p[1] + (tgt[i]![1] - p[1]) * kq]) as Quad) : tgt
    pq[key] = q
    return { right: sd.right, w: sd.w, m: quadMatrix(pw, ph, lerpQuad(anchor!.q, q, ek)), o: Math.min(1, ek * 1.3) * sd.w }
  })
}
// ---------------- the scanned wines: the bar, the sheet, their marks on the bottles ----------------
const scanned = ref<string[]>([])                        // catalogue wines recognised so far, in the order they were found
const sheetOpen = ref(false)
const shelf = shallowRef<{ picks: string[], pass: string[], filters: string[], why: Record<string, string> }>({ picks: [], pass: [], filters: [], why: {} })
const shown = shallowRef(shelf.value)                    // what the bottles show: the sheet's state as it was closed
function openSheet() {
  if (sheetOpen.value) return
  sheetOpen.value = true
  if (testSrc) video.value?.pause()
}
function closeSheet() {
  if (!sheetOpen.value) return
  sheetOpen.value = false; shown.value = shelf.value
  queue.length = 0; early.clear()
  if (testSrc) video.value?.play().catch(() => {})
}
const markOf = (slug?: string) => {
  if (!slug || !scanned.value.includes(slug)) return ''
  if (inCollection(slug)) return 'col'
  return shown.value.picks.includes(slug) ? 'pick' : ''
}
const dimmed = (slug?: string) => !!shown.value.filters.length && !!slug && !shown.value.pass.includes(slug)
const { inCollection } = useMyWines()
const pcard = computed(() => (domSlugR.value ? cards[domSlugR.value] ?? null : null))
// the card of the dominating wine turns into the panel
const cardOpacity = (p: Placed) => p.l.opacity * (dimmed(face(p.l).card?.slug) ? 0.45 : 1) * (domSlugR.value && face(p.l).card?.slug === domSlugR.value ? (1 - smooth(ex.value)) ** 2 : 1)
// the region map of the panel: a crop of the coastline around the pin (as the reference render)
const pmap = computed(() => {
  const g = pcard.value?.geo; if (!g) return null
  const x = (g.lon - AR_MAP.lon0) * AR_MAP.kx, y = (AR_MAP.lat1 - g.lat) * AR_MAP.k, bw = 70, bh = bw * 64 / 200
  return { vb: `${(x - bw / 2).toFixed(1)} ${(y - bh / 2).toFixed(1)} ${bw} ${bh.toFixed(1)}`, x, y }
})
function openWine(slug?: string) { if (slug) { halt(); navigateTo(`/wines/${slug}`) } }
function tap(l: LabelView) {
  const f = face(l)
  if (f.kind === 'found' && f.card) openWine(f.card.slug)
}
onMounted(() => {
  if (debug) (window as any).__lt = () => lt
  if (AS) $fetch<ArCard>(`/api/wines/${AS}/ar`).then(c => { cards[AS] = c }).catch(() => {})
  start(); window.addEventListener('resize', turned)
})
onBeforeUnmount(() => { halt(); window.removeEventListener('resize', turned) })
// the phone turned (or the browser bars moved): new screen geometry for the tracker, the camera keeps running
function turned() {
  if (state.value !== 'live') return start()
  queue.length = 0; early.clear(); frameOf.clear(); posOf.clear(); lastDet = null; lastTs = 0
  measure(); placed.value = []; ex.value = 0
}
</script>

<template>
  <div class="arc">
    <video ref="video" class="arc__src hidden" playsinline muted autoplay />
    <canvas ref="screen" class="arc__src" :class="{ hidden: state !== 'live' }" />
    <!-- a portrait card on every followed label: CARD_W x CARD_H layout mapped onto its 3D rectangle (utils/arRender.ts) -->
    <button v-for="p in placed" :key="p.l.id" class="arc__card" :class="`arc__card--${face(p.l).kind}`"
            :style="{ transform: p.m, opacity: cardOpacity(p) }" :aria-label="face(p.l).title" @click="tap(p.l)">
      <span v-if="face(p.l).card?.rating" class="arc__rating"><RatingGlass />{{ Number(face(p.l).card!.rating).toFixed(2) }}</span>
      <span v-else class="arc__chip">{{ face(p.l).note }}</span>
      <span class="arc__img">
        <img v-if="face(p.l).card?.img" :src="face(p.l).card!.img" alt="" />
        <svg v-else viewBox="0 0 40 110" aria-hidden="true"><path d="M15 4h10v22c0 6 9 10 9 22v54a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V48c0-12 9-16 9-22V4Z" /><rect x="8" y="56" width="24" height="30" rx="2" /></svg>
      </span>
      <b class="arc__title">{{ face(p.l).title }}</b>
      <span v-if="face(p.l).maker" class="arc__maker">{{ face(p.l).maker }}</span>
      <span v-if="markOf(face(p.l).card?.slug) === 'pick'" class="arc__band"><AppIcon name="star4" :size="13" />Рекомендация</span>
      <span v-else-if="markOf(face(p.l).card?.slug) === 'col'" class="arc__band arc__band--col"><AppIcon name="heart" :size="12" />В коллекции</span>
    </button>

    <!-- one wine in view: its card grown into the full «Своё вино» panel standing by the bottle (two copies while it changes sides) -->
    <template v-if="pcard">
      <div v-for="(sd, i) in pside" :key="sd.right ? 'r' : 'l'" ref="bigEl" class="big" :style="{ transform: sd.m, opacity: sd.o, zIndex: 4 + i }">
        <div v-if="shown.picks.includes(pcard.slug)" class="big__rec"><AppIcon name="star4" :size="13" />Рекомендация для вас<template v-if="shown.why[pcard.slug]"> · {{ shown.why[pcard.slug] }}</template></div>
        <div class="big__top"><span>Своё вино</span><b v-if="pcard.rating">★ {{ Number(pcard.rating).toFixed(2) }}</b></div>
        <h3 class="big__title">{{ pcard.title }}</h3>
        <span class="big__maker">{{ pcard.manufacturer }}</span>
        <span class="big__meta">{{ [pcard.category, pcard.alcohol ? `${pcard.alcohol}%` : '', (pcard.grapes || []).join(', ')].filter(Boolean).join(' · ') }}</span>
        <div v-if="pmap" class="big__map">
          <svg :viewBox="pmap.vb" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <path :d="AR_LAND" fill="#efe4cc" stroke="#d9c8a6" stroke-width=".3" />
            <g :transform="`translate(${pmap.x.toFixed(1)},${pmap.y.toFixed(1)})`"><circle r="4.2" fill="rgba(143,61,66,.15)" />
              <path d="M0 1.6 C-1.6 -.6 -2.2 -1.4 -2.2 -2.6 A2.2 2.2 0 1 1 2.2 -2.6 C2.2 -1.4 1.6 -.6 0 1.6Z" fill="#8f3d42" /><circle cy="-2.6" r=".8" fill="#fff" /></g>
          </svg>
          <span>Россия, {{ pcard.region }}</span>
        </div>
        <template v-if="pcard.taste?.length">
          <h4>{{ pcard.tasteFromStyle ? 'Типичный вкус стиля' : 'Вкусовой профиль' }}</h4>
          <div class="big__row"><div v-for="t in pcard.taste.slice(0, 4)" :key="t.label" class="big__it"><i v-html="arIcon(AR_TASTE_ICON[t.label] || '')" /><span>{{ t.label }}</span></div></div>
        </template>
        <template v-if="pcard.pairs?.length">
          <h4>С чем сочетается</h4>
          <div class="big__row"><div v-for="t in pcard.pairs.slice(0, 4)" :key="t.label" class="big__it"><i v-html="arIcon(AR_PAIR_ICON[t.label] || '')" /><span>{{ t.label }}</span></div></div>
        </template>
        <span v-if="pcard.temperature" class="big__srv"><i v-html="arIcon('lucide:thermometer')" />Подавать при {{ pcard.temperature.replace('-', '–') }} °C</span>
        <button class="big__btn" @click="openWine(pcard!.slug)">Подробнее о вине <i v-html="arIcon('lucide:chevron-right')" /></button>
      </div>
    </template>

    <!-- the controls keep the phone's portrait layout whichever way it is held (the picture and AR follow gravity) -->
    <div class="arc__ui" :style="rot ? { width: `${vh}px`, height: `${vw}px`, transform: `translate(-50%, -50%) rotate(${-rot}deg)` } : {}">
    <div class="arc__top">
      <button class="arc__round" aria-label="Закрыть" @click="close"><AppIcon name="close" /></button>
      <nav class="arc__modes" aria-label="Режим сканера">
        <NuxtLink to="/scan" replace class="arc__mode">Фото</NuxtLink>
        <span class="arc__mode on" aria-current="page">AR</span>
      </nav>
      <span class="arc__round arc__round--ghost" />
    </div>
    <p v-if="banner" class="arc__banner" role="status">{{ banner }}</p>
    <button v-if="state === 'live'" class="arc__bar" :aria-expanded="sheetOpen" @click="openSheet">
      <span class="arc__thumbs"><span v-for="sl in scanned.slice(-4)" :key="sl" class="arc__thumb"><img v-if="cards[sl]?.img" :src="cards[sl]!.img" alt="" /></span></span>
      <span class="arc__bt"><b>{{ scanned.length ? `Отсканировано: ${scanned.length}` : 'Наведите на полку' }}</b>
        <small v-if="shown.filters.length || shown.picks.length">{{ [...shown.filters, shown.picks.length ? 'Рекомендация · по вашему вкусу' : ''].filter(Boolean).join(' · ') }}</small></span>
      <svg class="arc__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
    </button>
    <ArShelfSheet :open="sheetOpen" :slugs="scanned" :cards="cards" @close="closeSheet" @state="v => (shelf = v)" />
    <div v-if="debug" class="arc__debug">поворот {{ rot }}° · задержка {{ DELAY }} мс · {{ stats.fps.toFixed(0) }} fps · трекинг {{ stats.track.toFixed(1) }} мс · ответ {{ stats.rtt }} мс (сервер {{ stats.ml }}) · карточек {{ placed.length }}</div>
    </div>
    <div v-if="state === 'fallback'" class="arc__fallback">
      <p>{{ reason }}</p>
      <NuxtLink to="/scan" replace class="btn btn-primary btn-block">Сфотографировать этикетку</NuxtLink>
    </div>
  </div>
</template>

<style scoped>
/* the «Своё вино» panel, opaque: cream surface, uppercase eyebrow, Playfair title, line icons */
.big { position: absolute; left: 0; top: 0; z-index: 4; width: 228px; padding: 18px 18px 16px; box-sizing: content-box; border-radius: 26px; color: #2c2a28;
  background: linear-gradient(160deg, #fffcf4, #faf3e4); border: 1px solid #fff;
  box-shadow: inset 0 1px 0 #fff, 0 18px 40px rgba(0, 0, 0, .25);
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif; -webkit-font-smoothing: antialiased; transform-origin: 0 0; will-change: transform, opacity; }
.big__top { display: flex; justify-content: space-between; align-items: center; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #7a746c; }
.big__top b { background: #f8ecc9; color: #2c2a28; border-radius: 10px; padding: 3px 8px; font-size: 11.5px; font-weight: 600; letter-spacing: 0; text-transform: none; }
.big__title { font: 700 22px/1.12 var(--serif); margin: 10px 0 4px; }
.big__maker { display: block; color: #8f3d42; font-weight: 600; font-size: 13.5px; }
.big__meta { display: block; color: #7a746c; font-size: 12px; margin-top: 3px; }
.big__map { position: relative; margin: 12px 0 4px; height: 64px; border-radius: 14px; overflow: hidden; background: #e6ecee; }
.big__map svg { width: 100%; height: 100%; display: block; }
.big__map span { position: absolute; left: 8px; bottom: 7px; background: rgba(255, 255, 255, .9); border-radius: 9px; padding: 3px 8px; font-size: 11.5px; font-weight: 600; }
.big h4 { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #7a746c; margin: 13px 0 8px; }
.big__row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; }
.big__it { display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center; font-size: 10.5px; line-height: 1.2; }
.big__it i { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: #fff; border: 1px solid rgba(143, 61, 66, .16); }
.big :deep(svg.ic) { width: 20px; height: 20px; color: #8f3d42; stroke: #8f3d42; }
.big :deep(svg.ic[viewBox="0 0 256 256"]) { fill: #8f3d42; stroke: none; }
.big__srv { display: flex; align-items: center; gap: 6px; margin-top: 14px; font-size: 12.5px; font-weight: 600; }
.big__srv :deep(svg.ic) { width: 16px; height: 16px; }
.big__btn { margin-top: 12px; width: 100%; height: 38px; border: 0; border-radius: 19px; background: #8f3d42; color: #fff; display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 13.5px; font-weight: 600; }
.big__btn :deep(svg.ic) { width: 16px; height: 16px; color: #fff; stroke: #fff; }
.arc { position: fixed; inset: 0; background: #1d1714; color: #fff; overflow: hidden; touch-action: manipulation; }
.arc__src { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.arc__src.hidden { opacity: 0; }
/* the catalogue card (WineCard) in portrait: cream surface, rating pill, bottle photo, title, maker in the accent colour */
.arc__card { position: absolute; left: 0; top: 0; width: 160px; height: 236px; box-sizing: border-box; padding: 10px 11px 11px; transform-origin: 0 0; z-index: 2;
  display: flex; flex-direction: column; align-items: flex-start; text-align: left; border: 0; border-radius: var(--radius-m);
  background: var(--surface); color: var(--text); box-shadow: 0 10px 28px rgba(0, 0, 0, .35), 0 0 0 1px rgba(143, 61, 66, .08); }
.arc__rating, .arc__chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px 3px 7px; border-radius: 14px; background: var(--pill);
  font-size: 11px; font-weight: 600; color: var(--text); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arc__chip { padding-left: 9px; }
.arc__img { flex: 1; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; margin: 6px 0 8px; }
.arc__img img { max-width: 100%; max-height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.arc__img svg { height: 92%; fill: var(--surface-2); stroke: var(--line); stroke-width: 1.2; }
.arc__img svg rect { fill: var(--accent-soft); }
.arc__title { font-size: 14px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.arc__maker { font-size: 12px; color: var(--accent); margin-top: 3px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arc__card--pending .arc__title, .arc__card--nf .arc__title { font-family: var(--serif); font-size: 17px; }
.arc__bar { position: absolute; left: 14px; right: 14px; bottom: calc(18px + var(--safe-bottom, 0px)); height: 58px; display: flex; align-items: center; gap: 10px;
  padding: 0 14px 0 11px; border: 0; border-radius: 20px; background: rgba(253, 251, 246, .98); color: var(--text); box-shadow: 0 6px 20px rgba(0, 0, 0, .35); text-align: left; }
.arc__thumbs { display: flex; flex: none; }
.arc__thumb { width: 36px; height: 36px; border-radius: 50%; background: var(--surface); border: 1.5px solid #fff; display: grid; place-items: center; overflow: hidden; }
.arc__thumb + .arc__thumb { margin-left: -14px; }
.arc__thumb img { height: 86%; object-fit: contain; mix-blend-mode: multiply; }
.arc__bt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.arc__bt b { font-size: 15px; font-weight: 700; }
.arc__bt small { font-size: 12px; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arc__chev { width: 22px; height: 22px; flex: none; fill: none; stroke: #7a746c; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.arc__band { position: absolute; left: 0; right: 0; bottom: 0; height: 30px; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 0 0 var(--radius-m) var(--radius-m);
  background: #f3c46a; color: #5b3a06; font-size: 12.5px; font-weight: 700; }
.arc__band--col { background: #c0392b; color: #fff; }
.big__rec { display: flex; align-items: center; gap: 5px; margin: -4px -4px 10px; padding: 6px 10px; border-radius: 12px; background: #f3c46a; color: #5b3a06; font-size: 12px; font-weight: 700; line-height: 1.25; }
.arc__ui { position: absolute; left: 50%; top: 50%; width: 100%; height: 100%; transform: translate(-50%, -50%); z-index: 5; pointer-events: none; }
.arc__ui > * { pointer-events: auto; }
.arc__top { position: absolute; top: 0; left: 0; right: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; padding: 16px;
  background: linear-gradient(rgba(0, 0, 0, .45), transparent); }
.arc__round { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: rgba(0, 0, 0, .35); color: #fff; }
.arc__round--ghost { background: transparent; }
.arc__modes { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(0, 0, 0, .45); }
.arc__mode { min-width: 64px; padding: 9px 16px; border-radius: 999px; font-size: 14px; font-weight: 600; text-align: center; color: rgba(255, 255, 255, .88); text-decoration: none; }
.arc__mode.on { background: #fff; color: #2c2a28; }
.arc__banner { position: absolute; left: 50%; transform: translateX(-50%); z-index: 6; margin: 0; text-align: center; font-size: 14px; }
.arc__banner { top: 80px; width: max-content; max-width: calc(100% - 32px); padding: 8px 14px; border-radius: 12px; background: rgba(179, 107, 22, .9); }
.arc__debug { position: absolute; left: 8px; top: 76px; z-index: 6; font: 11px ui-monospace, monospace; background: rgba(0, 0, 0, .55); padding: 3px 6px; border-radius: 6px; }
.arc__fallback { position: absolute; inset: 0; z-index: 7; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 32px;
  text-align: center; background: var(--bg); color: var(--text); }
</style>
