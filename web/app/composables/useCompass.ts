// «Винный компас» progress on this device (localStorage, no registration): the verdict for every tried step and the step
// the scanner is looking for right now (set by «Найти на полке», shown on the camera and the result screen).
import type { Verdict } from '#shared/compass'

export interface CompassAnswer { verdict: Verdict, reason?: string, slug?: string, title?: string, at: number }
const KEY = 'svoe-vino:compass'

export function useCompass() {
  const answers = useState<Record<string, CompassAnswer>>('compass-answers', () => ({}))
  const active = useState<string | null>('compass-active', () => null)
  const loaded = useState('compass-loaded', () => false)
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ answers: answers.value, active: active.value })) } catch { /* private mode */ } }
  if (import.meta.client && !loaded.value) {
    loaded.value = true
    const load = () => {
      try { const d = JSON.parse(localStorage.getItem(KEY) || '{}'); answers.value = d.answers || {}; active.value = d.active || null } catch { /* broken entry */ }
    }
    window.addEventListener('storage', e => { if (e.key === KEY) load() })
    if (useNuxtApp().isHydrating) onNuxtReady(load); else load()
  }
  function answer(key: string, a: Omit<CompassAnswer, 'at'>) { answers.value = { ...answers.value, [key]: { ...answers.value[key], ...a, at: Date.now() } }; save() }
  function clearAnswer(key: string) { const { [key]: _, ...rest } = answers.value; answers.value = rest; save() }
  function setActive(key: string | null) { active.value = key; save() }
  function reset() { answers.value = {}; active.value = null; save() }
  return { answers, active, answer, clearAnswer, setActive, reset }
}
