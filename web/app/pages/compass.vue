<script setup lang="ts">
// «Винный компас»: a route of 6 wine styles for someone who knows nothing about wine (shared/compass.ts). Each step is a style:
// any bottle of it will do — «Найти на полке» opens the scanner, which marks the bottle most typical for the step on a shelf photo.
// After tasting, «Как вам?» (one tap + an optional reason). The liked styles become «Ваш вкус». Progress lives on the device.
import { STEPS, VERDICTS, REASONS, compassSummary, type Verdict } from '#shared/compass'

useHead({ title: 'Винный компас — Свои вина' })
const { answers, answer, clearAnswer, setActive, reset } = useCompass()
const { data } = await useFetch<{ steps: any[] }>('/api/compass/steps')
const steps = computed(() => data.value?.steps || STEPS.map(s => ({ ...s, examples: [] })))
const sum = computed(() => compassSummary(answers.value))
// the first step without an answer is open; a tap opens another one
const open = ref<string | null>(null)
onMounted(() => nextTick(() => { if (open.value === null) open.value = STEPS.find(s => !answers.value[s.key])?.key || STEPS[0]!.key }))
const toggle = (k: string) => (open.value = open.value === k ? '' : k)

const SWATCH: Record<string, string> = {
  semisweet_red: 'linear-gradient(160deg, #b8324f, #7a1730)', light_red: 'linear-gradient(160deg, #d35a6b, #a32c44)',
  bold_red: 'linear-gradient(160deg, #6e1a2c, #3e0b18)', fresh_white: 'linear-gradient(160deg, #f4ecb0, #dcd07a)',
  soft_white: 'linear-gradient(160deg, #f6d98e, #e3b453)', brut: 'radial-gradient(circle at 30% 30%, #fff 0 2px, transparent 3px), radial-gradient(circle at 65% 60%, #fff 0 1.5px, transparent 2.5px), linear-gradient(160deg, #f5ecc4, #e2cf86)',
}
const VERDICT_WORD: Record<Verdict, string> = { like: 'Понравилось', meh: 'Нейтрально', no: 'Не моё' }
function find(k: string) { setActive(k); navigateTo('/scan') }
function setVerdict(k: string, v: Verdict) { answer(k, { verdict: v, reason: v === 'like' ? undefined : answers.value[k]?.reason }) }
function setReason(k: string, r: string) { const a = answers.value[k]; if (a) answer(k, { verdict: a.verdict, reason: a.reason === r ? undefined : r }) }
// «Что брать дальше»: the catalog filtered by a liked style
const NEXT: Record<string, Record<string, string>> = {
  semisweet_red: { color: 'red', sweetness: 'semi_sweet' }, light_red: { color: 'red', sweetness: 'dry', grape: 'Пино Нуар' },
  bold_red: { color: 'red', sweetness: 'dry', grape: 'Каберне Совиньон,Саперави,Красностоп' }, fresh_white: { color: 'white', sweetness: 'dry', grape: 'Рислинг,Совиньон Блан,Алиготе' },
  soft_white: { color: 'white', sweetness: 'semi_dry' }, brut: { sweetness: 'brut' },
}
const price = (p: number | null) => (p ? `от ${Math.round(p).toLocaleString('ru-RU')} ₽` : '')
const pairOf = (k: string) => STEPS.find(s => s.key === k)
</script>

<template>
  <div class="container cp">
    <section class="cp__hero">
      <svg class="cp__rose" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="54" class="r1" /><circle cx="60" cy="60" r="40" class="r2" />
        <path d="M60 10 68 60 60 110 52 60Z" class="n" /><path d="M10 60 60 52 110 60 60 68Z" class="e" />
        <path d="M60 10 68 60H52Z" class="tip" /><circle cx="60" cy="60" r="5" class="c" />
      </svg>
      <div>
        <h1 class="cp__title">Винный компас</h1>
        <p class="cp__lead">Шесть разных стилей вина, чтобы понять, какое нравится именно вам. Подойдёт любая бутылка стиля. После дегустации ответьте «как вам?», и компас покажет ваш вкус.</p>
      </div>
    </section>

    <ClientOnly>
      <div class="cp__progress" :aria-label="`Пройдено ${sum.done} из ${STEPS.length}`">
        <div class="cp__bar"><i v-for="s in STEPS" :key="s.key" :class="answers[s.key]?.verdict" /></div>
        <span>Пройдено {{ sum.done }} из {{ STEPS.length }}</span>
      </div>

      <!-- the conclusion appears as soon as there is something to say -->
      <section v-if="sum.like.length || sum.done >= 2" class="cp__taste">
        <h2>Ваш вкус</h2>
        <p v-if="sum.like.length">Вам нравится: <b>{{ sum.like.map(s => s.title.toLowerCase()).join(', ') }}</b>.<template v-if="sum.no.length"> Не ваше: {{ sum.no.map(s => s.title.toLowerCase()).join(', ') }}.</template></p>
        <p v-else>Пока ни один стиль не понравился — попробуйте оставшиеся. <template v-if="sum.no.length">Не ваше: {{ sum.no.map(s => s.title.toLowerCase()).join(', ') }}.</template></p>
        <div v-if="sum.like.length" class="cp__next">
          <span>Что брать дальше:</span>
          <NuxtLink v-for="s in sum.like" :key="s.key" :to="{ path: '/wines', query: NEXT[s.key] }" class="chip">{{ s.title }}<AppIcon name="chevron" :size="14" /></NuxtLink>
        </div>
      </section>
    </ClientOnly>

    <ol class="cp__route">
      <li v-for="s in steps" :key="s.key" class="st" :class="[{ open: open === s.key, pair: s.pair && s.n === 2 || s.n === 4, pair2: s.n === 3 || s.n === 5 }, answers[s.key]?.verdict]">
        <span v-if="s.n === 2 || s.n === 4" class="st__cmp">Сравните</span>
        <button class="st__head" :aria-expanded="open === s.key" @click="toggle(s.key)">
          <span class="st__num" :style="{ background: SWATCH[s.key] }">{{ s.n }}</span>
          <span class="st__name"><b>{{ s.title }}</b><small>{{ s.plain }}</small></span>
          <ClientOnly><span v-if="answers[s.key]" class="st__verdict" :class="answers[s.key]!.verdict">{{ VERDICT_WORD[answers[s.key]!.verdict] }}</span></ClientOnly>
          <AppIcon name="chevron" :size="18" class="st__chev" />
        </button>
        <div v-if="open === s.key" class="st__body">
          <p class="st__notice"><AppIcon name="bulb" :size="18" />{{ s.notice }}<template v-if="s.pair"> Пара: «{{ pairOf(s.pair)?.title }}».</template></p>
          <button class="btn btn-primary st__find" @click="find(s.key)"><AppIcon name="camera" :size="20" />Найти на полке</button>
          <p class="st__ex-title">Например <span>— подойдёт любое вино этого стиля</span></p>
          <div class="st__ex hscroll">
            <NuxtLink v-for="w in s.examples" :key="w.slug" :to="`/wines/${w.slug}`" class="ex">
              <span v-if="w.guideRating" class="ex__guide" title="Оценка гида Роскачества">гид {{ Number(w.guideRating).toFixed(2) }}</span>
              <span class="ex__img"><img :src="w.img" :alt="w.title" loading="lazy" /></span>
              <b class="ex__title">{{ w.title }}</b>
              <span class="ex__maker">{{ w.manufacturer }}</span>
              <span v-if="price(w.price)" class="ex__price">{{ price(w.price) }}</span>
            </NuxtLink>
          </div>
          <ClientOnly>
            <div class="st__ask">
              <b>Попробовали? Как вам?</b>
              <div class="st__chips">
                <button v-for="v in VERDICTS" :key="v.id" class="chip" :class="[v.id, { active: answers[s.key]?.verdict === v.id }]" @click="setVerdict(s.key, v.id)">{{ v.label }}</button>
              </div>
              <div v-if="answers[s.key] && answers[s.key]!.verdict !== 'like'" class="st__chips st__reasons">
                <span>Что не так?</span>
                <button v-for="r in REASONS" :key="r" class="chip chip--sm" :class="{ active: answers[s.key]?.reason === r }" @click="setReason(s.key, r)">{{ r }}</button>
              </div>
              <button v-if="answers[s.key]" class="st__undo" @click="clearAnswer(s.key)">Сбросить ответ</button>
            </div>
          </ClientOnly>
        </div>
      </li>
    </ol>

    <ClientOnly><button v-if="sum.done" class="cp__reset" @click="reset()">Пройти заново</button></ClientOnly>
  </div>
</template>

<style scoped>
.cp { max-width: 760px; padding-top: 20px; padding-bottom: calc(40px + var(--safe-bottom)); }
.cp__hero { display: flex; gap: 18px; align-items: center; padding: 22px; border-radius: var(--radius-l); background: var(--surface); }
.cp__rose { flex: 0 0 96px; height: 96px; }
.cp__rose .r1 { fill: var(--white); stroke: var(--line); stroke-width: 2; }
.cp__rose .r2 { fill: none; stroke: var(--line); stroke-dasharray: 3 5; }
.cp__rose .n, .cp__rose .e { fill: var(--surface-2); stroke: #cbb68a; stroke-width: 1; }
.cp__rose .tip { fill: var(--accent); }
.cp__rose .c { fill: var(--accent-dark); }
.cp__eyebrow { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: var(--accent); }
.cp__title { margin: 0; font-family: var(--serif); font-weight: 500; font-size: 34px; line-height: 1.1; }
.cp__lead { margin: 10px 0 0; font-size: 15px; line-height: 1.5; color: var(--text); }
@media (max-width: 520px) { .cp__hero { flex-direction: column; align-items: flex-start; } .cp__rose { flex-basis: auto; width: 72px; height: 72px; } .cp__title { font-size: 30px; } }

.cp__progress { display: flex; align-items: center; gap: 12px; margin: 18px 0 6px; font-size: 13px; color: var(--muted); }
.cp__bar { flex: 1; display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.cp__bar i { height: 6px; border-radius: 99px; background: var(--line); }
.cp__bar i.like { background: var(--ok); }
.cp__bar i.meh { background: #d9a441; }
.cp__bar i.no { background: #9a958c; }

.cp__taste { margin: 14px 0 4px; padding: 16px 18px; border-radius: var(--radius-m); background: var(--white); border: 1.5px solid #cfe2c9; }
.cp__taste h2 { margin: 0 0 6px; font-family: var(--serif); font-weight: 500; font-size: 22px; }
.cp__taste p { margin: 0; font-size: 15px; line-height: 1.5; }
.cp__next { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; font-size: 14px; color: var(--muted); }

.cp__route { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; position: relative; }
.st { position: relative; border-radius: var(--radius-m); background: var(--white); box-shadow: 0 4px 14px rgba(108, 85, 15, .08); border: 1.5px solid transparent; }
.st.open { border-color: var(--line); }
.st.like { border-color: #cfe2c9; }
.st.pair { margin-top: 18px; }
.st.pair::after, .st.pair2::before { content: ''; position: absolute; left: -10px; width: 6px; border: 2px solid #d8c9a6; border-right: 0; }
.st.pair::after { top: 24px; bottom: -12px; border-bottom: 0; border-radius: 8px 0 0 0; }
.st.pair2::before { top: -12px; height: 36px; border-top: 0; border-radius: 0 0 0 8px; }
.st__cmp { position: absolute; top: -18px; left: 2px; font-size: 11.5px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: #a08850; }
.st__head { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 14px; text-align: left; }
.st__num { flex: 0 0 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 16px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .35); box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .5); }
.st__name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.st__name b { font-family: var(--serif); font-weight: 500; font-size: 19px; }
.st__name small { font-size: 13.5px; color: var(--muted); }
.st__verdict { flex: 0 0 auto; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; }
.st__verdict.like { background: #e6f0e4; color: var(--ok); }
.st__verdict.meh { background: #fbf1d3; color: #8a6a10; }
.st__verdict.no { background: #eeebe6; color: #6f6a62; }
.st__chev { flex: 0 0 auto; color: var(--muted); transition: transform .2s; }
.st.open .st__chev { transform: rotate(90deg); }
.st__body { padding: 0 14px 16px; }
.st__notice { display: flex; gap: 8px; margin: 0; padding: 10px 12px; border-radius: 12px; background: var(--surface); font-size: 14px; line-height: 1.45; }
.st__notice :deep(svg) { flex: 0 0 auto; color: #b08a2e; margin-top: 1px; }
.st__find { width: 100%; margin-top: 12px; gap: 8px; }
.st__ex-title { margin: 16px 0 8px; font-weight: 600; font-size: 14px; }
.st__ex-title span { font-weight: 400; color: var(--muted); }
.st__ex { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x mandatory; }
.ex { position: relative; flex: 0 0 132px; scroll-snap-align: start; display: flex; flex-direction: column; gap: 2px; padding: 10px; border-radius: 14px; background: var(--surface); }
.ex__guide { position: absolute; top: 8px; left: 8px; font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 999px; background: var(--pill); }
.ex__img { height: 118px; display: flex; align-items: center; justify-content: center; margin: 14px 0 6px; }
.ex__img img { max-height: 100%; max-width: 100%; object-fit: contain; mix-blend-mode: multiply; }
.ex__title { font-size: 13px; line-height: 1.25; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ex__maker { font-size: 12px; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ex__price { font-size: 12px; color: var(--muted); }
.st__ask { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.st__ask b { font-size: 15px; }
.st__chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.st__chips .chip.like.active { background: var(--ok); border-color: var(--ok); }
.st__chips .chip.no.active { background: #6f6a62; border-color: #6f6a62; }
.st__chips .chip.meh.active { background: #b8872a; border-color: #b8872a; }
.st__reasons { align-items: center; font-size: 13px; color: var(--muted); }
.chip--sm { padding: 6px 11px; font-size: 13px; }
.st__undo { margin-top: 10px; font-size: 13px; color: var(--muted); text-decoration: underline; }
.cp__note { margin: 20px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
.cp__reset { margin-top: 8px; font-size: 13px; color: var(--accent); text-decoration: underline; }
</style>
