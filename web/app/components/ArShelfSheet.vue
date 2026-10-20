<script setup lang="ts">
// The «wines on the shelf» sheet of the live AR scanner (/scan/ar): the wines scanned so far shown exactly as the shelf
// result of the photo scanner shows a shelf (pages/scan/result.vue) — the same grid cards, the folding «Фильтры» panel and the
// «Рекомендация» picks: 2–3 wines that pass the filters and differ from each other (winery, style, grape), by closeness to the
// wines you liked (POST /api/wines/rank-by-favorites), the guide's score and awards (POST /api/wines/shelf-meta). A wine you
// rated 4–5 comes first with a heart; one in your collection carries «В коллекции». The scanner shows the result on the bottles:
// the state (picks, the wines that pass, the active filters, why each pick) goes up with `state`.
import type { ArCard } from '~/utils/arTracker'

const props = defineProps<{ open: boolean, slugs: string[], cards: Record<string, ArCard> }>()
const emit = defineEmits<{ close: [], state: [{ picks: string[], pass: string[], filters: string[], why: Record<string, string> }] }>()
const { liked, get, inCollection } = useMyWines()
const isLiked = (slug: string) => liked.value.some(w => w.slug === slug)

const COLOR: Record<string, string> = { red: 'красное', white: 'белое', rose: 'розовое', orange: 'оранжевое' }
const SWEET: Record<string, string> = { dry: 'сухое', semi_dry: 'полусухое', semi_sweet: 'полусладкое', sweet: 'сладкое', brut: 'брют', extra_brut: 'экстра брют' }
interface FavMatch { slug: string, match: number, reasons: string[], like: { slug: string, title: string } | null }
interface Meta { price: number | null, guideRating: number | null, rating: number | null, awards: number, grapes: string[], color: string, sweetness: string, sparkling: boolean, manufacturer: string }

const wines = computed(() => props.slugs.map(s => props.cards[s]).filter((c): c is ArCard => !!c))
// closeness to the wines you liked (silently, no percentages)
const rel = ref<Record<string, FavMatch>>({})
let relFor = ''
watchEffect(async () => {
  const slugs = wines.value.map(w => w.slug), favs = liked.value.map(w => w.slug), key = slugs.join(',') + '|' + favs.join(',')
  if (!slugs.length || !favs.length) { rel.value = {}; relFor = ''; return }
  if (key === relFor) return
  relFor = key
  try {
    const r = await $fetch<{ items: FavMatch[] }>('/api/wines/rank-by-favorites', { method: 'POST', body: { slugs, favorites: favs } })
    if (relFor === key) rel.value = Object.fromEntries(r.items.map(x => [x.slug, x]))
  } catch { if (relFor === key) rel.value = {} }
})
// price, guide, awards, grapes, style
const meta = ref<Record<string, Meta>>({})
const metaReady = ref(false)
let metaFor = ''
watchEffect(async () => {
  const slugs = wines.value.map(w => w.slug), key = slugs.join(',')
  if (key === metaFor) return
  metaFor = key; metaReady.value = false
  if (!slugs.length) { meta.value = {}; metaReady.value = true; return }
  try {
    const r = await $fetch<{ items: Record<string, Meta> }>('/api/wines/shelf-meta', { method: 'POST', body: { slugs } })
    if (metaFor === key) meta.value = r.items
  } catch { if (metaFor === key) meta.value = {} }
  if (metaFor === key) metaReady.value = true
})
const styleWord = (w: ArCard) => { const m = meta.value[w.slug], c = m?.color || w.color, sw = m?.sweetness || w.sweetness
  return m?.sparkling ? `игристое ${SWEET[sw || ''] || ''}`.trim() : [COLOR[c || ''], SWEET[sw || '']].filter(Boolean).join(' ') }
const pctOf = (w: ArCard) => { const p = meta.value[w.slug]?.price; return p ? `от ${Math.round(p).toLocaleString('ru-RU')} ₽` : '' }

// ---------------- «Фильтры» (as the shelf result) ----------------
const fOpen = ref(false)
const f = reactive({ fresh: false, noLiked: false, colors: [] as string[], sweets: [] as string[], price: '' })
const F_COLORS: [string, string][] = [['red', 'Красное'], ['white', 'Белое'], ['rose', 'Розовое']]
const F_SWEETS: [string, string][] = [['dry', 'Сухое'], ['semi_dry', 'Полусухое'], ['semi_sweet', 'Полусладкое'], ['sweet', 'Сладкое'], ['sparkling', 'Игристое']]
const F_PRICES: [string, string][] = [['lt700', 'до 700 ₽'], ['700_1500', '700–1500 ₽'], ['gt1500', 'от 1500 ₽']]
const fCount = computed(() => +f.fresh + +f.noLiked + f.colors.length + f.sweets.length + (f.price ? 1 : 0))
const tog = (arr: string[], v: string) => { const i = arr.indexOf(v); if (i < 0) arr.push(v); else arr.splice(i, 1) }
function fReset() { f.fresh = false; f.noLiked = false; f.colors.splice(0); f.sweets.splice(0); f.price = '' }
function passes(w: ArCard) {
  if (!fCount.value) return true
  const m = meta.value[w.slug]
  if (f.fresh && get(w.slug)) return false
  if (f.noLiked && isLiked(w.slug)) return false
  const color = m?.color || w.color, sw = m?.sweetness || w.sweetness, sp = m?.sparkling ?? ['brut', 'extra_brut'].includes(sw)
  if (f.colors.length && !f.colors.includes(color)) return false
  if (f.sweets.length && !f.sweets.includes(sp ? 'sparkling' : sw)) return false
  if (f.price) {
    const p = m?.price
    if (!p || (f.price === 'lt700' && p >= 700) || (f.price === '700_1500' && (p < 700 || p > 1500)) || (f.price === 'gt1500' && p <= 1500)) return false
  }
  return true
}
const filtered = computed(() => wines.value.filter(passes))
// ---------------- «Рекомендация»: 2–3 wines that pass the filters and differ from each other (result.vue recPicks) ----------------
const picks = computed(() => {
  if (!metaReady.value) return [] as { w: ArCard, why: string[] }[]
  const pool = filtered.value.filter(w => !isLiked(w.slug)).map(w => {
    const m = meta.value[w.slug], r = rel.value[w.slug]
    let s = 0
    if (r) s += r.match / 25
    if (m?.guideRating) s += 1 + (m.guideRating - 4) * 4
    s += Math.min(m?.awards || 0, 3) * 0.25
    if (get(w.slug)) s -= 2
    return { w, s }
  })
  const out: typeof pool = []
  while (out.length < 3 && pool.length) {
    let best = 0, bs = -Infinity
    pool.forEach((x, k) => {
      let s = x.s
      for (const p of out) {
        if (p.w.manufacturer === x.w.manufacturer) s -= 3
        if (styleWord(p.w) === styleWord(x.w)) s -= 2
        const ga = meta.value[p.w.slug]?.grapes?.[0], gb = meta.value[x.w.slug]?.grapes?.[0]
        if (ga && ga === gb) s -= 1
      }
      if (s > bs) { bs = s; best = k }
    })
    out.push(pool.splice(best, 1)[0]!)
  }
  return out.map(x => {
    const m = meta.value[x.w.slug], r = rel.value[x.w.slug], why: string[] = [styleWord(x.w)]
    if (r?.like) why.push(`похоже на «${r.like.title.split(/[.,;(]\s*/)[0]!.trim() || r.like.title}»`)
    if (m?.guideRating) why.push(`гид ${m.guideRating.toFixed(2)}`); else if (m?.awards) why.push(`медалей: ${m.awards}`)
    if (m?.price) why.push(`от ${Math.round(m.price).toLocaleString('ru-RU')} ₽`)
    return { w: x.w, why }
  })
})
const pickNo = (slug: string) => picks.value.findIndex(p => p.w.slug === slug) + 1
// the grid: the wines you liked (best first), then the picks, then the rest
const gridShown = computed(() => {
  const favs = filtered.value.filter(w => isLiked(w.slug)).sort((a, b) => (get(b.slug)?.rating || 0) - (get(a.slug)?.rating || 0))
  const taken = new Set([...favs.map(w => w.slug), ...picks.value.map(p => p.w.slug)])
  return [...favs, ...picks.value.map(p => p.w), ...filtered.value.filter(w => !taken.has(w.slug))]
})
const activeFilters = computed(() => [
  ...(f.fresh ? ['Новое для меня'] : []), ...(f.noLiked ? ['Без понравившихся'] : []),
  ...F_COLORS.filter(([k]) => f.colors.includes(k)).map(([, t]) => t), ...F_SWEETS.filter(([k]) => f.sweets.includes(k)).map(([, t]) => t),
  ...F_PRICES.filter(([k]) => f.price === k).map(([, t]) => t)])
watchEffect(() => emit('state', {
  picks: picks.value.map(p => p.w.slug), pass: filtered.value.map(w => w.slug), filters: activeFilters.value,
  why: Object.fromEntries(picks.value.map(p => [p.w.slug, p.why.find(w => /похоже/.test(w)) || p.why.slice(1).join(' · ') || p.why[0] || ''])) }))
function openWine(slug: string) { navigateTo(`/wines/${slug}`) }
</script>

<template>
  <Transition name="ash">
    <div v-if="open" class="ash" @click.self="emit('close')">
      <div class="ash__sheet" role="dialog" aria-label="Вина на полке">
        <button class="ash__grab" aria-label="Свернуть" @click="emit('close')" />
        <h2 class="ash__t">Вина на полке</h2>
        <p class="ash__s">{{ wines.length }} из каталога «Своё вино» · отсканировано</p>
        <section v-if="wines.length" class="tl">
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
              <button v-for="[k, t] in F_COLORS" :key="k" class="chip chip--sm" :class="{ active: f.colors.includes(k) }" :data-f="`c-${k}`" @click="tog(f.colors, k)">{{ t }}</button>
            </div>
            <div class="tl__group"><span>Сладость</span>
              <button v-for="[k, t] in F_SWEETS" :key="k" class="chip chip--sm" :class="{ active: f.sweets.includes(k) }" :data-f="`s-${k}`" @click="tog(f.sweets, k)">{{ t }}</button>
            </div>
            <div class="tl__group"><span>Цена</span>
              <button v-for="[k, t] in F_PRICES" :key="k" class="chip chip--sm" :class="{ active: f.price === k }" @click="f.price = f.price === k ? '' : k">{{ t }}</button>
            </div>
            <div class="tl__foot">
              <span>{{ fCount ? `Подходит ${gridShown.length} из ${wines.length}` : `Вин на полке: ${wines.length}` }}</span>
              <button v-if="fCount" class="tl__reset" @click="fReset">Сбросить</button>
            </div>
          </div>
        </section>
        <p v-else class="ash__empty">Наведите камеру на полку — найденные вина появятся здесь</p>
        <section class="sg p2">
          <div class="sg__grid">
            <div v-for="w in gridShown" :key="w.slug" class="gc" :class="{ fav: isLiked(w.slug), col: inCollection(w.slug), pickc: pickNo(w.slug) > 0 }"
              :data-slug="w.slug" role="button" tabindex="0" @click="openWine(w.slug)" @keydown.enter="openWine(w.slug)">
              <span class="gc__top">
                <span v-if="w.rating" class="gc__rating" title="Рейтинг «Своё вино»"><RatingGlass />{{ Number(w.rating).toFixed(2) }}</span>
                <span v-if="isLiked(w.slug)" class="gc__heart" :aria-label="`Вы оценили на ${get(w.slug)?.rating} из 5`"><AppIcon name="heart" :size="14" /></span>
              </span>
              <span class="gc__img"><img :src="w.img" alt="" loading="lazy" /></span>
              <b class="gc__title">{{ w.title }}</b>
              <span class="gc__maker">{{ w.manufacturer }}</span>
              <span class="gc__info"><span>{{ styleWord(w) }}</span><span v-if="pctOf(w)">{{ pctOf(w) }}</span></span>
              <span v-if="pickNo(w.slug) && picks[pickNo(w.slug) - 1]?.why.some(x => /похоже/.test(x))" class="gc__why">{{ picks[pickNo(w.slug) - 1]!.why.find(x => /похоже/.test(x)) }}</span>
              <span v-if="inCollection(w.slug)" class="gc__rec gc__rec--col"><AppIcon name="heart" :size="11" />В коллекции</span>
              <span v-else-if="pickNo(w.slug)" class="gc__rec"><AppIcon name="star4" :size="12" />Рекомендация</span>
            </div>
          </div>
        </section>
        <div class="ash__foot"><button class="btn btn-primary btn-block ash__go" @click="emit('close')">Показать на полке</button></div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ash { position: absolute; inset: 0; z-index: 8; background: rgba(20, 16, 14, .45); display: flex; align-items: flex-end; }
.ash__sheet { width: 100%; height: 82%; overflow-y: auto; display: flex; flex-direction: column; overscroll-behavior: contain; box-sizing: border-box; padding: 6px 14px 0; border-radius: 22px 22px 0 0;
  background: var(--bg); color: var(--text); box-shadow: 0 -10px 30px rgba(0, 0, 0, .25); }
.ash__grab { display: block; width: 40px; height: 5px; border-radius: 3px; background: #d9cdb6; margin: 4px auto 10px; border: 0; padding: 0; }
.ash__t { font: 600 20px/1.2 var(--serif); margin: 0; }
.ash__s { font-size: 13px; color: var(--muted); margin: 2px 0 0; }
.ash__empty { font-size: 14px; color: var(--muted); margin: 18px 0; }
.ash__foot { position: sticky; bottom: 0; margin: 12px -14px 0; margin-top: auto; padding: 10px 14px calc(12px + var(--safe-bottom, 0px)); background: linear-gradient(transparent, var(--bg) 30%); }
.ash-enter-active, .ash-leave-active { transition: background-color .3s ease; }
.ash-enter-active .ash__sheet, .ash-leave-active .ash__sheet { transition: transform .35s cubic-bezier(.2, .8, .2, 1); }
.ash-enter-from, .ash-leave-to { background-color: transparent; }
.ash-enter-from .ash__sheet, .ash-leave-to .ash__sheet { transform: translateY(100%); }
/* the shelf result's grid and filters (pages/scan/result.vue) */
.p2 .gc { opacity: 1; transform: none; }
.sg { max-width: 760px; margin: 12px auto 0; }
.sg__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.gc { scroll-margin-top: calc(var(--hdr, 76px) + 8px); position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 22px 6px 9px; border-radius: 14px; background: var(--white);
  text-align: center; cursor: pointer; border: 1.5px solid transparent; box-shadow: 0 4px 14px rgba(108, 85, 15, .1), 0 1px 3px rgba(108, 85, 15, .07);
  opacity: 0; transform: translateY(8px); transition: opacity .3s ease, transform .35s ease, border-color .15s; }
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
.gc__hint { margin-top: 3px; font-size: 11px; font-weight: 600; color: var(--accent); }
.gc__mine { position: absolute; top: 6px; right: 6px; font-size: 11px; font-weight: 700; color: #c79a2e; background: #fff; border-radius: 999px; padding: 2px 6px; }
</style>
