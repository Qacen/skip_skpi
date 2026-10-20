<script setup lang="ts">
// Скрытая страница для живой демонстрации (Track A, ТЗ): результат scripts/eval_service.py, доступна по прямой ссылке
// /metrics, никуда из меню не ведёт. Данные — GET /api/metrics (web/data/metrics.json).
useHead({ title: 'Метрики распознавания — Свои вина' })

const { data: metrics, error, refresh, pending } = await useFetch<any>('/api/metrics')

const SUBSET_NAME: Record<string, string> = { exact: 'Точное совпадение', probable: 'Вероятное совпадение', same_line: 'Та же линейка' }
const SUBSET_ORDER = ['exact', 'probable', 'same_line']
const subsetRows = computed(() => SUBSET_ORDER
  .filter(k => metrics.value?.subsets?.[k])
  .map(k => ({ key: k, name: SUBSET_NAME[k] || k, ...metrics.value.subsets[k] })))

const misses = computed(() => (metrics.value?.per_photo || []).filter((p: any) => !p.hit1))

// названия вин для промахов (target vs то, что нашёл сервис) — тянем через уже существующий /api/wines/:slug
const { data: titles } = await useAsyncData('metrics-titles', async () => {
  const slugs = new Set<string>()
  for (const m of misses.value) { if (m.target) slugs.add(m.target); if (m.pred) slugs.add(m.pred) }
  const entries = await Promise.all([...slugs].map(async (slug) => {
    try { const w = await $fetch<any>(`/api/wines/${slug}`); return [slug, w?.title || slug] as const }
    catch { return [slug, slug] as const }
  }))
  return Object.fromEntries(entries) as Record<string, string>
}, { watch: [misses], default: () => ({}) })
const titleOf = (slug: string) => slug ? (titles.value?.[slug] || slug) : '—'

const pct = (x: number | null | undefined) => x == null ? '—' : `${Math.round(x * 100)}%`
const f1 = (x: number | null | undefined) => x == null ? '—' : x.toFixed(2)
const ms = (x: number | null | undefined) => x == null ? '—' : `${Math.round(x)} мс`
const dt = (s: string) => { try { return new Date(s).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return s } }

const overall = computed(() => metrics.value?.overall)
</script>

<template>
  <div class="container metrics">
    <h1 class="h1">Метрики распознавания</h1>
    <p v-if="metrics" class="muted metrics__meta">
      {{ metrics.url }} · модель {{ metrics.model || '—' }} · посчитано {{ dt(metrics.generated_at) }} · {{ overall?.n || 0 }} фото
      <button class="metrics__refresh" :disabled="pending" @click="refresh()">Обновить</button>
    </p>

    <p v-if="error" class="card metrics__empty">Метрики ещё не посчитаны. Запустите <code>web/scripts/eval_service.py</code>.</p>

    <template v-else-if="overall">
      <div class="metrics__big">
        <div class="card metrics__stat">
          <span class="metrics__num">{{ pct(overall.accuracy_at1) }}</span>
          <span class="muted">доля совпадений (top-1)</span>
        </div>
        <div class="card metrics__stat">
          <span class="metrics__num">{{ f1(overall.f1_at1) }}</span>
          <span class="muted">F1 top-1</span>
        </div>
        <div class="card metrics__stat">
          <span class="metrics__num">{{ f1(overall.f1_at5) }}</span>
          <span class="muted">F1 top-5</span>
        </div>
        <div class="card metrics__stat">
          <span class="metrics__num">{{ ms(overall.latency_ms?.p50) }}</span>
          <span class="muted">p50 время ответа</span>
        </div>
      </div>

      <div class="section">
        <h2 class="section-title">По подвыборкам</h2>
        <div class="card metrics__table-wrap">
          <table class="metrics__table">
            <thead>
              <tr><th>Подвыборка</th><th>n</th><th>acc@1</th><th>R@5</th><th>F1@1</th><th>F1@5</th><th>p50</th><th>p90</th><th>max</th><th>ошибки</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in subsetRows" :key="s.key">
                <td>{{ s.name }}</td><td>{{ s.n }}</td><td>{{ pct(s.accuracy_at1) }}</td><td>{{ pct(s.recall_at5) }}</td>
                <td>{{ f1(s.f1_at1) }}</td><td>{{ f1(s.f1_at5) }}</td>
                <td>{{ ms(s.latency_ms?.p50) }}</td><td>{{ ms(s.latency_ms?.p90) }}</td><td>{{ ms(s.latency_ms?.max) }}</td><td>{{ s.errors }}</td>
              </tr>
              <tr class="metrics__overall">
                <td>Всего</td><td>{{ overall.n }}</td><td>{{ pct(overall.accuracy_at1) }}</td><td>{{ pct(overall.recall_at5) }}</td>
                <td>{{ f1(overall.f1_at1) }}</td><td>{{ f1(overall.f1_at5) }}</td>
                <td>{{ ms(overall.latency_ms?.p50) }}</td><td>{{ ms(overall.latency_ms?.p90) }}</td><td>{{ ms(overall.latency_ms?.max) }}</td><td>{{ overall.errors }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <h2 class="section-title">Промахи ({{ misses.length }})</h2>
        <p v-if="!misses.length" class="muted">Нет — все top-1 совпали с целевым вином.</p>
        <ul v-else class="metrics__misses">
          <li v-for="m in misses" :key="m.photo_id" class="card metrics__miss">
            <div class="metrics__miss-head">
              <span class="metrics__photo-id">{{ m.photo_id }}</span>
              <span class="chip" :class="{ active: m.hit5 }">{{ m.hit5 ? 'в топ-5' : 'мимо топ-5' }}</span>
              <span class="muted">{{ ms(m.ms) }}</span>
            </div>
            <p><span class="muted">Ожидалось:</span> {{ titleOf(m.target) }}</p>
            <p><span class="muted">Ответил сервис:</span> {{ m.pred ? titleOf(m.pred) : 'ничего' }}</p>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.metrics { padding: 24px 16px 64px; max-width: 960px; }
.metrics__meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 0 24px; }
.metrics__refresh { color: var(--accent); font-weight: 600; font-size: 14px; }
.metrics__empty { padding: 24px; }

.metrics__big { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 640px) { .metrics__big { grid-template-columns: repeat(2, 1fr); } }
.metrics__stat { display: flex; flex-direction: column; gap: 4px; padding: 20px 16px; text-align: center; }
.metrics__num { font-family: var(--serif); font-size: 34px; font-weight: 600; color: var(--accent); }

.metrics__table-wrap { overflow-x: auto; padding: 4px; }
.metrics__table { width: 100%; border-collapse: collapse; font-size: 14px; white-space: nowrap; }
.metrics__table th, .metrics__table td { padding: 10px 14px; text-align: right; }
.metrics__table th:first-child, .metrics__table td:first-child { text-align: left; }
.metrics__table thead th { color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--line); }
.metrics__table tbody tr + tr { border-top: 1px solid var(--line); }
.metrics__overall { font-weight: 600; }

.metrics__misses { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.metrics__miss { padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.metrics__miss-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.metrics__photo-id { font-weight: 600; }
.metrics__miss p { margin: 0; font-size: 14px; }
</style>
