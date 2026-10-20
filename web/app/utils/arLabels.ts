// Live label tracking (/scan/ar): every front-row bottle's LABEL is followed on the device and carries a panel on its plane.
// Detection only on the server (RF-DETR-Seg masks, /api/ar/detect, ~0.4–1 s); everything else here, per video frame:
//  - label zone from the bottle mask: the shoulder line is where the silhouette reaches full body width, the label is the body
//    below it without the curved side bands (highlights); bottles cut by the frame edge or hidden behind others are skipped;
//  - latency compensation is exact: a new label's tracker starts on the very frame that was sent and replays the buffered frames
//    up to now, so it joins the live view already aligned;
//  - consistency: at every answer each track must coincide with a detected zone (IoU > 0.5 on the sent frame), two misses = gone;
//    a sheared quad (angles outside 65–115°) is not accepted; a fresh zone clearly bigger than a track there replaces it;
//  - panel corners are One-Euro filtered in screen space; tracks appear after 5 reliable frames and fade out when they end.
import { FramePyramids, I3, OneEuro, PlanarTracker, apply, h4, inv3, mul3, type M3, type Pt } from '~/utils/arPlanar'

export interface Det { bbox: number[], polygon?: number[][] | null }
/** what the recognizer said about a bottle (live AR with recognition); absent in the pure tracking demo */
export interface Meta { status: 'found' | 'not_found', slug: string | null, read?: Record<string, any> }
export interface Ident { status: 'pending' | 'found' | 'not_found', slug: string | null, read: Record<string, any>, votes: string[] }
const box = (q: Pt[]) => [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))]
const area = (b: number[]) => Math.max(1e-6, (b[2]! - b[0]!) * (b[3]! - b[1]!))
function overlap(a: number[], b: number[]) {   // max(IoU, 0.6 * intersection / smaller): a fragment inside a label counts as the same label
  const i = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!)) * Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!))
  return Math.max(i / (area(a) + area(b) - i), 0.6 * i / Math.min(area(a), area(b)))
}
const iou = (a: number[], b: number[]) => { const i = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!)) * Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!)); return i / (area(a) + area(b) - i) }
function square(q: Pt[]) {
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!, c = q[(i + 3) % 4]!
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - a[0], vy = c[1] - a[1]
    if (Math.abs((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1)) > 0.4226) return false   // cos 65°
  }
  return true
}

/** label quad (TL, TR, BR, BL) from a bottle mask polygon, in the polygon's pixel frame; null = no usable label zone.
 *  A bottle that leans in the image (phone held at a roll) gets its zone along the bottle axis, not along the frame axes. */
export function labelZone(poly: number[][] | undefined, W: number, H: number): Pt[] | null {
  if (!poly || poly.length < 3) return null
  const ys = poly.map(p => p[1]!), xs = poly.map(p => p[0]!)
  if (Math.max(...ys) >= H - 3 || Math.min(...xs) <= 2 || Math.max(...xs) >= W - 3) return null   // cut by the frame: partial label
  const z = uprightZone(poly, W)
  if (!z || Math.abs(z.slope) < 0.035 || Math.abs(z.slope) > 0.6) return z && z.q      // < 2°: as is; > 30°: not a standing bottle
  const a = Math.atan(z.slope), c = Math.cos(a), s = Math.sin(a)
  const cx = xs.reduce((u, v) => u + v, 0) / xs.length, cy = ys.reduce((u, v) => u + v, 0) / ys.length
  const rot = (p: number[], k: number): Pt => { const x = p[0]! - cx, y = p[1]! - cy; return [cx + x * c - k * y * s, cy + k * x * s + y * c] }
  const r = uprightZone(poly.map(p => rot(p, 1)), W)                   // axis made vertical, zone found, turned back
  return r && r.q.map(p => rot(p, -1))
}
function uprightZone(poly: number[][], W: number): { q: Pt[], slope: number } | null {
  const ys = poly.map(p => p[1]!)
  const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys)), h = y1 - y0
  if (h < 60) return null
  // scanline extents of the silhouette
  const L: number[] = [], R: number[] = []
  for (let y = y0; y <= y1; y++) {
    const hits: number[] = []
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i] as [number, number], [bx, by] = poly[(i + 1) % poly.length] as [number, number]
      if ((ay <= y && by > y) || (by <= y && ay > y)) hits.push(ax + (y - ay) * (bx - ax) / (by - ay))
    }
    L.push(hits.length ? Math.min(...hits) : NaN); R.push(hits.length ? Math.max(...hits) : NaN)
  }
  const wd = L.map((l, i) => (Number.isNaN(l) ? 0 : R[i]! - l)), full = [...wd].sort((a, b) => a - b)[Math.floor(wd.length * 0.9)]!
  const sh = wd.findIndex(w => w >= 0.75 * full)                      // shoulder line
  if (sh < 0) return null
  const top = y0 + sh + 0.07 * h, bot = y1 - 0.04 * h
  if (bot - top < 0.15 * h) return null
  const rows = [], lefts = [], rights = []
  for (let y = Math.ceil(top); y < bot; y++) { const i = y - y0; if (!Number.isNaN(L[i]!)) { rows.push(y); lefts.push(L[i]!); rights.push(R[i]!) } }
  if (!rows.length) return null
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1]!
  const l = med(lefts), r = med(rights), inset = 0.12 * (r - l)
  const q: Pt[] = [[l + inset, top], [r - inset, top], [r - inset, bot], [l + inset, bot]]
  if (q[1]![0] - q[0]![0] < 0.1 * W || (bot - top) / (q[1]![0] - q[0]![0]) > 3.2) return null   // a sliver of a hidden bottle
  // bottle axis: least-squares line x = slope * y + b through the body's row midpoints
  let n = 0, my = 0, mx = 0, syy = 0, sxy = 0
  for (let i = 0; i < rows.length; i++) { const x = (lefts[i]! + rights[i]!) / 2, y = rows[i]!; n++; my += y; mx += x; syy += y * y; sxy += x * y }
  const vy = syy - my * my / n
  return { q, slope: vy > 1e-6 ? (sxy - mx * my / n) / vy : 0 }
}

/** label zones of the front row: tall bottles, the wider of two overlapping boxes (the other one stands behind it);
 *  idx = index of the detection the zone came from (to carry its recognition result) */
export function frontZonesIdx<T extends Det>(dets: T[], W: number, H: number): { quad: Pt[], det: T }[] {
  const tall = dets.filter(d => d.bbox.length === 4 && d.bbox[3]! - d.bbox[1]! >= 0.4 * H)
  const front = tall.filter(d => !tall.some(o => o !== d && iou(o.bbox, d.bbox) > 0.25 && o.bbox[2]! - o.bbox[0]! > d.bbox[2]! - d.bbox[0]!))
  return front.map(d => ({ quad: labelZone(d.polygon || undefined, W, H), det: d })).filter((z): z is { quad: Pt[], det: T } => !!z.quad)
}
export const frontZones = (dets: Det[], W: number, H: number): Pt[][] => frontZonesIdx(dets, W, H).map(z => z.quad)

// one physical bottle, many answers: the first recognised wine shows at once, a different one needs two answers in a row,
// a recognised bottle keeps its name through blurry frames (5 "not found" in a row to drop it)
function vote(id: Ident, m: Meta) {
  const v = m.status === 'found' && m.slug ? m.slug : ''
  id.votes = [...id.votes, v].slice(-5)
  if (m.read && Object.values(m.read).some(x => x != null && x !== '')) id.read = m.read
  const last = id.votes.slice(-2)
  if (!id.slug) {
    if (v) { id.slug = v; id.status = 'found' } else if (last.length === 2 && last.every(x => x === '')) id.status = 'not_found'
  } else if (v && v !== id.slug && last.length === 2 && last[0] === v) id.slug = v
  else if (id.votes.length === 5 && id.votes.every(x => x === '')) { id.slug = null; id.status = 'not_found' }
}

export interface LabelView { id: number, matrix: string, opacity: number, corners: string, ident: Ident, cx: number, cy: number }
interface Track {
  id: number, tracker: PlanarTracker, quad0: Pt[], panel0: Pt[], hist: Map<number, M3>, good: number, shown: boolean,
  miss: number, lost: number, opacity: number, dying: boolean, filt: OneEuro, last: Pt[] | null, corners: Pt[] | null, ident: Ident
}

export class LabelTracks {
  tracks: Track[] = []
  frame = 0
  stat: Record<string, number> = { zones: 0, overlap: 0, failStart: 0, failReplay: 0, noRing: 0, born: 0 }
  private ring = new Map<number, Uint8Array>()
  private next = 1
  constructor(public pyr: FramePyramids, private panelAspect = 0.64, private keep = 90, public model: 'similarity' | 'homography' = 'similarity',
              private histKeep = 300) {}   // track positions are kept longer than frames: a slow recognition answer can still name its track

  /** every video frame: gray copy of the viewfinder (pyr size) */
  push(gray: Uint8Array) {
    this.frame++
    this.pyr.push(gray)
    this.ring.set(this.frame, gray); this.ring.delete(this.frame - this.keep)
    for (const t of this.tracks) {
      if (t.dying) continue
      let ok = t.tracker.track()
      if (!ok) this.stat.trkFail = (this.stat.trkFail || 0) + 1
      if (ok && !square(t.quad0.map(p => apply(t.tracker.H, p[0], p[1])))) { ok = false; this.stat.shear = (this.stat.shear || 0) + 1 }
      if (ok) t.hist.set(this.frame, t.tracker.H.slice())
      t.hist.delete(this.frame - this.histKeep)
      t.lost = ok ? 0 : t.lost + 1; t.good = ok ? t.good + 1 : 0
      if (t.good >= 5) t.shown = true
      if (t.lost > 6) t.dying = true
    }
  }

  /** a recognition answer (slow, ~1–5 s) for the frame `sent`: only names the tracks that were on those zones then —
   *  no births, no kills (the fast detection loop owns the tracks) */
  name(sent: number, zones: Pt[][], metas: (Meta | null)[]) {
    for (const t of this.tracks) {
      if (t.dying) continue
      const M = t.hist.get(sent); if (!M) continue
      const b = box(t.quad0.map(p => apply(M, p[0], p[1])))
      let bi = -1, bv = 0.4
      zones.forEach((z, i) => { const v = iou(box(z), b); if (v > bv) { bv = v; bi = i } })
      if (bi >= 0 && metas[bi]) vote(t.ident, metas[bi]!)
    }
  }

  /** a detection answer for the frame `sent` (zones in pyr pixels) */
  private lastSent = 0
  dbgZones: Pt[][] = []                                                 // the last answer's label zones (debug overlay)
  answer(sent: number, zones: Pt[][], bottles: number[][] = [], metas: (Meta | null)[] = []) {
    if (sent <= this.lastSent) return                                    // overlapping requests: a late older answer is stale
    this.lastSent = sent
    this.dbgZones = zones
    const at = (t: Track, k: number) => { const M = t.hist.get(k); return M ? box(t.quad0.map(p => apply(M, p[0], p[1]))) : null }
    for (const t of this.tracks) {
      if (t.dying) continue
      const b = at(t, sent)
      if (!b) continue                                                   // born after that frame
      // supported by a label zone, or at least by a detected bottle around it (its zone may be skipped: edge, partly hidden)
      const cx = (b[0]! + b[2]!) / 2, cy = (b[1]! + b[3]!) / 2
      let bi = -1, bv = 0.5
      zones.forEach((z, i) => { const v = iou(box(z), b); if (v > bv) { bv = v; bi = i } })
      if (bi >= 0 && metas[bi]) vote(t.ident, metas[bi]!)              // this answer names this bottle
      // drifted (still the same bottle, but off its label): re-anchor on the fresh zone, keeping the id, name and smoothing
      // (cheap: the zone is carried from the sent frame to now by the track's own motion, the tracker restarts on the live frame)
      if (bi >= 0 && bv < 0.8 && t.lost === 0) {
        const Hs = t.hist.get(sent), Hsi = Hs && inv3(Hs)
        if (Hsi) {
          const M = mul3(t.tracker.H, Hsi), q = zones[bi]!.map(p => apply(M, p[0], p[1]))
          const tr = new PlanarTracker(this.pyr, undefined, this.model); tr.start(q)
          if (tr.ok && square(q)) {
            t.tracker = tr; t.quad0 = q; t.panel0 = this.panelFor(q); t.hist = new Map([[this.frame, I3()]])
            this.stat.reanchor = (this.stat.reanchor || 0) + 1
          }
        }
      }
      const ok = bi >= 0 || bottles.some(d => cx > d[0]! && cx < d[2]! && cy > d[1]! && cy < d[3]!)
      t.miss = ok ? 0 : t.miss + 1
      if (t.miss >= 2) t.dying = true                                    // drifted off its label
    }
    for (const [zi, z] of zones.entries()) {
      const zb = box(z)
      const over = this.tracks.filter(t => !t.dying && (() => { const b = at(t, sent) || at(t, this.frame); return b && overlap(b, zb) > 0.15 })())
      this.stat.zones++
      if (over.some(t => { const b = at(t, sent) || at(t, this.frame)!; return area(b) * 1.6 > area(zb) })) { this.stat.overlap++; continue }
      over.forEach(t => (t.dying = true))                                // a partial-label track replaced by the full zone
      const t = this.born(sent, z)
      if (t) { t.id = this.next++; if (metas[zi]) vote(t.ident, metas[zi]!); this.tracks.push(t); this.stat.born++ }
    }
  }

  private born(sent: number, z: Pt[]): Track | null {
    if (!this.ring.has(sent)) { this.stat.noRing++; return null }
    // replay from the sent frame to now on a private pyramid, then continue on the live one
    const rp = new FramePyramids(this.pyr.w, this.pyr.h)
    const tr = new PlanarTracker(rp, undefined, this.model), hist = new Map<number, M3>()
    let fails = 0
    for (let k = sent; k <= this.frame; k++) {
      const g = this.ring.get(k); if (!g) return null
      rp.push(g)
      if (k === sent) { tr.start(z); if (!tr.ok) { this.stat.failStart++; return null } hist.set(k, [1, 0, 0, 0, 1, 0, 0, 0, 1]) }
      else if (tr.track() && square(z.map(p => apply(tr.H, p[0], p[1])))) hist.set(k, tr.H.slice())
      else if (++fails > 2) { this.stat.failReplay++; return null }       // a blurred frame or two during the catch-up is fine
    }
    tr.pyr = this.pyr
    return { id: 0, tracker: tr, quad0: z, panel0: this.panelFor(z), hist, good: hist.size, shown: hist.size >= 5, miss: 0, lost: 0, opacity: 0, dying: false,
      filt: new OneEuro(1.0, 0.02), last: null, corners: null, ident: { status: 'pending', slug: null, read: {}, votes: [] } }
  }

  /** the panel above a label quad, parallel to its top edge */
  private panelFor(z: Pt[]): Pt[] {
    const [tl, trr, , bl] = z as [Pt, Pt, Pt, Pt]
    const ex: Pt = [trr[0] - tl[0], trr[1] - tl[1]], lw = Math.hypot(ex[0], ex[1]); ex[0] /= lw; ex[1] /= lw
    const up: Pt = [tl[0] - bl[0], tl[1] - bl[1]], ul = Math.hypot(up[0], up[1]); up[0] /= ul; up[1] /= ul
    const W0 = 1.1 * lw, H0 = W0 * this.panelAspect, gap = 0.012 * this.pyr.w
    const mid: Pt = [(tl[0] + trr[0]) / 2 + up[0] * gap, (tl[1] + trr[1]) / 2 + up[1] * gap]
    const a: Pt = [mid[0] - ex[0] * W0 / 2, mid[1] - ex[1] * W0 / 2], b: Pt = [mid[0] + ex[0] * W0 / 2, mid[1] + ex[1] * W0 / 2]
    return [[a[0] + up[0] * H0, a[1] + up[1] * H0], [b[0] + up[0] * H0, b[1] + up[1] * H0], b, a]
  }

  /** screen state: s = pyr px per screen px; panel element size (CSS px) for the matrix */
  //  up(x, y): the true vertical at a screen point (phone sensors) — when given, the label rectangle and its panel
  //  are rebuilt square to it around the tracked label (centre and size from the tracker, rotation from gravity)
  view(s: number, ts: number, pw: number, ph: number, up?: (x: number, y: number) => Pt | null): LabelView[] {
    const out: LabelView[] = []
    for (const t of this.tracks) {
      const target = t.shown && !t.dying && t.lost <= 3 ? 1 : 0
      t.opacity += (target - t.opacity) * (target ? 0.25 : 0.2)
      const M = t.tracker.H
      if (!t.dying && t.lost === 0) {
        let pts = [...t.panel0, ...t.quad0].map(p => apply(M, p[0], p[1])).map(p => [p[0] / s, p[1] / s] as Pt)
        const q = pts.slice(4), C: Pt = [q.reduce((a, p) => a + p[0], 0) / 4, q.reduce((a, p) => a + p[1], 0) / 4]
        const U = up?.(C[0], C[1])
        if (U) {
          const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
          const w = (d(q[0]!, q[1]!) + d(q[3]!, q[2]!)) / 2, h = (d(q[0]!, q[3]!) + d(q[1]!, q[2]!)) / 2
          const R: Pt = [-U[1], U[0]], at = (o: Pt, r: number, u: number): Pt => [o[0] + R[0] * r + U[0] * u, o[1] + R[1] * r + U[1] * u]
          const W0 = 1.1 * w, H0 = W0 * this.panelAspect, mid = at(C, 0, h / 2 + 0.012 * this.pyr.w / s)
          pts = [at(mid, -W0 / 2, H0), at(mid, W0 / 2, H0), at(mid, W0 / 2, 0), at(mid, -W0 / 2, 0),
            at(C, -w / 2, h / 2), at(C, w / 2, h / 2), at(C, w / 2, -h / 2), at(C, -w / 2, -h / 2)]
        }
        const raw = pts.flat()
        const f = t.filt.filter(raw, ts)
        t.last = [0, 1, 2, 3].map(i => [f[2 * i]!, f[2 * i + 1]!] as Pt)
        t.corners = [4, 5, 6, 7].map(i => [f[2 * i]!, f[2 * i + 1]!] as Pt)
      }
      if (!t.last || !t.corners || t.opacity < 0.02) continue
      const Hm = h4([[0, 0], [pw, 0], [pw, ph], [0, ph]], t.last)
      if (!Hm) continue
      const cx = t.corners.reduce((a, p) => a + p[0], 0) / 4, cy = t.corners.reduce((a, p) => a + p[1], 0) / 4
      out.push({ id: t.id, matrix: `matrix3d(${Hm[0]},${Hm[3]},0,${Hm[6]},${Hm[1]},${Hm[4]},0,${Hm[7]},0,0,1,0,${Hm[2]},${Hm[5]},0,${Hm[8]})`, opacity: t.opacity,
        corners: brackets(t.corners), ident: t.ident, cx, cy })
    }
    this.tracks = this.tracks.filter(t => !(t.dying && t.opacity < 0.02))
    // a track lying mostly inside a bigger visible one is a duplicate on the same bottle
    return out.filter(v => { const t = this.tracks.find(x => x.id === v.id); if (!t?.corners) return true; const b = box(t.corners)
      return !this.tracks.some(o => o !== t && o.corners && !o.dying && area(box(o.corners)) > area(b) && overlap(box(o.corners), b) >= 0.3 && (Math.max(0, Math.min(b[2]!, box(o.corners)[2]!) - Math.max(b[0]!, box(o.corners)[0]!)) * Math.max(0, Math.min(b[3]!, box(o.corners)[3]!) - Math.max(b[1]!, box(o.corners)[1]!))) > 0.5 * area(b)) })
  }
}

function brackets(q: Pt[]) {
  let d = ''
  for (let i = 0; i < 4; i++) {
    const [x, y] = q[i]!
    for (const [nx, ny] of [q[(i + 1) % 4]!, q[(i + 3) % 4]!]) {
      const L = Math.hypot(nx - x, ny - y) || 1, k = Math.min(0.22, 14 / L)
      d += `M${x + (nx - x) * k},${y + (ny - y) * k} L${x},${y} `
    }
  }
  return d
}
