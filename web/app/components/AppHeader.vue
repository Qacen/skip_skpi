<script setup lang="ts">
withDefaults(defineProps<{ hideSearch?: boolean }>(), { hideSearch: false })
const emit = defineEmits<{ search: [], menu: [] }>()
const { collection } = useMyWines()
</script>

<template>
  <header class="header">
    <div class="container">
      <div class="header__pill">
        <AppLogo />
        <div class="header__actions">
          <button v-if="!hideSearch" class="header__icon" aria-label="Поиск" @click="emit('search')"><AppIcon name="search" :size="26" /></button>
          <NuxtLink to="/my" class="header__icon header__me" aria-label="Личный кабинет"><AppIcon name="user" :size="26" /><ClientOnly><i v-if="collection.length" class="header__dot" /></ClientOnly></NuxtLink>
          <button class="header__burger" aria-label="Меню" @click="emit('menu')"><AppIcon name="menu" :size="26" /></button>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header { position: sticky; top: 0; z-index: 40; padding-top: 12px; }
.header__pill { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 8px 8px 12px; border-radius: 999px;
  background: var(--header); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.header__actions { display: flex; align-items: center; gap: 8px; }
.header__icon { width: 44px; height: 44px; display: grid; place-items: center; color: var(--accent); border-radius: 50%; }
.header__me { position: relative; }
.header__dot { position: absolute; top: 9px; right: 9px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); border: 2px solid var(--header); }
.header__burger { width: 64px; height: 48px; display: grid; place-items: center; border-radius: 999px; background: var(--accent-dark); color: var(--white); }
</style>
