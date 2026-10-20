// POST /api/sommelier — «Цифровой сомелье»: what you serve + the occasion -> verdict for THIS wine, a serving tip and
// wines of the same colour and style from other wineries that the wineries recommend to the chosen food (with reasons).
// body: { slug: string, food?: keyof FOOD, occasion?: 'dinner'|'gift'|'party'|'self' }
// Rule-based on the catalog pairing data; the UI offers only the food groups the wine is recommended for (shared/food.ts).
import { FOOD } from '#shared/food'
import { card, catalog } from '../utils/catalog'
import { rankAnalogs } from '../utils/analogs'

const SWEET_RU: Record<string, string> = { dry: 'сухое', semi_dry: 'полусухое', semi_sweet: 'полусладкое', sweet: 'сладкое', brut: 'брют', extra_brut: 'экстра брют' }
const low = (d: string) => d.replace(/^[А-ЯЁ](?=[а-яё])/, c => c.toLowerCase())
const sparkling = (w: any) => ['brut', 'extra_brut'].includes(w.sweetness) || /игрист/i.test(w.category)

function serveTip(w: any) {
  if (sparkling(w)) return 'Подавайте охлаждённым до 6–8 °C'
  if (w.color === 'red') return ['semi_sweet', 'sweet'].includes(w.sweetness) ? 'Подавайте при 14–16 °C' : 'Подавайте при 16–18 °C, откройте за 15–20 минут'
  return ['semi_sweet', 'sweet'].includes(w.sweetness) ? 'Подавайте охлаждённым до 8–10 °C' : 'Подавайте охлаждённым до 8–12 °C'
}

export default defineEventHandler(async (event) => {
  const a = await readBody(event)
  const cur = a?.slug ? await card(a.slug) : null
  if (!cur) throw createError({ statusCode: 400, statusMessage: 'Нужно вино (slug)' })
  const f = a.food && FOOD[a.food]
  const fitDishes = f ? cur.dishes.filter((d: string) => f.dishes.includes(d)) : []

  const reasons: string[] = []
  let ok = true
  if (f) {
    if (fitDishes.length) reasons.push(`подходит к ${f.label} — винодельня рекомендует: ${fitDishes.slice(0, 2).map(low).join(', ')}`)
    else { ok = false; reasons.push(`к ${f.label} винодельня его не рекомендует; её выбор: ${cur.dishes.slice(0, 2).map(low).join(', ')}`) }
  }
  const rating = Number(cur.rating) || 0, awards = cur.extra?.awards?.length || 0
  if (a.occasion === 'dinner' && !f) reasons.push(`к ужину винодельня советует: ${cur.dishes.slice(0, 3).map(low).join(', ')}`)
  if (a.occasion === 'gift') {
    reasons.push(cur.sweetness === 'dry' ? 'для подарка уточните, любит ли человек сухое: многие выбирают полусладкое' : 'для подарка безопасный вариант по сладости')
    if (awards) reasons.push(`есть награды (${awards}) — хороший аргумент для подарка`)
    else if (rating >= 4.5) reasons.push(`высокий народный рейтинг — ${rating.toFixed(1)}`)
  }
  if (a.occasion === 'party') {
    // finger food only from what the winery pairs THIS wine with — no generic «сыры и ассорти» for a wine that does not go with them
    const bites = cur.dishes.filter((d: string) => [...FOOD.snacks!.dishes, 'Сыры', 'Мясное ассорти'].includes(d))
    reasons.push(sparkling(cur) ? 'игристое — лучший выбор для вечеринки'
      : bites.length ? `на вечеринке — с закусками, которые советует винодельня: ${bites.slice(0, 3).map(low).join(', ')}`
        : cur.color === 'red' ? 'это вино лучше раскроется за ужином, чем на вечеринке' : 'лёгкое и свежее — хорошо для вечеринки')
  }
  const verdict = reasons.length ? { ok, reasons } : null

  // same colour & style from other wineries, recommended to the chosen food; the food reason goes first
  const items = await catalog()
  const bySlug = new Map(items.map(w => [w.slug, w]))
  const recs = await rankAnalogs({ slug: cur.slug }, { limit: 8, dishes: f?.dishes })
  const recommendations = recs.map((w) => {
    if (!f) return w
    const d = bySlug.get(w.slug)?.dishes.find(x => f.dishes.includes(x))
    return { ...w, reasons: [d ? `Винодельня рекомендует: ${low(d)}` : `Подходит к ${f.label}`, ...w.reasons.filter(x => !x.startsWith('Подходит к тем же блюдам'))].slice(0, 3) }
  })
  const sameStyle = (w: any) => w.color === cur.color && (sparkling(w) ? sparkling(cur) : !sparkling(cur) && w.sweetness === cur.sweetness)
  const count = items.filter(w => w.manufacturer !== cur.manufacturer && sameStyle(w) && (!f || w.dishes.some(d => f.dishes.includes(d)))).length
  // catalog query for «Все N» (same filters as /wines)
  const query: Record<string, string> = { color: cur.color }
  if (cur.sweetness) query.sweetness = cur.sweetness
  if (f) query.dish = f.dishes.join(',')
  return { verdict, serve: serveTip(cur), summary: f ? `к ${f.label}` : '', count, recommendations, query }
})
