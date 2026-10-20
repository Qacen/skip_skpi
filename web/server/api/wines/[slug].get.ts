// GET /api/wines/:slug — full wine card
import { card } from '../../utils/catalog'
import { bodyOf } from '../../utils/analogs'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') || ''
  const c = await card(slug)
  if (!c) throw createError({ statusCode: 404, statusMessage: 'Вино не найдено' })
  return { ...c, body: await bodyOf(slug) }   // light / full from the description: the taste profile compares it
})
