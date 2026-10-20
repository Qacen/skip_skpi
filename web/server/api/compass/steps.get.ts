// GET /api/compass/steps -> { steps: [{ key, n, title, plain, notice, pair, examples: [wine mini + price] }] }
// «Винный компас»: the 6 style steps with their example wines (reliable, widely sold — shared/compass.ts).
import { STEPS } from '#shared/compass'
import { bySlug, card } from '../../utils/catalog'

export default defineEventHandler(async () => {
  const steps = await Promise.all(STEPS.map(async s => ({
    ...s,
    examples: (await Promise.all(s.examples.map(async slug => {
      const w = await bySlug(slug); if (!w) return null
      const c = await card(slug)
      return { slug: w.slug, title: w.title, manufacturer: w.manufacturer, img: w.img, category: w.category, color: w.color, sweetness: w.sweetness,
        rating: w.rating, guideRating: w.guideRating ?? null, grapes: w.grapes, price: c?.extra?.prices?.min ?? null }
    }))).filter(Boolean),
  })))
  return { steps }
})
