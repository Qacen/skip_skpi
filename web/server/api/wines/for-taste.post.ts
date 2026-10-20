// POST /api/wines/for-taste { colors, sweet, sparkling, body, dishes, exclude, limit } -> { items: [{ slug, title, …, reasons }] }
// «Вина в вашем стиле» of the personal cabinet: catalog wines ranked by the taste profile (questionnaire + collection ratings).
// The profile is the user's own explicit choice (a filter he can change at any time), not a hidden behavioural model.
import { rankForTaste } from '../../utils/analogs'

export default defineEventHandler(async (event) => {
  const b = await readBody<any>(event) || {}
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const colors = Object.fromEntries(Object.entries(b.colors && typeof b.colors === 'object' ? b.colors : {})
    .filter(([k, v]) => ['red', 'white', 'rose'].includes(k) && typeof v === 'number').map(([k, v]) => [k, Math.max(0, Math.min(1, v as number))]))
  const strs = (v: any, n: number) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, n) : [])
  return { items: await rankForTaste({
    colors, sweet: num(b.sweet) ?? null, sparkling: num(b.sparkling) ?? 0, body: ['light', 'full'].includes(b.body) ? b.body : null,
    dishes: strs(b.dishes, 60), exclude: strs(b.exclude, 200), limit: Math.max(1, Math.min(24, num(b.limit) ?? 12)),
  }) }
})
