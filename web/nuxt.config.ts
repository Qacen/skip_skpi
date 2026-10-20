// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      title: 'Свои вина — сканер российских вин',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#fdfbf6' },
        { name: 'description', content: 'Сфотографируйте этикетку российского вина и сразу получите карточку: производитель, регион, сорт, описание и к чему подать.' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&display=swap' },
      ],
    },
  },
  runtimeConfig: {
    // URL of the recognition service (Python: RF-DETR-Seg + SigLIP2 + pgvector). Empty = demo mode.
    mlUrl: process.env.NUXT_ML_URL || '',   // comma-separated list, tried in order (see server/utils/recognizer.ts)
    mlUrlFile: 'ml-url.txt',                // NUXT_ML_URL_FILE: runtime override (Kaggle T4 tunnel URL), re-read on every scan
    mlTimeoutMs: 8000,            // NUXT_ML_TIMEOUT_MS; T4 answers in ~0.4 s, a local Mac (MPS) needs more
    public: {
      demoBanner: process.env.NUXT_PUBLIC_DEMO_BANNER !== '0',
    },
  },
  // dev server reachable through a quick tunnel (Cloudflare / localhost.run) for phone testing: Vite rejects unknown Host headers otherwise
  vite: { server: { allowedHosts: ['.trycloudflare.com', '.lhr.life'] } },
  nitro: {
    // catalog dump shipped inside the server bundle (reproducible build, no DB needed for the demo)
    serverAssets: [{ baseName: 'catalog', dir: fileURLToPath(new URL('./data', import.meta.url)) }],   // absolute: Nitro resolves relative dirs from server/
  },
})
