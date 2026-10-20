// POST /api/wines/ar-frame (multipart "file": one camera frame, the visible part of the viewfinder, <= ~960 px) — live AR mode.
// Same recognition as the photo scanner (ML /recognize), but a light answer for a loop of ~2 frames/s: every bottle's box, mask
// polygon and match, plus the compact AR card of every recognised wine the client does not have yet (?known=slug1,slug2).
// Frames are not stored or logged.
import { arCard, type ArCard } from '../../utils/arcard'
import { mlErrorMessage, recognize } from '../../utils/recognizer'
// a frame is matched for its front row only: the largest bottles (a shelf photo keeps up to 32) — keeps the answer ~1 s on a Mac
const AR_MAX_BOTTLES = 6

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Нужен кадр (поле file)' })
  if (file.data.length > 4 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'Кадр больше 4 МБ' })
  const known = new Set(String(getQuery(event).known || '').split(',').filter(Boolean))
  const t0 = Date.now()
  let r
  try {
    r = await recognize({ data: file.data, filename: 'frame.jpg', type: file.type || 'image/jpeg' }, undefined, 'polygon', AR_MAX_BOTTLES)
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: mlErrorMessage(e), data: String(e?.message || e) })
  }
  const raw = r.detection.bottles.map(b => ({
    bbox: b.source === 'full_image' ? [] : b.bbox,      // no bottle found: the whole frame was matched (label close-up)
    polygon: b.mask?.polygon || null,                   // bottle silhouette: the client finds the label zone from it
    score: b.score ?? 0,
    status: b.match.status,
    slug: b.match.status === 'found' ? b.match.slug : null,
    top1: b.match.confidence?.top1 ?? null,
    read: b.match.read || {},
  }))
  // a slug is looked up once per frame; the ones in ?known= are already resolved on the client (trusted, no lookup)
  const slugs = [...new Set(raw.map(b => b.slug).filter((s): s is string => !!s && !known.has(s)))]
  const resolved = new Map(await Promise.all(slugs.map(async s => [s, await arCard(s)] as const)))
  const cards: Record<string, ArCard> = {}
  for (const [s, c] of resolved) if (c) cards[s] = c
  // "found" without a card (slug is not in the web catalog) is "not_found", as in the photo flow: the client would
  // wait for a card that never comes ("Распознаю этикетку…" forever)
  const bottles = raw.map(b => b.status === 'found' && (!b.slug || (resolved.has(b.slug) && !resolved.get(b.slug)))
    ? { ...b, status: 'not_found' as const, slug: null } : b)
  return { image: r.detection.image, primary: r.primary, bottles, cards, demo: !!r.demo, ms: Date.now() - t0 }
})
