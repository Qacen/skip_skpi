<script setup lang="ts">
// Small inline icon set (stroke icons, currentColor)
defineProps<{ name: string, size?: number }>()
const P: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  heart: '<path d="M12 20s-7-4.4-9-9.2C1.6 7.3 4 4 7.3 4c2 0 3.4 1.1 4.7 2.8C13.3 5.1 14.7 4 16.7 4 20 4 22.4 7.3 21 10.8 19 15.6 12 20 12 20Z"/>',
  share: '<path d="M12 4v11M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v6h14v-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  flash: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.9.7 1.5 1.6 1.5 2.6h4c0-1 .6-1.9 1.5-2.6A6 6 0 0 0 12 3Z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  star4: '<path d="M12 2.5c.6 4.6 2.9 6.9 7.5 9.5-4.6 2.6-6.9 4.9-7.5 9.5-.6-4.6-2.9-6.9-7.5-9.5 4.6-2.6 6.9-4.9 7.5-9.5Z" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  glass: '<path d="M7 3h10l-1 6a4 4 0 0 1-8 0L7 3Z"/><path d="M12 13v7M8.5 21h7"/>',
  pin: '<path d="M12 21s-6-5.7-6-11a6 6 0 0 1 12 0c0 5.3-6 11-6 11Z"/><circle cx="12" cy="10" r="2.2"/>',
  grape: '<circle cx="9" cy="10" r="2.2"/><circle cx="14" cy="10" r="2.2"/><circle cx="11.5" cy="14" r="2.2"/><circle cx="16.5" cy="14" r="2.2"/><circle cx="14" cy="18" r="2.2"/><path d="M12 7c0-2 1-3 3-4"/>',
  thermo: '<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1-3.8 4-5.8 7.5-5.8s6.5 2 7.5 5.8"/>',
}
</script>

<template>
  <svg :width="size || 24" :height="size || 24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="P[name] || ''" />
</template>
