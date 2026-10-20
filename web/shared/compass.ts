// «Винный компас»: a route of 6 wine styles for someone who knows nothing about wine. Each step is a STYLE (not a bottle):
// the user tries any wine of it, says «как вам?», and the liked styles become his taste. On a shelf photo the scanner picks
// the bottle most typical for the current step, so the route works in any shop (no stock data needed).
// The examples are reliable, widely sold wines of the catalog (guide score, medals, mass brands, price) — ideas/starter_pack.md.
// Shared by the compass page (client) and POST /api/wines/shelf-meta (server).

export interface CompassStep {
  key: string
  n: number
  title: string          // everyday words, no wine jargon
  plain: string          // what it tastes like
  notice: string         // what to pay attention to while tasting
  pair?: string          // the step it is contrasted with
  examples: string[]     // catalog slugs: typical, reliable, easy to find
}

export const STEPS: CompassStep[] = [
  { key: 'semisweet_red', n: 1, title: 'Сладкое красное', plain: 'Сладкое, как компот, без кислинки',
    notice: 'С него проще начать: вино без горчинки и кислоты. Запомните, нравится ли вам сладость.',
    examples: ['inkermanskiy-zmv-winemakers-selection-saperavi-krasnoe-polusladkoe-12', 'usadba-aleksandrovskaya-bubnovyy-valet-kaberne-sovinon-krasnoe-polusladkoe-13',
      'derbent-vino-di-kaspiko-merlo-krasnoe-polusladkoe-11', 'soyuz-vino-lavetti-krasnoe-polusladkoe-krasnye-sorta-vinograda-11'] },
  { key: 'light_red', n: 2, title: 'Лёгкое красное', plain: 'Не сладкое, ягодное, почти не вяжет', pair: 'bold_red',
    notice: 'Почувствуйте вишню и малину. Во рту легко, язык почти не стягивает.',
    examples: ['abrau-dyurso-pino-nuar-krasnoe-suhoe-12', 'fanagoriya-100-ottenkov-krasnogo-pino-nuar-krasnoe-suhoe-135',
      'golubitskoe-estate-pino-nuar-rezerv-krasnoe-suhoe-132', 'belbek-belbek-pino-nuar-krasnoe-suhoe-13'] },
  { key: 'bold_red', n: 3, title: 'Густое красное', plain: 'Не сладкое, тёмные ягоды, вяжет, как крепкий чай', pair: 'light_red',
    notice: 'Сравните с лёгким красным: вкус плотнее, а во рту немного вяжет — это танины, как в крепком чае.',
    examples: ['fanagoriya-formula-q-kaberne-sovinon-krasnoe-suhoe-135', 'imenie-sikory-kaberne-sovinon-semeynyy-rezerv-krasnoe-suhoe-14',
      'pomeste-golubitskoe-kaberne-sovinon-rezerv-krasnoe-suhoe-143', 'fanagoriya-cru-lermont-saperavi-saperavi-krasnoe-suhoe-135'] },
  { key: 'fresh_white', n: 4, title: 'Свежее белое', plain: 'Не сладкое, с кислинкой, как зелёное яблоко', pair: 'soft_white',
    notice: 'Охладите получше. Кислинка освежает, как лимон в воде: нравится она вам или кажется резкой?',
    examples: ['abrau-dyurso-risling-beloe-suhoe-13', 'golubitskoe-estate-sovinon-blan-beloe-suhoe-11',
      'solnechnaya-dolina-meganom-beloe-aligote-suhoe-13', 'imenie-sikory-sovinon-blan-sikory-beloe-suhoe-13'] },
  { key: 'soft_white', n: 5, title: 'Мягкое белое', plain: 'Чуть сладкое, фруктовое, без резкости', pair: 'fresh_white',
    notice: 'Сравните со свежим белым: сладость чуть заметна, кислинка мягче, во вкусе персик и груша.',
    examples: ['polusuhoe-beloe-zolotaya-balka', 'vinodelnya-myshako-risling-mode-kabinett-beloe-polusuhoe-126',
      'fanagoriya-zelyonoe-vino-risling-tsitronnyy-magaracha-beloe-polusuhoe-11', 'esse-nectar-muscat-muskat-belyy-beloe-polusuhoe-12'] },
  { key: 'brut', n: 6, title: 'Игристое', plain: 'Пузырьки, не сладкое, свежее', notice: 'Брют — это не сладкое игристое. Если покажется кислым, в следующий раз возьмите полусухое.',
    examples: ['abrau-dyurso-victor-dravigny-bryut', 'abrau-dyurso-brut-dor-blanc-de-blancs-shardone-beloe-bryut-12',
      'fanagoriya-blanc-de-blancs-shardone-beloe-bryut-12', 'inkermanskiy-zmv-inkerman-bryut-shardone-beloe-135'] },
]
export const stepByKey = (k?: string | null) => STEPS.find(s => s.key === k)

export type Verdict = 'like' | 'meh' | 'no'
export const VERDICTS: { id: Verdict, label: string }[] = [{ id: 'like', label: 'Понравилось' }, { id: 'meh', label: 'Нейтрально' }, { id: 'no', label: 'Не моё' }]
export const REASONS = ['Слишком сладко', 'Слишком кисло', 'Горчит, вяжет', 'Тяжёлое, крепкое', 'Скучное']

export interface CompassWine { slug?: string, title?: string, category?: string, color?: string, sweetness?: string, grapes?: string[], alcohol?: number | null, text?: string }
export interface CompassFit { fits: boolean, score: number, why: string[] }

const LIGHT = ['Пино Нуар', 'Пино нуар', 'Цвайгельт', 'Гаме', 'Гамэ', 'Пино Менье']
const MID = ['Мерло']
const BOLD = ['Каберне Совиньон', 'Саперави', 'Красностоп', 'Сира', 'Шираз', 'Мальбек', 'Цимлянский черный', 'Цимлянский чёрный']
const FRESH = ['Рислинг', 'Совиньон Блан', 'Алиготе', 'Сильванер', 'Ркацители', 'Кокур', 'Пино Блан', 'Грюнер Вельтлинер', 'Сибирьковый', 'Цитронный Магарача']
// «Victor Dravigny» is Абрау-Дюрсо's sparkling line, though the catalog files its semi-sweet red as a still «Красное полусладкое»
const SPARK_RE = /игрист|шампанск|спуманте|spumante|frizzante|петнат|pet[- ]?nat|dravigny/i
const ODD_RE = /оранж|петнат|пет-нат|pet-nat|натурал|амфор|квеври|креплён|кагор|портвейн|херес|мадер/i
const OAK_RE = /дуб|бочк|баррик|выдерж/i
const has = (gs: string[], list: string[]) => gs.some(g => list.some(x => g.toLowerCase().startsWith(x.toLowerCase())))
const all = (gs: string[], list: string[]) => gs.length > 0 && gs.every(g => list.some(x => g.toLowerCase().startsWith(x.toLowerCase())))
const kw = (t: string, words: string[]) => words.filter(w => t.includes(w)).length

/** how well a wine fits a step: hard style rule (colour, sweetness, sparkling) + typicality (grapes, words, strength) */
export function compassFit(step: CompassStep, w: CompassWine): CompassFit {
  const gs = w.grapes || [], t = `${w.title || ''} ${w.category || ''} ${w.text || ''}`.toLowerCase()
  const sparkling = ['brut', 'extra_brut'].includes(w.sweetness || '') || SPARK_RE.test(`${w.title || ''} ${w.category || ''}`)
  let al = w.alcohol || 0; if (al > 30) al /= 10                 // «135» in the source data = 13.5 %
  const no = (why: string): CompassFit => ({ fits: false, score: 0, why: [why] })
  if (ODD_RE.test(t)) return no('необычный стиль')
  const why: string[] = []; let s = 1
  switch (step.key) {
    case 'semisweet_red':
      if (w.color !== 'red' || sparkling) return no('не красное тихое')
      if (w.sweetness !== 'semi_sweet') return no(w.sweetness === 'sweet' ? 'слишком сладкое' : 'не полусладкое')
      why.push('красное полусладкое')
      if (has(gs, [...BOLD, ...MID])) { s += 0.5; why.push(`сорт ${gs[0]}`) }
      break
    case 'light_red':
      if (w.color !== 'red' || sparkling || w.sweetness !== 'dry') return no('не красное сухое')
      if (all(gs, LIGHT)) { s += 2; why.push(`${gs[0]} — лёгкий сорт`) }
      else if (all(gs, [...LIGHT, ...MID]) && !OAK_RE.test(t)) { s += 1; why.push(`${gs[0]}, без выдержки в дубе`) }
      else return no('плотный сорт')
      if (al && al >= 14) return no('слишком крепкое для лёгкого')
      s += 0.3 * kw(t, ['легк', 'мягк', 'шелковист', 'вишн', 'малин', 'клубник'])
      break
    case 'bold_red':
      if (w.color !== 'red' || sparkling || w.sweetness !== 'dry') return no('не красное сухое')
      if (!has(gs, BOLD)) return no('лёгкий сорт')
      s += 2; why.push(`${gs.find(g => has([g], BOLD))} — плотный сорт`)
      if (al >= 13) s += 0.3
      s += 0.3 * kw(t, ['насыщ', 'танин', 'плотн', 'полнотел', 'ежевик', 'смородин', 'бархат'])
      break
    case 'fresh_white':
      if (w.color !== 'white' || sparkling || w.sweetness !== 'dry') return no('не белое сухое')
      if (!has(gs, FRESH)) return no('не свежий сорт')
      s += 2; why.push(`${gs.find(g => has([g], FRESH))} — свежий сорт`)
      if (OAK_RE.test(t)) { s -= 1; why.push('с выдержкой в дубе') }
      s += 0.3 * kw(t, ['свеж', 'кислотн', 'цитрус', 'лимон', 'яблок', 'грейпфрут', 'минерал'])
      break
    case 'soft_white':
      if (w.color !== 'white' || sparkling) return no('не белое тихое')
      if (w.sweetness !== 'semi_dry') return no(w.sweetness === 'dry' ? 'сухое, не мягкое' : 'слишком сладкое')
      why.push('белое полусухое')
      s += 0.3 * kw(t, ['мягк', 'округл', 'персик', 'абрикос', 'дын', 'фрукт', 'мед'])
      break
    case 'brut':
      if (!['brut', 'extra_brut'].includes(w.sweetness || '') || !['white', 'rose'].includes(w.color || '')) return no('не игристое брют')
      s += w.sweetness === 'brut' ? 1 : 0.4; why.push(w.sweetness === 'brut' ? 'игристое брют' : 'экстра брют — суше обычного')
      break
  }
  return { fits: true, score: Math.round(s * 100) / 100, why }
}

/** the taste conclusion of the route: liked / disliked steps -> words */
export function compassSummary(answers: Record<string, { verdict: Verdict }>) {
  const like = STEPS.filter(s => answers[s.key]?.verdict === 'like'), no = STEPS.filter(s => answers[s.key]?.verdict === 'no')
  return { like, no, done: STEPS.filter(s => answers[s.key]).length }
}
