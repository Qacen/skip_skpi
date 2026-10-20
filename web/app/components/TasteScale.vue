<script setup lang="ts">
// Sweetness scale: where this wine sits between dry and sweet (sparkling brut / extra brut sit at the dry end).
const props = defineProps<{ sweetness: string }>()
const STEPS = ['Сухое', 'Полусухое', 'Полусладкое', 'Сладкое']
const POS: Record<string, number> = { extra_brut: 0, brut: 0, dry: 0, semi_dry: 1, semi_sweet: 2, sweet: 3 }
const pos = computed(() => POS[props.sweetness] ?? -1)
</script>

<template>
  <div v-if="pos >= 0" class="ts" role="img" :aria-label="`Сладость: ${STEPS[pos]}`">
    <div class="ts__track"><span v-for="(s, i) in STEPS" :key="s" :class="{ on: i <= pos, cur: i === pos }" /></div>
    <div class="ts__labels"><span v-for="(s, i) in STEPS" :key="s" :class="{ cur: i === pos }">{{ s }}</span></div>
  </div>
</template>

<style scoped>
.ts__track { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.ts__track span { height: 8px; border-radius: 4px; background: var(--line); }
.ts__track span.on { background: #d9a8a0; }
.ts__track span.cur { background: var(--accent); }
.ts__labels { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 6px; font-size: 12px; color: var(--muted); }
.ts__labels .cur { color: var(--accent); font-weight: 600; }
</style>
