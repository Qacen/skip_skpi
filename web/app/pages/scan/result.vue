<script setup lang="ts">
// Result of the photo search, no leader lines:
//  - one bottle (or one clearly dominating bottle) -> a small dot on it and a clean mini card right under the photo;
//  - several bottles (front row or a whole shelf) -> a marker on each bottle (no numbers) and a grid of cards under the photo,
//    2 per row (mobile first); a tap (card or marker) shows a brief card in the scrolling area, «Все вина на полке» returns. Wines the user
//    rated 4–5 in the collection come first (heart), then the rest ordered by closeness to them (POST /api/wines/rank-by-favorites,
//    no percentages shown). Under the photo: a folding «Фильтры» block (new for me, not liked, colour, sweetness, price) and
//    «Рекомендация» — 2–3 wines of the shelf that pass the filters and differ from each other (style, winery, grape).
//  - «Винный компас» mode (a step set on /compass): the wines most typical for the step are marked (POST /api/wines/shelf-meta).
//    A recognised wine can be rated right here: the rating adds it to the collection (personal cabinet).
// Masks, label zones, nearest wines and timings stay server-side (API only), the page gets just what it draws.
// Geometry comes from the ML service (detection.bottles, px of the uploaded photo); without it the dot sits in the photo centre.
import type { ScanBottle } from '~/composables/useScan'
import AnalogCard from '~/components/AnalogCard.vue'
import { stepByKey, type CompassFit } from '#shared/compass'

useHead({ title: 'Результат поиска по фото — Свои вина' })
const { result, preview, photoSize, pick } = useScan()
const { liked, get, addScan, inCollection } = useMyWines()
// history: a wine the user opened or picked on this screen (catalog photo of «Своё вино»)
const toHistory = (b?: ScanBottle) => { if (b?.wine) addScan({ slug: b.wine.slug, title: b.wine.title, img: b.wine.img, found: true }) }
const isLiked = (slug: string) => liked.value.some(w => w.slug === slug)
const { active: compassKey, setActive: setCompass } = useCompass()
const compassStep = computed(() => stepByKey(compassKey.value))
if (import.meta.client && (!result.value || !preview.value)) navigateTo('/wines', { replace: true })

const r = computed(() => result.value)
const img = computed(() => r.value?.detection?.image || photoSize.value || { width: 3, height: 4 })
const all = computed<ScanBottle[]>(() => r.value?.detection?.bottles?.length ? r.value.detection.bottles
  : r.value ? [{ bbox: [], match: { status: r.value.status, slug: r.value.slug, read: r.value.read }, wine: r.value.wine }] : [])
const shownIdx = computed(() => r.value?.display?.length ? r.value.display : all.value.map((_, i) => i))
const multi = computed(() => (r.value?.layout ? r.value.layout === 'multi' : shownIdx.value.length > 1))
// marked bottles (left -> right as the ML service orders them)
const shown = computed(() => shownIdx.value.map((i, n) => ({ i, n, b: all.value[i]!, f: frac(all.value[i]!) })))

function frac(b: ScanBottle) {
  const { width: W, height: H } = img.value
  const has = b.bbox?.length === 4 && b.source !== 'full_image'
  // several bottles: the marker sits in the middle of the bottle
  const c = has && multi.value ? [(b.bbox[0]! + b.bbox[2]!) / 2, b.bbox[1]! + 0.5 * (b.bbox[3]! - b.bbox[1]!)]
    : b.center?.length === 2 && has ? b.center : has ? [(b.bbox[0]! + b.bbox[2]!) / 2, (b.bbox[1]! + b.bbox[3]!) / 2] : [W / 2, H / 2]
  return { x: c[0]! / W, y: c[1]! / H }
}

const phase = ref(0)   // 0 photo, 1 dots, 2 cards
const active = ref(-1) // highlighted bottle (index into detection.bottles)
let timers: ReturnType<typeof setTimeout>[] = []
onMounted(() => {
  timers = [[1, 150], [2, 450]].map(([p, t]) => setTimeout(() => (phase.value = p!), t))
  const h = document.querySelector('.header') as HTMLElement | null      // sticky site header: scroll targets land right below it
  if (h) document.documentElement.style.setProperty('--hdr', `${h.offsetHeight}px`)
})
onBeforeUnmount(() => timers.forEach(clearTimeout))
onMounted(() => { if (!multi.value) toHistory(one.value) })   // one bottle: it is what the user looked at


const COLOR: Record<string, string> = { red: 'красное', white: 'белое', rose: 'розовое', orange: 'оранжевое' }
const SWEET: Record<string, string> = { dry: 'сухое', semi_dry: 'полусухое', semi_sweet: 'полусладкое', sweet: 'сладкое', brut: 'брют', extra_brut: 'экстра брют' }
const styleOf = (b?: ScanBottle) => [COLOR[b?.match?.read?.color || ''], SWEET[b?.match?.read?.sweetness || '']].filter(Boolean).join(' ')
function open(b: ScanBottle) {
  toHistory(b)
  if (b.wine) return navigateTo({ path: `/wines/${b.wine.slug}`, query: { from: 'scan' } })
  const q: Record<string, string> = {}                      // not in the catalog -> the catalog filtered by the style read from the label
  if (b.match?.read?.color) q.color = b.match.read.color
  if (b.match?.read?.sweetness) q.sweetness = b.match.read.sweetness
  return navigateTo({ path: '/wines', query: q })
}

// single layout: the focus bottle
const one = computed(() => shown.value[0]?.b)
const wine = computed(() => (multi.value ? null : one.value?.wine) || null)
const vintage = computed(() => one.value?.match?.read?.vintage || '')
const saveItem = computed(() => wine.value && ({ ...saveMini(wine.value), vintage: vintage.value || undefined }))
function scrollToAnalogs() { document.getElementById('analogs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

// ---------------- shelf / several bottles: grid 3 per row, favourites, ranking by the favourites ----------------
interface FavMatch { slug: string, match: number, reasons: string[], like: { slug: string, title: string } | null }
// reading order of the shelf: rows top -> bottom (y-centres closer than half a bottle = one row), left -> right inside a row
const reading = computed(() => {
  const xs = shown.value.map(s => ({ s, ...s.f, h: s.b.bbox?.length === 4 ? (s.b.bbox[3]! - s.b.bbox[1]!) / img.value.height : 0.3 }))
  const tol = (xs.map(x => x.h).sort((a, b) => a - b)[Math.floor(xs.length / 2)] || 0.3) / 2
  const rows: typeof xs[] = []
  for (const x of [...xs].sort((a, b) => a.y - b.y)) {
    const row = rows.find(r => Math.abs(r[0]!.y - x.y) < tol)
    if (row) row.push(x); else rows.push([x])
  }
  return rows.flatMap(r => r.sort((a, b) => a.x - b.x).map(x => x.s))
})
const rel = ref<Record<string, FavMatch>>({})
const relFor = ref('')
// favourites exist -> rank the recognised shelf wines by closeness to the favourites (favourites on the shelf still go first)
watchEffect(async () => {
  if (!multi.value || !liked.value.length) { rel.value = {}; relFor.value = ''; return }   // nothing liked (any more): no ranking
  const slugs = [...new Set(shown.value.filter(s => s.b.wine).map(s => s.b.wine.slug as string))]
  const key = slugs.join(',') + '|' + liked.value.map(w => w.slug).join(',')
  if (!slugs.length || key === relFor.value) return
  relFor.value = key
  try {
    const r = await $fetch<{ items: FavMatch[] }>('/api/wines/rank-by-favorites', { method: 'POST', body: { slugs, favorites: liked.value.map(w => w.slug) } })
    if (relFor.value === key) rel.value = Object.fromEntries(r.items.map(x => [x.slug, x]))   // a later request superseded this one
  } catch { if (relFor.value === key) rel.value = {} }
})
// order: favourites on the shelf -> the rest by closeness to the favourites (silently, no percentages) -> not in the catalog
const grid = computed(() => {
  const base = reading.value
  const isFav = (x: typeof base[number]) => !!(x.b.wine && isLiked(x.b.wine.slug))
  const score = (x: typeof base[number]) => (x.b.wine ? rel.value[x.b.wine.slug]?.match ?? 0 : -1)
  const rest = base.filter(x => x.b.wine && !isFav(x))
  const ranked = Object.keys(rel.value).length ? [...rest].sort((a, b) => score(b) - score(a)) : rest
  return [...base.filter(isFav), ...ranked, ...base.filter(x => !x.b.wine)].map(x => ({ ...x, fav: isFav(x), rec: null as FavMatch | null }))
})

// ---------------- what the filters / picks / compass need about the recognised wines (price, guide, style, step fit) ----------------
interface Meta { price: number | null, guideRating: number | null, rating: number | null, awards: number, grapes: string[], color: string, sweetness: string, sparkling: boolean, manufacturer: string, fit?: CompassFit }
const meta = ref<Record<string, Meta>>({})
const metaFor = ref(''), metaDone = ref('')
const metaKey = computed(() => [...new Set(shown.value.filter(s => s.b.wine).map(s => s.b.wine.slug as string))].join(',') + '|' + (compassKey.value || ''))
watchEffect(async () => {
  const key = metaKey.value, slugs = key.split('|')[0]!.split(',').filter(Boolean)
  if (!slugs.length || key === metaFor.value) { if (!slugs.length) metaDone.value = key; return }
  metaFor.value = key
  try {
    const r = await $fetch<{ items: Record<string, Meta> }>('/api/wines/shelf-meta', { method: 'POST', body: { slugs, step: compassKey.value || undefined } })
    if (metaFor.value === key) meta.value = r.items
  } catch { if (metaFor.value === key) meta.value = {} }
  if (metaFor.value === key) metaDone.value = key
})
const metaReady = computed(() => metaDone.value === metaKey.value)
const metaOf = (b?: ScanBottle): Meta | undefined => (b?.wine ? meta.value[b.wine.slug] : undefined)
const styleWord = (b: ScanBottle) => { const m = metaOf(b), c = m?.color || b.wine?.color, sw = m?.sweetness || b.wine?.sweetness
  return m?.sparkling ? `игристое ${SWEET[sw || ''] || ''}`.trim() : [COLOR[c || ''], SWEET[sw || '']].filter(Boolean).join(' ') }
const uniqBySlug = <T extends { b: ScanBottle }>(xs: T[]) => xs.filter((x, k) => xs.findIndex(y => y.b.wine?.slug === x.b.wine?.slug) === k)

// ---------------- «Винный компас»: the wines of the photo most typical for the current step ----------------
const compassPicks = computed(() => {
  if (!compassStep.value) return []
  const ok = shown.value.filter(s => metaOf(s.b)?.fit?.fits)
  return uniqBySlug(ok.sort((a, b) => metaOf(b.b)!.fit!.score - metaOf(a.b)!.fit!.score || (metaOf(b.b)!.guideRating || 0) - (metaOf(a.b)!.guideRating || 0))).slice(0, 3)
})
const compassMiss = computed(() => metaOf(one.value)?.fit?.why?.[0] || '')
// wines of the step's style from the catalog (the compass examples): offered whatever the photo shows
const { data: cSteps } = useLazyFetch<{ steps: any[] }>('/api/compass/steps', { server: false })
const styleWines = computed(() => {
  if (!compassStep.value) return []
  const onPhoto = new Set(shown.value.filter(s => s.b.wine).map(s => s.b.wine.slug))
  return (cSteps.value?.steps.find(x => x.key === compassStep.value!.key)?.examples || []).filter((w: any) => !onPhoto.has(w.slug))
})

// ---------------- shelf filters (folded block) ----------------
const fOpen = ref(false)
const f = reactive({ fresh: false, noLiked: false, colors: [] as string[], sweets: [] as string[], price: '' })
const F_COLORS: [string, string][] = [['red', 'Красное'], ['white', 'Белое'], ['rose', 'Розовое']]
const F_SWEETS: [string, string][] = [['dry', 'Сухое'], ['semi_dry', 'Полусухое'], ['semi_sweet', 'Полусладкое'], ['sweet', 'Сладкое'], ['sparkling', 'Игристое']]
const F_PRICES: [string, string][] = [['lt700', 'до 700 ₽'], ['700_1500', '700–1500 ₽'], ['gt1500', 'от 1500 ₽']]
const fCount = computed(() => +f.fresh + +f.noLiked + f.colors.length + f.sweets.length + (f.price ? 1 : 0))
const tog = (arr: string[], v: string) => { const i = arr.indexOf(v); if (i < 0) arr.push(v); else arr.splice(i, 1) }
function fReset() { f.fresh = false; f.noLiked = false; f.colors.splice(0); f.sweets.splice(0); f.price = '' }
function passes(b: ScanBottle) {
  if (!fCount.value) return true
  if (!b.wine) return false
  const m = metaOf(b), slug = b.wine.slug as string
  if (f.fresh && get(slug)) return false                       // «Новое для меня»: not rated yet
  if (f.noLiked && isLiked(slug)) return false                 // «Без понравившихся»
  const color = m?.color || b.wine.color, sw = m?.sweetness || b.wine.sweetness, sp = m?.sparkling ?? ['brut', 'extra_brut'].includes(sw)
  if (f.colors.length && !f.colors.includes(color)) return false
  if (f.sweets.length && !f.sweets.includes(sp ? 'sparkling' : sw)) return false
  if (f.price) {
    const p = m?.price
    if (!p || (f.price === 'lt700' && p >= 700) || (f.price === '700_1500' && (p < 700 || p > 1500)) || (f.price === 'gt1500' && p <= 1500)) return false
  }
  return true
}
// in the compass mode the wines that fit the step come first
const filtered = computed(() => {
  const xs = grid.value.filter(g => passes(g.b))
  if (!compassStep.value) return xs
  const fit = (g: typeof xs[number]) => (metaOf(g.b)?.fit?.fits ? 1 : 0)
  return xs.map((g, k) => ({ g, k })).sort((a, b) => fit(b.g) - fit(a.g) || a.k - b.k).map(x => x.g)
})

// ---------------- «Рекомендация»: 2–3 wines that pass the filters and differ from each other ----------------
const recPicks = computed(() => {
  if (!metaReady.value) return []
  const pool = uniqBySlug(filtered.value.filter(g => g.b.wine && !g.fav)).map(g => {
    const m = metaOf(g.b), r = rel.value[g.b.wine.slug]
    let s = 0
    if (r) s += r.match / 25                                  // close to what the user liked
    if (m?.guideRating) s += 1 + (m.guideRating - 4) * 4      // the guide's score
    s += Math.min(m?.awards || 0, 3) * 0.25
    if (get(g.b.wine.slug)) s -= 2                            // already tried: a recommendation is for something new
    return { g, s }
  })
  const key = (g: typeof pool[number]['g']) => styleWord(g.b)
  const picks: typeof pool = []
  while (picks.length < 3 && pool.length) {
    let best = 0, bs = -Infinity
    pool.forEach((x, k) => {
      let s = x.s
      for (const p of picks) {
        if (p.g.b.wine.manufacturer === x.g.b.wine.manufacturer) s -= 3
        if (key(p.g) === key(x.g)) s -= 2
        const ga = metaOf(p.g.b)?.grapes?.[0], gb = metaOf(x.g.b)?.grapes?.[0]
        if (ga && ga === gb) s -= 1
      }
      if (s > bs) { bs = s; best = k }
    })
    picks.push(pool.splice(best, 1)[0]!)
  }
  return picks.map(x => {
    const m = metaOf(x.g.b), r = rel.value[x.g.b.wine.slug], why: string[] = [styleWord(x.g.b)]
    // the name only: «Старая дорога на Джанхот. Каберне Совиньон, Каберне Фран, …» → «Старая дорога на Джанхот» (the grapes read as more wines)
    if (r?.like) why.push(`похоже на «${r.like.title.split(/[.,;(]\s*/)[0]!.trim() || r.like.title}»`)
    if (m?.guideRating) why.push(`гид ${m.guideRating.toFixed(2)}`); else if (m?.awards) why.push(`медалей: ${m.awards}`)
    if (m?.price) why.push(`от ${Math.round(m.price).toLocaleString('ru-RU')} ₽`)
    return { ...x.g, why }
  })
})
const pickNo = (i: number) => recPicks.value.findIndex(p => p.i === i) + 1
// the grid: the 2–3 recommended wines first (marked «Рекомендация»), then the rest of the shelf
// the grid: wines the user rated highly (best first), then the 2–3 recommended wines (marked «Рекомендация»), then the rest
const gridShown = computed(() => {
  const favs = filtered.value.filter(g => g.fav).sort((a, b) => (get(b.b.wine.slug)?.rating || 0) - (get(a.b.wine.slug)?.rating || 0))
  const taken = new Set([...favs, ...recPicks.value].map(g => g.i))
  return [...favs, ...recPicks.value, ...filtered.value.filter(g => !taken.has(g.i))]
})
const pctOf = (b: ScanBottle) => { const p = metaOf(b)?.price; return p ? `от ${Math.round(p).toLocaleString('ru-RU')} ₽` : '' }
const isCompassPick = (i: number) => compassPicks.value.some(p => p.i === i)
const kind = (i: number) => { const g = grid.value.find(x => x.i === i); return g?.fav ? 'fav' : g?.b.wine ? '' : 'nf' }
const gridEls: Record<number, HTMLElement | null> = {}
// tap a wine (its card or its marker on the photo) -> a brief card fills the scrolling area under the pinned photo;
// «Все вина на полке» returns to the grid at the same scroll position. The full card opens from the brief one.
const detail = ref(-1)                     // index into detection.bottles, -1 = the grid
const detailCard = ref<any>(null)          // /api/wines/:slug (description, grapes, ABV, serving temperature)
let gridScroll = 0
async function showDetail(i: number) {
  if (detail.value < 0) gridScroll = window.scrollY
  active.value = i; detail.value = i; detailCard.value = null
  toHistory(all.value[i])
  nextTick(() => document.querySelector('.dv')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  const slug = all.value[i]?.wine?.slug
  if (!slug) return
  try { const c = await $fetch<any>(`/api/wines/${slug}`); if (detail.value === i) detailCard.value = c } catch { /* brief card without the extras */ }
}
function closeDetail() {
  detail.value = -1; active.value = -1; detailCard.value = null
  nextTick(() => window.scrollTo({ top: gridScroll }))
}
const focusCard = showDetail
const tapCard = showDetail
const dItem = computed(() => grid.value.find(g => g.i === detail.value) || null)
const dPos = computed(() => grid.value.findIndex(g => g.i === detail.value))
const step = (d: number) => { const g = grid.value[dPos.value + d]; if (g) showDetail(g.i) }
const short = (t?: string) => { if (!t) return ''; const m = t.match(/^(.{60,240}?[.!?])(\s|$)/); return m ? m[1] : t.slice(0, 220) + (t.length > 220 ? '…' : '') }
function saveMini(w: any) { return { slug: w.slug, title: w.title, manufacturer: w.manufacturer, img: w.img, category: w.category, color: w.color, sweetness: w.sweetness } }
const toastText = ref(''); let tt: any
function onRated(n: number, added: boolean) { toastText.value = added ? 'Добавлено в коллекцию' : `Оценка ${n} из 5 сохранена`; clearTimeout(tt); tt = setTimeout(() => (toastText.value = ''), 2200) }
</script>

<template>
  <div v-if="r && preview" class="container rs" :class="{ 'rs--multi': multi}">
    <h1 class="sr-only">Результат поиска по фото</h1>
    <div class="rs__top">
    <div class="rs__bar">
      <NuxtLink to="/wines" class="rs__back"><AppIcon name="back" :size="20" />Каталог</NuxtLink>
      <span v-if="!multi" class="rs__status" :class="wine ? 'ok' : 'nf'"><AppIcon :name="wine ? 'check' : 'search'" :size="16" />{{ wine ? 'Вино найдено' : 'Нет в каталоге' }}</span>
    </div>

    <div class="rs__stage" :class="[`p${phase}`, { 'has-active': active >= 0 }]">
      <div class="rs__photo" :style="{ '--ar': `${img.width} / ${img.height}`, '--arn': img.width / img.height }">
        <img :src="preview" alt="Ваше фото" />
        <button v-for="s in shown" :key="s.i" class="rs__dot"
          :class="[multi ? `shelf ${kind(s.i)}` : '', { nf: !s.b.wine, on: active === s.i, off: multi && fCount > 0 && !passes(s.b), pick: multi && pickNo(s.i) > 0, cmp: multi && isCompassPick(s.i) }]"
          :style="{ left: `${s.f.x * 100}%`, top: `${s.f.y * 100}%`, transitionDelay: `${s.n * 40}ms` }"
          :aria-label="s.b.wine ? s.b.wine.title : 'Нет в каталоге'"
          @click="multi ? focusCard(s.i) : open(s.b)"><i v-if="!multi" /><i v-if="!multi" />
          <AppIcon v-if="multi && kind(s.i) === 'fav'" name="heart" :size="12" /><AppIcon v-else-if="multi && pickNo(s.i)" name="star4" :size="14" /></button>
      </div>

      <!-- one bottle: a clean card under the photo -->
      <div v-if="!multi" class="rs__card">
        <template v-if="wine">
          <div class="mc" role="link" tabindex="0" @click="open(one!)" @keydown.enter="open(one!)">
            <div class="mc__img"><img :src="wine.img" :alt="wine.title" /></div>
            <div class="mc__body">
              <span v-if="wine.rating" class="mc__rating"><RatingGlass />{{ Number(wine.rating).toFixed(2) }}</span>
              <h2 class="mc__title">{{ wine.title }}</h2>
              <span class="mc__maker">{{ wine.manufacturer }}</span>
              <span class="mc__meta">{{ wine.category }}<template v-if="wine.region"> · {{ wine.region }}</template></span>
              <span v-if="vintage" class="mc__vintage">Урожай {{ vintage }} — с этикетки</span>
            </div>
          </div>
          <div class="mc__actions">
            <button class="btn btn-primary mc__open" @click="open(one!)">Открыть карточку<AppIcon name="chevron" :size="18" /></button>
          </div>
          <RateStars v-if="saveItem" :wine="saveItem" small class="mc__rate" @rated="onRated" />
        </template>
        <template v-else>
          <div class="mc">
            <div class="mc__icon"><AppIcon name="search" :size="26" /></div>
            <div class="mc__body">
              <h2 class="mc__title">Этого вина пока нет в каталоге</h2>
              <span class="mc__meta">{{ styleOf(one) ? `Похоже на ${styleOf(one)} — ниже аналоги из других виноделен` : 'Ниже — аналоги по стилю из других виноделен' }}</span>
            </div>
          </div>
          <div class="mc__actions">
            <button class="btn btn-primary mc__open" @click="scrollToAnalogs">Аналоги<AppIcon name="chevron" :size="18" /></button>
            <button class="mc__save" aria-label="Переснять" @click="pick(true)"><AppIcon name="camera" :size="22" /></button>
          </div>
        </template>
      </div>
    </div>
    </div>


    <div class="rs__scroll">
    <!-- «Винный компас»: what on this photo fits the current step -->
    <section v-if="compassStep && !dItem" class="cmp">
      <div class="cmp__head">
        <span class="cmp__badge">Винный компас · шаг {{ compassStep.n }} из 6</span>
        <button class="cmp__x" aria-label="Выйти из режима компаса" @click="setCompass(null)"><AppIcon name="close" :size="16" /></button>
      </div>
      <h2 class="cmp__title">{{ compassStep.title }} <small>— {{ compassStep.plain.toLowerCase() }}</small></h2>
      <p v-if="!metaReady" class="cmp__lead">Смотрим, что подходит…</p>
      <template v-else-if="compassPicks.length">
        <p class="cmp__lead">{{ multi ? 'Для этого шага на полке подойдёт:' : 'Это вино подходит для шага' }}</p>
        <button v-for="(p, k) in compassPicks" :key="p.i" class="cmp__wine" :class="{ main: k === 0 }" @click="multi ? showDetail(p.i) : open(p.b)">
          <span class="cmp__img"><img :src="p.b.wine.img" alt="" /></span>
          <span class="cmp__txt"><b>{{ p.b.wine.title }}</b><small>{{ p.b.wine.manufacturer }}</small><em>{{ metaOf(p.b)?.fit?.why.join(' · ') }}</em></span>
          <span v-if="multi && k === 0" class="cmp__best">лучше всего</span>
        </button>
      </template>
      <p v-else class="cmp__lead">{{ multi ? `На этом фото нет вина в стиле «${compassStep.title.toLowerCase()}». Попробуйте соседнюю полку.` : `Это вино не для этого шага${compassMiss ? ': ' + compassMiss : ''}.` }}</p>
      <template v-if="styleWines.length">
        <p class="cmp__sub">{{ compassPicks.length ? 'Ещё вина этого стиля' : `Ищите на полке вино в стиле «${compassStep.title.toLowerCase()}», например:` }}</p>
        <div class="cmp__ex hscroll">
          <NuxtLink v-for="w in styleWines" :key="w.slug" :to="`/wines/${w.slug}`" class="cex">
            <span class="cex__img"><img :src="w.img" :alt="w.title" loading="lazy" /></span>
            <b>{{ w.title }}</b><small>{{ w.manufacturer }}</small>
            <em v-if="w.price">от {{ Math.round(w.price).toLocaleString('ru-RU') }} ₽</em>
          </NuxtLink>
        </div>
      </template>
      <NuxtLink to="/compass" class="cmp__back">К маршруту компаса<AppIcon name="chevron" :size="16" /></NuxtLink>
    </section>

    <!-- shelf: folding filters + «Рекомендация» -->
    <section v-if="multi && !dItem && grid.some(g => g.b.wine)" class="tl">
      <div class="tl__row">
        <button class="tl__btn" :class="{ on: fOpen || fCount }" :aria-expanded="fOpen" @click="fOpen = !fOpen">
          <AppIcon name="filter" :size="18" />Фильтры<span v-if="fCount" class="tl__n">{{ fCount }}</span>
        </button>
      </div>
      <div v-if="fOpen" class="tl__panel">
        <div class="tl__group"><span>Для меня</span>
          <button class="chip chip--sm" :class="{ active: f.fresh }" @click="f.fresh = !f.fresh">Новое для меня</button>
          <button class="chip chip--sm" :class="{ active: f.noLiked }" @click="f.noLiked = !f.noLiked">Без понравившихся</button>
        </div>
        <div class="tl__group"><span>Цвет</span>
          <button v-for="[k, t] in F_COLORS" :key="k" class="chip chip--sm" :class="{ active: f.colors.includes(k) }" @click="tog(f.colors, k)">{{ t }}</button>
        </div>
        <div class="tl__group"><span>Сладость</span>
          <button v-for="[k, t] in F_SWEETS" :key="k" class="chip chip--sm" :class="{ active: f.sweets.includes(k) }" @click="tog(f.sweets, k)">{{ t }}</button>
        </div>
        <div class="tl__group"><span>Цена</span>
          <button v-for="[k, t] in F_PRICES" :key="k" class="chip chip--sm" :class="{ active: f.price === k }" @click="f.price = f.price === k ? '' : k">{{ t }}</button>
        </div>
        <div class="tl__foot">
          <span>{{ fCount ? `Подходит ${gridShown.length} из ${grid.length}` : `Вин на фото: ${grid.length}` }}</span>
          <button v-if="fCount" class="tl__reset" @click="fReset">Сбросить</button>
        </div>
      </div>
    </section>
    <!-- shelf / several bottles: a tap shows a brief card in place of the grid (back -> the grid); grid of cards, 2 per row -->
    <section v-if="multi && dItem" class="dv">
      <div class="dv__nav">
        <button class="dv__back" @click="closeDetail"><AppIcon name="back" :size="18" />Все вина на полке</button>
        <span class="dv__steps">
          <button :disabled="dPos <= 0" aria-label="Предыдущее вино" @click="step(-1)"><AppIcon name="back" :size="18" /></button>
          <span>{{ dPos + 1 }} / {{ grid.length }}</span>
          <button :disabled="dPos >= grid.length - 1" aria-label="Следующее вино" @click="step(1)"><AppIcon name="chevron" :size="18" /></button>
        </span>
      </div>
      <div class="dv__card" :class="{ fav: dItem.fav, rec: dItem.rec }">
        <template v-if="dItem.b.wine">
          <div class="dv__head">
            <div class="dv__img"><img :src="dItem.b.wine.img" :alt="dItem.b.wine.title" /></div>
            <div class="dv__main">
              <span v-if="dItem.fav" class="dv__tag fav"><AppIcon name="heart" :size="12" />Вам понравилось · {{ get(dItem.b.wine.slug)?.rating }}★</span>
              <h2 class="dv__title">{{ dItem.b.wine.title }}</h2>
              <span class="dv__maker">{{ dItem.b.wine.manufacturer }}</span>
              <span class="dv__meta">{{ dItem.b.wine.category }}<template v-if="dItem.b.wine.region"> · {{ dItem.b.wine.region }}</template></span>
              <span v-if="dItem.b.wine.rating" class="dv__rating"><RatingGlass />{{ Number(dItem.b.wine.rating).toFixed(2) }}</span>
            </div>
          </div>
          <div v-if="detailCard" class="dv__chips">
            <span v-for="g in (detailCard.grapes || []).slice(0, 3)" :key="g">{{ g }}</span>
            <span v-if="detailCard.alcohol">{{ detailCard.alcohol }}%</span>
            <span v-if="detailCard.temperature">{{ detailCard.temperature }} °C</span>
          </div>
          <p v-if="detailCard?.description" class="dv__desc">{{ short(detailCard.description) }}</p>
          <div v-if="dItem.b.wine && rel[dItem.b.wine.slug]?.like" class="dv__why">
            <span>Похоже на «{{ rel[dItem.b.wine.slug]!.like!.title }}» из вашей коллекции</span>
          </div>
          <div class="dv__actions">
            <button class="btn btn-primary dv__open" @click="open(dItem.b)">Полная карточка<AppIcon name="chevron" :size="18" /></button>
          </div>
          <RateStars :wine="{ ...saveMini(dItem.b.wine), vintage: dItem.b.match?.read?.vintage ? String(dItem.b.match.read.vintage) : undefined }" small class="dv__rate" @rated="onRated" />
        </template>
        <template v-else>
          <div class="dv__head">
            <div class="dv__img nf"><AppIcon name="search" :size="28" /></div>
            <div class="dv__main">
              <h2 class="dv__title">Этого вина нет в каталоге</h2>
              <span class="dv__meta">{{ styleOf(dItem.b) ? `Похоже на ${styleOf(dItem.b)}` : 'Подберём похожие по стилю' }}</span>
            </div>
          </div>
          <div class="dv__actions"><button class="btn btn-primary dv__open" @click="open(dItem.b)">Похожие вина<AppIcon name="chevron" :size="18" /></button></div>
        </template>
      </div>
    </section>

    <section v-else-if="multi" class="sg" :class="`p${phase}`">
      <div class="sg__grid">
        <div v-for="(g, k) in gridShown" :key="g.i" :ref="(el: any) => { gridEls[g.i] = el }" class="gc"
          :class="{ nf: !g.b.wine, on: active === g.i, fav: g.fav, col: !!g.b.wine && inCollection(g.b.wine.slug), pickc: pickNo(g.i) > 0 }" :style="{ transitionDelay: `${Math.min(k, 12) * 30}ms` }"
          role="button" tabindex="0" :aria-pressed="active === g.i" @click="tapCard(g.i)" @keydown.enter="tapCard(g.i)">
          <span v-if="g.b.wine" class="gc__top">
            <span v-if="g.b.wine.rating" class="gc__rating" title="Рейтинг «Своё вино»"><RatingGlass />{{ Number(g.b.wine.rating).toFixed(2) }}</span>
            <span v-if="g.fav" class="gc__heart" :aria-label="`Вы оценили на ${get(g.b.wine.slug)?.rating} из 5`"><AppIcon name="heart" :size="14" /></span>
          </span>
          <span class="gc__img"><img v-if="g.b.wine" :src="g.b.wine.img" alt="" loading="lazy" /><AppIcon v-else name="search" :size="20" /></span>
          <b class="gc__title">{{ g.b.wine ? g.b.wine.title : 'Нет в каталоге' }}</b>
          <span class="gc__maker">{{ g.b.wine ? g.b.wine.manufacturer : styleOf(g.b) || 'похожие вина' }}</span>
          <span v-if="g.b.wine" class="gc__info">
            <span>{{ styleWord(g.b) }}</span>
            <span v-if="pctOf(g.b)">{{ pctOf(g.b) }}</span>
          </span>
          <span v-if="pickNo(g.i) && recPicks[pickNo(g.i) - 1]?.why.some(w => /похоже/.test(w))" class="gc__why">{{ recPicks[pickNo(g.i) - 1]!.why.find(w => /похоже/.test(w)) }}</span>
          <span v-if="g.b.wine && inCollection(g.b.wine.slug)" class="gc__rec gc__rec--col"><AppIcon name="heart" :size="11" />В коллекции</span>
          <span v-else-if="pickNo(g.i)" class="gc__rec"><AppIcon name="star4" :size="12" />Рекомендация</span>
        </div>
      </div>
    </section>

    <!-- not in the catalog: analogs of the product from other wineries are the main answer, right under the card -->
    <section v-if="!multi && !wine && r.analogs?.length" id="analogs" class="section rs__analogs">
      <h2 class="section-title">Аналоги из других виноделен</h2>
      <p class="muted rs__analogs-lead">{{ r.analogsLead || (styleOf(one) ? `В том же стиле — ${styleOf(one)}, от других производителей` : 'По стилю, от других производителей') }}</p>
      <div class="hscroll"><AnalogCard v-for="w in r.analogs" :key="w.slug" :wine="w" /></div>
    </section>

    <div class="rs__more">
      <button class="btn btn-outline" @click="pick(true)"><AppIcon name="camera" :size="20" />Переснять</button>
      <button class="btn btn-outline" @click="pick(false)"><AppIcon name="image" :size="20" />Другое фото</button>
    </div>

    <section v-if="!multi && wine && r.analogs?.length" id="analogs" class="section">
      <h2 class="section-title">Аналоги из других виноделен</h2>
      <div class="hscroll"><AnalogCard v-for="w in r.analogs" :key="w.slug" :wine="w" /></div>
    </section>
    </div>
    <Transition name="fade"><div v-if="toastText" class="rs__toast" role="status">{{ toastText }}</div></Transition>
  </div>
</template>

<style scoped>
.rs { padding-top: 16px; padding-bottom: calc(24px + var(--safe-bottom)); }
.rs__bar { display: flex; justify-content: space-between; align-items: center; max-width: 560px; margin: 0 auto 14px; }
.rs--multi .rs__bar, .rs--multi .rs__more { max-width: 760px; }
.rs__back { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-weight: 600; min-height: 40px; }
.rs__status { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-size: 14px; font-weight: 600; }
.rs__status.ok { background: #e6f0e4; color: var(--ok); }
.rs__status.nf { background: var(--pill); color: var(--accent-dark); }

.rs__stage { position: relative; max-width: 560px; margin: 0 auto; }
.rs--multi .rs__stage { max-width: 760px; }
.rs__photo { position: relative; aspect-ratio: var(--ar); width: min(100%, calc(52vh * var(--arn)), calc(52svh * var(--arn))); margin: 0 auto; border-radius: var(--radius-l);
  overflow: hidden; background: var(--surface); box-shadow: var(--shadow-soft); }
.rs--multi .rs__photo { width: min(100%, calc(56vh * var(--arn)), calc(56svh * var(--arn))); margin: 0 auto; border-radius: 18px; }
.rs__photo img { width: 100%; height: 100%; object-fit: cover; }

/* dots: single = small pulsing marker; multi = coloured numbered circle */
.rs__dot { position: absolute; z-index: 2; width: 18px; height: 18px; margin: -9px 0 0 -9px; padding: 0; border-radius: 50%; background: #fff;
  border: 4px solid var(--accent); box-shadow: 0 2px 8px rgba(0, 0, 0, .35); transform: scale(0); transition: transform .35s cubic-bezier(.3, 1.6, .5, 1), opacity .2s; }
.rs__dot.nf { border-color: #b98a3c; }
.p1 .rs__dot, .p2 .rs__dot { transform: scale(1); }
.p2 .rs__dot.on { transform: scale(1.3); }
.rs__dot i { position: absolute; inset: -4px; border-radius: 50%; border: 2px solid #fff; opacity: 0; animation: ripple 2.2s ease-out infinite; pointer-events: none; }
.rs__dot i + i { animation-delay: 1.1s; }
@keyframes ripple { 0% { transform: scale(1); opacity: .9 } 100% { transform: scale(3.2); opacity: 0 } }

/* one bottle: clean card under the photo */
.rs__card { position: relative; z-index: 4; width: min(100%, 560px); margin: 14px auto 0; background: var(--white); border-radius: var(--radius-l); padding: 14px;
  box-shadow: 0 10px 30px rgba(108, 85, 15, .12), 0 2px 6px rgba(108, 85, 15, .08);
  opacity: 0; transform: translateY(10px); transition: opacity .35s ease, transform .4s cubic-bezier(.2, .9, .3, 1.1); }
.p2 .rs__card { opacity: 1; transform: none; }
.mc { display: flex; gap: 14px; cursor: pointer; }
.mc__img { flex: 0 0 72px; height: 116px; border-radius: 14px; background: var(--surface); display: flex; align-items: center; justify-content: center; padding: 6px; }
.mc__img img { max-width: 100%; max-height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.mc__icon { flex: 0 0 56px; height: 56px; border-radius: 16px; background: var(--pill); color: var(--accent-dark); display: grid; place-items: center; }
.mc__body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.mc__rating { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px 3px 7px; border-radius: 16px; background: var(--pill); font-size: 12px; font-weight: 600; }
.mc__title { font-family: var(--serif); font-weight: 500; font-size: 20px; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mc__maker { color: var(--accent); font-size: 15px; }
.mc__meta { color: var(--muted); font-size: 13px; line-height: 1.35; }
.mc__vintage { align-self: flex-start; margin-top: 2px; font-size: 12px; font-weight: 600; color: var(--ok); background: #e6f0e4; border-radius: 999px; padding: 3px 10px; }
.mc__actions { display: flex; gap: 10px; margin-top: 12px; }
.mc__open { flex: 1; }
.mc__save { flex: 0 0 48px; height: 48px; border-radius: var(--radius-s); border: 1px solid var(--line); display: grid; place-items: center; color: var(--accent); }
.mc__save.on { background: var(--accent); color: #fff; border-color: var(--accent); }


/* shelf markers: heart = favourite, star = recommended by the favourites, grey = not in the catalog */
.rs__dot.shelf { width: 20px; height: 20px; margin: -10px 0 0 -10px; border: 2.5px solid #fff; background: var(--accent); color: #fff; display: grid; place-items: center; }
.rs__dot.shelf.fav { width: 26px; height: 26px; margin: -13px 0 0 -13px; background: #c0392b; }
.rs__dot.shelf.rec { width: 26px; height: 26px; margin: -13px 0 0 -13px; background: #d4a017; font-size: 13px; line-height: 1; }
.rs__dot.shelf.nf { background: #9a958c; border-color: #fff; }
.rs__dot.shelf.off { opacity: .25; }
.rs__dot.shelf.pick { width: 26px; height: 26px; margin: -13px 0 0 -13px; background: #f3c46a; color: #5b3a06; font-size: 13px; font-weight: 700; }
.rs__dot.shelf.cmp { box-shadow: 0 0 0 4px #f2c94c, 0 0 14px 4px rgba(242, 201, 76, .8); }
.has-active .rs__dot.shelf:not(.on) { opacity: .45; }
.p2 .rs__dot.shelf.on { transform: scale(1.45); box-shadow: 0 0 0 4px rgba(255, 255, 255, .9), 0 2px 10px rgba(0, 0, 0, .45); z-index: 3; }

.sg { max-width: 760px; margin: 12px auto 0; }
.sg__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.gc { scroll-margin-top: calc(var(--hdr, 76px) + 8px); position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 22px 6px 9px; border-radius: 14px; background: var(--white);
  text-align: center; cursor: pointer; border: 1.5px solid transparent; box-shadow: 0 4px 14px rgba(108, 85, 15, .1), 0 1px 3px rgba(108, 85, 15, .07);
  opacity: 0; transform: translateY(8px); transition: opacity .3s ease, transform .35s ease, border-color .15s; }
.p1 .gc, .p2 .gc { opacity: 1; transform: none; }
.gc.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent), 0 6px 18px rgba(108, 85, 15, .18); }
.gc.fav { border-color: #c0392b; background: #fffaf9; }
.gc.rec { border-color: #e9cf7d; }
.gc__img { width: 100%; height: 130px; display: flex; align-items: center; justify-content: center; color: #8a6424; }
.gc__img img { max-width: 100%; max-height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.gc.nf .gc__img { background: var(--pill); border-radius: 10px; }
.gc__title { font-size: 13.5px; line-height: 1.25; font-weight: 600; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.gc__maker { font-size: 12px; color: var(--accent); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gc.nf .gc__maker { color: var(--muted); }
.gc__why { font-size: 10.5px; color: #8a6a10; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.gc__badge { position: absolute; top: 6px; left: 6px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
.gc__top { align-self: stretch; display: flex; justify-content: space-between; align-items: center; min-height: 24px; margin: -14px 0 4px; padding: 0 2px; }
.gc__rating { display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px 3px 6px; border-radius: 16px; background: var(--pill); font-size: 11.5px; font-weight: 600; color: var(--text); }
.gc__heart { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: #fbe9e7; color: #c0392b; margin-left: auto; }
.gc__rec { align-self: stretch; display: flex; justify-content: center; align-items: center; gap: 4px; margin: auto -6px -9px; padding: 5px 4px; border-radius: 0 0 12px 12px;
  background: #f3c46a; color: #5b3a06; font-size: 11.5px; font-weight: 700; }
.gc.pickc { border-color: #f3c46a; }
.gc.col { border-color: #c0392b; }
.gc__rec--col { background: #c0392b; color: #fff; }
.gc__info { display: flex; flex-wrap: wrap; justify-content: center; gap: 3px 6px; margin-top: 2px; font-size: 11px; color: var(--muted); line-height: 1.3; }
.gc__info > span + span::before { content: '·'; margin-right: 6px; }
.gc__r { display: inline-flex; align-items: center; gap: 2px; font-weight: 700; color: var(--text); }
.gc__r :deep(svg) { width: 11px; height: 11px; }

/* «Винный компас» panel */
.cmp { max-width: 760px; margin: 14px auto 0; padding: 14px 16px; border-radius: var(--radius-l); background: #fffaf0; border: 1.5px solid #f0d98a; }
.cmp__head { display: flex; justify-content: space-between; align-items: center; }
.cmp__badge { font-size: 12px; font-weight: 700; color: #8a6a10; background: #fbf1d3; border-radius: 999px; padding: 3px 10px; }
.cmp__x { width: 32px; height: 32px; display: grid; place-items: center; color: var(--muted); }
.cmp__title { margin: 8px 0 0; font-family: var(--serif); font-weight: 500; font-size: 21px; }
.cmp__title small { font-family: var(--sans, system-ui); font-size: 14px; color: var(--muted); }
.cmp__lead { margin: 8px 0 0; font-size: 14px; line-height: 1.45; }
.cmp__wine { position: relative; width: 100%; display: flex; gap: 12px; align-items: center; margin-top: 8px; padding: 8px 10px; border-radius: 14px; background: var(--white); text-align: left; }
.cmp__wine.main { box-shadow: 0 0 0 2px #f2c94c; }
.cmp__img { flex: 0 0 44px; height: 72px; display: flex; align-items: center; justify-content: center; }
.cmp__img img { max-height: 100%; max-width: 100%; object-fit: contain; mix-blend-mode: multiply; }
.cmp__txt { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cmp__txt b { font-size: 14.5px; line-height: 1.25; }
.cmp__txt small { font-size: 12.5px; color: var(--accent); }
.cmp__txt em { font-style: normal; font-size: 12.5px; color: #6d5410; }
.cmp__best { position: absolute; top: 8px; right: 10px; font-size: 11px; font-weight: 700; color: #8a6a10; }
.cmp__sub { margin: 12px 0 6px; font-size: 13.5px; font-weight: 600; }
.cmp__ex { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.cex { flex: 0 0 116px; display: flex; flex-direction: column; gap: 2px; padding: 8px; border-radius: 12px; background: var(--white); }
.cex__img { height: 96px; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }
.cex__img img { max-height: 100%; max-width: 100%; object-fit: contain; mix-blend-mode: multiply; }
.cex b { font-size: 12.5px; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cex small { font-size: 11.5px; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cex em { font-style: normal; font-size: 11.5px; color: var(--muted); }
.cmp__back { display: inline-flex; align-items: center; gap: 2px; margin-top: 10px; font-size: 14px; font-weight: 600; color: var(--accent); }

/* shelf tools: filters (folded) + «Рекомендация» */
.tl { max-width: 760px; margin: 12px auto 0; }
.tl__row { display: flex; gap: 8px; }
.tl__btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; border-radius: 999px; background: var(--white);
  border: 1px solid var(--line); font-weight: 600; font-size: 14.5px; color: var(--text); }
.tl__btn.on { border-color: var(--accent); color: var(--accent); }
.tl__rec.on { background: var(--accent); color: #fff; }
.tl__n { min-width: 20px; height: 20px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 12px; display: grid; place-items: center; padding: 0 5px; }
.tl__panel { margin-top: 8px; padding: 12px 14px; border-radius: var(--radius-m); background: var(--white); box-shadow: 0 4px 14px rgba(108, 85, 15, .08); }
.tl__group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 0; }
.tl__group > span { flex: 0 0 76px; font-size: 13px; color: var(--muted); }
.tl__foot { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
.tl__reset { color: var(--accent); font-weight: 600; font-size: 13px; }
.tl__recs { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.tl__muted { margin: 0; font-size: 13px; color: var(--muted); }
.rc { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 14px; background: var(--white); text-align: left; box-shadow: 0 4px 14px rgba(108, 85, 15, .08); }
.rc__n { flex: 0 0 24px; height: 24px; border-radius: 50%; background: var(--accent-dark); color: #fff; font-size: 13px; font-weight: 700; display: grid; place-items: center; }
.rc__img { flex: 0 0 40px; height: 68px; display: flex; align-items: center; justify-content: center; }
.rc__img img { max-height: 100%; max-width: 100%; object-fit: contain; mix-blend-mode: multiply; }
.rc__txt { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rc__txt b { font-size: 14px; line-height: 1.25; }
.rc__txt small { font-size: 12.5px; color: var(--accent); }
.rc__why { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.rc__why i { font-style: normal; font-size: 11.5px; padding: 2px 7px; border-radius: 999px; background: var(--surface); color: #5d5348; }
.gc__hint { margin-top: 3px; font-size: 11px; font-weight: 600; color: var(--accent); }
.gc__mine { position: absolute; top: 6px; right: 6px; font-size: 11px; font-weight: 700; color: #c79a2e; background: #fff; border-radius: 999px; padding: 2px 6px; }
@media (min-width: 720px) {
  .sg__grid { gap: 12px; }
  .gc__img { height: 140px; }
  .gc__title { font-size: 14px; }
  .gc__maker { font-size: 12.5px; }
}

.dv { max-width: 760px; margin: 14px auto 0; scroll-margin-top: calc(var(--hdr, 76px) + 8px); }
.dv__nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.dv__back { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; color: var(--accent); font-weight: 600; font-size: 15px; }
.dv__steps { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 13px; }
.dv__steps button { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; color: var(--accent); }
.dv__steps button:disabled { opacity: .3; }
.dv__card { background: var(--white); border-radius: var(--radius-l); padding: 16px; border: 1.5px solid transparent;
  box-shadow: 0 10px 30px rgba(108, 85, 15, .12), 0 2px 6px rgba(108, 85, 15, .08); animation: dvIn .25s ease; }
.dv__card.fav { border-color: #c0392b; }
.dv__card.rec { border-color: #e9cf7d; }
@keyframes dvIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.dv__head { display: flex; gap: 14px; }
.dv__img { flex: 0 0 92px; height: 170px; border-radius: 14px; background: var(--surface); display: flex; align-items: center; justify-content: center; padding: 6px; }
.dv__img img { max-width: 100%; max-height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.dv__img.nf { height: 92px; background: var(--pill); color: var(--accent-dark); }
.dv__main { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.dv__tag { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.dv__tag.fav { background: #fbe9e7; color: #c0392b; }
.dv__tag.rec { background: #fbf1d3; color: #8a6a10; }
.dv__title { font-family: var(--serif); font-weight: 500; font-size: 22px; line-height: 1.2; }
.dv__maker { color: var(--accent); font-size: 15px; }
.dv__meta { color: var(--muted); font-size: 13.5px; line-height: 1.35; }
.dv__rating { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px 3px 7px; border-radius: 16px; background: var(--pill); font-size: 12.5px; font-weight: 600; }
.dv__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.dv__chips span { padding: 4px 10px; border-radius: 999px; background: var(--surface); font-size: 12.5px; }
.dv__desc { margin: 12px 0 0; font-size: 14px; line-height: 1.5; color: var(--text, #2b2421); }
.dv__why { display: flex; flex-direction: column; gap: 3px; margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: #fbf6e6; font-size: 13px; color: #6d5410; }
.dv__why b { font-size: 13px; }
.dv__actions { display: flex; gap: 10px; margin-top: 16px; }
.dv__open { flex: 1; }
.dv__rate, .mc__rate { margin-top: 8px; padding: 2px 4px 0; border-top: 1px solid var(--line); }
.rs__toast { position: fixed; left: 50%; bottom: calc(100px + var(--safe-bottom)); transform: translateX(-50%); z-index: 60; background: #2c2a28; color: #fff;
  padding: 10px 18px; border-radius: 999px; font-size: 14px; white-space: nowrap; }

.rs__more { display: flex; gap: 10px; max-width: 560px; margin: 20px auto 0; }
.rs__analogs { max-width: 560px; margin-left: auto; margin-right: auto; margin-top: 24px; }
.rs__analogs .section-title { margin-bottom: 4px; }
.rs__analogs-lead { margin: 0 0 12px; font-size: 14px; }
.rs__more .btn { flex: 1; padding: 12px 10px; }

@media (prefers-reduced-motion: reduce) {
  .rs__dot i { animation: none; }
  .rs__card, .rs__dot, .gc { transition: none; }
}
</style>
