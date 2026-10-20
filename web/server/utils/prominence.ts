// Which detected bottles the result screen marks. The ML service returns every bottle it sees; here we keep only what the
// user photographed: the primary bottle (ML: crosses the vertical centre line, tall enough) and, if several similar bottles
// stand in the front row, those too. Bottles cut off by the left/right frame edge and small background bottles are not marked.
import type { Bottle } from './recognizer'

const DOMINANCE = 2.0        // primary at least this many times more prominent than any other candidate -> show only it
const FRONT_PROMINENCE = 0.4 // front-row bottle: prominence >= 40 % of the best one ...
const FRONT_HEIGHT = 0.6     // ... and bbox height >= 60 % of the primary's (background bottles look smaller)
const EDGE = 0.01            // bbox within 1 % of the left/right edge = cut off by the frame
const MAX_SHOWN = 6
const SHELF_MIN = 4           // >= this many detected bottles = a shelf photo: every bottle is marked (the user scans the whole shelf)
const SHELF_MAX = 32

export function pickDisplay(bottles: Bottle[], image: { width: number, height: number } | null, primary: number) {
  const single = (i: number) => ({ display: [i], layout: 'single' as const })
  // the ML service made a centre-crop / whole-frame pseudo bottle the primary (no detected bottle crosses the centre):
  // the user aimed at the centre, so mark only it, never the cut-off bottles at the edges
  if (bottles[primary]?.source === 'full_image') return single(primary)
  const real = bottles.map((b, i) => ({ b, i })).filter(x => x.b.bbox?.length === 4 && x.b.source !== 'full_image')
  if (!image || real.length <= 1) return single(real.some(x => x.i === primary) ? primary : real[0]?.i ?? primary)
  if (real.length >= SHELF_MIN) return { display: real.slice(0, SHELF_MAX).map(x => x.i), layout: 'multi' as const }
  const { width: W, height: H } = image
  const half = Math.hypot(W, H) / 2
  const s = real.map(({ b, i }) => {
    const [x1, y1, x2, y2] = b.bbox as [number, number, number, number]
    const d = Math.hypot((x1 + x2) / 2 - W / 2, (y1 + y2) / 2 - H / 2) / half
    return { i, h: y2 - y1, cut: x1 <= EDGE * W || x2 >= (1 - EDGE) * W, p: ((x2 - x1) * (y2 - y1)) / (W * H) * (1 - 0.5 * d) }
  })
  const pr = s.find(x => x.i === primary) ?? s.reduce((a, c) => (c.p > a.p ? c : a))
  const others = s.filter(x => x.i !== pr.i && !x.cut)
  const next = others.reduce((m, x) => Math.max(m, x.p), 0)
  if (next * DOMINANCE <= pr.p) return single(pr.i)
  const best = Math.max(pr.p, next)
  const front = others.filter(x => x.p >= FRONT_PROMINENCE * best && x.h >= FRONT_HEIGHT * pr.h)
    .sort((a, c) => c.p - a.p).slice(0, MAX_SHOWN - 1)
  if (!front.length) return single(pr.i)
  return { display: [pr.i, ...front.map(x => x.i)].sort((a, c) => a - c), layout: 'multi' as const }   // left -> right (ML order)
}
