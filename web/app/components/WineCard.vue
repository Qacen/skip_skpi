<script setup lang="ts">
defineProps<{ wine: any, compact?: boolean }>()
</script>

<template>
  <NuxtLink :to="`/wines/${wine.slug}`" class="wc" :class="{ 'wc--compact': compact }">
    <span v-if="wine.rating" class="wc__rating"><RatingGlass />{{ Number(wine.rating).toFixed(2) }}</span>
    <div class="wc__img"><img :src="wine.img" :alt="`${wine.category} ${wine.title} ${wine.manufacturer}`" loading="lazy" /></div>
    <h2 class="wc__title">{{ wine.title }}</h2>
    <span class="wc__maker">{{ wine.manufacturer }}</span>
  </NuxtLink>
</template>

<style scoped>
.wc { position: relative; display: flex; flex-direction: column; padding: 16px; border-radius: var(--radius-m); background: var(--surface); min-width: 0; }
.wc__rating { position: absolute; top: 16px; left: 16px; z-index: 1; display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px 4px 8px; border-radius: 16px;
  background: var(--pill); font-size: 12px; font-weight: 600; color: var(--text); }
.wc__img { height: 230px; display: flex; align-items: center; justify-content: center; margin: 28px 0 14px; }
.wc__img img { max-width: 100%; max-height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.wc__title { font-size: 16px; font-weight: 600; line-height: 1.35; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wc__maker { font-size: 14px; color: var(--accent); margin-top: 6px; }
.wc--compact { width: 168px; padding: 12px; }
.wc--compact .wc__img { height: 170px; margin: 24px 0 10px; }
.wc--compact .wc__rating { top: 12px; left: 12px; }
.wc--compact .wc__title { font-size: 15px; }
@media (max-width: 400px) { .wc__img { height: 190px; } }
</style>
