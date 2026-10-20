<script setup lang="ts">
import type { NuxtError } from '#app'
const props = defineProps<{ error: NuxtError }>()
const is404 = computed(() => props.error?.statusCode === 404)
useHead({ title: is404.value ? 'Страница не найдена — Свои вина' : 'Ошибка — Свои вина' })
</script>

<template>
  <NuxtLayout>
    <div class="container err">
      <p class="err__code">{{ error?.statusCode || 500 }}</p>
      <h1 class="h2">{{ is404 ? (error?.statusMessage === 'Вино не найдено' ? 'Такого вина нет в каталоге' : 'Страница не найдена') : 'Что-то пошло не так' }}</h1>
      <p class="muted">Попробуйте найти вино по фото этикетки или по названию.</p>
      <div class="err__actions">
        <button class="btn btn-primary" @click="clearError({ redirect: '/scan' })">Сканировать</button>
        <button class="btn btn-outline" @click="clearError({ redirect: '/wines' })">В каталог</button>
      </div>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.err { text-align: center; padding-top: 64px; padding-bottom: 32px; }
.err__code { font-family: var(--serif); font-size: 72px; color: var(--accent); margin: 0 0 8px; line-height: 1; }
.err .muted { margin: 12px 0 24px; }
.err__actions { display: flex; gap: 10px; justify-content: center; }
</style>
