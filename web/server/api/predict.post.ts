// POST /api/predict — endpoint for the organizer's evaluation script: one photo in, flat {"slug": "wine-slug"} out.
// Also accepts the raw image as the request body (curl --data-binary @photo.jpg).
import { callMl, mlEndpoints, photoForm, recognize } from '../utils/recognizer'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event).catch(() => undefined)
  const file = parts?.find(p => p.data?.length && (p.name === 'file' || p.name === 'image' || p.type?.startsWith('image/')))
  const data = file?.data || (await readRawBody(event, false))
  if (!data || !data.length) throw createError({ statusCode: 400, statusMessage: 'no image' })
  const photo = { data: Buffer.from(data), filename: file?.filename, type: file?.type }
  // ML /predict matches only the primary bottle and always answers its top-1 (organiser's test = catalog wines only;
  // "not found" is a website concept) -> faster than the full /recognize
  if (mlEndpoints().length) {
    try {
      const { data: r } = await callMl<{ slug: string }>('/predict', photoForm(photo))
      return { slug: r?.slug || '' }
    } catch { /* fall through to the full recognition */ }
  }
  const r = await recognize(photo)
  return { slug: r.slug || r.confidence?.top5?.[0]?.slug || '' }
})
