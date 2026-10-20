// Scanner flow: photo (camera / gallery) -> client-side normalization (EXIF orientation, max 1600 px, JPEG)
// -> POST /api/wines/search-by-photo -> result screen (/scan/result): the photo, a dot on every detected bottle and a line to its
// mini card (one card per bottle, never a list of candidate variants — TZ) -> full card /wines/:slug?from=scan.
export interface ScanMatch { status: 'found' | 'not_found', slug: string | null, read?: { color?: string | null, sweetness?: string | null, vintage?: string | null, text?: string | null } }
// one detected bottle: geometry in pixels of the uploaded (normalized) photo + its own match and mini card
export interface ScanBottle { bbox: number[], center?: number[], score?: number, source?: 'detector' | 'full_image', match: ScanMatch, wine: any | null }
export interface ScanResult extends ScanMatch {
  wine: any | null          // full card of the primary bottle
  analogs: any[]            // analogs for the primary bottle
  analogsLead?: string | null  // not found: what the analogs are based on
  primary: number
  focus?: number            // bottle with the full card (= the only marked one in the single layout)
  display?: number[]        // bottles marked on the photo: one dominating bottle or the front row (small background bottles are skipped)
  layout?: 'single' | 'multi'
  detection: { image: { width: number, height: number } | null, detector?: string, bottles: ScanBottle[] }
  confidence?: { top1: number, margin: number, top5: { slug: string, score: number }[] }   // API only, never shown (TZ)
}

const PHOTO_BG = '#fdfbf6'   // --bg of the site

async function normalizePhoto(file: File, maxSide = 1600): Promise<{ blob: Blob, preview: string, thumb: string, size: { width: number, height: number } }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any).catch(() => null)
  const src: any = bmp || await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file) })
  const w = src.width, h = src.height, s = Math.min(1, maxSide / Math.max(w, h))
  const draw = (scale: number) => {
    const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = PHOTO_BG; ctx.fillRect(0, 0, c.width, c.height)   // transparent PNG -> site background, not black JPEG
    ctx.drawImage(src, 0, 0, c.width, c.height); return c
  }
  const big = draw(s)
  const blob = await new Promise<Blob>(res => big.toBlob(b => res(b!), 'image/jpeg', 0.9))
  const thumb = draw(Math.min(1, 240 / Math.max(w, h))).toDataURL('image/jpeg', 0.7)
  return { blob, preview: URL.createObjectURL(blob), thumb, size: { width: big.width, height: big.height } }
}

export function useScan() {
  const busy = useState('scan-busy', () => false)
  const step = useState('scan-step', () => 0)
  const preview = useState<string | null>('scan-preview', () => null)
  const photoSize = useState<{ width: number, height: number } | null>('scan-photo-size', () => null)
  const result = useState<ScanResult | null>('scan-result', () => null)
  const error = useState<string | null>('scan-error', () => null)
  const { markScanned } = useMyWines()

  async function run(file: File) {
    if (busy.value) return
    error.value = null; busy.value = true; step.value = 0; result.value = null
    const timers: any[] = []
    try {
      const { blob, preview: p, thumb, size } = await normalizePhoto(file)
      if (preview.value) URL.revokeObjectURL(preview.value)
      preview.value = p; photoSize.value = size
      ;[900, 1900].forEach((t, i) => timers.push(setTimeout(() => (step.value = Math.max(step.value, i + 1)), t)))
      const fd = new FormData(); fd.append('file', blob, 'photo.jpg')
      // dev-only testing knob: localStorage['svoe-vino:force'] = 'found' | 'not_found'
      const force = import.meta.dev ? (() => { try { return localStorage.getItem('svoe-vino:force') || undefined } catch { return undefined } })() : undefined
      const r = await $fetch<ScanResult>('/api/wines/search-by-photo', { method: 'POST', body: fd, query: force ? { force } : undefined })
      step.value = 3
      result.value = r
      // every recognised wine may be rated; the HISTORY gets only the wines the user opened or picked (result screen),
      // shown with the catalog photo of «Своё вино» — not the whole shelf photo
      const shown = (r.display || r.detection.bottles.map((_, i) => i)).map(i => r.detection.bottles[i]!)
      shown.filter(b => b.wine).forEach(b => markScanned(b.wine.slug))
      await new Promise(res => setTimeout(res, 250))
      await navigateTo('/scan/result')
    } catch (e: any) {
      error.value = e?.data?.statusMessage || e?.statusMessage || 'Не получилось распознать фото. Попробуйте ещё раз.'
    } finally {
      timers.forEach(clearTimeout); busy.value = false
    }
  }

  // hidden <input type=file> shared by "Сканировать" (capture) and "Загрузить фото"
  function pick(capture: boolean) {
    const i = document.createElement('input')
    i.type = 'file'; i.accept = 'image/*'
    if (capture) i.setAttribute('capture', 'environment')
    i.onchange = () => { const f = i.files?.[0]; if (f) run(f) }
    i.click()
  }
  return { busy, step, preview, photoSize, result, error, run, pick, reset: () => { error.value = null } }
}
