// POST /api/ar/detect (multipart "file": one viewfinder frame) — bottle boxes + RF-DETR-Seg mask polygons only (ML /rt/detect),
// no recognition: the live AR (/scan/ar, tracking-only mode) finds label zones from the masks and follows them on the phone.
import { callMl, mlErrorMessage, photoForm } from '../../utils/recognizer'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Нужен кадр (поле file)' })
  try {
    const { data } = await callMl<any>('/rt/detect', photoForm({ data: file.data, filename: 'frame.jpg', type: file.type || 'image/jpeg' }), { poly: '1', threshold: '0.3' })
    // TEMP debug (AR on the phone): the last frame and answer go to AR_DUMP_DIR, only when it is set
    if (process.env.AR_DUMP_DIR) {
      const fs = await import('node:fs/promises')
      await fs.writeFile(`${process.env.AR_DUMP_DIR}/last.jpg`, file.data).catch(() => {})
      await fs.writeFile(`${process.env.AR_DUMP_DIR}/last.json`, JSON.stringify(data)).catch(() => {})
    }
    return data
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: mlErrorMessage(e), data: String(e?.message || e) })
  }
})
