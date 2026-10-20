// Personal cabinet without registration (localStorage, per device):
//  - «Коллекция» — the wines the user rated. A wine gets in ONLY through the scanner: it can be rated once it was recognised
//    on one of the user's photos or in the live AR (the «scanned» set — kept apart from the history, so clearing the history or
//    its 50-entry limit never takes the right away) — a catalog card opened from the list cannot be added;
//  - the taste profile = the questionnaire answers (shared/taste.ts) refined by the ratings of the collection;
//  - the scan history.
import { buildProfile, type TasteAnswers } from '#shared/taste'

export interface CollectionWine {
  slug: string, title: string, manufacturer: string, img: string, category: string
  color?: string, sweetness?: string, rating: number, vintage?: string, at: number, updated: number
}
export type WineMini = Pick<CollectionWine, 'slug' | 'title' | 'manufacturer' | 'img' | 'category' | 'color' | 'sweetness'> & { vintage?: string }
export interface ScanEntry { slug: string | null, title: string, img: string, photo?: string, at: number, found: boolean }

const KEY_COLLECTION = 'svoe-vino:collection'
const KEY_HISTORY = 'svoe-vino:history'
const KEY_TASTE = 'svoe-vino:taste'
const KEY_SCANNED = 'svoe-vino:scanned'           // slug -> time it was last recognised by the scanner
const KEY_OLD_SAVED = 'svoe-vino:saved'           // before the cabinet: «Мои вина» (saved + own rating)
const read = <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || '') ?? d } catch { return d } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage full / private mode */ } }

const COLORS: [RegExp, string][] = [[/^красн/i, 'red'], [/^бел/i, 'white'], [/^розов/i, 'rose'], [/^оранж/i, 'orange']]
const SWEETS: [RegExp, string][] = [[/экстра брют/i, 'extra_brut'], [/брют/i, 'brut'], [/полусух/i, 'semi_dry'], [/полуслад/i, 'semi_sweet'], [/сладк/i, 'sweet'], [/сух/i, 'dry']]
/** «Красное полусладкое» -> colour + sweetness (entries saved before these fields were stored) */
export const parseCategory = (c = '') => ({ color: COLORS.find(([re]) => re.test(c))?.[1], sweetness: SWEETS.find(([re]) => re.test(c))?.[1] })

export function useMyWines() {
  const collection = useState<CollectionWine[]>('my-collection', () => [])
  const history = useState<ScanEntry[]>('my-history', () => [])
  const answers = useState<TasteAnswers | null>('my-taste', () => null)
  const scannedSet = useState<Record<string, number>>('my-scanned', () => ({}))
  const loaded = useState('my-loaded', () => false)
  if (import.meta.client && !loaded.value) {
    loaded.value = true
    const load = () => {
      let col = read<CollectionWine[]>(KEY_COLLECTION, [])
      // one-time move of the old «Мои вина»: the wines the user rated become the collection (unrated bookmarks stay in storage)
      if (!localStorage.getItem(KEY_COLLECTION)) {
        const old = read<any[]>(KEY_OLD_SAVED, []).filter(w => w?.slug && w.myRating)
        col = old.map(w => ({ slug: w.slug, title: w.title, manufacturer: w.manufacturer, img: w.img, category: w.category, ...parseCategory(w.category),
          rating: w.myRating, vintage: w.vintage, at: w.at || Date.now(), updated: w.at || Date.now() }))
        write(KEY_COLLECTION, col)
      }
      collection.value = col; history.value = read(KEY_HISTORY, []); answers.value = read<TasteAnswers | null>(KEY_TASTE, null)
      let sc = read<Record<string, number>>(KEY_SCANNED, {})
      if (!localStorage.getItem(KEY_SCANNED)) {           // first run: seed from the history
        sc = Object.fromEntries(history.value.filter(h => h.found && h.slug).map(h => [h.slug!, h.at]))
        write(KEY_SCANNED, sc)
      }
      scannedSet.value = sc
    }
    // another tab changed the cabinet: re-read, so this tab never writes its stale copy over it
    window.addEventListener('storage', (e) => { if (e.key?.startsWith('svoe-vino:')) load() })
    // SSR renders the empty lists: read storage only after hydration, otherwise counters/badges mismatch
    if (useNuxtApp().isHydrating) onNuxtReady(load)
    else load()
  }

  const get = (slug: string) => collection.value.find(w => w.slug === slug)
  const inCollection = (slug: string) => collection.value.some(w => w.slug === slug)
  const scanned = (slug: string) => !!scannedSet.value[slug] || history.value.some(h => h.found && h.slug === slug)
  /** the collection is filled from the scanner only */
  const canRate = (slug: string) => inCollection(slug) || scanned(slug)
  const liked = computed(() => collection.value.filter(w => w.rating >= 4))
  const profile = computed(() => buildProfile(answers.value, collection.value))

  /** rate (1..5) a scanned wine: adds it to the collection or updates the rating; false = not scanned */
  function rate(w: WineMini, rating: number) {
    if (!canRate(w.slug)) return false
    const now = Date.now(), cur = get(w.slug), cat = parseCategory(w.category)
    const item: CollectionWine = { ...(cur || { at: now }), slug: w.slug, title: w.title, manufacturer: w.manufacturer, img: w.img, category: w.category,
      color: w.color || cur?.color || cat.color, sweetness: w.sweetness || cur?.sweetness || cat.sweetness,
      vintage: w.vintage || cur?.vintage, rating, updated: now } as CollectionWine
    collection.value = cur ? collection.value.map(x => (x.slug === w.slug ? item : x)) : [item, ...collection.value]
    write(KEY_COLLECTION, collection.value)
    return true
  }
  function setVintage(slug: string, vintage: string) {
    collection.value = collection.value.map(w => (w.slug === slug ? { ...w, vintage } : w))
    write(KEY_COLLECTION, collection.value)
  }
  /** returns the removed entry (for «Вернуть») */
  function remove(slug: string) {
    const gone = get(slug)
    collection.value = collection.value.filter(w => w.slug !== slug)
    write(KEY_COLLECTION, collection.value)
    return gone
  }
  /** undo of remove: back in place, with its rating and dates */
  function restore(w: CollectionWine) {
    if (inCollection(w.slug)) return
    collection.value = [...collection.value, w].sort((a, b) => b.at - a.at)
    write(KEY_COLLECTION, collection.value)
  }
  function setAnswers(a: TasteAnswers | null) { answers.value = a; if (a) write(KEY_TASTE, a); else { try { localStorage.removeItem(KEY_TASTE) } catch {} } }

  function addScan(e: Omit<ScanEntry, 'at'>) {
    history.value = [{ ...e, at: Date.now() }, ...history.value.filter(h => !(h.slug && h.slug === e.slug))].slice(0, 50)
    write(KEY_HISTORY, history.value)
    if (e.found && e.slug) {
      const sc = { ...scannedSet.value, [e.slug]: Date.now() }
      const keys = Object.keys(sc)
      if (keys.length > 2000) keys.sort((a, b) => sc[a]! - sc[b]!).slice(0, keys.length - 2000).forEach(k => delete sc[k])
      scannedSet.value = sc
      write(KEY_SCANNED, sc)
    }
  }
  /** a wine recognised by the scanner (it may be rated) without putting it into the history */
  function markScanned(slug: string) {
    const sc = { ...scannedSet.value, [slug]: Date.now() }
    scannedSet.value = sc
    write(KEY_SCANNED, sc)
  }
  function clearHistory() { history.value = []; write(KEY_HISTORY, []) }
  return { collection, history, answers, profile, liked, get, inCollection, scanned, canRate, rate, setVintage, remove, restore, setAnswers, addScan, markScanned, clearHistory }
}
