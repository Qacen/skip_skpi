<template>
  <footer class="footer">
    <div class="container">
      <a class="footer__link" href="https://forms.yandex.ru/cloud/6911d889e010db6b5d3f3410/" target="_blank" rel="noopener">Добавить винодельню в каталог</a>
      <p class="footer__copy">© Своё Вино · сканер российских вин</p>
      <p class="footer__warn">Чрезмерное употребление алкоголя вредит вашему здоровью <span class="footer__age">18+</span></p>
    </div>
  </footer>
</template>

<style scoped>
.footer { margin-top: 56px; padding: 32px 0 120px; background: var(--surface-2); font-size: 14px; }
.footer__link { color: var(--accent); font-weight: 600; }
.footer__copy { color: var(--muted); margin: 16px 0 8px; }
.footer__warn { color: var(--muted); margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.footer__age { border: 1px solid var(--muted); border-radius: 6px; padding: 0 5px; font-size: 12px; }
</style>
