<script setup lang="ts">
// Extra facts about the wine from other sources (scripts/build_extra.py): awards, shop prices (for reference only — no sales
// on the site, 171-FZ), tasting notes of critics and shops, known vintages, buyers' reviews, the winery.
const props = defineProps<{ extra: any, readVintage?: string | null }>()
const ex = computed(() => props.extra || {})
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const medal = (a: string) => /гран|золот|gold/i.test(a) ? 'gold' : /серебр|silver/i.test(a) ? 'silver' : /бронз|bronze/i.test(a) ? 'bronze' : ''
const taste = computed(() => (ex.value.notes || []).filter((n: any) => n.kind === 'taste'))
const aroma = computed(() => (ex.value.notes || []).filter((n: any) => n.kind === 'aroma'))
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
const openReviews = ref(false)
const site = (u?: string | null) => u ? u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : ''
</script>

<template>
  <div class="wx">
    <section v-if="ex.awards?.length" class="section">
      <h2 class="section-title">Награды</h2>
      <div class="wx__awards">
        <span v-for="a in ex.awards" :key="a" class="wx__award" :class="medal(a)"><span class="wx__medal" />{{ a }}</span>
      </div>
    </section>

    <section v-if="ex.prices" class="section">
      <h2 class="section-title">Цена в магазинах</h2>
      <p class="wx__price">{{ ex.prices.min === ex.prices.max ? rub(ex.prices.min) : `${rub(ex.prices.min)} — ${rub(ex.prices.max)}` }}</p>
      <ul v-if="ex.prices.offers?.length" class="wx__offers">
        <li v-for="o in ex.prices.offers" :key="o.label + o.price">
          <a v-if="o.url" :href="o.url" target="_blank" rel="noopener nofollow">{{ o.label }}</a><span v-else>{{ o.label }}</span>
          <b>{{ rub(o.price) }}</b>
        </li>
      </ul>
      <p class="muted wx__note">Ориентир по данным магазинов, цена может отличаться. Продажи на сайте нет.</p>
    </section>

    <section v-if="taste.length || aroma.length" class="section">
      <h2 class="section-title">Вкус и аромат</h2>
      <div class="wx__notes">
        <div v-for="n in [...aroma, ...taste]" :key="n.label + n.text.slice(0, 20)" class="wx__notecard card">
          <span class="wx__kind">{{ n.kind === 'aroma' ? 'Аромат' : 'Вкус' }}</span>
          <p>{{ n.text }}</p>
          <a v-if="n.url" :href="n.url" target="_blank" rel="noopener nofollow" class="wx__src">{{ n.label }}</a>
          <span v-else class="wx__src">{{ n.label }}</span>
        </div>
      </div>
    </section>

    <section v-if="ex.vintages?.length" class="section">
      <h2 class="section-title">Года урожая</h2>
      <div class="wx__vintages">
        <span v-for="v in ex.vintages" :key="v" class="chip" :class="{ active: v === readVintage }">{{ v }}</span>
      </div>
      <p v-if="readVintage && !ex.vintages.includes(readVintage)" class="muted wx__note">
        На вашей этикетке {{ readVintage }} — этого года нет среди известных, характеристики могут отличаться.
      </p>
    </section>

    <section v-if="ex.reviews?.items?.length" class="section">
      <h2 class="section-title">Отзывы покупателей</h2>
      <p class="wx__rev-sum">
        <span v-if="ex.reviews.avg" class="wx__stars">★ {{ Number(ex.reviews.avg).toFixed(1) }}</span>
        {{ ex.reviews.n }} {{ ex.reviews.n % 10 === 1 && ex.reviews.n % 100 !== 11 ? 'отзыв' : [2, 3, 4].includes(ex.reviews.n % 10) && ![12, 13, 14].includes(ex.reviews.n % 100) ? 'отзыва' : 'отзывов' }} · {{ ex.reviews.source }}
      </p>
      <div v-for="(r, i) in ex.reviews.items" v-show="i < 2 || openReviews" :key="i" class="wx__review">
        <div class="wx__rev-head"><b>{{ r.author || 'Покупатель' }}</b><span v-if="r.rating" class="wx__stars">{{ '★'.repeat(Math.round(r.rating)) }}</span><span class="muted">{{ fmtDate(r.date) }}</span></div>
        <p>{{ r.text }}</p>
      </div>
      <div class="wx__rev-more">
        <button v-if="ex.reviews.items.length > 2 && !openReviews" class="wx__link" @click="openReviews = true">Ещё {{ ex.reviews.items.length - 2 }}</button>
        <a v-if="ex.reviews.url" :href="ex.reviews.url" target="_blank" rel="noopener nofollow" class="wx__link">Все отзывы на {{ ex.reviews.source }}</a>
      </div>
    </section>

    <section v-if="ex.winery" class="section">
      <h2 class="section-title">О винодельне</h2>
      <div class="wx__winery card">
        <b>{{ ex.winery.name }}</b>
        <span v-if="ex.winery.license_active" class="wx__lic"><AppIcon name="check" :size="14" />Лицензия Росалкоголя действует</span>
        <dl>
          <template v-if="ex.winery.regions?.length"><dt>Регион</dt><dd>{{ ex.winery.regions.join(', ') }}</dd></template>
          <template v-if="ex.winery.vineyard_ha"><dt>Виноградники</dt><dd>{{ Math.round(ex.winery.vineyard_ha).toLocaleString('ru-RU') }} га</dd></template>
          <template v-if="ex.winery.website"><dt>Сайт</dt><dd><a :href="ex.winery.website" target="_blank" rel="noopener">{{ site(ex.winery.website) }}</a></dd></template>
          <template v-if="ex.winery.phone"><dt>Телефон</dt><dd><a :href="`tel:${ex.winery.phone.replace(/[^\d+]/g, '')}`">{{ ex.winery.phone }}</a></dd></template>
        </dl>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wx__awards { display: flex; flex-wrap: wrap; gap: 8px; }
.wx__award { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px 7px 8px; border-radius: 999px; background: var(--surface); font-size: 14px; }
.wx__medal { width: 16px; height: 16px; border-radius: 50%; background: #d6cbb4; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, .12); }
.gold .wx__medal { background: #e0b441; } .silver .wx__medal { background: #c3c7cc; } .bronze .wx__medal { background: #c98b4f; }
.wx__price { font-family: var(--serif); font-size: 28px; margin: 0 0 8px; }
.wx__offers { list-style: none; margin: 0; padding: 0; }
.wx__offers li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 15px; }
.wx__offers a { color: var(--accent); }
.wx__note { font-size: 13px; margin: 8px 0 0; }
.wx__notes { display: grid; gap: 10px; }
@media (min-width: 760px) { .wx__notes { grid-template-columns: 1fr 1fr; } }
.wx__notecard { padding: 14px; }
.wx__notecard p { margin: 6px 0 8px; line-height: 1.55; }
.wx__kind { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); }
.wx__src { font-size: 13px; color: var(--muted); }
a.wx__src { text-decoration: underline; text-underline-offset: 2px; }
.wx__vintages { display: flex; flex-wrap: wrap; gap: 8px; }
.wx__rev-sum { margin: 0 0 8px; color: var(--muted); }
.wx__stars { color: #c79a2e; font-weight: 700; letter-spacing: 1px; }
.wx__review { padding: 12px 0; border-bottom: 1px solid var(--line); }
.wx__review p { margin: 6px 0 0; line-height: 1.5; }
.wx__rev-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; }
.wx__rev-more { display: flex; gap: 18px; margin-top: 10px; }
.wx__link { color: var(--accent); font-weight: 600; }
.wx__winery { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.wx__lic { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; color: var(--ok); background: #e6f0e4; border-radius: 999px; padding: 3px 10px; }
.wx__winery dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 4px 0 0; font-size: 15px; }
.wx__winery dt { color: var(--muted); }
.wx__winery dd { margin: 0; }
.wx__winery a { color: var(--accent); }
</style>
