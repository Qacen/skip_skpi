// POST /api/wines/shelf-meta { slugs: string[], step?: string } -> { items: { [slug]: { price, guideRating, rating, grapes, color, sweetness, sparkling, fit? } } }
// What the shelf screen needs for its filters and the «Рекомендация» picks (price, guide score, style), and — in the
// «Винный компас» mode — how typical every recognised wine is for the current step (shared/compass.ts).
import { compassFit, stepByKey } from '#shared/compass'
import { isSparkling } from '#shared/taste'
import { bySlug, card } from '../../utils/catalog'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slugs?: string[], step?: string }>(event)
  const slugs = [...new Set((body?.slugs || []).filter(s => typeof s === 'string'))].slice(0, 64)
  const step = stepByKey(typeof body?.step === 'string' ? body.step : null)
  const items: Record<string, any> = {}
  await Promise.all(slugs.map(async slug => {
    const w = await bySlug(slug); if (!w) return
    const c = await card(slug)
    const notes = (c?.extra?.notes || []).map(n => n.text).join(' ')
    items[slug] = {
      price: c?.extra?.prices?.min ?? null, guideRating: w.guideRating ?? null, rating: w.rating, awards: c?.extra?.awards?.length || 0,
      grapes: w.grapes, color: w.color, sweetness: w.sweetness, sparkling: isSparkling(w), manufacturer: w.manufacturer,
      fit: step ? compassFit(step, { ...w, text: `${c?.description || ''} ${notes}` }) : undefined,
    }
  }))
  return { items }
})
