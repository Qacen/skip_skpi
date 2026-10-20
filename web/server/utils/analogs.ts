// Explained analog selection: wines from OTHER wineries that a person who liked (or wanted) the reference wine would pick
// instead, each with a match % and 2-3 human reasons ("Тот же сорт — Пино Нуар", "Похожие ноты: вишня, пряности", ...).
//  - hard constraints: same colour, same style (still dry / semi-dry / semi-sweet / sweet / sparkling), another winery;
//  - score = grapes (synonyms, style families, known Russian<->international analogues) + flavour notes parsed from the
//    winery's description + food pairing + body (light/full, tannins, ABV) + region + popularity;
//  - diversity: one wine per winery.
import { card, catalog, type WineItem } from './catalog'

// ---------------- grapes ----------------
const SYN: Record<string, string> = {
  'рислинг рейнский': 'рислинг', 'шираз': 'сира', 'пино гриджио': 'пино гри', 'мускат белый': 'мускат', 'мускат розовый': 'мускат',
  'мускат оттонель': 'мускат', 'кокур белый': 'кокур', 'красностоп золотовский': 'красностоп', 'красностоп анапский': 'красностоп',
  'траминер розовый': 'траминер', 'гевюрцтраминер': 'траминер',
}
const norm = (g: string) => { const s = g.toLowerCase().replace(/ё/g, 'е').trim(); return SYN[s] || s }
// style families: grapes that drink alike (used only when the grapes differ)
const FAMILY: Record<string, string> = {
  'пино нуар': 'red_light', 'менье': 'red_light', 'гаме': 'red_light', 'цимлянский черный': 'red_medium', 'бастардо магарачский': 'red_medium',
  'мерло': 'red_medium', 'каберне фран': 'red_medium', 'санджовезе': 'red_medium', 'молдова': 'red_medium', 'марселан': 'red_medium',
  'каберне совиньон': 'red_full', 'саперави': 'red_full', 'красностоп': 'red_full', 'сира': 'red_full', 'мальбек': 'red_full',
  'пти вердо': 'red_full', 'темпранильо': 'red_full', 'рубин голодриги': 'red_full', 'одесский черный': 'red_full',
  'рислинг': 'white_aromatic', 'совиньон блан': 'white_aromatic', 'мускат': 'white_aromatic', 'траминер': 'white_aromatic',
  'цитронный магарача': 'white_aromatic', 'сибирьковый': 'white_aromatic', 'вионье': 'white_aromatic', 'шенен блан': 'white_aromatic',
  'алиготе': 'white_fresh', 'ркацители': 'white_fresh', 'пино блан': 'white_fresh', 'пино гри': 'white_fresh', 'бианка': 'white_fresh',
  'кокур': 'white_fresh', 'первенец магарача': 'white_fresh', 'шардоне': 'white_round', 'семильон': 'white_round',
}
const FAMILY_RU: Record<string, string> = {
  red_light: 'лёгкое красное', red_medium: 'красное средней плотности', red_full: 'плотное красное',
  white_aromatic: 'ароматное белое', white_fresh: 'свежее белое', white_round: 'округлое белое',
}
// well-known Russian <-> international analogues (reason text shown as is)
const PAIRS: [string, string, string][] = [
  ['красностоп', 'каберне совиньон', 'Красностоп по плотности и танинам близок к каберне совиньон'],
  ['сибирьковый', 'совиньон блан', 'Сибирьковый — свежий и травянистый, как совиньон блан'],
  ['цитронный магарача', 'мускат', 'Цитронный Магарача — ароматный, с цитрусом и цветами, как мускат'],
  ['саперави', 'каберне совиньон', 'Саперави — такое же плотное и тёмное, как каберне совиньон'],
  ['кокур', 'алиготе', 'Кокур — свежий и сдержанный, как алиготе'],
  ['цимлянский черный', 'мерло', 'Цимлянский чёрный — мягкий и ягодный, как мерло'],
]
const pairOf = (a: string, b: string) => PAIRS.find(([x, y]) => (x === a && y === b) || (x === b && y === a))?.[2]

// ---------------- flavour notes & body parsed from the description ----------------
const NOTES: [string, string, RegExp][] = [
  ['red_berry', 'красные ягоды', /вишн|черешн|малин|клубник|землян|клюкв|брусник|красн\w* ягод|красн\w* смородин/],
  ['dark_fruit', 'тёмные ягоды и слива', /черн\w* смородин|ежевик|черник|шелковиц|слив|чернослив|черн\w* ягод/],
  ['citrus', 'цитрус', /цитрус|лимон|лайм|грейпфрут|цедр|апельсин|мандарин/],
  ['orchard', 'яблоко и груша', /яблок|груш|айв/],
  ['stone', 'персик и абрикос', /персик|абрикос|косточков|нектарин/],
  ['tropical', 'тропические фрукты', /тропич|манго|ананас|маракуй|дын|банан|личи|папай/],
  ['floral', 'цветы', /цвет(ов|оч|ы)|акаци|роз[ыа]|фиалк|бузин|липов|жасмин/],
  ['herbal', 'травы', /трав|крыжовник|мят|шалфе|зелен\w* перц|листа/],
  ['spice', 'пряности', /специ|пряност|пряны|перц|гвоздик|корицы|лакриц|мускатн\w* орех/],
  ['oak', 'дуб и ваниль', /дуб|ванил|бочк|шоколад|кофе|табак|кож[аи]|карамел|дым/],
  ['honey', 'мёд и сухофрукты', /м[её]д|сухофрукт|изюм|джем|варень|инжир|цукат/],
  ['mineral', 'минеральность', /минерал|кремн/],
  ['pastry', 'выпечка', /выпечк|бриош|хлебн|тост|дрожж/],
]
const BODY: [string, RegExp][] = [
  ['light', /л[её]гк|питк|освежающ/], ['full', /насыщенн|плотн|полнотел|концентрирован|мощн/],
  ['tannic', /танин|терпк/], ['soft', /мягк|бархат|округл|шелковист/],
]
// phrases where «лёгкий / насыщенный» describe a note, the colour or the acidity, not the body of the wine
// («легкими растительными нотами», «слегка», «освежающей кислотностью», «насыщенного барбарисового цвета», «средней насыщенности»)
const BODY_NOISE = [
  /л[её]гк\S*\s+(\S+\s+)?(нот|оттен|пряност|минерал|кислотн|закуск|мясн|горчинк|аромат|дымк|сладост|терпкост|танин|перчинк|намек|сливочн|шипуч|тон)\S*/g,
  /слегка/g, /освежающ\S*\s+кислотн\S*/g, /насыщенн\S*\s+(\S+\s+)?(цвет|оттенк|окрас|тон|нот|аромат)\S*/g, /(средн|умеренн)\S*\s+насыщенн\S*/g,
  /концентрированн\S*\s+(сок|аромат)\S*/g, /плотн\S*\s+(пен|мусс|перлаж)\S*/g,
]
const bodyText = (t: string) => BODY_NOISE.reduce((s, re) => s.replace(re, ' '), t)

// ---------------- features ----------------
interface F { w: WineItem, grapes: Set<string>, fam: Set<string>, notes: Set<string>, body: Set<string>, dishes: Set<string>, style: string }
let _F: Map<string, F> | null = null
// the categories never say «игристое» («Белое полусладкое»): brut / extra brut, or the word in the name (semi-sweet sparkling, ~23 wines)
const styleOf = (w: WineItem) => (['brut', 'extra_brut'].includes(w.sweetness) || /игрист|шампанск|спуманте|frizzante|петнат|pet[- ]?nat/i.test(`${w.title} ${w.category}`) ? 'sparkling' : w.sweetness || 'unknown')

async function features(): Promise<Map<string, F>> {
  if (_F) return _F
  const items = await catalog()
  const cards = await Promise.all(items.map(w => card(w.slug)))
  _F = new Map(items.map((w, i) => {
    const text = `${cards[i]?.description || ''}`.toLowerCase().replace(/ё/g, 'е')
    const grapes = new Set(w.grapes.map(norm))
    return [w.slug, {
      w, grapes, fam: new Set([...grapes].map(g => FAMILY[g]).filter(Boolean) as string[]),
      notes: new Set(NOTES.filter(([, , re]) => re.test(text)).map(([k]) => k)),
      body: (() => { const bt = bodyText(text); const b = new Set(BODY.filter(([, re]) => re.test(bt)).map(([k]) => k)); if (b.has('full')) b.delete('light'); return b })(),
      dishes: new Set(w.dishes), style: styleOf(w),
    }]
  }))
  return _F
}

const jac = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n) }
const inter = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x))
const NEIGHBORS: Record<string, string[]> = { 'Кубань': ['Крым'], 'Крым': ['Кубань'], 'Долина Дона': ['Ставрополье', 'Нижняя Волга'],
  'Ставрополье': ['Долина Дона', 'Дагестан'], 'Дагестан': ['Ставрополье'], 'Нижняя Волга': ['Долина Дона', 'Самара'], 'Самара': ['Нижняя Волга'] }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const list = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}` : xs[0] || ''

export interface Analog { slug: string, title: string, manufacturer: string, img: string, rating: number | null, category: string,
  region: string, match: number, reasons: string[] }

/** ref: a catalog wine (found) or a profile of the photographed wine (not found: read colour + top candidates). */
export interface AnalogRef { slug?: string, color?: string, colors?: string[], sweetness?: string, category?: string, manufacturer?: string,
  grapes?: string[], region?: string, alcohol?: number | null, dishes?: string[], notes?: string[], body?: string[], known?: boolean }

/** opts.dishes: keep only wines the wineries recommend to one of these dishes (the sommelier's food choice). */
export async function rankAnalogs(ref: AnalogRef, opts: { limit?: number, exclude?: string[], dishes?: string[] } = {}): Promise<Analog[]> {
  const F = await features()
  const rf = ref.slug ? F.get(ref.slug) : undefined
  const R = {
    grapes: rf?.grapes || new Set((ref.grapes || []).map(norm)),
    notes: rf?.notes || new Set(ref.notes || []), body: rf?.body || new Set(ref.body || []),
    dishes: rf?.dishes || new Set(ref.dishes || []), region: rf?.w.region || ref.region || '',
    alcohol: rf?.w.alcohol ?? ref.alcohol ?? null,
    // not found and the label colour was not read: the colours the candidates vote for (red + rosé Pinot Noir -> both)
    colors: rf ? [rf.w.color] : ref.colors?.length ? ref.colors : ref.color ? [ref.color] : [],
    style: rf?.style || styleOf({ sweetness: ref.sweetness || '', category: ref.category || '' } as WineItem),
    maker: rf?.w.manufacturer || ref.manufacturer || '', known: ref.known ?? !!rf,
  }
  const rfam = new Set([...R.grapes].map(g => FAMILY[g]).filter(Boolean) as string[])
  const exclude = new Set([ref.slug, ...(opts.exclude || [])].filter(Boolean) as string[])
  const scored: { a: Analog, s: number }[] = []
  for (const f of F.values()) {
    const w = f.w
    if (exclude.has(w.slug) || (R.maker && w.manufacturer === R.maker)) continue
    if (R.colors.length && !R.colors.includes(w.color)) continue
    if (opts.dishes && !opts.dishes.some(x => f.dishes.has(x))) continue
    if (R.style !== 'unknown' && f.style !== R.style) continue
    const why: [number, string][] = []
    // grapes
    const same = inter(R.grapes, f.grapes)
    // blends: a single-varietal wine inside the other's blend counts as a strong match (overlap), not a third of one (Jaccard)
    let g = same.length ? 0.5 * jac(R.grapes, f.grapes) + 0.5 * same.length / Math.min(R.grapes.size, f.grapes.size) : 0
    // grape names as written in the analog's card (not the normalised keys)
    const shown = w.grapes.filter(x => same.includes(norm(x))).slice(0, 2)
    if (same.length) why.push([0.3 * g + 0.05, R.known ? `Тот же сорт — ${list(shown)}` : `${list(shown)} — как у похожих на ваше фото вин`])
    else {
      const p = [...R.grapes].flatMap(a => [...f.grapes].map(b => pairOf(a, b))).find(Boolean)
      if (p) { g = 0.7; why.push([0.21, p]) }
      else if (inter(rfam, f.fam).length) { g = 0.45; why.push([0.13, `Сорт того же стиля — ${FAMILY_RU[inter(rfam, f.fam)[0]!]}`]) }
    }
    // flavour notes
    const sn = inter(R.notes, f.notes); const d = jac(R.notes, f.notes)
    if (sn.length) why.push([0.25 * d + 0.02 * sn.length, `Похожие ноты: ${NOTES.filter(n => sn.includes(n[0])).slice(0, 3).map(n => n[1]).join(', ')}`])
    // food
    const sd = inter(R.dishes, f.dishes); const fd = jac(R.dishes, f.dishes)
    if (sd.length) why.push([0.15 * fd, `Подходит к тем же блюдам: ${sd.slice(0, 2).map(x => x.replace(/^[А-ЯЁ](?=[а-яё])/, c => c.toLowerCase())).join(', ')}`])
    // body
    let b = 0
    if (R.body.has('light') && f.body.has('light')) { b += 0.5; why.push([0.06, 'Такое же лёгкое и свежее']) }
    if (R.body.has('full') && f.body.has('full')) { b += 0.5; why.push([0.06, R.body.has('tannic') && f.body.has('tannic') ? 'Такое же плотное, с танинами' : 'Такое же насыщенное']) }
    if (R.alcohol && w.alcohol) { const da = Math.abs(R.alcohol - w.alcohol); b += da <= 0.5 ? 0.5 : da <= 1.5 ? 0.25 : 0 }
    // region, popularity
    const reg = w.region === R.region ? 1 : (NEIGHBORS[R.region] || []).includes(w.region) ? 0.5 : 0
    if (reg === 1 && R.region) why.push([0.03, `Тоже ${R.region}`])
    const pop = (w.rating || 0) / 5
    if ((w.rating || 0) >= 4.7) why.push([0.02, `Народный рейтинг ${Number(w.rating).toFixed(1)}`])
    const s = 0.3 * g + 0.25 * d + 0.15 * fd + 0.12 * Math.min(1, b) + 0.05 * reg + 0.08 * pop
    if (s < 0.12 || !why.length) continue
    scored.push({ s, a: { slug: w.slug, title: w.title, manufacturer: w.manufacturer, img: w.img, rating: w.rating, category: w.category,
      region: w.region, match: 0, reasons: why.sort((x, y) => y[0] - x[0]).slice(0, 3).map(x => x[1]) } })
  }
  scored.sort((x, y) => y.s - x.s)
  const seen = new Set<string>(), out: Analog[] = []
  for (const { a, s } of scored) {
    if (seen.has(a.manufacturer)) continue                       // one wine per winery
    seen.add(a.manufacturer)
    a.match = Math.round(Math.max(50, Math.min(97, 40 + 75 * s)))   // absolute: s ~0.75 (same grapes, notes, food, body) -> ~96 %
    if (process.env.ANALOG_DEBUG) (a as any).s = +s.toFixed(3)
    out.push(a)
    if (out.length >= (opts.limit ?? 12)) break
  }
  return out
}

/** Profile of a photographed wine that is not in the catalog: colour/sweetness read from the label, the rest voted by the
 *  top visual candidates (weighted by similarity). The candidates' winery is excluded — it is usually the same producer. */
export async function profileFromCandidates(top5: { slug: string, score: number }[], read?: { color?: string | null, sweetness?: string | null }): Promise<AnalogRef> {
  const F = await features()
  const c = top5.map(t => ({ f: F.get(t.slug), s: t.score })).filter(x => x.f) as { f: F, s: number }[]
  const vote = (get: (f: F) => Iterable<string>, min = 0.34) => {
    const tot = c.reduce((a, x) => a + x.s, 0) || 1, acc = new Map<string, number>()
    for (const x of c) for (const k of get(x.f)) acc.set(k, (acc.get(k) || 0) + x.s / tot)
    return [...acc].filter(([, v]) => v >= min).map(([k]) => k)
  }
  const first = c[0]?.f.w
  // colour / style: read from the label, else a weighted vote of the candidates. A split colour vote keeps every colour with
  // >= 30 % (the rank then leans on grapes and notes) instead of trusting the single closest bottle
  const colors = read?.color ? [read.color] : vote(f => [f.w.color], 0.3)
  const style = vote(f => [f.style], 0.5)[0]
  const sweetness = read?.sweetness || (style === 'sparkling' ? 'brut' : style !== 'unknown' ? style : undefined)
  return {
    color: colors.length === 1 ? colors[0] : undefined, colors, sweetness, category: style === 'sparkling' ? 'Игристое' : '',
    manufacturer: first?.manufacturer, grapes: vote(f => f.grapes, 0.5), notes: vote(f => f.notes), body: vote(f => f.body),
    dishes: vote(f => f.dishes), region: first?.region, alcohol: first?.alcohol ?? null, known: false,
  }
}

const COLOR_RU: Record<string, string> = { red: 'красное', white: 'белое', rose: 'розовое', orange: 'оранжевое' }
const SWEET_RU: Record<string, string> = { dry: 'сухое', semi_dry: 'полусухое', semi_sweet: 'полусладкое', sweet: 'сладкое', brut: 'брют', extra_brut: 'экстра брют' }
const title = (g: string) => g.replace(/(^|\s|-)\S/g, c => c.toUpperCase())

/** One line under «Аналоги из других виноделен» for a not-found wine: what the picks are based on. */
export function profileLead(p: AnalogRef, read?: { color?: string | null, sweetness?: string | null }) {
  const style = read?.color ? [COLOR_RU[read.color], read.sweetness ? SWEET_RU[read.sweetness] : ''].filter(Boolean).join(' ') : ''
  const grapes = (p.grapes || []).slice(0, 2).map(title)
  if (style && grapes.length) return `Похоже на ${list(grapes)}, ${style} — от других производителей`
  if (style) return `В том же стиле — ${style}, от других производителей`
  if (grapes.length) return `Похоже на ${list(grapes)} — подобрали по сорту, нотам и блюдам`
  return 'Подобрали по стилю похожих вин, от других производителей'
}

// ---------------- relevance to the user's favourites (shelf photo: none of the favourites on the shelf) ----------------
export interface FavMatch { slug: string, match: number, reasons: string[], like: { slug: string, title: string } | null }

/** How well each candidate (a wine on the photographed shelf) fits the taste expressed by the favourites:
 *  max over favourites of a soft similarity — colour, style, grapes (synonyms / pairs / style families), flavour notes, food,
 *  body, winery, region. No hard constraints (unlike analogs): a red-wine lover still gets a ranked shelf of whites. */
export async function rankByFavorites(candidates: string[], favorites: string[]): Promise<FavMatch[]> {
  const F = await features()
  const favs = favorites.map(s => F.get(s)).filter(Boolean) as F[]
  return candidates.map((slug) => {
    const f = F.get(slug)
    if (!f || !favs.length) return { slug, match: 0, reasons: [], like: null }
    let best = { s: -1, why: [] as [number, string][], fav: favs[0]! }
    for (const r of favs) {
      const why: [number, string][] = []
      const color = r.w.color && r.w.color === f.w.color ? 1 : 0
      const style = r.style !== 'unknown' && r.style === f.style ? 1 : 0
      if (color && style) why.push([0.2, `Тоже ${f.w.category.toLowerCase()}`])
      const same = inter(r.grapes, f.grapes)
      let g = same.length ? 0.5 * jac(r.grapes, f.grapes) + 0.5 * same.length / Math.min(r.grapes.size, f.grapes.size) : 0
      if (same.length) why.push([0.25 * g + 0.05, `Тот же сорт — ${list(f.w.grapes.filter(x => same.includes(norm(x))).slice(0, 2))}`])
      else {
        const p = [...r.grapes].flatMap(a => [...f.grapes].map(b => pairOf(a, b))).find(Boolean)
        if (p) { g = 0.7; why.push([0.17, p]) }
        else if (inter(r.fam, f.fam).length) { g = 0.45; why.push([0.11, `Сорт того же стиля — ${FAMILY_RU[inter(r.fam, f.fam)[0]!]}`]) }
      }
      const sn = inter(r.notes, f.notes), d = jac(r.notes, f.notes)
      if (sn.length) why.push([0.15 * d + 0.02 * sn.length, `Похожие ноты: ${NOTES.filter(n => sn.includes(n[0])).slice(0, 3).map(n => n[1]).join(', ')}`])
      const fd = jac(r.dishes, f.dishes)
      const b = (r.body.has('light') && f.body.has('light') ? 0.5 : 0) + (r.body.has('full') && f.body.has('full') ? 0.5 : 0)
      const maker = r.w.manufacturer === f.w.manufacturer ? 1 : 0
      if (maker) why.push([0.06, `Та же винодельня — ${f.w.manufacturer}`])
      const reg = r.w.region && r.w.region === f.w.region ? 1 : 0
      const s = 0.2 * color + 0.15 * style + 0.25 * g + 0.15 * d + 0.1 * fd + 0.07 * b + 0.05 * maker + 0.03 * reg
      if (s > best.s) best = { s, why, fav: r }
    }
    return { slug, match: Math.round(Math.max(20, Math.min(98, 25 + 80 * best.s))),
      reasons: best.why.sort((x, y) => y[0] - x[0]).slice(0, 2).map(x => x[1]), like: { slug: best.fav.w.slug, title: best.fav.w.title } }
  })
}

// ---------------- wines in the user's style (personal cabinet, taste profile from the questionnaire + collection) ----------------
export interface TasteQuery { colors?: Record<string, number>, sweet?: number | null, sparkling?: number, body?: string | null, dishes?: string[], exclude?: string[], limit?: number }
export interface TastePick { slug: string, title: string, manufacturer: string, img: string, rating: number | null, category: string, region: string, reasons: string[] }
const SWEET_LVL: Record<string, number> = { dry: 0, extra_brut: 0, brut: 0, semi_dry: 1, semi_sweet: 2, sweet: 3 }
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }

/** Catalog wines closest to a coarse taste profile: sweetness first (the main criterion of Russian buyers), then colour,
 *  sparkling, the wineries' food pairings and body; popularity only breaks ties; at most 2 wines per winery. */
export async function rankForTaste(q: TasteQuery): Promise<TastePick[]> {
  const F = await features()
  const ex = new Set(q.exclude || [])
  const colors = q.colors || {}, cmax = Math.max(0, ...Object.values(colors))
  const dishes = new Set(q.dishes || [])
  const scored: { f: F, s: number, why: string[] }[] = []
  for (const f of F.values()) {
    if (ex.has(f.w.slug)) continue
    const why: string[] = []
    let s = 0
    const lvl = SWEET_LVL[f.w.sweetness]
    if (q.sweet != null && lvl != null) { const d = Math.abs(lvl - q.sweet); s += 0.4 * Math.max(0, 1 - d / 1.5); if (d <= 0.75) why.push(`${cap(f.w.category.toLowerCase())} — по сладости как вы любите`) }
    if (cmax > 0) s += 0.25 * ((colors[f.w.color] || 0) / cmax)
    if ((q.sparkling || 0) >= 1) { if (f.style === 'sparkling') { s += 0.15; why.push('Игристое') } }
    else if (f.style === 'sparkling') s -= 0.05
    const dd = f.w.dishes.filter(d => dishes.has(d))
    if (dd.length) { s += 0.12; why.push(`Винодельня советует к: ${dd.slice(0, 2).join(', ').toLowerCase()}`) }
    if (q.body && f.body.has(q.body)) { s += 0.08; why.push(q.body === 'light' ? 'Лёгкое и свежее' : 'Насыщенное') }
    // ties (most of the catalog has the same coarse features and a 5.0 rating): the guide's score and a described taste break them,
    // then a deterministic hash — never the alphabetical catalog order
    s += 0.03 * (f.w.guideRating ? Math.min(5, f.w.guideRating) / 5 : 0) + 0.01 * Math.min(1, (f.notes.size + f.body.size) / 4)
    s += 0.004 * (hash(f.w.slug) % 1000) / 1000
    scored.push({ f, s, why })
  }
  scored.sort((a, b) => b.s - a.s)
  const limit = Math.min(24, q.limit || 12)
  const per = new Map<string, number>(), seen = new Set<string>(), out: TastePick[] = []
  // one wine per winery first, a second one only if the list is still short; vintages of one wine count once
  for (const maxPer of [1, 2]) for (const x of scored) {
    if (out.length >= limit) break
    const w = x.f.w, key = `${w.manufacturer}|${w.title.replace(/\b(19|20)\d\d\b/g, '').trim().toLowerCase()}`
    if (seen.has(key) || out.some(o => o.slug === w.slug)) continue
    const n = per.get(w.manufacturer) || 0
    if (n >= maxPer) continue
    per.set(w.manufacturer, n + 1); seen.add(key)
    out.push({ slug: w.slug, title: w.title, manufacturer: w.manufacturer, img: w.img, rating: w.rating, category: w.category, region: w.region, reasons: x.why.slice(0, 2) })
  }
  return out
}

/** light / full / tannic / soft parsed from the description (empty when the description says nothing) */
export async function bodyOf(slug: string): Promise<string[]> { return [...((await features()).get(slug)?.body || [])] }
