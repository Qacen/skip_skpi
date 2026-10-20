// GET /api/metrics — last eval_service.py run (accuracy@1, R@5, F1@1/F1@5, latency, per-photo misses), for app/pages/metrics.vue
export default defineEventHandler(async () => {
  const raw = await useStorage('assets:catalog').getItem<any | string>('metrics.json')
  if (!raw) throw createError({ statusCode: 404, statusMessage: 'Метрики ещё не посчитаны — запустите scripts/eval_service.py' })
  return typeof raw === 'string' ? JSON.parse(raw) : raw
})
