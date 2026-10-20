<script setup lang="ts">
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], scan: [] }>()
const q = ref('')
const results = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const input = ref<HTMLInputElement>()
const RECENT = 'svoe-vino:recent'
const recent = ref<string[]>([])
let timer: any
watch(() => props.open, (o) => {
  if (o) {
    try { recent.value = JSON.parse(localStorage.getItem(RECENT) || '[]') } catch { recent.value = [] }
    nextTick(() => input.value?.focus())
  }
})
watch(q, (v) => {
  clearTimeout(timer)
  if (!v.trim()) { results.value = []; total.value = 0; return }
  timer = setTimeout(async () => {
    loading.value = true
    const r = await $fetch<any>('/api/wines', { query: { search: v, limit: 12 } }).catch(() => null)
    results.value = r?.items || []; total.value = r?.totalItems || 0; loading.value = false
  }, 180)
})
function remember(v: string) {
  const s = v.trim(); if (!s) return
  recent.value = [s, ...recent.value.filter(x => x !== s)].slice(0, 6)
  try { localStorage.setItem(RECENT, JSON.stringify(recent.value)) } catch {}
}
function openWine(slug: string) { remember(q.value); emit('close'); navigateTo(`/wines/${slug}`) }
function showAll() { remember(q.value); emit('close'); navigateTo({ path: '/wines', query: { search: q.value } }) }
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="so" role="dialog" aria-label="Поиск вина">
      <div class="container so__bar">
        <label class="so__field">
          <AppIcon name="search" />
          <input ref="input" v-model="q" type="search" placeholder="Название, винодельня или сорт" enterkeyhint="search" @keydown.enter="showAll" />
        </label>
        <button class="so__close" aria-label="Закрыть" @click="emit('close')"><AppIcon name="close" /></button>
      </div>
      <div class="container so__body">
        <button class="so__scan" @click="emit('close'); emit('scan')">
          <span class="so__scan-ico"><AppIcon name="camera" /></span>
          <span><b>Поиск по фотографии</b><br /><span class="muted">Сфотографируйте этикетку — откроем карточку вина</span></span>
        </button>
        <template v-if="!q.trim()">
          <div v-if="recent.length" class="so__recent">
            <div class="so__label">Вы искали</div>
            <div class="so__chips"><button v-for="r in recent" :key="r" class="chip" @click="q = r">{{ r }}</button></div>
          </div>
          <div class="so__label">Популярные запросы</div>
          <div class="so__chips">
            <button v-for="r in ['Саперави', 'Красностоп', 'Фанагория', 'Шардоне', 'Абрау-Дюрсо', 'Кагор']" :key="r" class="chip" @click="q = r">{{ r }}</button>
          </div>
        </template>
        <template v-else>
          <div v-if="!loading && !results.length" class="so__empty">Ничего не нашли. Попробуйте другое написание или поиск по фото.</div>
          <button v-for="w in results" :key="w.slug" class="so__item" @click="openWine(w.slug)">
            <img :src="w.img" :alt="w.title" loading="lazy" />
            <span class="so__item-text"><b>{{ w.title }}</b><span class="muted">{{ w.manufacturer }} · {{ w.category }}</span></span>
            <AppIcon name="chevron" :size="18" />
          </button>
          <button v-if="total > results.length" class="btn btn-outline btn-block so__all" @click="showAll">Показать все {{ total }}</button>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.so { position: fixed; inset: 0; z-index: 80; background: var(--bg); overflow-y: auto; padding-bottom: 40px; }
.so__bar { position: sticky; top: 0; display: flex; gap: 8px; align-items: center; padding-top: 14px; padding-bottom: 12px; background: var(--bg); }
.so__field { flex: 1; display: flex; align-items: center; gap: 8px; padding: 0 16px; height: 52px; border-radius: 999px; background: var(--white);
  border: 1px solid var(--line); color: var(--muted); }
.so__field input { flex: 1; border: 0; outline: 0; background: transparent; font-size: 17px; color: var(--text); min-width: 0; }
.so__close { width: 48px; height: 48px; display: grid; place-items: center; }
.so__scan { width: 100%; display: flex; gap: 14px; align-items: center; text-align: left; padding: 14px; border-radius: var(--radius-m); background: var(--surface); margin: 4px 0 20px; }
.so__scan-ico { width: 48px; height: 48px; flex: 0 0 48px; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; }
.so__label { font-weight: 600; margin: 12px 0 10px; }
.so__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.so__item { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--line); text-align: left; }
.so__item img { width: 44px; height: 64px; object-fit: contain; }
.so__item-text { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 15px; min-width: 0; }
.so__item-text b { font-weight: 600; }
.so__empty { padding: 24px 0; color: var(--muted); }
.so__all { margin-top: 16px; }
</style>
