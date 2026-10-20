// Catalog access layer. The demo reads the JSON dump shipped as a server asset (data/); in production this module is the
// single place to swap for PostgreSQL / Strapi (the rest of the server only calls these functions).
export interface WineItem {
  slug: string
  title: string
  manufacturer: string
  manufacturerSlug: string
  region: string
  category: string
  color: string        // white | red | rose | orange
  sweetness: string    // dry | semi_dry | semi_sweet | sweet | brut | extra_brut
  grapes: string[]
  dishes: string[]
  year: string
  rating: number | null
  guideRating?: number | null  // Roskachestvo guide score (5-point), only set for wines the portal rated
  alcohol: number | null
  gradient: string
  img: string
}
export interface WineCard extends WineItem {
  colorDescription: string
  description: string
  temperature: string
  extra?: WineExtra
}
export interface WineExtra {
  awards?: string[]
  prices?: { min: number, max: number, currency: string, offers?: { label: string, price: number, url?: string }[] }
  notes?: { kind: 'taste' | 'aroma', label: string, url?: string, text: string }[]
  vintages?: string[]
  reviews?: { source: string, url?: string, n: number, avg: number | null, items: { author?: string, date?: string, rating?: number, text?: string }[] }
  winery?: { name: string, license_active?: boolean | null, vineyard_ha?: number | null, website?: string | null, phone?: string | null, regions?: string[], inn?: string | null }
}

let _items: WineItem[] | null = null
let _index: Map<string, WineItem> | null = null
let _filters: any[] | null = null

export async function catalog(): Promise<WineItem[]> {
  if (!_items) {
    const raw = await useStorage('assets:catalog').getItem<WineItem[] | string>('catalog.json')
    _items = (typeof raw === 'string' ? JSON.parse(raw) : raw) || []
    _index = new Map(_items.map(w => [w.slug, w]))
  }
  return _items
}
export async function bySlug(slug: string): Promise<WineItem | undefined> {
  await catalog()
  return _index!.get(slug)
}
export async function card(slug: string): Promise<WineCard | null> {
  const st = useStorage('assets:catalog')
  const raw = await st.getItem<WineCard | string>(`wines:${slug}.json`)
  if (!raw) return null
  const c: WineCard = typeof raw === 'string' ? JSON.parse(raw) : raw
  // extra data from other sources (awards, shop prices, tasting notes, vintages, reviews, winery) — scripts/build_extra.py
  const ex = await st.getItem<any>(`extra:${slug}.json`).catch(() => null)
  if (ex) c.extra = typeof ex === 'string' ? JSON.parse(ex) : ex
  return c
}
export async function filters(): Promise<any[]> {
  if (!_filters) {
    const raw = await useStorage('assets:catalog').getItem<any[] | string>('filters.json')
    _filters = (typeof raw === 'string' ? JSON.parse(raw) : raw) || []
  }
  return _filters
}

// ---------- text search: case / ё / punctuation insensitive + Cyrillic <-> Latin transliteration ----------
const CYR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'iu', я: 'ia' }
export function skeleton(s: string): string {
  let t = (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  t = t.split('').map(ch => CYR[ch] ?? ch).join('')
  for (const [a, b] of [['eau', 'o'], ['ch', 'sh'], ['kh', 'h'], ['ph', 'f'], ['th', 't'], ['ts', 'c'], ['qu', 'k'], ['ou', 'u'], ['w', 'v'], ['x', 'ks'], ['q', 'k'], ['y', 'i'], ['j', 'i'], ['c', 'k'], ['h', '']] as const)
    t = t.split(a).join(b)
  return t.replace(/[^a-z0-9]+/g, ' ').replace(/(.)\1+/g, '$1').trim()
}
export function textScore(query: string, w: WineItem): number {
  const q = skeleton(query).split(' ').filter(Boolean)
  if (!q.length) return 0
  const title = skeleton(w.title), maker = skeleton(w.manufacturer), grapes = skeleton(w.grapes.join(' ')), region = skeleton(w.region)
  let s = 0
  for (const t of q) {
    if (title.split(' ').some(x => x.startsWith(t))) s += 3
    else if (maker.split(' ').some(x => x.startsWith(t))) s += 2
    else if (grapes.includes(t) || region.includes(t)) s += 1
    else return 0            // every query word must be found somewhere
  }
  return s + (w.rating || 0) / 10
}
