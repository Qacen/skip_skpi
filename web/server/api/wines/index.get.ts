// GET /api/wines — same contract as the portal: { currentPage, totalPages, itemsPerPage, totalItems, items }
// query: page, limit, search, color, sweetness, region, grape, manufacturer, dish (comma-separated or repeated), sort=rating|title
import { catalog, textScore } from '../../utils/catalog'

const list = (v: unknown): string[] => (Array.isArray(v) ? v : v ? [v] : []).flatMap(x => String(x).split(',')).filter(Boolean)

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page) || 1)
  const limit = Math.min(60, Math.max(1, Number(q.limit) || 16))
  const f = { color: list(q.color), sweetness: list(q.sweetness), region: list(q.region), grape: list(q.grape), manufacturer: list(q.manufacturer), dish: list(q.dish) }
  let items = (await catalog()).filter(w =>
    (!f.color.length || f.color.includes(w.color)) &&
    (!f.sweetness.length || f.sweetness.includes(w.sweetness)) &&
    (!f.region.length || f.region.includes(w.region)) &&
    (!f.manufacturer.length || f.manufacturer.includes(w.manufacturer)) &&
    (!f.grape.length || w.grapes.some(g => f.grape.includes(g))) &&
    (!f.dish.length || w.dishes.some(d => f.dish.includes(d))))
  const search = String(q.search || '').trim()
  if (search) {
    items = items.map(w => ({ w, s: textScore(search, w) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.w)
  } else if (q.sort === 'title') {
    items = [...items].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  }
  const totalItems = items.length
  return { currentPage: page, totalPages: Math.max(1, Math.ceil(totalItems / limit)), itemsPerPage: limit, totalItems,
    items: items.slice((page - 1) * limit, page * limit) }
})
