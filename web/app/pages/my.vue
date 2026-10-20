<script setup lang="ts">
// Personal cabinet (no registration, this device): «Коллекция» — wines rated after a scan (the only way in), the taste profile
// from a short questionnaire refined by those ratings, and the scan history. Everything personal lives here; the rest of the site
// is the catalog and the scanner.
import { QUESTIONS, SWEET_NAME, SWEET_WORD, COLOR_WORD, profileWords, sweetIndex, likedColors, type TasteAnswers } from '#shared/taste'
import { FOOD } from '#shared/food'

useHead({ title: 'Личный кабинет — Свои вина' })
const route = useRoute(), router = useRouter()
const { collection, history, answers, profile, rate, remove, restore, setAnswers, clearHistory } = useMyWines()
type Tab = 'collection' | 'taste' | 'history'
const tab = computed<Tab>({
  get: () => (['collection', 'taste', 'history'].includes(String(route.query.tab)) ? route.query.tab as Tab : 'collection'),
  set: v => router.replace({ query: { ...route.query, tab: v === 'collection' ? undefined : v } }),
})
const NuxtLink = resolveComponent('NuxtLink')
const fmt = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

// ---------------- collection ----------------
const sort = ref<'date' | 'rating'>('date')
// «Новые» = date added (a re-rating never moves the row from under the finger); «По оценке» freezes the order until re-sorted
const ratingOrder = ref<string[]>([])
watch(sort, v => { if (v === 'rating') ratingOrder.value = [...collection.value].sort((a, b) => b.rating - a.rating || b.at - a.at).map(w => w.slug) }, { immediate: true })
const items = computed(() => {
  const byDate = [...collection.value].sort((a, b) => b.at - a.at)
  if (sort.value === 'date') return byDate
  const pos = new Map(ratingOrder.value.map((s, i) => [s, i]))
  return byDate.sort((a, b) => (pos.get(a.slug) ?? -1) - (pos.get(b.slug) ?? -1))
})
// removal: one tap, with «Вернуть» for a few seconds (a wine out of the scanner history could not be re-added otherwise)
const undo = ref<typeof collection.value[number] | null>(null); let undoT: any
function drop(slug: string) {
  const gone = remove(slug)
  if (!gone) return
  undo.value = gone; clearTimeout(undoT); undoT = setTimeout(() => (undo.value = null), 6000)
}
function undoDrop() { if (undo.value) restore(undo.value); undo.value = null; clearTimeout(undoT) }
const avg = computed(() => (collection.value.length ? collection.value.reduce((s, w) => s + w.rating, 0) / collection.value.length : 0))
function setRating(w: typeof collection.value[number], n: number) { rate(w, n) }

// ---------------- taste profile ----------------
const quizOpen = ref(false)
function done(a: TasteAnswers) { setAnswers(a); quizOpen.value = false; refreshPicks() }
const answerText = computed(() => {
  const a = answers.value || {}
  return QUESTIONS.filter(q => a[q.id] != null && (!q.when || q.when(a))).map(q => {
    const ids = Array.isArray(a[q.id]) ? a[q.id] as string[] : [a[q.id] as string]
    return { q: q.title, a: q.options.filter(o => ids.includes(o.id)).map(o => o.label).join(', ') }
  }).filter(x => x.a)
})
const words = computed(() => (profile.value ? profileWords(profile.value) : []))
const colorsOn = computed(() => (profile.value ? likedColors(profile.value) : []))
const sweetPos = computed(() => (profile.value?.sweet != null ? (profile.value.sweet / 3) * 100 : null))
// «Вина в вашем стиле»: catalog wines ranked by the profile (POST /api/wines/for-taste), the collection excluded
const picks = ref<any[]>([]), picksBusy = ref(false)
async function refreshPicks() {
  const p = profile.value
  if (!p) { picks.value = []; return }
  picksBusy.value = true
  try {
    const r = await $fetch<{ items: any[] }>('/api/wines/for-taste', { method: 'POST', body: {
      colors: p.colors, sweet: p.sweet, sparkling: p.sparkling, body: p.body, dishes: p.food.flatMap(f => FOOD[f]?.dishes || []),
      exclude: collection.value.map(w => w.slug), limit: 12 } })
    picks.value = r.items
  } catch { picks.value = [] } finally { picksBusy.value = false }
}
watch(() => [tab.value, profile.value && JSON.stringify(profile.value)], () => { if (tab.value === 'taste') refreshPicks() }, { immediate: true })
</script>

<template>
  <div class="container me">
    <h1 class="h1">Личный кабинет</h1>
    <p class="me__lead muted">Хранится на этом устройстве, без регистрации</p>
    <div class="me__tabs" role="tablist">
      <button role="tab" :aria-selected="tab === 'collection'" :class="{ on: tab === 'collection' }" @click="tab = 'collection'">Коллекция<ClientOnly><span v-if="collection.length">{{ collection.length }}</span></ClientOnly></button>
      <button role="tab" :aria-selected="tab === 'taste'" :class="{ on: tab === 'taste' }" @click="tab = 'taste'">Мой вкус</button>
      <button role="tab" :aria-selected="tab === 'history'" :class="{ on: tab === 'history' }" @click="tab = 'history'">История<ClientOnly><span v-if="history.length">{{ history.length }}</span></ClientOnly></button>
    </div>

    <ClientOnly>
      <!-- ================= collection ================= -->
      <section v-if="tab === 'collection'">
        <div v-if="!collection.length" class="me__empty">
          <AppIcon name="camera" :size="32" />
          <h2>Коллекция пока пуста</h2>
          <p>Отсканируйте бутылку и поставьте оценку — вино попадёт сюда. В коллекцию добавляются только вина, которые вы сфотографировали.</p>
          <NuxtLink to="/scan" class="btn btn-primary">Сканировать этикетку</NuxtLink>
        </div>
        <template v-else>
          <div class="me__bar">
            <span class="muted">{{ collection.length }} {{ collection.length % 10 === 1 && collection.length % 100 !== 11 ? 'вино' : [2, 3, 4].includes(collection.length % 10) && ![12, 13, 14].includes(collection.length % 100) ? 'вина' : 'вин' }} · средняя оценка {{ avg.toFixed(1) }}</span>
            <div class="me__sort" role="radiogroup" aria-label="Порядок">
              <button role="radio" :aria-checked="sort === 'date'" :class="{ on: sort === 'date' }" @click="sort = 'date'">Новые</button>
              <button role="radio" :aria-checked="sort === 'rating'" :class="{ on: sort === 'rating' }" @click="sort = 'rating'">По оценке</button>
            </div>
          </div>
          <div v-for="w in items" :key="w.slug" class="me__row">
            <NuxtLink :to="`/wines/${w.slug}`" class="me__img"><img :src="w.img" :alt="w.title" loading="lazy" /></NuxtLink>
            <div class="me__body">
              <NuxtLink :to="`/wines/${w.slug}`" class="me__title">{{ w.title }}</NuxtLink>
              <span class="me__maker">{{ w.manufacturer }}</span>
              <span class="me__meta">{{ w.category }}<template v-if="w.vintage"> · урожай {{ w.vintage }}</template> · {{ fmt(w.at) }}</span>
              <div class="me__stars" role="radiogroup" :aria-label="`Оценка «${w.title}»`">
                <button v-for="n in 5" :key="n" role="radio" :aria-checked="w.rating === n" :aria-label="`${n} из 5`" :class="{ on: w.rating >= n }" @click="setRating(w, n)">★</button>
              </div>
            </div>
            <button class="me__del" :aria-label="`Убрать «${w.title}» из коллекции`" @click="drop(w.slug)"><AppIcon name="close" :size="20" /></button>
          </div>
          <p class="me__note muted">Вина с оценкой 4–5 уточняют ваш вкусовой профиль, а на фото полки похожие на них бутылки идут первыми.</p>
        </template>
      </section>

      <!-- ================= taste profile ================= -->
      <section v-else-if="tab === 'taste'">
        <div v-if="quizOpen" class="me__quiz card"><TasteQuiz :initial="answers" @done="done" @cancel="quizOpen = false" /></div>
        <template v-else>
          <div v-if="!profile" class="me__invite card">
            <AppIcon name="sparkle" :size="30" />
            <h2>Расскажите, какое вино вам нравится</h2>
            <p>7 простых вопросов, без винных терминов. По ответам подскажем на карточке вина, подойдёт ли оно вам, и соберём вина в вашем стиле.</p>
            <button class="btn btn-primary btn-block" @click="quizOpen = true">Пройти анкету</button>
          </div>
          <template v-else>
            <div class="me__profile card">
              <p class="me__eyebrow">Ваш вкус</p>
              <h2 class="me__summary">{{ words.length ? words.join(' · ') : 'Пока без предпочтений' }}</h2>
              <div v-if="sweetPos != null" class="me__scale">
                <span class="me__scale-label">Сладость</span>
                <div class="me__track"><i class="me__dot" :style="{ left: `${sweetPos}%` }" /></div>
                <div class="me__ticks"><span v-for="(n, i) in SWEET_NAME" :key="n" :class="{ on: sweetIndex(profile.sweet!) === i }">{{ n }}</span></div>
                <p class="me__hint muted">{{ SWEET_WORD[sweetIndex(profile.sweet!)] }} — {{ ['вино почти без сахара', 'лёгкая сладость', 'заметно сладкое', 'десертное'][sweetIndex(profile.sweet!)] }}</p>
              </div>
              <div v-if="colorsOn.length && colorsOn.length < 3" class="me__chips"><span v-for="c in colorsOn" :key="c" class="chip">{{ COLOR_WORD[c] }}</span><span v-if="profile.sparkling >= 1" class="chip">игристое</span></div>
              <p class="me__src muted">
                <template v-if="profile.quiz">По анкете</template><template v-if="profile.quiz && profile.ratings"> и </template>
                <template v-if="profile.ratings">{{ profile.ratings }} {{ profile.ratings === 1 ? 'оценке' : 'оценкам' }} из коллекции</template>
              </p>
              <div class="me__actions">
                <button class="btn btn-outline" @click="quizOpen = true">{{ profile.quiz ? 'Пройти заново' : 'Пройти анкету' }}</button>
                <button v-if="profile.quiz" class="btn btn-ghost" @click="setAnswers(null)">Сбросить ответы</button>
              </div>
            </div>

            <details v-if="answerText.length" class="me__answers">
              <summary>Ваши ответы</summary>
              <dl><template v-for="x in answerText" :key="x.q"><dt>{{ x.q }}</dt><dd>{{ x.a }}</dd></template></dl>
            </details>

            <div class="me__how card">
              <b>Где это работает</b>
              <span>На карточке вина после скана — строка «Для вас»: суше или слаще, чем вы любите, к чему подходит.</span>
              <span>Профиль меняется вместе с оценками в коллекции: вина на 4–5 тянут его к своему стилю.</span>
            </div>

            <section class="me__picks">
              <h2 class="section-title">Вина в вашем стиле</h2>
              <p class="muted me__picks-lead">Подобраны по сладости, цвету и блюдам из вашего профиля. Добавить в коллекцию можно после скана.</p>
              <p v-if="picksBusy && !picks.length" class="muted">Подбираем…</p>
              <div class="me__grid"><AnalogCard v-for="w in picks" :key="w.slug" :wine="w" /></div>
            </section>
          </template>
        </template>
      </section>

      <!-- ================= scan history ================= -->
      <section v-else>
        <div v-if="!history.length" class="me__empty">
          <AppIcon name="camera" :size="32" />
          <h2>Сканов пока нет</h2>
          <p>Здесь появятся вина, которые вы открыли или выбрали после скана. Любое из них можно потом оценить и добавить в коллекцию.</p>
          <NuxtLink to="/scan" class="btn btn-primary">Сканировать этикетку</NuxtLink>
        </div>
        <div class="me__hgrid">
          <component :is="h.slug ? NuxtLink : 'div'" v-for="h in history" :key="h.at" :to="h.slug ? `/wines/${h.slug}` : undefined" class="me__scan">
            <span class="me__himg"><img v-if="h.img || h.photo" :src="h.img || h.photo" :alt="h.title" /></span>
            <span class="me__badge" :class="h.found ? 'ok' : 'nf'">{{ h.found ? 'Найдено' : 'Нет в каталоге' }}</span>
            <b>{{ h.title }}</b>
            <span class="me__meta">{{ fmt(h.at) }}</span>
          </component>
        </div>
        <button v-if="history.length" class="btn btn-ghost btn-block" @click="clearHistory">Очистить историю</button>
      </section>
    </ClientOnly>
    <Transition name="fade">
      <div v-if="undo" class="me__toast" role="status">Убрано «{{ undo.title }}»<button @click="undoDrop">Вернуть</button></div>
    </Transition>
  </div>
</template>

<style scoped>
.me { padding-top: 24px; max-width: 760px; }
.me__lead { text-align: center; margin: 10px 0 20px; }
.me__tabs { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--surface-2); margin-bottom: 18px; }
.me__tabs button { flex: 1; min-height: 42px; border-radius: 999px; font-weight: 600; color: var(--muted); display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.me__tabs button.on { background: #fff; color: var(--accent); box-shadow: var(--shadow-soft); }
.me__tabs span { font-size: 12px; background: var(--pill); color: var(--accent-dark); border-radius: 999px; padding: 1px 7px; }
.me__empty { text-align: center; padding: 36px 16px; color: var(--accent); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.me__empty h2 { font-family: var(--serif); font-weight: 500; font-size: 22px; color: var(--text); margin: 0; }
.me__empty p { color: var(--muted); max-width: 340px; margin: 0 0 8px; line-height: 1.5; }
.me__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; font-size: 14px; }
.me__sort { display: flex; gap: 4px; }
.me__sort button { padding: 6px 12px; border-radius: 999px; font-size: 13px; color: var(--muted); border: 1px solid var(--line); }
.me__sort button.on { color: var(--accent); border-color: var(--accent); background: #fff; }
.me__row { display: flex; gap: 14px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); }
.me__img { flex: 0 0 64px; height: 96px; border-radius: 12px; background: var(--surface); display: flex; align-items: center; justify-content: center; padding: 4px; }
.me__img img { max-width: 100%; max-height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.me__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.me__title { font-weight: 600; line-height: 1.3; }
.me__maker { color: var(--accent); font-size: 14px; }
.me__meta { color: var(--muted); font-size: 13px; }
.me__stars { display: flex; margin-left: -6px; }
.me__stars button { font-size: 22px; line-height: 1; width: 34px; height: 38px; color: #e2d6bd; }
.me__stars button.on { color: #c79a2e; }
.me__del { flex: 0 0 44px; height: 44px; display: grid; place-items: center; color: var(--muted); }
.me__note { font-size: 13px; margin: 14px 0 0; line-height: 1.5; }

.me__quiz, .me__invite, .me__profile { padding: 20px; }
.me__invite { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; color: var(--accent); }
.me__invite h2 { font-family: var(--serif); font-weight: 500; font-size: 24px; line-height: 1.2; color: var(--text); margin: 0; }
.me__invite p { color: var(--muted); margin: 0 0 6px; line-height: 1.5; }
.me__eyebrow { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }
.me__summary { font-family: var(--serif); font-weight: 500; font-size: 24px; line-height: 1.25; margin: 0 0 16px; }
.me__scale-label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
.me__track { position: relative; height: 8px; border-radius: 99px; background: linear-gradient(90deg, #efe6d2, #e7b9a8 60%, #b4475a); }
.me__dot { position: absolute; top: 50%; width: 20px; height: 20px; margin-left: -10px; transform: translateY(-50%); border-radius: 50%; background: #fff; border: 3px solid var(--accent); box-shadow: 0 1px 4px rgba(0, 0, 0, .2); }
.me__ticks { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-top: 8px; }
.me__ticks span.on { color: var(--accent); font-weight: 600; }
.me__hint { font-size: 13px; margin: 8px 0 0; }
.me__chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.me__src { font-size: 13px; margin: 14px 0 0; }
.me__actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.me__answers { margin: 14px 0; padding: 12px 16px; border-radius: var(--radius-m); border: 1px solid var(--line); }
.me__answers summary { cursor: pointer; font-weight: 600; color: var(--accent); }
.me__answers dl { margin: 10px 0 0; display: grid; gap: 8px; }
.me__answers dt { font-size: 13px; color: var(--muted); }
.me__answers dd { margin: 0; }
.me__how { padding: 16px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; line-height: 1.45; margin-top: 14px; }
.me__picks { margin-top: 28px; }
.me__picks-lead { margin: -8px 0 14px; font-size: 14px; }
.me__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.me__grid :deep(.wc--compact) { width: auto; }
@media (min-width: 640px) { .me__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

.me__toast { position: fixed; left: 50%; bottom: calc(100px + var(--safe-bottom)); transform: translateX(-50%); z-index: 60; display: flex; align-items: center; gap: 14px;
  max-width: calc(100% - 32px); background: #2c2a28; color: #fff; padding: 8px 8px 8px 18px; border-radius: 999px; font-size: 14px; }
.me__toast button { color: #f5c26b; font-weight: 700; padding: 6px 10px; white-space: nowrap; }
.me__hgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
@media (min-width: 640px) { .me__hgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.me__scan { display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: var(--radius-m); background: var(--surface); min-width: 0; position: relative; }
.me__himg { height: 170px; display: flex; align-items: center; justify-content: center; margin: 22px 0 8px; }
.me__himg img { max-width: 100%; max-height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.me__scan .me__badge { position: absolute; top: 10px; left: 10px; }
.me__grid :deep(.an) { width: auto; flex: none; }
.me__scan b { font-size: 15px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.me__badge { position: absolute; top: 16px; left: 16px; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; }
.me__badge.ok { background: #e6f0e4; color: var(--ok); }
.me__badge.nf { background: var(--pill); color: var(--accent-dark); }
</style>
