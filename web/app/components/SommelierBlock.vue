<script setup lang="ts">
// «Цифровой сомелье» (retention after the scan): two taps — what you serve and the occasion — give a verdict for THIS wine,
// and a serving tip (POST /api/sommelier). No wine list here: analogs live in their own section of the card.
// Only the food the winery recommends this wine to is offered (shared/food.ts), never pairings that do not work.
import { FOOD, foodsFor } from '#shared/food'
const props = defineProps<{ wine: any }>()
const foods = computed(() => foodsFor(props.wine?.dishes).map(k => [k, FOOD[k]!.chip] as const))
const OCCASION = [['dinner', 'Ужин'], ['gift', 'Подарок'], ['party', 'Вечеринка'], ['self', 'Для себя']]
const food = ref(''), occasion = ref('')
const res = ref<any>(null), loading = ref(false), failed = ref(false)
let reqId = 0   // only the latest answer is shown when chips are tapped quickly
async function ask() {
  const id = ++reqId
  if (!food.value && !occasion.value) { res.value = null; failed.value = false; loading.value = false; return }
  loading.value = true; failed.value = false
  try {
    const r = await $fetch('/api/sommelier', { method: 'POST', body: { slug: props.wine.slug, food: food.value || undefined, occasion: occasion.value || undefined } })
    if (id === reqId) res.value = r
  } catch {
    if (id === reqId) { res.value = null; failed.value = true }
  } finally {
    if (id === reqId) loading.value = false
  }
}
watch([food, occasion], ask)
</script>

<template>
  <section class="som card" aria-labelledby="som-title">
    <div class="som__head">
      <span class="som__icon"><AppIcon name="chat" :size="22" /></span>
      <div><h2 id="som-title" class="h3">Цифровой сомелье</h2><p class="muted">Подскажу, подойдёт ли это вино, и что взять ещё</p></div>
    </div>
    <template v-if="foods.length">
      <p class="som__q">К чему подаёте?</p>
      <div class="som__chips"><button v-for="[k, t] in foods" :key="k" class="chip" :class="{ active: food === k }" @click="food = food === k ? '' : k">{{ t }}</button></div>
      <p class="muted som__hint">Только то, к чему это вино советует винодельня</p>
    </template>
    <p class="som__q">Какой повод?</p>
    <div class="som__chips"><button v-for="[k, t] in OCCASION" :key="k" class="chip" :class="{ active: occasion === k }" @click="occasion = occasion === k ? '' : k">{{ t }}</button></div>

    <div v-if="res?.verdict?.reasons?.length" class="som__verdict" :class="res.verdict.ok ? 'ok' : 'warn'" aria-live="polite">
      <AppIcon :name="res.verdict.ok ? 'check' : 'alert'" :size="20" />
      <div><b>{{ res.verdict.ok ? 'Хороший выбор' : 'Лучше подобрать другое' }}</b>
        <ul><li v-for="x in res.verdict.reasons" :key="x">{{ x }}</li></ul></div>
    </div>
    <p v-if="res?.serve" class="som__serve"><AppIcon name="thermo" :size="16" />{{ res.serve }}</p>
    <p v-if="loading" class="muted som__loading">Подбираю…</p>
    <p v-else-if="failed" class="som__loading som__failed">Не получилось подобрать. <button @click="ask">Попробовать ещё раз</button></p>
  </section>
</template>

<style scoped>
.som { padding: 20px 16px; }
.som__head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 8px; }
.som__head p { margin: 4px 0 0; font-size: 14px; }
.som__icon { flex: 0 0 44px; height: 44px; border-radius: 14px; background: var(--accent); color: #fff; display: grid; place-items: center; }
.som__q { font-weight: 600; margin: 16px 0 8px; }
.som__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.som__verdict { display: flex; gap: 10px; margin-top: 18px; padding: 14px; border-radius: var(--radius-s); background: #fff; }
.som__verdict.ok { color: var(--ok); }
.som__verdict.warn { color: var(--warn); }
.som__verdict div { color: var(--text); }
.som__verdict ul { margin: 6px 0 0; padding-left: 18px; font-size: 14px; line-height: 1.45; }
.som__recs-head { display: flex; justify-content: space-between; gap: 12px; margin: 18px 0 10px; font-weight: 600; }
.som__recs-head a { color: var(--accent); white-space: nowrap; }
.som__recs :deep(.an) { background: #fff; }
.som__hint { font-size: 13px; margin: 8px 0 0; }
.som__serve { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; font-size: 14px; color: var(--muted); }
.som__loading { margin: 16px 0 0; }
.som__failed button { color: var(--accent); font-weight: 600; }
</style>
