<script setup lang="ts">
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], scan: [] }>()
const { collection } = useMyWines()
const portal = [
  ['Истории в бокале', 'https://vino-svoe.ru/articles'], ['События', 'https://vino-svoe.ru/events'], ['Винные туры', 'https://vino-svoe.ru/tours'],
  ['Винодельни и регионы', 'https://vino-svoe.ru/wineries'], ['Винный Барометр', 'https://vino-svoe.ru/surveys/vinnyj-barometr'],
]
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="md" @click.self="emit('close')">
      <nav class="md__panel" aria-label="Меню">
        <div class="md__top"><AppLogo /><button class="md__close" aria-label="Закрыть" @click="emit('close')"><AppIcon name="close" /></button></div>
        <NuxtLink to="/wines" class="md__link" @click="emit('close')">Свои вина</NuxtLink>
        <button class="md__link" @click="emit('close'); emit('scan')">Сканировать этикетку</button>
        <NuxtLink to="/my" class="md__link" @click="emit('close')">Личный кабинет <ClientOnly><span v-if="collection.length" class="md__badge">{{ collection.length }}</span></ClientOnly></NuxtLink>
        <div class="md__sep" />
        <a v-for="[t, u] in portal" :key="u" :href="u" class="md__link md__link--small" target="_blank" rel="noopener">{{ t }}</a>
        <NuxtLink to="/compass" class="md__link md__link--small md__link--new" @click="emit('close')">Винный компас <span class="md__new">новое</span></NuxtLink>
      </nav>
    </div>
  </Transition>
</template>

<style scoped>
.md { position: fixed; inset: 0; z-index: 85; background: rgba(44, 42, 40, .35); display: flex; justify-content: flex-end; }
.md__panel { width: min(88vw, 380px); height: 100%; background: var(--bg); padding: 16px 20px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
.md__top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.md__close { width: 44px; height: 44px; display: grid; place-items: center; }
.md__link { display: flex; align-items: center; gap: 8px; text-align: left; font-family: var(--serif); font-size: 24px; padding: 10px 0; }
.md__link--small { font-family: var(--sans); font-size: 16px; padding: 8px 0; color: var(--muted); }
.md__badge { font-family: var(--sans); font-size: 13px; background: var(--accent); color: #fff; border-radius: 999px; padding: 2px 8px; }
.md__link--new { color: var(--accent); font-weight: 600; }
.md__new { font-size: 11px; font-weight: 700; color: #fff; background: var(--accent); border-radius: 999px; padding: 1px 7px; }
.md__sep { height: 1px; background: var(--line); margin: 12px 0; }
</style>
