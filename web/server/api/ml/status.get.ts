// GET /api/ml/status — which recognition backends are configured and alive (for whoever runs the demo; not linked from the UI)
import { mlEndpoints } from '../../utils/recognizer'

export default defineEventHandler(async () => {
  const list = await Promise.all(mlEndpoints().map(async (url) => {
    const t0 = Date.now()
    try {
      const h = await $fetch<any>(`${url}/health`, { timeout: 5000 })
      return { url, ok: true, ms: Date.now() - t0, model: h?.model?.name, detector: h?.detector, index: h?.index?.size }
    } catch (e: any) {
      return { url, ok: false, ms: Date.now() - t0, error: String(e?.statusCode || e?.cause?.code || e?.message || e).slice(0, 120) }
    }
  }))
  return { active: list.find(x => x.ok)?.url || null, endpoints: list }
})
