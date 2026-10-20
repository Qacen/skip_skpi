<script setup lang="ts">
// Mobile scanner block from the portal (/wines): "Сканировать" opens our in-app camera, "Загрузить фото" the gallery.
// Desktop: a photo can also be dropped onto the block (and pasted anywhere, see layouts/default.vue).
const { pick, run } = useScan()
const over = ref(false)
function drop(e: DragEvent) {
  over.value = false
  const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'))
  if (f) run(f)
}
</script>

<template>
  <section class="sc" :class="{ over }" aria-label="Сканер этикетки" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="drop">
    <ScannerIllustration class="sc__art" />
    <NuxtLink to="/scan" class="btn btn-primary btn-block">Сканировать</NuxtLink>
    <button class="btn btn-ghost btn-block sc__upload" @click="pick(false)">Загрузить фото</button>
  </section>
</template>

<style scoped>
.sc { background: var(--surface); border-radius: var(--radius-l); padding: 32px 32px 20px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.sc__art { width: 132px; height: 132px; margin-bottom: 24px; }
.sc__upload { margin-top: 4px; }
.sc.over { outline: 2px dashed var(--accent); outline-offset: -8px; }
@media (max-width: 400px) { .sc { padding: 28px 20px 16px; } }
</style>
