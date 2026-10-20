<script setup lang="ts">
// In-app camera viewfinder (getUserMedia). Falls back to the native camera input (same as the portal) when the camera API
// is unavailable (http on a phone, permission denied, desktop without camera).
import { stepByKey } from '#shared/compass'
useHead({ title: 'Сканер этикетки — Свои вина' })
const { run, pick, busy, result } = useScan()
// «Винный компас»: the step the shelf photo is for (the result screen marks the wines that fit it)
const { active: compassKey, setActive: setCompass } = useCompass()
const compassStep = computed(() => stepByKey(compassKey.value))
const video = ref<HTMLVideoElement>()
const state = ref<'starting' | 'live' | 'fallback'>('starting')
const reason = ref('')
const torch = ref(false)
const torchSupported = ref(false)
let stream: MediaStream | null = null

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) { state.value = 'fallback'; reason.value = 'Браузер не даёт доступ к камере на этой странице.'; return }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
    video.value!.srcObject = stream
    await video.value!.play()
    state.value = 'live'
    const track = stream.getVideoTracks()[0]
    torchSupported.value = !!(track.getCapabilities?.() as any)?.torch
  } catch (e: any) {
    state.value = 'fallback'
    reason.value = e?.name === 'NotAllowedError' ? 'Нет доступа к камере. Разрешите его в настройках браузера или снимите системной камерой.' : 'Камера недоступна. Снимите системной камерой или загрузите фото.'
  }
}
function stop() { stream?.getTracks().forEach(t => t.stop()); stream = null }
async function toggleTorch() {
  const track = stream?.getVideoTracks()[0]; if (!track) return
  torch.value = !torch.value
  await track.applyConstraints({ advanced: [{ torch: torch.value } as any] }).catch(() => (torch.value = false))
}
async function shoot() {
  const v = video.value; if (!v || busy.value) return
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight
  c.getContext('2d')!.drawImage(v, 0, 0)
  const blob = await new Promise<Blob>(res => c.toBlob(b => res(b!), 'image/jpeg', 0.92))
  stop()
  await run(new File([blob], 'camera.jpg', { type: 'image/jpeg' }))
  if (!result.value) start()          // error -> resume the camera
}
function close() { stop(); history.length > 1 ? useRouter().back() : navigateTo('/wines') }
onMounted(start)
onBeforeUnmount(stop)
</script>

<template>
  <div class="cam">
    <video ref="video" class="cam__video" playsinline muted autoplay :class="{ hidden: state !== 'live' }" />
    <div class="cam__top">
      <button class="cam__round" aria-label="Закрыть" @click="close"><AppIcon name="close" /></button>
      <nav class="cam__modes" aria-label="Режим сканера">
        <span class="cam__mode on" aria-current="page">Фото</span>
        <NuxtLink to="/scan/ar" replace class="cam__mode">AR</NuxtLink>
      </nav>
      <button v-if="torchSupported" class="cam__round" :class="{ on: torch }" aria-label="Фонарик" @click="toggleTorch"><AppIcon name="flash" /></button>
      <span v-else class="cam__round cam__round--ghost" />
    </div>

    <template v-if="state !== 'fallback'">
      <div class="cam__frame" aria-hidden="true"><span class="c tl" /><span class="c tr" /><span class="c bl" /><span class="c br" /></div>
      <div v-if="compassStep" class="cam__compass">
        <span>Компас · шаг {{ compassStep.n }}: <b>{{ compassStep.title }}</b></span>
        <button aria-label="Выйти из режима компаса" @click="setCompass(null)"><AppIcon name="close" :size="16" /></button>
      </div>
      <p class="cam__hint">{{ compassStep ? 'Снимите полку целиком — отметим вино, которое подходит для шага' : 'Наведите камеру на этикетку — целиком, без бликов' }}</p>
      <div class="cam__bottom">
        <button class="cam__side" aria-label="Загрузить фото" @click="pick(false)"><AppIcon name="image" :size="26" /><span>Галерея</span></button>
        <button class="cam__shutter" aria-label="Сфотографировать" :disabled="state !== 'live'" @click="shoot"><span /></button>
        <NuxtLink to="/my" class="cam__side" aria-label="Личный кабинет: коллекция"><AppIcon name="user" :size="26" /><span>Кабинет</span></NuxtLink>
      </div>
    </template>
    <div v-else class="cam__fallback">
      <ScannerIllustration class="cam__art" />
      <p>{{ reason }}</p>
      <button class="btn btn-primary btn-block" @click="pick(true)">Сфотографировать этикетку</button>
      <button class="btn btn-block cam__light" @click="pick(false)">Загрузить из галереи</button>
    </div>
  </div>
</template>

<style scoped>
.cam { position: fixed; inset: 0; background: #1d1714; color: #fff; overflow: hidden; }
.cam__video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cam__video.hidden { opacity: 0; }
.cam__top { position: absolute; top: 0; left: 0; right: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 16px;
  background: linear-gradient(rgba(0,0,0,.45), transparent); }
.cam__round { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: rgba(0,0,0,.35); color: #fff; }
.cam__round.on { background: #f5d58a; color: #3a2a1c; }
.cam__round--ghost { background: transparent; }
.cam__frame { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); width: min(72vw, 320px); aspect-ratio: 3 / 4; z-index: 1;
  border-radius: 22px; box-shadow: 0 0 0 200vmax rgba(0, 0, 0, .38); }
.c { position: absolute; width: 40px; height: 40px; border: 4px solid #fff; }
.tl { top: -2px; left: -2px; border-right: 0; border-bottom: 0; border-radius: 22px 0 0 0; }
.tr { top: -2px; right: -2px; border-left: 0; border-bottom: 0; border-radius: 0 22px 0 0; }
.bl { bottom: -2px; left: -2px; border-right: 0; border-top: 0; border-radius: 0 0 0 22px; }
.br { bottom: -2px; right: -2px; border-left: 0; border-top: 0; border-radius: 0 0 22px 0; }
.cam__hint { position: absolute; left: 0; right: 0; top: calc(46% + min(48vw, 214px)); z-index: 2; text-align: center; margin: 0; padding: 0 32px; font-size: 15px;
  text-shadow: 0 1px 4px rgba(0,0,0,.6); }
.cam__compass { position: absolute; left: 50%; top: 76px; transform: translateX(-50%); z-index: 2; display: flex; align-items: center; gap: 6px; max-width: calc(100% - 32px);
  padding: 6px 6px 6px 14px; border-radius: 999px; background: rgba(255, 250, 240, .95); color: #6d5410; font-size: 14px; white-space: nowrap; }
.cam__compass b { color: #3a2a1c; }
.cam__compass button { width: 28px; height: 28px; display: grid; place-items: center; color: #8a6a10; }
.cam__bottom { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: space-around;
  padding: 20px 16px calc(28px + var(--safe-bottom)); background: linear-gradient(transparent, rgba(0,0,0,.55)); }
.cam__side { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; width: 72px; color: #fff; }
.cam__shutter { width: 78px; height: 78px; border-radius: 50%; border: 4px solid #fff; display: grid; place-items: center; }
.cam__shutter span { width: 60px; height: 60px; border-radius: 50%; background: #fff; transition: transform .1s; }
.cam__shutter:active span { transform: scale(.9); }
.cam__modes { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(0, 0, 0, .45); }
.cam__mode { min-width: 64px; padding: 9px 16px; border-radius: 999px; font-size: 14px; font-weight: 600; text-align: center; color: rgba(255, 255, 255, .88); text-decoration: none; }
.cam__mode.on { background: #fff; color: #2c2a28; }
.cam__fallback { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 32px;
  text-align: center; background: var(--bg); color: var(--text); }
.cam__art { width: 120px; height: 120px; margin-bottom: 8px; }
.cam__fallback p { margin: 0 0 8px; line-height: 1.5; max-width: 340px; }
.cam__light { color: var(--accent); }
</style>
