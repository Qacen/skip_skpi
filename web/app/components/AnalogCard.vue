<script setup lang="ts">
// A recommended wine (analogs, similar wines, «в вашем стиле»): the same compact card as the winery shelf (WineCard)
// plus 2–3 short reasons why it fits (server/utils/analogs.ts). No match percentages.
defineProps<{ wine: { slug: string, title: string, manufacturer: string, img: string, category?: string, rating?: number | null, reasons?: string[] } }>()
</script>

<template>
  <NuxtLink :to="`/wines/${wine.slug}`" class="wc wc--compact an">
    <span v-if="wine.rating" class="wc__rating"><RatingGlass />{{ Number(wine.rating).toFixed(2) }}</span>
    <div class="wc__img"><img :src="wine.img" :alt="`${wine.title} ${wine.manufacturer}`" loading="lazy" /></div>
    <h3 class="wc__title">{{ wine.title }}</h3>
    <span class="wc__maker">{{ wine.manufacturer }}</span>
    <ul v-if="wine.reasons?.length" class="an__why" aria-label="Почему подходит">
      <li v-for="r in wine.reasons.slice(0, 3)" :key="r"><AppIcon name="check" :size="13" />{{ r }}</li>
    </ul>
  </NuxtLink>
</template>

<style scoped>
.wc { position: relative; display: flex; flex-direction: column; padding: 16px; border-radius: var(--radius-m); background: var(--surface); min-width: 0; color: var(--text); }
.wc__rating { position: absolute; top: 12px; left: 12px; z-index: 1; display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px 4px 8px; border-radius: 16px;
  background: var(--pill); font-size: 12px; font-weight: 600; color: var(--text); }
.wc__img { height: 170px; display: flex; align-items: center; justify-content: center; margin: 24px 0 10px; }
.wc__img img { max-width: 100%; max-height: 100%; object-fit: contain; mix-blend-mode: multiply; }
.wc__title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wc__maker { font-size: 14px; color: var(--accent); margin-top: 6px; }
.wc--compact { width: 168px; flex: 0 0 168px; padding: 12px; }
.an__why { list-style: none; margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; }
.an__why li { display: flex; gap: 5px; font-size: 12px; line-height: 1.3; color: #5d5348; }
.an__why li :deep(svg) { flex: 0 0 13px; margin-top: 1px; color: var(--ok); }
</style>
