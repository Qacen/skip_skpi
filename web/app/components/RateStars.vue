<script setup lang="ts">
// 1..5 rating of a scanned wine; the first rating adds it to the collection (personal cabinet). Renders nothing for a wine
// that was not scanned: the collection is filled from the scanner only.
import type { WineMini } from '~/composables/useMyWines'
const props = withDefaults(defineProps<{ wine: WineMini, small?: boolean, label?: boolean }>(), { small: false, label: true })
const emit = defineEmits<{ rated: [n: number, added: boolean] }>()
const { get, canRate, rate } = useMyWines()
const mine = computed(() => get(props.wine.slug))
function set(n: number) {
  const added = !mine.value
  if (rate(props.wine, n)) emit('rated', n, added)
}
</script>

<template>
  <div v-if="canRate(wine.slug)" class="rs" :class="{ small }">
    <span v-if="label" class="rs__label">{{ mine ? 'Ваша оценка' : 'Оцените — вино попадёт в коллекцию' }}</span>
    <div class="rs__stars" role="radiogroup" aria-label="Ваша оценка">
      <button v-for="n in 5" :key="n" type="button" role="radio" :aria-checked="mine?.rating === n" :aria-label="`${n} из 5`"
        :class="{ on: (mine?.rating || 0) >= n }" @click.stop="set(n)">★</button>
    </div>
  </div>
</template>

<style scoped>
.rs { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rs__label { font-size: 14px; color: var(--muted); }
.rs__stars { display: flex; }
.rs__stars button { font-size: 26px; line-height: 1; width: 40px; height: 44px; color: #e2d6bd; }
.rs__stars button.on { color: #c79a2e; }
.rs.small .rs__stars button { font-size: 20px; width: 30px; height: 36px; }
.rs.small .rs__label { font-size: 13px; }
</style>
