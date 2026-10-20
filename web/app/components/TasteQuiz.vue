<script setup lang="ts">
// The taste questionnaire of the cabinet: one question per screen, plain words, «не знаю» everywhere (shared/taste.ts).
import { visibleQuestions, type TasteAnswers } from '#shared/taste'
const props = defineProps<{ initial?: TasteAnswers | null }>()
const emit = defineEmits<{ done: [a: TasteAnswers], cancel: [] }>()
const a = ref<TasteAnswers>({ ...(props.initial || {}) })
const step = ref(0)
const qs = computed(() => visibleQuestions(a.value))
const q = computed(() => qs.value[Math.min(step.value, qs.value.length - 1)]!)
const val = computed(() => a.value[q.value.id])
const has = (id: string) => (Array.isArray(val.value) ? val.value.includes(id) : val.value === id)
const answered = computed(() => (Array.isArray(val.value) ? val.value.length > 0 : !!val.value))
// auto-advance after a single choice: one pending timer, bound to the question it was set for (a double tap, a change of mind
// or «Назад» within the delay never skips a question)
let advT: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(advT))

function choose(id: string) {
  const o = q.value.options.find(x => x.id === id)!
  if (!q.value.multi) {
    a.value = { ...a.value, [q.value.id]: id }
    const qid = q.value.id
    clearTimeout(advT); advT = setTimeout(() => { if (q.value.id === qid) next() }, 180)
    return
  }
  const cur = Array.isArray(val.value) ? val.value : []
  // «ничего из этого» excludes the other options and vice versa
  const nones = q.value.options.filter(x => x.none).map(x => x.id)
  const nextVal = o.none ? (cur.includes(id) ? [] : [id]) : (cur.includes(id) ? cur.filter(x => x !== id) : [...cur.filter(x => !nones.includes(x)), id])
  a.value = { ...a.value, [q.value.id]: nextVal }
}
function next() {
  clearTimeout(advT)
  if (step.value < qs.value.length - 1) { step.value++; return }
  // drop answers of questions that are no longer shown (e.g. the tea question after the sweetness became known)
  const ids = new Set(qs.value.map(x => x.id))
  emit('done', Object.fromEntries(Object.entries(a.value).filter(([k]) => ids.has(k))))
}
function back() { clearTimeout(advT); if (step.value > 0) step.value--; else emit('cancel') }
</script>

<template>
  <div class="tq">
    <div class="tq__top">
      <button class="tq__back" type="button" :aria-label="step ? 'Назад' : 'Отменить'" @click="back"><AppIcon :name="step ? 'back' : 'close'" :size="20" /></button>
      <div class="tq__bar" role="progressbar" :aria-valuenow="step + 1" :aria-valuemin="1" :aria-valuemax="qs.length"><i :style="{ width: `${((step + 1) / qs.length) * 100}%` }" /></div>
      <span class="tq__count">{{ step + 1 }} / {{ qs.length }}</span>
    </div>
    <h2 class="tq__title">{{ q.title }}</h2>
    <p v-if="q.lead" class="tq__lead">{{ q.lead }}</p>
    <div class="tq__opts" :role="q.multi ? 'group' : 'radiogroup'" :aria-label="q.title">
      <button v-for="o in q.options" :key="o.id" type="button" class="tq__opt" :class="{ on: has(o.id) }"
        :role="q.multi ? 'checkbox' : 'radio'" :aria-checked="has(o.id)" @click="choose(o.id)">
        <span><b>{{ o.label }}</b><small v-if="o.hint">{{ o.hint }}</small></span>
        <i class="tq__mark" aria-hidden="true"><AppIcon v-if="has(o.id)" name="check" :size="16" /></i>
      </button>
    </div>
    <button v-if="q.multi || answered" type="button" class="btn btn-primary btn-block tq__next" :disabled="!answered" @click="next">
      {{ step < qs.length - 1 ? 'Дальше' : 'Готово' }}
    </button>
  </div>
</template>

<style scoped>
.tq { display: flex; flex-direction: column; gap: 14px; }
.tq__top { display: flex; align-items: center; gap: 12px; }
.tq__back { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; background: var(--surface-2); color: var(--accent); flex: 0 0 40px; }
.tq__bar { flex: 1; height: 6px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
.tq__bar i { display: block; height: 100%; background: var(--accent); border-radius: 99px; transition: width .25s; }
.tq__count { font-size: 13px; color: var(--muted); min-width: 34px; text-align: right; }
.tq__title { font-family: var(--serif); font-weight: 500; font-size: 26px; line-height: 1.2; margin: 6px 0 0; }
.tq__lead { margin: -6px 0 0; color: var(--muted); }
.tq__opts { display: flex; flex-direction: column; gap: 8px; }
.tq__opt { display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; padding: 14px 16px; border-radius: var(--radius-m);
  background: var(--surface); border: 1.5px solid transparent; transition: border-color .15s, background .15s; }
.tq__opt span { display: flex; flex-direction: column; gap: 2px; }
.tq__opt b { font-weight: 600; font-size: 16px; }
.tq__opt small { color: var(--muted); font-size: 13px; }
.tq__opt.on { border-color: var(--accent); background: #fff; }
.tq__mark { flex: 0 0 24px; height: 24px; border-radius: 50%; border: 1.5px solid var(--line); display: grid; place-items: center; color: #fff; }
.tq__opt.on .tq__mark { background: var(--accent); border-color: var(--accent); }
.tq__next { margin-top: 4px; }
</style>
