<script setup lang="ts">
// Wine card in the portal's layout + what happens after the scan: label check, «Цифровой сомелье», analogs from other wineries,
// own rating -> the collection of the personal cabinet (only for a wine the user has scanned) and «Для вас» from the taste profile.
import { fitOf } from '#shared/taste'
const route = useRoute()
const slug = computed(() => String(route.params.slug))
import AnalogCard from '~/components/AnalogCard.vue'
const { data: wine, error } = await useFetch<any>(() => `/api/wines/${slug.value}`)
if (error.value || !wine.value) throw createError({ statusCode: 404, statusMessage: 'Вино не найдено', fatal: true })
// the page instance is reused between /wines/a -> /wines/b: a failed refetch must also show the error page
watch(error, e => { if (e) showError({ statusCode: 404, statusMessage: 'Вино не найдено', fatal: true }) })
useHead(() => ({ title: `${wine.value?.title} — ${wine.value?.manufacturer} | Свои вина`, meta: [{ name: 'description', content: (wine.value?.description || '').slice(0, 160) }] }))

const { data: analogs } = useLazyFetch<any[]>(() => `/api/wines/${slug.value}/similar`, { query: { mode: 'analogs', size: 12 }, default: () => [] })
const { data: maker } = useLazyFetch<any>('/api/wines', { query: computed(() => ({ manufacturer: wine.value?.manufacturer, limit: 13 })), default: () => ({ items: [] }) })
const makerItems = computed(() => (maker.value?.items || []).filter((w: any) => w.slug !== slug.value).slice(0, 12))

// came from the scanner -> compare what was read on the label with the catalog
const { result, preview } = useScan()
// the bottle on the scanned photo that matched this wine (a shelf photo can have several)
const scanBottle = computed(() => route.query.from === 'scan' ? result.value?.detection?.bottles?.find(b => b.match?.slug === slug.value) : undefined)
const fromScan = computed(() => !!scanBottle.value)
const read = computed<Record<string, any>>(() => scanBottle.value?.match?.read || {})
const COLOR: Record<string, string> = { red: 'красное', white: 'белое', rose: 'розовое', orange: 'оранжевое' }
const SWEET: Record<string, string> = { dry: 'сухое', semi_dry: 'полусухое', semi_sweet: 'полусладкое', sweet: 'сладкое', brut: 'брют', extra_brut: 'экстра брют' }
const checks = computed(() => {
  const w = wine.value, r = read.value, out: { ok: boolean, text: string }[] = []
  if (!w || !fromScan.value) return out
  if (r.color) out.push(r.color === w.color ? { ok: true, text: `Цвет совпадает: ${COLOR[w.color] || w.color}` } : { ok: false, text: `На фото похоже ${COLOR[r.color] || r.color}, в каталоге — ${COLOR[w.color] || w.color}` })
  if (r.sweetness) out.push(r.sweetness === w.sweetness ? { ok: true, text: `Сладость совпадает: ${SWEET[w.sweetness] || w.sweetness}` } : { ok: false, text: `На этикетке похоже ${SWEET[r.sweetness] || r.sweetness}, в каталоге — ${SWEET[w.sweetness] || w.sweetness}. Проверьте, это частая ошибка при покупке` })
  if (r.vintage) out.push(!w.year || String(w.year) === String(r.vintage) ? { ok: true, text: `Урожай ${r.vintage}` } : { ok: false, text: `На этикетке урожай ${r.vintage}, описание в каталоге — для ${w.year}` })
  return out
})

// personal cabinet: the collection is filled from the scanner only (a wine recognised on the user's photo / in AR can be rated)
const { canRate, get, setVintage, profile } = useMyWines()
const mini = computed(() => ({ slug: wine.value.slug, title: wine.value.title, manufacturer: wine.value.manufacturer, img: wine.value.img,
  category: wine.value.category, color: wine.value.color, sweetness: wine.value.sweetness, vintage: read.value.vintage ? String(read.value.vintage) : undefined }))
const mine = computed(() => get(slug.value))
const rateable = computed(() => canRate(slug.value))
function onRated(n: number, added: boolean) { toast(added ? 'Добавлено в коллекцию' : `Оценка ${n} из 5 сохранена`) }
// «Для вас» is personal: only on the card of a wine the user scanned (the catalog card stays the portal's)
const fit = computed(() => fitOf(profile.value, wine.value || {}))

const toastText = ref(''); let tt: any
function toast(t: string) { toastText.value = t; clearTimeout(tt); tt = setTimeout(() => (toastText.value = ''), 2200) }
async function share() {
  const data = { title: wine.value.title, text: `${wine.value.title} — ${wine.value.manufacturer}`, url: location.href.split('?')[0] }
  if (navigator.share) return navigator.share(data).catch(() => {})
  await navigator.clipboard?.writeText(data.url).catch(() => {}); toast('Ссылка скопирована')
}
const descOpen = ref(false)
const longDesc = computed(() => (wine.value?.description || '').length > 320)
const specs = computed(() => {
  const w = wine.value
  return [
    w.region && { icon: 'pin', label: 'Регион', value: w.region },
    w.grapes?.length && { icon: 'grape', label: 'Сорт винограда', value: w.grapes.join(', ') },
    w.category && { icon: 'drop', label: 'Категория и цвет', value: w.category, swatch: w.gradient },
    w.temperature && { icon: 'thermo', label: 'Температура подачи', value: `${w.temperature} °C` },
    w.alcohol && { icon: 'glass', label: 'Крепость', value: `${w.alcohol}%` },
    w.year && { icon: 'bookmark', label: 'Год урожая', value: w.year },
  ].filter(Boolean) as any[]
})
</script>

<template>
  <div v-if="wine" class="container wd">
    <nav class="crumbs" aria-label="Навигация"><NuxtLink to="/wines">Свои вина</NuxtLink><span>›</span><span class="crumbs__cur">{{ wine.title }}</span></nav>

    <div v-if="fromScan" class="wd__scan">
      <img v-if="preview" :src="preview" alt="" class="wd__scan-photo" />
      <div><b>Найдено по вашему фото</b><br /><NuxtLink to="/scan/result" class="wd__scan-link">Вернуться к фото</NuxtLink></div>
      <AppIcon name="check" class="wd__scan-ok" />
    </div>

    <div class="wd__top">
      <div class="wd__media">
        <div class="wd__badges">
          <span v-if="wine.rating" class="wd__rating"><RatingGlass />{{ Number(wine.rating).toFixed(2) }}<small>Народный рейтинг</small></span>
          <span v-if="wine.guideRating" class="wd__rating wd__rating--guide"><span class="wd__star">★</span>{{ Number(wine.guideRating).toFixed(2) }}<small>Оценка гида</small></span>
        </div>
        <img :src="wine.img" :alt="`${wine.category} ${wine.title} ${wine.manufacturer}`" />
      </div>
      <div class="wd__info">
        <h1 class="wd__title">{{ wine.title }}</h1>
        <NuxtLink :to="{ path: '/wines', query: { manufacturer: wine.manufacturer } }" class="wd__maker">{{ wine.manufacturer }}</NuxtLink>
        <ClientOnly>
          <div v-if="rateable" class="wd__mine">
            <RateStars :wine="mini" @rated="onRated" />
            <NuxtLink v-if="mine" to="/my" class="wd__mine-link">В коллекции · личный кабинет<AppIcon name="chevron" :size="16" /></NuxtLink>
          </div>
          <div v-else class="wd__mine wd__mine--locked">
            <AppIcon name="camera" :size="22" />
            <span>Оценить и добавить в коллекцию можно после скана этикетки</span>
            <NuxtLink to="/scan" class="wd__mine-scan">Сканировать</NuxtLink>
          </div>
          <div v-if="fit && rateable" class="wd__fit" :class="fit.level">
            <b>Для вас</b>
            <span v-for="l in fit.lines" :key="l">{{ l }}</span>
          </div>
          <NuxtLink v-else-if="rateable && !profile" to="/my?tab=taste" class="wd__fit wd__fit--invite">
            <b>Подойдёт ли вам это вино?</b><span>Ответьте на 5 простых вопросов о вкусе — подскажем на каждой карточке</span>
          </NuxtLink>
        </ClientOnly>
        <div class="wd__actions">
          <button class="btn btn-outline wd__share" @click="share"><AppIcon name="share" :size="20" />Поделиться</button>
        </div>
      </div>
    </div>

    <section v-if="checks.length" class="wd__check card">
      <h2 class="h3">Сверка с этикеткой</h2>
      <p v-for="c in checks" :key="c.text" class="wd__check-row" :class="c.ok ? 'ok' : 'warn'"><AppIcon :name="c.ok ? 'check' : 'alert'" :size="18" />{{ c.text }}</p>
      <button v-if="read.vintage && mine && mine.vintage !== String(read.vintage)" class="btn btn-outline btn-block"
        @click="setVintage(slug, String(read.vintage)); toast(`В коллекции — урожай ${read.vintage}`)">
        Запомнить в коллекции урожай {{ read.vintage }}
      </button>
    </section>

    <section class="section">
      <h2 class="section-title">Характеристики</h2>
      <dl class="wd__specs">
        <div v-for="s in specs" :key="s.label" class="wd__spec">
          <AppIcon :name="s.icon" :size="22" class="wd__spec-icon" />
          <dt>{{ s.label }}</dt>
          <dd><span v-if="s.swatch" class="wd__swatch" :style="{ background: s.swatch }" />{{ s.value }}</dd>
        </div>
      </dl>
      <div class="wd__taste"><span class="wd__taste-label">Сладость</span><TasteScale :sweetness="wine.sweetness" /></div>
    </section>

    <section v-if="wine.dishes?.length" class="section">
      <h2 class="section-title">Сочетание с блюдами</h2>
      <div class="wd__dishes"><NuxtLink v-for="d in wine.dishes" :key="d" :to="{ path: '/wines', query: { dish: d } }" class="chip">{{ d }}</NuxtLink></div>
    </section>

    <section v-if="wine.description" class="section">
      <h2 class="section-title">Описание</h2>
      <p class="wd__desc" :class="{ clamp: longDesc && !descOpen }">{{ wine.description }}</p>
      <button v-if="longDesc" class="wd__more" @click="descOpen = !descOpen">{{ descOpen ? 'Свернуть' : 'Читать полностью' }}</button>
    </section>

    <WineExtras v-if="wine.extra" :extra="wine.extra" :read-vintage="read.vintage ? String(read.vintage) : null" />

    <div class="section"><SommelierBlock :key="wine.slug" :wine="wine" /></div>

    <section v-if="analogs?.length" class="section">
      <h2 class="section-title">Аналоги из других виноделен</h2>
      <p class="muted wd__lead">Подобрали по сорту, нотам во вкусе и аромате, гастрономии и телу вина</p>
      <div class="hscroll"><AnalogCard v-for="w in analogs" :key="w.slug" :wine="w" /></div>
    </section>
    <WineShelf :title="`Ещё от «${wine.manufacturer}»`" :items="makerItems" :to="{ path: '/wines', query: { manufacturer: wine.manufacturer } }" />

    <Transition name="fade"><div v-if="toastText" class="wd__toast" role="status">{{ toastText }}</div></Transition>
  </div>
</template>

<style scoped>
.wd { padding-top: 20px; }
.crumbs { display: flex; gap: 8px; font-size: 14px; color: var(--muted); margin-bottom: 16px; min-width: 0; }
.crumbs a { color: var(--accent); }
.crumbs__cur { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wd__scan { display: flex; align-items: center; gap: 12px; padding: 10px 14px 10px 10px; border-radius: var(--radius-m); background: #e6f0e4; margin-bottom: 16px; font-size: 15px; }
.wd__scan-photo { width: 44px; height: 56px; object-fit: cover; border-radius: 10px; }
.wd__scan div { flex: 1; }
.wd__scan-link { color: var(--ok); font-size: 14px; }
.wd__scan-ok { color: var(--ok); }

.wd__top { display: grid; gap: 20px; }
@media (min-width: 760px) { .wd__top { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; } }
.wd__media { position: relative; background: var(--surface); border-radius: var(--radius-l); height: 400px; display: flex; align-items: center; justify-content: center; padding: 48px 16px 20px; }
.wd__media img { max-width: 100%; max-height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.wd__badges { position: absolute; top: 16px; left: 16px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.wd__rating--guide { background: #fff; }
.wd__star { color: #d9a520; font-size: 15px; line-height: 1; }
.wd__rating { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px 5px 9px; border-radius: 16px;
  background: var(--pill); font-weight: 600; font-size: 14px; }
.wd__rating small { font-weight: 400; color: var(--muted); font-size: 12px; margin-left: 4px; }
.wd__title { font-family: var(--serif); font-weight: 500; font-size: 34px; line-height: 1.15; }
.wd__maker { display: inline-block; color: var(--accent); font-size: 18px; margin-top: 8px; }
.wd__actions { display: flex; gap: 10px; margin-top: 14px; }
.wd__share { gap: 8px; }
.wd__mine { display: flex; flex-direction: column; align-items: stretch; gap: 4px; margin-top: 18px; padding: 10px 14px; border-radius: var(--radius-s); border: 1px solid var(--line); }
.wd__mine-link { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-size: 14px; font-weight: 600; }
.wd__mine--locked { flex-direction: row; align-items: center; gap: 10px; color: var(--accent); background: var(--surface); border-color: transparent; }
.wd__mine--locked span { flex: 1; color: var(--muted); font-size: 14px; line-height: 1.4; }
.wd__mine-scan { color: var(--accent); font-weight: 600; font-size: 14px; white-space: nowrap; }
.wd__fit { display: flex; flex-direction: column; gap: 3px; margin-top: 12px; padding: 12px 14px; border-radius: var(--radius-s); background: #e6f0e4; font-size: 14px; line-height: 1.4; }
.wd__fit b { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: var(--ok); }
.wd__fit.mixed { background: var(--pill); }
.wd__fit.mixed b, .wd__fit.off b { color: var(--accent-dark); }
.wd__fit.off { background: var(--accent-soft); }
.wd__fit--invite { background: var(--surface); }
.wd__fit--invite b { color: var(--accent); }
.wd__fit--invite span { color: var(--muted); }

.wd__check { margin-top: 20px; padding: 18px 16px; display: flex; flex-direction: column; gap: 10px; }
.wd__check-row { display: flex; gap: 8px; margin: 0; line-height: 1.4; }
.wd__check-row.ok { color: var(--ok); }
.wd__check-row.warn { color: var(--warn); }

.wd__specs { margin: 0; display: grid; gap: 2px; }
@media (min-width: 760px) { .wd__specs { grid-template-columns: 1fr 1fr; gap: 2px 24px; } }
.wd__spec { display: grid; grid-template-columns: 34px 1fr; grid-template-rows: auto auto; padding: 12px 0; border-bottom: 1px solid var(--line); }
.wd__spec-icon { grid-row: span 2; color: var(--accent); margin-top: 2px; }
.wd__spec dt { font-size: 13px; color: var(--muted); }
.wd__spec dd { margin: 2px 0 0; font-weight: 500; display: flex; align-items: center; gap: 8px; }
.wd__swatch { width: 18px; height: 18px; border-radius: 50%; flex: 0 0 18px; }
.wd__taste { margin-top: 18px; }
.wd__taste-label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 8px; }

.wd__dishes { display: flex; flex-wrap: wrap; gap: 8px; }
.wd__desc { white-space: pre-line; line-height: 1.6; margin: 0; }
.wd__desc.clamp { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
.wd__more { color: var(--accent); font-weight: 600; margin-top: 8px; }
.wd__lead { margin: -8px 0 12px; font-size: 14px; }

.wd__toast { position: fixed; left: 50%; bottom: calc(100px + var(--safe-bottom)); transform: translateX(-50%); z-index: 60; background: #2c2a28; color: #fff;
  padding: 10px 18px; border-radius: 999px; font-size: 14px; white-space: nowrap; }
@media (max-width: 480px) { .wd__title { font-size: 30px; } .wd__media { height: 340px; } }
</style>
