<script setup lang="ts">
const { busy, step, preview, error, reset, pick } = useScan()
const steps = ['Выравниваем фото', 'Находим бутылки и этикетки', 'Сравниваем с винами каталога', 'Готовим результат']
</script>

<template>
  <Transition name="fade">
    <div v-if="busy || error" class="sp" role="dialog" aria-live="polite" aria-label="Поиск вина по фото">
      <div class="sp__photo">
        <img v-if="preview" :src="preview" alt="Ваше фото" />
        <div v-if="busy" class="sp__scanline" />
        <span class="sp__corner tl" /><span class="sp__corner tr" /><span class="sp__corner bl" /><span class="sp__corner br" />
      </div>
      <div v-if="busy" class="sp__steps">
        <div v-for="(s, i) in steps" :key="s" class="sp__step" :class="{ done: step > i, active: step === i }">
          <span class="sp__dot"><AppIcon v-if="step > i" name="check" :size="14" /></span>{{ s }}
        </div>
      </div>
      <div v-else class="sp__error">
        <AppIcon name="alert" :size="28" />
        <p>{{ error }}</p>
        <div class="sp__actions">
          <button class="btn btn-primary btn-block" @click="reset(); pick(true)">Переснять</button>
          <button class="btn btn-ghost btn-block" @click="reset()">Закрыть</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sp { position: fixed; inset: 0; z-index: 90; background: rgba(35, 28, 24, 0.94); color: #fff; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 28px; padding: 24px; }
.sp__photo { position: relative; width: min(78vw, 360px); aspect-ratio: 3 / 4; border-radius: 20px; overflow: hidden; background: #2c2521; }
.sp__photo img { width: 100%; height: 100%; object-fit: cover; opacity: .9; }
.sp__scanline { position: absolute; left: 6%; right: 6%; height: 3px; border-radius: 3px; background: linear-gradient(90deg, transparent, #f5d58a, transparent);
  box-shadow: 0 0 18px 4px rgba(245, 213, 138, .55); animation: scan 1.8s ease-in-out infinite; }
@keyframes scan { 0% { top: 8% } 50% { top: 90% } 100% { top: 8% } }
.sp__corner { position: absolute; width: 34px; height: 34px; border: 3px solid #fff; opacity: .9; }
.tl { top: 12px; left: 12px; border-right: 0; border-bottom: 0; border-radius: 12px 0 0 0; }
.tr { top: 12px; right: 12px; border-left: 0; border-bottom: 0; border-radius: 0 12px 0 0; }
.bl { bottom: 12px; left: 12px; border-right: 0; border-top: 0; border-radius: 0 0 0 12px; }
.br { bottom: 12px; right: 12px; border-left: 0; border-top: 0; border-radius: 0 0 12px 0; }
.sp__steps { display: flex; flex-direction: column; gap: 10px; width: min(78vw, 360px); }
.sp__step { display: flex; align-items: center; gap: 10px; opacity: .45; font-size: 15px; transition: opacity .3s; }
.sp__step.active, .sp__step.done { opacity: 1; }
.sp__dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .6); display: grid; place-items: center; flex: 0 0 20px; }
.sp__step.done .sp__dot { background: #f5d58a; border-color: #f5d58a; color: #3a2a1c; }
.sp__step.active .sp__dot { border-color: #f5d58a; animation: pulse 1s infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 5px rgba(245, 213, 138, .25) } }
.sp__error { width: min(86vw, 380px); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.sp__error p { margin: 0; font-size: 16px; line-height: 1.45; }
.sp__actions { width: 100%; display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.sp__actions .btn-ghost { color: #fff; }
</style>
