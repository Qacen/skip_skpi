// Compact AR card of one wine (the same as /api/wines/ar-frame returns per recognised bottle): taste notes, pairings, serving.
export default defineEventHandler(async (event) => {
  const c = await arCard(getRouterParam(event, 'slug') || '')
  if (!c) throw createError({ statusCode: 404, statusMessage: 'Вино не найдено' })
  return c
})
