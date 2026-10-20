// Compact wine card for the live AR overlay (/scan/ar): what the glass panel next to the bottle draws.
// Taste icons come from the winery's own tasting text (description + tasting notes): keywords in order of appearance;
// when the text names fewer than two, the panel shows the typical profile of the style and says so (tasteFromStyle).
import { card } from './catalog'

export interface ArIcon { icon: string, label: string }
export interface ArCard {
  slug: string, title: string, manufacturer: string, year: string, category: string, color: string, sweetness: string,
  region: string, geo: { lon: number, lat: number } | null, grapes: string[], alcohol: number | null, rating: number | null,
  img: string, temperature: string, taste: ArIcon[], tasteFromStyle: boolean, pairs: ArIcon[]
}

// wine regions of the catalog -> map pin (lon, lat); null = outside the coastline map (shared/arMapLand.ts)
export const REGION_GEO: Record<string, { lon: number, lat: number } | null> = {
  'Кубань': { lon: 38.0, lat: 44.9 },
  'Крым': { lon: 34.1, lat: 44.95 },
  'Дагестан': { lon: 47.8, lat: 42.6 },
  'Долина Дона': { lon: 41.0, lat: 47.5 },
  'Ставрополье': { lon: 43.8, lat: 44.7 },
  'Нижняя Волга': { lon: 44.6, lat: 48.4 },
  'Самара': { lon: 50.1, lat: 53.2 },
  'Северная Осетия — Алания': { lon: 44.6, lat: 43.3 },
  'Дальневосточная зона': null,
}

// [pattern on the lower-cased (ё -> е) tasting text, icon, label]; more specific patterns first (one label per icon group).
// JS \b is ASCII-only, so word edges are lookarounds on [а-я]: (?<![а-я]) = word start, (?![а-я]) = word end.
// Stems are anchored where a bare substring is a known false hit ("молодым" has дым, "различимы" has личи, "сахаристости" has тост).
const TASTE: [RegExp, string, string][] = [
  [/(?<![а-я])(?:черн[а-я]*\s+смородин|черно-?смородин)/, '🫐', 'Чёрная смородина'],   // also "черносмородиновый", "черно-смородиновый"
  [/смородин/, '🫐', 'Смородина'],
  [/черешн/, '🍒', 'Черешня'],
  [/вишн/, '🍒', 'Вишня'],
  [/ежевик/, '🫐', 'Ежевика'],
  [/черник/, '🫐', 'Черника'],
  [/чернослив/, '🫐', 'Чернослив'],
  [/(?<![а-я])слив(?!оч|к|ок|ает|ают)/, '🫐', 'Слива'],   // not сливочный / сливки / сливок / "сливаются"
  [/малин/, '🍓', 'Малина'],
  [/клубник|землян/, '🍓', 'Клубника'],
  [/(?<![а-я])(?:красн|черн|темн|лесн|(?:пере)?спел|свеж)[а-я-]*\s+ягод/, '🍓', 'Ягоды'],
  [/(?<![а-я])(?:джем|варень|конфитюр)/, '🍓', 'Ягодный джем'],
  [/гранат(?!ов)/, '🍎', 'Гранат'],                    // гранатовый is a colour ("гранатовыми отблесками")
  [/(?<![а-я])зелен[а-я-]*\s+яблок/, '🍏', 'Зелёное яблоко'],
  [/яблок|яблоч(?!но-молоч)/, '🍏', 'Яблоко'],         // not "яблочно-молочная" (malolactic fermentation)
  [/айв/, '🍐', 'Айва'],
  [/груш|дюшес/, '🍐', 'Груша'],
  [/грейпфрут/, '🍊', 'Грейпфрут'],
  [/апельсин|мандарин/, '🍊', 'Апельсин'],
  [/лимон|лайм|цитрус|цедр/, '🍋', 'Цитрус'],
  [/персик|нектарин/, '🍑', 'Персик'],
  [/абрикос|кураг/, '🍑', 'Абрикос'],
  [/манго/, '🥭', 'Манго'],
  [/ананас|тропич|маракуй|(?<![а-я])личи|гуав/, '🍍', 'Тропические фрукты'],
  [/дын/, '🍈', 'Дыня'],
  [/банан/, '🍌', 'Банан'],
  [/изюм|сухофрукт|инжир|финик|сушен[а-я-]*\s+(?:фрукт|плод|ягод)/, '🍇', 'Сухофрукты'],   // not "сушеных трав / цветов"
  [/фиалк/, '🌸', 'Фиалка'],
  [/(?<![а-я])роз(?:а|ы|ой|у)(?![а-я])|чайн[а-я-]* роз|лепестк/, '🌹', 'Роза'],   // "розе" is the wine type (rosé), not a flower
  [/(?<![а-я])бел[а-я-]*\s+(?:[а-я-]+\s+)?цвет(?:ов|ы|ами|ах|к)/, '🌼', 'Белые цветы'],   // "белого цвета" is the colour
  [/цвет(?:оч|ов|ами|ущ)|(?<![а-я])цветы(?![а-я])|жасмин|акаци|липы|липов|бузин|боярышн/, '🌼', 'Цветы'],
  [/трав|(?<![а-я])мят|эвкалипт|шалфе|розмарин|самшит|чабрец|тимьян|полын/, '🌿', 'Травы'],   // "безмятежности" has мят
  [/(?<![а-я])специ(?:и|й|ями|ях|я)(?![а-я])|пряност|пряны|перц|перец|перечн|гвоздик|кориц|анис|мускатн[а-я-]* орех/, '🌶️', 'Специи'],
  [/ванил/, '🍦', 'Ваниль'],
  [/(?<![а-я])дуб(?!ка|ильн|лир)|бочк|бочон|смолист/, '🪵', 'Дуб'],   // not "два дубка" (vineyard), "дубильные", "дублирующий"
  [/(?<![а-я])дым|копч[её]н|поджар/, '🔥', 'Дымные ноты'],
  [/шоколад|какао/, '🍫', 'Шоколад'],
  [/кофе(?!рмент)/, '☕', 'Кофе'],                       // not "коферментация"
  [/(?<![а-я])мед(?:а|у|ом|е|ов[а-я-]*)?(?![а-я])/, '🍯', 'Мёд'],
  [/карамел|(?<![а-я])ирис(?!ов)|леденц/, '🍬', 'Карамель'],   // "ирисов" = irises
  [/орех|миндал|фундук/, '🌰', 'Орехи'],
  [/бриош|хлебн|(?<![а-я])тост|дрожж/, '🥐', 'Бриошь'],
  [/сливоч|сливк|сливок/, '🧈', 'Сливочные ноты'],
  [/минерал|кремни/, '🪨', 'Минеральность'],
  [/гриб|трюфел|землист|подлеск|лесн[а-я-]* подстил/, '🍄', 'Землистые ноты'],
  [/табак|табачн/, '🍂', 'Табак'],
]

// typical profile of the style, used only when the winery's text names fewer than two notes
function styleTaste(c: { color: string, sweetness: string, category: string }): ArIcon[] {
  const sweet = ['semi_sweet', 'sweet'].includes(c.sweetness)
  const sparkling = /игрист|шампан/i.test(c.category) || ['brut', 'extra_brut'].includes(c.sweetness)
  const L = (...xs: [string, string][]) => xs.map(([icon, label]) => ({ icon, label }))
  if (c.color === 'red') return sweet ? L(['🍒', 'Вишня'], ['🍓', 'Малина'], ['🫐', 'Слива'], ['🍫', 'Шоколад'])
    : L(['🍒', 'Вишня'], ['🫐', 'Чёрная смородина'], ['🌶️', 'Специи'], ['🪵', 'Дуб'])
  if (c.color === 'rose') return L(['🍓', 'Клубника'], ['🍒', 'Черешня'], ['🍋', 'Цитрус'], ['🌼', 'Цветы'])
  if (c.color === 'orange') return L(['🍑', 'Абрикос'], ['🍊', 'Цедра'], ['🌰', 'Орехи'], ['🌿', 'Травы'])
  if (sparkling) return L(['🍏', 'Яблоко'], ['🍋', 'Цитрус'], ['🥐', 'Бриошь'], ['🌼', 'Белые цветы'])
  return sweet ? L(['🍑', 'Абрикос'], ['🍯', 'Мёд'], ['🍐', 'Груша'], ['🌼', 'Белые цветы'])
    : L(['🍏', 'Яблоко'], ['🍋', 'Цитрус'], ['🍐', 'Груша'], ['🌿', 'Травы'])
}

// sentences about serving / food are not tasting notes ("подойдёт к шоколаду" is not a chocolate note).
// "сочетается с ..." is food only when the complement is not a sensory word: "гармонично сочетаются ноты ..." and
// "в сочетании с древесными оттенками" are tasting notes, "сочетается с рыбой" and "Сочетания: ..." are not.
const SENSORY = '(?!(?:[а-я-]+\\s+){0,3}(?:друг|нот|тон|оттен|аромат|вкус|кислотн|танин|минерал|сладост|горчин|свежест))'
const NOT_TASTING = new RegExp('подав|гастроном|блюд|аперитив|закуск'
  + `|сочета(?:ет|ют|ть)ся\\s+со?\\s+${SENSORY}|сочетани[а-я]*(?::|\\s+со?\\s+${SENSORY})`
  + '|(?<![а-я])к (красн|бел|выдерж|мяс|рыб|сыр|птиц|баран|десерт|шоколад|фрукт|паст|пицц)')
// colour of the glass is not a fruit note: "вишнёвого цвета", "с гранатовыми отблесками", "цвет тёмной черешни".
// "оттенки" alone is an aroma word ("медовые оттенки", "оттенки вишни"), so it counts as colour only next to "цвет ... с"
const FRUIT_ADJ = '(?:[а-я]+-)?(?:вишнев|малинов|сливов|черешнев|клубничн|земляничн|черничн|ежевичн|смородинов|(?:персиков|абрикосов)(?=[аоуыэ])|лимонн|медов|яблочн)[а-я-]*'   // not the plural nouns "абрикосов, липового цвета"
const HUE = '(?:цвет(?:а|ом|у|е)?(?![а-я])|(?:отблеск|блик|отлив)[а-я]*)'
const COLOUR = new RegExp([
  `(?<![а-я])${FRUIT_ADJ},?(?:\\s+[а-я-]+)?\\s+${HUE}`,   // <adj> [word] цвета / отблеском
  `(?<![а-я])${HUE}(?:\\s+(?:со?|вина|мякоти))?\\s+${FRUIT_ADJ}`,   // цвет вина вишневый / цвета с вишневым
  `(?<![а-я])цвет(?:а|ом|у|е)?(?:\\s+[а-я-]+){0,3}\\s+со?\\s+(?:(?!нот|тон|аромат)[а-я-]+\\s+)?${FRUIT_ADJ}\\s+оттенк[а-я]*`,   // ... цвета с (легким) вишневым оттенком
  '(?<![а-я])цвет(?:а|ом|у|е)?\\s+(?:[а-я-]+\\s+)?(?:вишн|черешн|малин|слив|ягод)[а-я]*',   // цвет спелой вишни
].join('|'), 'g')
const BERRIES = ['Малина', 'Клубника', 'Ежевика', 'Черника', 'Вишня', 'Черешня', 'Смородина', 'Чёрная смородина']
// a generic note is dropped when the text also names a more specific one of the same kind
const SUPERSEDED: Record<string, string[]> = {
  'Смородина': ['Чёрная смородина'], 'Яблоко': ['Зелёное яблоко'], 'Ягоды': BERRIES, 'Цветы': ['Белые цветы'],
}
export function tasteFromText(...texts: (string | undefined | null)[]): ArIcon[] {
  const t = texts.filter(Boolean).join('. ').toLowerCase().replace(/ё/g, 'е')
  const body = t.split(/(?<=[.!?;])\s+/).filter(s => !NOT_TASTING.test(s)).map(s => s.replace(COLOUR, ' ')).join(' ')
  const hits: { s: number, e: number, icon: string, label: string }[] = []
  for (const [rx, icon, label] of TASTE) {          // specific patterns first: "черной смородины" is not also "смородина"
    for (const m of body.matchAll(new RegExp(rx.source, 'g'))) {
      const s = m.index!, e = s + m[0].length
      if (hits.some(h => s < h.e && e > h.s)) continue
      hits.push({ s, e, icon, label }); break
    }
  }
  return hits.filter(h => !SUPERSEDED[h.label]?.some(l => hits.some(o => o.label === l)))
    .sort((a, b) => a.s - b.s).slice(0, 5).map(({ icon, label }) => ({ icon, label }))
}

// the catalog's pairing dishes -> icon + short label
const DISH: Record<string, [string, string]> = {
  'Сыры': ['🧀', 'Сыры'], 'Рыба и морепродукты': ['🐟', 'Рыба'], 'Блюда из рыбы': ['🐟', 'Рыба'], 'Морепродукты': ['🦐', 'Морепродукты'],
  'Устрицы': ['🦪', 'Устрицы'], 'Мясо и стейки': ['🥩', 'Мясо'], 'Мясное ассорти': ['🥓', 'Мясная тарелка'], 'BBQ': ['🍖', 'Гриль'],
  'Кавказская кухня': ['🍢', 'Кавказская'], 'Блюда из птицы': ['🍗', 'Птица'], 'Легкие закуски': ['🫒', 'Закуски'], 'Лёгкие закуски': ['🫒', 'Закуски'],
  'Закуски': ['🫒', 'Закуски'], 'Салаты': ['🥗', 'Салаты'], 'Брускетты': ['🥖', 'Брускетты'], 'Паштеты': ['🥖', 'Паштеты'],
  'Паста': ['🍝', 'Паста'], 'Пицца': ['🍕', 'Пицца'], 'Средиземноморская кухня': ['🫒', 'Средиземноморская'], 'Азиатская кухня': ['🍣', 'Азиатская'],
  'Острое': ['🌶️', 'Острое'], 'Кухни народов мира': ['🌍', 'Кухни мира'], 'Русская кухня': ['🥟', 'Русская кухня'], 'Фастфуд': ['🍔', 'Фастфуд'],
  'Овощи гриль': ['🫑', 'Овощи гриль'], 'Запеченные овощи': ['🥔', 'Печёные овощи'], 'Свежие овощи': ['🥒', 'Овощи'],
  'Несладкая выпечка': ['🥨', 'Выпечка'], 'Выпечка и десерты': ['🥧', 'Выпечка'], 'Десерты': ['🍰', 'Десерты'],
  'Фруктово-ягодные десерты': ['🍓', 'Ягодные десерты'], 'Фрукты': ['🍇', 'Фрукты'], 'Шоколад': ['🍫', 'Шоколад'], 'Мороженое': ['🍨', 'Мороженое'],
}
// only 4 dishes fit on the panel, and the catalog lists them in an arbitrary order: the classic pairings of the style go first
// (red: meat; white / rosé / sparkling / orange: cheese and fish; sweet: desserts), generic items last
const LEAD: Record<'red' | 'light' | 'sweet', string[]> = {
  red: ['Мясо и стейки', 'BBQ', 'Кавказская кухня', 'Мясное ассорти', 'Блюда из птицы', 'Сыры', 'Паста', 'Паштеты', 'Пицца'],
  light: ['Сыры', 'Рыба и морепродукты', 'Блюда из рыбы', 'Морепродукты', 'Устрицы', 'Блюда из птицы', 'Паста'],
  sweet: ['Десерты', 'Фруктово-ягодные десерты', 'Выпечка и десерты', 'Фрукты', 'Сыры', 'Шоколад', 'Мороженое'],
}
const GENERIC_DISH = new Set(['Легкие закуски', 'Лёгкие закуски', 'Закуски', 'Салаты', 'Овощи гриль', 'Запеченные овощи', 'Свежие овощи', 'Кухни народов мира', 'Фастфуд'])
export function pairsFor(dishes: string[] = [], c: { color?: string, sweetness?: string } = {}): ArIcon[] {
  const lead = LEAD[['semi_sweet', 'sweet'].includes(c.sweetness || '') ? 'sweet' : c.color === 'red' ? 'red' : 'light']
  const rank = (d: string) => { const i = lead.indexOf(d); return i >= 0 ? i : GENERIC_DISH.has(d) ? 200 : 100 }
  const out: ArIcon[] = []
  for (const d of [...(dishes || [])].sort((a, b) => rank(a) - rank(b))) {   // stable: the catalog order decides within a tier
    const p = DISH[d]
    if (p && !out.some(o => o.label === p[1])) out.push({ icon: p[0], label: p[1] })
  }
  return out.slice(0, 4)
}

const cache = new Map<string, ArCard | null>()
export async function arCard(slug: string): Promise<ArCard | null> {
  if (cache.has(slug)) return cache.get(slug)!
  const c = await card(slug)
  let r: ArCard | null = null
  if (c) {
    const notes = (c.extra?.notes || []).map(n => n.text)
    const found = tasteFromText(c.description, ...notes)
    const fromStyle = found.length < 2
    r = { slug: c.slug, title: c.title, manufacturer: c.manufacturer, year: c.year || '', category: c.category, color: c.color,
      sweetness: c.sweetness, region: c.region, geo: REGION_GEO[c.region] ?? null, grapes: (c.grapes || []).slice(0, 3),
      alcohol: c.alcohol ?? null, rating: c.rating ?? null, img: c.img, temperature: c.temperature || '',
      taste: fromStyle ? styleTaste(c) : found, tasteFromStyle: fromStyle, pairs: pairsFor(c.dishes, c) }
  }
  cache.set(slug, r)
  return r
}
