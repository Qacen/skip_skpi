# Nuxt 4 SSR server (catalog JSON is bundled as a Nitro server asset, bottle images are static files)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/wines?limit=1 >/dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
