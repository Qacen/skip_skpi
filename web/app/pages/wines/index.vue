<script setup lang="ts">
useHead({ title: 'Свои вина — сканер и каталог российских вин' })
const route = useRoute()
const router = useRouter()
const { data: groups } = await useFetch<any[]>('/api/wines/filters', { default: () => [] })
const KEYS = ['color', 'sweetness', 'region', 'grape', 'manufacturer', 'dish']
const fromQuery = () => Object.fromEntries(KEYS.map(k => [k, String(route.query[k] || '').split(',').filter(Boolean)]))
const selected = ref<Record<string, string[]>>(fromQuery())
const search = ref(String(route.query.search || ''))
const page = ref(1)
const items = ref<any[]>([])
const filtersOpen = ref(false)
const query = computed(() => ({ page: page.value, limit: 16, search: search.value || undefined,
  ...Object.fromEntries(Object.entries(selected.value).filter(([, v]) => v.length).map(([k, v]) => [k, v.join(',')])) }))
const { data, pending } = await useFetch<any>('/api/wines', { query })
watch(data, (d) => {
  if (!d) return
  items.value = d.currentPage > 1 ? [...items.value, ...d.items] : d.items
}, { immediate: true })
watch([selected, search], () => {
  page.value = 1
  router.replace({ query: { ...(search.value ? { search: search.value } : {}),
    ...Object.fromEntries(Object.entries(selected.value).filter(([, v]) => v.length).map(([k, v]) => [k, v.join(',')])) } })
}, { deep: true })
watch(() => route.query.search, v => { search.value = String(v || '') })
const activeCount = computed(() => Object.values(selected.value).reduce((n, v) => n + v.length, 0))
const chips = computed(() => (groups.value || []).flatMap(g => (selected.value[g.key] || []).map(v => ({ key: g.key, value: v, name: g.values.find((x: any) => x.value === v)?.name || v }))))
function removeChip(c: { key: string, value: string }) { selected.value = { ...selected.value, [c.key]: selected.value[c.key].filter(v => v !== c.value) } }
</script>

<template>
  <div class="container wines">
    <nav class="crumbs" aria-label="Навигация"><a href="https://vino-svoe.ru/" rel="noopener">Главная</a><span>›</span><span>Свои вина</span></nav>
    <h1 class="h1">Свои вина</h1>
    <p class="wines__lead">Сфотографируйте этикетку российского вина или загрузите фото, чтобы найти его</p>
    <ScannerCard class="wines__scanner" />

    <div class="wines__toolbar">
      <button class="wines__filter" @click="filtersOpen = true">
        <AppIcon name="filter" :size="20" />Фильтр<span v-if="activeCount" class="wines__badge">{{ activeCount }}</span>
      </button>
    </div>
    <div v-if="search || chips.length" class="wines__chips">
      <button v-if="search" class="chip active" @click="search = ''">«{{ search }}» <AppIcon name="close" :size="14" /></button>
      <button v-for="c in chips" :key="c.key + c.value" class="chip active" @click="removeChip(c)">{{ c.name }} <AppIcon name="close" :size="14" /></button>
    </div>
    <p v-if="data" class="wines__count muted">{{ data.totalItems }} {{ data.totalItems % 10 === 1 && data.totalItems % 100 !== 11 ? 'вино' : [2, 3, 4].includes(data.totalItems % 10) && ![12, 13, 14].includes(data.totalItems % 100) ? 'вина' : 'вин' }}</p>

    <div class="wines__grid">
      <WineCard v-for="w in items" :key="w.slug" :wine="w" />
    </div>
    <p v-if="!pending && !items.length" class="wines__empty">По этим условиям вин нет. Сбросьте часть фильтров.</p>
    <button v-if="data && data.currentPage < data.totalPages" class="btn btn-outline btn-block wines__more" :disabled="pending" @click="page++">
      {{ pending ? 'Загружаем…' : 'Показать ещё' }}
    </button>

    <FiltersSheet v-model="selected" :open="filtersOpen" :groups="groups || []" :total="data?.totalItems || 0" @close="filtersOpen = false" />
  </div>
</template>

<style scoped>
.wines { padding-top: 24px; }
.crumbs { display: flex; gap: 8px; justify-content: center; font-size: 14px; color: var(--muted); margin-bottom: 20px; }
.wines__lead { text-align: center; font-size: 18px; line-height: 1.5; margin: 16px auto 0; max-width: 520px; }
.wines__scanner { margin: 28px auto 0; max-width: 560px; }
.wines__toolbar { display: flex; justify-content: center; margin: 28px 0 12px; }
.wines__filter { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 999px; border: 1px solid var(--line); background: #fff; color: var(--accent); font-weight: 600; }
.wines__badge { background: var(--accent); color: #fff; border-radius: 999px; font-size: 12px; padding: 1px 7px; }
.wines__chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 8px; }
.wines__count { text-align: center; font-size: 14px; margin: 8px 0 16px; }
.wines__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (min-width: 720px) { .wines__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; } }
@media (min-width: 1024px) { .wines__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.wines__more { margin: 24px auto 0; max-width: 420px; display: flex; }
.wines__empty { text-align: center; color: var(--muted); padding: 32px 0; }
</style>
