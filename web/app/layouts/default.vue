<script setup lang="ts">
const searchOpen = useState('search-open', () => false)
const menuOpen = ref(false)
const route = useRoute()
const hideBottom = computed(() => route.path === '/scan' || route.path.startsWith('/scan/ar'))   // full-screen camera only (photo / AR modes)
const hideBar = computed(() => route.path.startsWith('/scan'))  // the photo is already taken: no «Найти своё вино» pill on the result
function scan() { navigateTo('/scan') }
watch(() => route.fullPath, () => { searchOpen.value = false; menuOpen.value = false })
// paste a photo (Ctrl/Cmd+V) anywhere -> photo search
const { run } = useScan()
function onPaste(e: ClipboardEvent) {
  const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'))
  if (f) { e.preventDefault(); run(f) }
}
onMounted(() => window.addEventListener('paste', onPaste))
onBeforeUnmount(() => window.removeEventListener('paste', onPaste))
</script>

<template>
  <div class="layout" :class="{ 'layout--bar': !hideBar }">
    <AppHeader v-if="!hideBottom" :hide-search="hideBar" @search="searchOpen = true" @menu="menuOpen = true" />
    <main><slot /></main>
    <AppFooter v-if="!hideBottom" />
    <MobileSearchBar v-if="!hideBar" @search="searchOpen = true" @scan="scan" />
    <SearchOverlay :open="searchOpen" @close="searchOpen = false" @scan="scan" />
    <MenuDrawer :open="menuOpen" @close="menuOpen = false" @scan="scan" />
    <ScanProgress />
  </div>
</template>

<style scoped>
.layout { min-height: 100vh; display: flex; flex-direction: column; }
.layout main { flex: 1; }
.layout--bar { padding-bottom: calc(88px + var(--safe-bottom)); }   /* room for the fixed «Найти своё вино» pill */
</style>
