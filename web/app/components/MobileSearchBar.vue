<script setup lang="ts">
// Sticky bottom pill from the portal: "Найти своё вино" + photo search
const emit = defineEmits<{ search: [], scan: [] }>()
</script>

<template>
  <div class="msb">
    <div class="msb__pill">
      <button class="msb__search" aria-label="Поиск" @click="emit('search')"><AppIcon name="search" :size="26" /></button>
      <button class="msb__text" @click="emit('search')">Найти своё вино</button>
      <button class="msb__cam" aria-label="Поиск по фотографии" @click="emit('scan')"><AppIcon name="camera" :size="28" /></button>
    </div>
  </div>
</template>

<style scoped>
.msb { position: fixed; left: 0; right: 0; bottom: 0; z-index: 45; padding: 0 20px calc(16px + var(--safe-bottom)); pointer-events: none; }
.msb__pill { pointer-events: auto; max-width: 560px; margin: 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.92); border: 1px solid var(--white); box-shadow: var(--shadow-soft); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.msb__search { width: 48px; height: 48px; flex: 0 0 48px; border-radius: 50%; background: var(--accent); color: var(--white); display: grid; place-items: center; }
.msb__text { flex: 1; text-align: center; font-size: 17px; color: var(--text); padding: 12px 0; }
.msb__cam { width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center; color: #7d7870; }
</style>
