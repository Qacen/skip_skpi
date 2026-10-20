<template>
  <NuxtLink to="/wines" class="logo" aria-label="Своё Вино — каталог">
    <svg class="logo__mark" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#c7343a" /><stop offset="1" stop-color="#7a2a2c" />
        </linearGradient>
        <clipPath id="lc"><circle cx="24" cy="24" r="24" /></clipPath>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#lg)" />
      <g clip-path="url(#lc)" fill="none" stroke="#fdf3ea" stroke-width="3.2" stroke-linecap="round">
        <path d="M-2 18 C 8 10, 14 26, 26 16 S 44 8, 52 14" />
        <path d="M-2 28 C 10 20, 16 36, 28 26 S 44 20, 52 26" />
        <path d="M-2 38 C 10 31, 18 46, 30 37 S 46 32, 52 38" />
      </g>
    </svg>
    <span class="logo__text">
      <span class="logo__name">Своё Вино</span>
      <span class="logo__sub">От Россельхозбанка</span>
    </span>
  </NuxtLink>
</template>

<style scoped>
.logo { display: flex; align-items: center; gap: 10px; min-width: 0; }
.logo__mark { width: 44px; height: 44px; flex: 0 0 44px; }
.logo__text { display: flex; flex-direction: column; line-height: 1.05; }
.logo__name { font-family: var(--serif); font-weight: 700; font-size: 24px; color: var(--text); letter-spacing: -0.2px; }
.logo__sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
@media (max-width: 360px) { .logo__name { font-size: 21px; } }
</style>
