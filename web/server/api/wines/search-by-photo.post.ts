// POST /api/wines/search-by-photo (multipart "file") — the scanner endpoint used by the UI.
// Every detected bottle gets its own match + mini card (a shelf photo -> several wines); the PRIMARY bottle gets the full card
// and analogs. Still one card per bottle, never a list of candidate variants (TZ). Not in the catalog -> style analogs from other wineries.
import { card, catalog, bySlug } from '../../utils/catalog'
import { profileFromCandidates, profileLead, rankAnalogs } from '../../utils/analogs'
import { mlErrorMessage, recognize } from '../../utils/recognizer'
import { pickDisplay } from '../../utils/prominence'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Нужна фотография (поле file)' })
  if (file.data.length > 15 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'Фото больше 15 МБ' })
  const t0 = Date.now()
  let r
  try {
    const force = import.meta.dev ? String(getQuery(event).force || '') || undefined : undefined   // testing knob, dev only
    r = await recognize({ data: file.data, filename: file.filename, type: file.type }, force)
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: mlErrorMessage(e), data: String(e?.message || e) })
  }
  const items = await catalog()
  const mini = (w: any) => w && { slug: w.slug, title: w.title, manufacturer: w.manufacturer, img: w.img, rating: w.rating, category: w.category, region: w.region, color: w.color, sweetness: w.sweetness }
  // the page only needs geometry for the dots + each bottle's match and mini card: masks, label zones and nearest-wine lists
  // stay in the ML response / API logs, not in the browser
  const bottles = await Promise.all(r.detection.bottles.map(async b => ({
    bbox: b.bbox, center: b.center, score: b.score, source: b.source,
    match: { status: b.match.status, slug: b.match.slug, read: b.match.read },
    wine: b.match.status === 'found' && b.match.slug ? mini(await bySlug(b.match.slug)) || null : null,
  })))
  // which bottles the result screen marks (one dominating bottle / the whole front row) and which one gets the full card
  const { display, layout } = pickDisplay(r.detection.bottles, r.detection.image, r.primary)
  const focus = layout === 'single' ? display[0]! : r.primary
  const m = r.detection.bottles[focus]!.match
  const wine = m.status === 'found' && m.slug ? await card(m.slug) : null
  // style of the photographed wine: the top candidates' colour / sweetness / grapes (or what was read from the label)
  const cands = (await Promise.all((m.confidence?.top5 || []).map(c => bySlug(c.slug)))).filter(Boolean)
  // analogs from OTHER wineries with a match % and reasons. Found: relative to the wine. Not in the catalog: relative to a
  // profile of the photographed wine (colour/sweetness read from the label + grapes/notes voted by the top visual candidates);
  // the candidates' winery is excluded — the closest candidates are usually the same producer / line.
  const top5 = m.confidence?.top5 || []
  const profile = wine ? null : await profileFromCandidates(top5, m.read)
  const analogs = profile
    ? await rankAnalogs(profile, { limit: 12, exclude: top5.map(c => c.slug) })
    : await rankAnalogs({ slug: wine!.slug }, { limit: 12 })
  const analogsLead = profile ? profileLead(profile, m.read) : null
  // only what the page draws (+ confidence for API consumers, TZ); masks, label zones, nearest wines, timings are not sent to the browser
  return { status: wine ? 'found' : 'not_found', slug: wine?.slug ?? null, read: m.read, confidence: m.confidence,
    primary: r.primary, focus, display, layout, wine, analogs, analogsLead, detection: { image: r.detection.image, bottles } }
})
