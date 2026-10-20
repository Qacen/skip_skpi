// GET /api/wines/:slug/similar?mode=similar|analogs&size=12
// analogs = OTHER wineries, explained (match % + reasons) — retention: "what else to buy if this one is missing / to try next"
import { bySlug, catalog } from '../../../utils/catalog'
import { rankSimilar } from '../../../utils/similar'
import { rankAnalogs } from '../../../utils/analogs'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') || ''
  const q = getQuery(event)
  const ref = await bySlug(slug)
  if (!ref) throw createError({ statusCode: 404, statusMessage: 'Вино не найдено' })
  const limit = Math.min(24, Number(q.size) || 12)
  // analogs: other wineries, ranked with reasons (server/utils/analogs.ts); similar: plain style similarity
  if (q.mode === 'analogs') return rankAnalogs({ slug }, { limit })
  return rankSimilar(ref, await catalog(), { excludeSlug: slug, otherWineries: false, limit })
})
