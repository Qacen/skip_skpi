// Taste profile of the personal cabinet: a short questionnaire for people who know nothing about wine, refined by the
// wines rated in the collection. Shared by the cabinet / the wine card (client) and POST /api/wines/for-taste (server).
// Only what the catalog really knows about every wine is used: colour, sweetness (category), sparkling, the wineries' food
// pairings; body (light / full) only where the description says it. No percentages: the profile is coarse by design.
import { FOOD } from '#shared/food'

export type Color = 'red' | 'white' | 'rose'
export type Body = 'light' | 'full'
/** quiz answers: question id -> option id(s) */
export type TasteAnswers = Record<string, string | string[]>
export interface RatedWine { title?: string, color?: string, sweetness?: string, category?: string, rating?: number }

export interface TasteProfile {
  colors: Record<Color, number>   // relative weights 0..1 (0 everywhere = no preference)
  sweet: number | null            // preferred sweetness on the 0..3 scale (0 not sweet … 3 dessert), null = unknown
  sparkling: number               // > 0 likes sparkling
  body: Body | null
  food: string[]                  // FOOD group keys
  ratings: number                 // how many rated wines refined it
  quiz: boolean                   // the questionnaire was answered
}

/** 0 not sweet (dry, brut, extra brut) · 1 semi-dry · 2 semi-sweet · 3 sweet */
export const SWEET_LEVEL: Record<string, number> = { dry: 0, extra_brut: 0, brut: 0, semi_dry: 1, semi_sweet: 2, sweet: 3 }
export const SWEET_WORD = ['не сладкое', 'чуть сладкое', 'сладкое', 'очень сладкое']
export const SWEET_NAME = ['сухое', 'полусухое', 'полусладкое', 'сладкое']
export const COLOR_WORD: Record<string, string> = { red: 'красное', white: 'белое', rose: 'розовое', orange: 'оранжевое' }
// the catalog categories never say «игристое» («Белое полусладкое»): brut / extra brut, or the word in the name (semi-sweet sparkling)
export const SPARKLING_RE = /игрист|шампанск|спуманте|frizzante|петнат|pet[- ]?nat/i
export const isSparkling = (w: { sweetness?: string, category?: string, title?: string }) => ['brut', 'extra_brut'].includes(w.sweetness || '') || SPARKLING_RE.test(`${w.title || ''} ${w.category || ''}`)

interface Opt { id: string, label: string, hint?: string, color?: Color, sweet?: number, sweetW?: number, sparkling?: number, body?: Body, food?: string[], none?: boolean }
export interface Question { id: string, title: string, lead?: string, multi?: boolean, when?: (a: TasteAnswers) => boolean, options: Opt[] }

// Questions a novice can answer without knowing a single wine word: everyday drinks and tastes stand in for the wine's
// sweetness, acidity (fresh white), tannin (dense red), body and bubbles. Each option is a soft vote; the answers add up.
export const QUESTIONS: Question[] = [
  { id: 'drinks', title: 'Какие напитки тебе обычно нравятся?', options: [
    { id: 'sweet', label: 'Сладкие', hint: 'соки, лимонады, сладкий чай', sweet: 2.3, sweetW: 2 },
    { id: 'sour', label: 'С кислинкой', hint: 'лимонад с лимоном, морс, клюквенный сок', color: 'white', sweet: 1, sweetW: 1 },
    { id: 'dry', label: 'Несладкие', hint: 'вода, чай без сахара, чёрный кофе', sweet: 0, sweetW: 2 },
    { id: 'mood', label: 'Зависит от настроения' },
  ] },
  { id: 'acid', title: 'Как ты относишься к кислому вкусу?', options: [
    { id: 'love', label: 'Обожаю', hint: 'кислые ягоды, цитрусы и кислые конфеты', color: 'white', sweet: 0.5, sweetW: 0.7, body: 'light' },
    { id: 'little', label: 'Нравится лёгкая кислинка' },
    { id: 'soft', label: 'Предпочитаю мягкие вкусы', hint: 'без выраженной кислоты', sweet: 2, sweetW: 0.7 },
  ] },
  { id: 'fruit', title: 'Какие фрукты и ягоды ты скорее выберешь?', options: [
    { id: 'ripe', label: 'Персик, манго, спелая груша', color: 'white', sweet: 1.5, sweetW: 0.5 },
    { id: 'citrus', label: 'Лимон, грейпфрут, зелёное яблоко', color: 'white', sweet: 0, sweetW: 0.5, body: 'light' },
    { id: 'berry', label: 'Вишня, малина, клубника', color: 'rose', body: 'light' },
    { id: 'dark', label: 'Ежевика, черника, чёрная смородина', color: 'red', body: 'full' },
  ] },
  { id: 'bitter', title: 'Как относишься к горечи и терпкости?', options: [
    { id: 'love', label: 'Люблю', hint: 'крепкий чай, чёрный кофе, горький шоколад', color: 'red', sweet: 0, sweetW: 1, body: 'full' },
    { id: 'little', label: 'Немного горчинки приятно', color: 'red' },
    { id: 'no', label: 'Не люблю, когда горчит или вяжет во рту', color: 'white', sweet: 1.5, sweetW: 0.5 },
  ] },
  { id: 'body', title: 'Какой напиток по ощущениям приятнее?', options: [
    { id: 'light', label: 'Лёгкий, свежий', hint: 'хорошо освежающий', body: 'light' },
    { id: 'soft', label: 'Мягкий, округлый, нежный', sweet: 1.5, sweetW: 0.5 },
    { id: 'full', label: 'Насыщенный', hint: 'с ярким и долгим вкусом', body: 'full' },
  ] },
  { id: 'bubbles', title: 'Как относишься к пузырькам?', options: [
    { id: 'love', label: 'Очень люблю газированные напитки', sparkling: 2 },
    { id: 'sometimes', label: 'Иногда хочется чего-то игристого', sparkling: 1 },
    { id: 'no', label: 'Предпочитаю напитки без газа' },
  ] },
  { id: 'evening', title: 'Какой вариант звучит привлекательнее для вечера?', options: [
    { id: 'cold', label: 'Холодный фруктовый напиток', hint: 'лёгкий и освежающий', color: 'rose', sweet: 1.5, sweetW: 1, body: 'light' },
    { id: 'aroma', label: 'Ароматный, нежный, слегка сладковатый', color: 'white', sweet: 1.7, sweetW: 1.5 },
    { id: 'dry', label: 'Сухой, свежий, без сладости', color: 'white', sweet: 0, sweetW: 1.5, body: 'light' },
    { id: 'deep', label: 'Глубокий, насыщенный, согревающий', color: 'red', sweet: 0.3, sweetW: 1, body: 'full' },
  ] },
]

export const visibleQuestions = (a: TasteAnswers) => QUESTIONS.filter(q => !q.when || q.when(a))
const picked = (q: Question, a: TasteAnswers) => { const v = a[q.id]; const ids = Array.isArray(v) ? v : v ? [v] : []; return q.options.filter(o => ids.includes(o.id)) }

/** profile = questionnaire (if answered) + the collection: a wine rated 4–5 pulls the profile to its colour and sweetness,
 *  a wine rated 1–2 pushes away from its colour. A direct sweetness answer outweighs the wines ticked in «known» (weight 4
 *  vs 0.3 each); colour votes are summed first and clipped once, so the order of the ratings does not matter. */
export function buildProfile(answers: TasteAnswers | null, rated: RatedWine[] = []): TasteProfile | null {
  const col: Record<Color, number> = { red: 0, white: 0, rose: 0 }
  const sw: [number, number][] = []                     // (level, weight)
  let sparkling = 0, bodyVote = 0
  const food = new Set<string>()
  const quiz = !!answers && QUESTIONS.some(q => answers[q.id] != null)   // answers of an older questionnaire do not count
  if (answers) for (const q of visibleQuestions(answers)) for (const o of picked(q, answers)) {
    if (o.color) col[o.color] += 1
    if (o.sweet != null) sw.push([o.sweet, o.sweetW ?? 1])
    if (o.sparkling) sparkling += o.sparkling
    if (o.body) bodyVote += o.body === 'light' ? 1 : -1
    o.food?.forEach(f => food.add(f))
  }
  let n = 0
  for (const w of rated) {
    if (!w.rating) continue
    n++
    const k = w.rating - 3                               // +2 … −2
    if (w.color && w.color in col) col[w.color as Color] += 0.7 * k
    const lvl = w.sweetness != null ? SWEET_LEVEL[w.sweetness] : undefined
    if (k > 0 && lvl != null) sw.push([lvl, 0.6 * k])
    if (isSparkling(w)) sparkling += 0.5 * k
  }
  if (!quiz && !n) return null
  const body: Body | null = bodyVote > 0 ? 'light' : bodyVote < 0 ? 'full' : null
  for (const c of Object.keys(col) as Color[]) col[c] = Math.max(0, col[c])
  const max = Math.max(col.red, col.white, col.rose)
  const colors = { red: max ? col.red / max : 0, white: max ? col.white / max : 0, rose: max ? col.rose / max : 0 }
  const wsum = sw.reduce((s, [, w]) => s + w, 0)
  const sweet = wsum ? sw.reduce((s, [l, w]) => s + l * w, 0) / wsum : null
  return { colors, sweet, sparkling, body, food: [...food], ratings: n, quiz }
}

export const sweetIndex = (s: number) => Math.max(0, Math.min(3, Math.round(s)))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const likedColors = (p: TasteProfile) => (Object.keys(p.colors) as Color[]).filter(c => p.colors[c] >= 0.6)

/** one line of the profile in plain words: «красное · сладкое (полусладкое) · игристое · к мясу и сырам · лёгкое» */
export function profileWords(p: TasteProfile): string[] {
  const out: string[] = []
  const cs = likedColors(p)
  if (cs.length && cs.length < 3) out.push(cs.map(c => COLOR_WORD[c]).join(' и '))
  if (p.sweet != null) { const i = sweetIndex(p.sweet); out.push(`${SWEET_WORD[i]} (${SWEET_NAME[i]})`) }
  if (p.sparkling >= 1) out.push('игристое')
  if (p.food.length) out.push('к ' + p.food.slice(0, 3).map(f => FOOD[f]?.label).filter(Boolean).join(', '))
  if (p.body) out.push(p.body === 'light' ? 'лёгкое' : 'насыщенное')
  return out
}

export interface Fit { level: 'good' | 'mixed' | 'off', lines: string[] }
/** how a wine looks against the profile, in neutral words — what the user gets, not a verdict on the wine */
export function fitOf(p: TasteProfile | null, w: { title?: string, color?: string, sweetness?: string, category?: string, dishes?: string[], body?: string[] }): Fit | null {
  if (!p) return null
  const lines: string[] = []
  let good = 0, bad = 0
  const lvl = w.sweetness != null ? SWEET_LEVEL[w.sweetness] : undefined
  if (p.sweet != null && lvl != null) {
    const d = lvl - p.sweet
    if (Math.abs(d) <= 0.75) { lines.push('Сладость — как вы любите'); good++ }
    else { lines.push(d < 0 ? 'Суше, чем вы обычно любите' : 'Слаще, чем вы обычно любите'); bad++ }
  }
  const cs = likedColors(p)
  // any colour outside the liked ones (orange included) is a mismatch; a match is said aloud, so the level matches the lines
  if (cs.length && cs.length < 3 && w.color) {
    if (cs.includes(w.color as Color)) { lines.push(`${cap(COLOR_WORD[w.color] || '')} — как вы любите`); good++ }
    else { lines.push(`Вы чаще выбираете ${cs.map(c => COLOR_WORD[c]).join(' или ')}`); bad++ }
  }
  if (p.body && w.body?.length) {
    const wb = w.body.includes('full') ? 'full' : w.body.includes('light') ? 'light' : null
    if (wb && wb === p.body) { lines.push(wb === 'light' ? 'Лёгкое, как вы любите' : 'Насыщенное, как вы любите'); good++ }
    else if (wb) { lines.push(wb === 'light' ? 'Легче, чем вы любите' : 'Плотнее, чем вы любите'); bad++ }
  }
  const foods = p.food.filter(f => FOOD[f]?.dishes.some(d => w.dishes?.includes(d)))
  if (foods.length) { lines.push('Подходит к ' + foods.slice(0, 2).map(f => FOOD[f]!.label).join(' и ')); good++ }
  if (!lines.length) return null
  return { level: bad === 0 ? 'good' : good === 0 ? 'off' : 'mixed', lines }
}
