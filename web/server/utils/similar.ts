import type { WineItem } from './catalog'

// Style similarity used for "similar wines", "analogs from other wineries" and the not-found fallback.
// Colour and sweetness define the style (a gift mistake "dry instead of semi-sweet" is the most common one), then grapes and region.
export function styleScore(a: Partial<WineItem>, b: WineItem): number {
  let s = 0
  if (a.color && a.color === b.color) s += 3
  if (a.sweetness && a.sweetness === b.sweetness) s += 3
  const ga = new Set((a.grapes || []).map(g => g.toLowerCase()))
  const shared = b.grapes.filter(g => ga.has(g.toLowerCase())).length
  s += Math.min(shared, 2) * 2
  if (a.region && a.region === b.region) s += 1
  return s + (b.rating || 0) / 5
}

// keep shelves varied: at most `perMaker` wines of one winery
export function diversify<T extends { manufacturer: string }>(items: T[], limit: number, perMaker = 2): T[] {
  const n = new Map<string, number>(), out: T[] = []
  for (const w of items) {
    if ((n.get(w.manufacturer) || 0) >= perMaker) continue
    n.set(w.manufacturer, (n.get(w.manufacturer) || 0) + 1); out.push(w)
    if (out.length >= limit) break
  }
  return out
}

export function rankSimilar(ref: Partial<WineItem>, items: WineItem[], opts: { excludeSlug?: string, otherWineries?: boolean, limit?: number } = {}) {
  const ranked = items
    .filter(w => w.slug !== opts.excludeSlug && (!opts.otherWineries || !ref.manufacturer || w.manufacturer !== ref.manufacturer))
    .map(w => ({ w, s: styleScore(ref, w) }))
    .filter(x => x.s >= 4)
    .sort((x, y) => y.s - x.s)
    .map(x => x.w)
  return diversify(ranked, opts.limit ?? 12)
}
