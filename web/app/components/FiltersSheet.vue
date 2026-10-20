<script setup lang="ts">
const props = defineProps<{ open: boolean, groups: any[], modelValue: Record<string, string[]>, total: number }>()
const emit = defineEmits<{ close: [], 'update:modelValue': [Record<string, string[]>] }>()
const expanded = ref<Record<string, boolean>>({})
const q = ref<Record<string, string>>({})
const sel = computed(() => props.modelValue)
function toggle(key: string, value: string) {
  const cur = new Set(sel.value[key] || [])
  cur.has(value) ? cur.delete(value) : cur.add(value)
  emit('update:modelValue', { ...sel.value, [key]: [...cur] })
}
function visible(g: any) {
  const s = (q.value[g.key] || '').toLowerCase()
  const vals = s ? g.values.filter((v: any) => v.name.toLowerCase().includes(s)) : g.values
  return expanded.value[g.key] || s ? vals : vals.slice(0, 6)
}
const count = computed(() => Object.values(sel.value).reduce((n, v) => n + v.length, 0))
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="fs" @click.self="emit('close')">
      <Transition name="sheet" appear>
        <div class="fs__sheet" role="dialog" aria-label="Фильтр">
          <div class="fs__head">
            <span class="h3">Фильтр</span>
            <button class="fs__close" aria-label="Закрыть" @click="emit('close')"><AppIcon name="close" /></button>
          </div>
          <div class="fs__body">
            <div v-for="g in groups" :key="g.key" class="fs__group">
              <div class="fs__title">{{ g.name }}</div>
              <input v-if="g.searchable" v-model="q[g.key]" class="fs__search" type="text" placeholder="Поиск" />
              <label v-for="v in visible(g)" :key="v.value" class="fs__opt">
                <input type="checkbox" :checked="(sel[g.key] || []).includes(v.value)" @change="toggle(g.key, v.value)" />
                <span class="fs__box"><AppIcon name="check" :size="14" /></span>
                <span class="fs__name">{{ v.name }}</span><span class="fs__cnt">{{ v.count }}</span>
              </label>
              <button v-if="g.values.length > 6 && !q[g.key]" class="fs__more" @click="expanded[g.key] = !expanded[g.key]">
                {{ expanded[g.key] ? 'Свернуть' : `Показать все (${g.values.length})` }}
              </button>
            </div>
          </div>
          <div class="fs__foot">
            <button class="btn btn-outline" :disabled="!count" @click="emit('update:modelValue', {})">Сбросить</button>
            <button class="btn btn-primary" style="flex: 1" @click="emit('close')">Показать {{ total }}</button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.fs { position: fixed; inset: 0; z-index: 75; background: rgba(44, 42, 40, .35); display: flex; align-items: flex-end; justify-content: center; }
.fs__sheet { width: 100%; max-width: 640px; max-height: 88vh; background: var(--bg); border-radius: 24px 24px 0 0; display: flex; flex-direction: column; }
.fs__head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px 8px; }
.fs__close { width: 44px; height: 44px; display: grid; place-items: center; }
.fs__body { overflow-y: auto; padding: 0 20px 16px; }
.fs__group { padding: 14px 0; border-bottom: 1px solid var(--line); }
.fs__title { font-weight: 600; margin-bottom: 10px; }
.fs__search { width: 100%; height: 42px; border-radius: 12px; border: 1px solid var(--line); padding: 0 14px; margin-bottom: 8px; background: #fff; outline: none; }
.fs__opt { display: flex; align-items: center; gap: 10px; padding: 7px 0; min-height: 40px; cursor: pointer; }
.fs__opt input { position: absolute; opacity: 0; pointer-events: none; }
.fs__box { width: 22px; height: 22px; border-radius: 6px; border: 1.5px solid #cbbd9f; display: grid; place-items: center; color: transparent; flex: 0 0 22px; }
.fs__opt input:checked + .fs__box { background: var(--accent); border-color: var(--accent); color: #fff; }
.fs__name { flex: 1; }
.fs__cnt { color: var(--muted); font-size: 13px; }
.fs__more { color: var(--accent); font-weight: 600; margin-top: 6px; }
.fs__foot { display: flex; gap: 10px; padding: 12px 20px calc(16px + var(--safe-bottom)); border-top: 1px solid var(--line); }
</style>
