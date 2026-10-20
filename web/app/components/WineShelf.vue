<script setup lang="ts">
// Horizontal shelf of compact wine cards with an optional «Все» link.
defineProps<{ title: string, items: any[], to?: any, toLabel?: string }>()
</script>

<template>
  <section v-if="items.length" class="section">
    <div class="shelf__head">
      <h2 class="section-title">{{ title }}</h2>
      <NuxtLink v-if="to" :to="to" class="shelf__all">{{ toLabel || 'Все' }}</NuxtLink>
    </div>
    <div class="hscroll"><WineCard v-for="w in items" :key="w.slug" :wine="w" compact /></div>
  </section>
</template>

<style scoped>
.shelf__head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.shelf__all { color: var(--accent); font-weight: 600; white-space: nowrap; }
</style>
