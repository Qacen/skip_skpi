// Live AR (/scan/ar): detect-then-track. The server answers in 0.4–1.6 s, so between answers every bottle box is moved on the
// phone by template matching on a small grayscale copy of the viewfinder (~192x416, ~1–2 ms per frame):
//   - every track keeps an ANCHOR (the frame + box at the moment its position was known: server answer or last renewal) and each
//     video frame is matched against that anchor, not against the previous frame. Slow motion (< 1 px/frame) therefore adds up
//     instead of being rounded away, and errors do not pile up from frame to frame; the anchor is renewed after ~6 px / 20 frames;
//   - the camera motion as a whole (a big central template, same technique) is kept as a running displacement G (motion());
//   - each server answer refers to the frame that was SENT, so its boxes are first carried over to the current frame: the search
//     window is centred on the camera motion since that frame (G now - G at sending), the template match refines it, then the boxes
//     are matched to the existing tracks by IoU.
// CPU budget per video frame: one match = ~240 candidate shifts (R 14: coarse grid of 2 px + refine) or ~175 (camera, R 16: grid of
// 3 px) x ~500 sampled pixels, candidates that are clearly worse than the best so far are dropped early. 3 tracks + the camera ~ 900
// candidates ~ 1.5 ms in Node on a laptop (the old previous-frame matching: 0.3 ms); an answer adds ~170 candidates per bottle.
// The recognised wine of a track changes only when a different answer repeats (no flicker between neighbours of one line).
// Coordinates are normalized to the visible viewfinder: [x0, y0, x1, y1] in 0..1.

export type Box = [number, number, number, number]
export interface Gray { w: number, h: number, d: Uint8Array }
export interface LabelRead { color?: string | null, sweetness?: string | null, vintage?: string | null, text?: string | null, kind?: string | null, kind_p?: number | null }
// compact wine card from POST /api/wines/ar-frame (server/utils/arcard.ts)
export interface ArIcon { icon: string, label: string }
export interface ArCard {
  slug: string, title: string, manufacturer: string, year: string, category: string, color: string, sweetness: string,
  region: string, geo: { lon: number, lat: number } | null, grapes: string[], alcohol: number | null, rating: number | null,
  img: string, temperature: string, taste: ArIcon[], tasteFromStyle: boolean, pairs: ArIcon[]
}
export interface Det { box: Box | null, status: 'found' | 'not_found', slug: string | null, read?: LabelRead }
export interface Anchor { gray: Gray, box: Box, age: number }
export interface Track {
  id: number
  box: Box                  // tracked position
  disp: Box                 // eased position for drawing
  whole: boolean            // no bottle found: the whole frame was matched (label close-up)
  misses: number            // server answers in a row without this bottle
  votes: string[]           // last answers: slug, or '' = not in the catalog
  slug: string | null
  agree: number             // how many of the last 3 answers equal `slug` (0 without a slug): how settled the recognition is
  status: 'pending' | 'found' | 'not_found'
  read: LabelRead
  lost: number              // frames in a row the template match failed
  anchor?: Anchor           // what step() matches against (frame + box at the last known position); none for `whole`
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export class GrayGrabber {
  private c: HTMLCanvasElement
  private x: CanvasRenderingContext2D
  constructor(public w: number, public h: number) {
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h
    this.x = this.c.getContext('2d', { willReadFrequently: true })!
  }
  resize(w: number, h: number) { if (w !== this.w || h !== this.h) { this.w = this.c.width = w; this.h = this.c.height = h } }
  grab(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Gray {
    this.x.drawImage(src, sx, sy, sw, sh, 0, 0, this.w, this.h)
    const rgba = this.x.getImageData(0, 0, this.w, this.h).data
    const d = new Uint8Array(this.w * this.h)
    for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = (rgba[j]! * 77 + rgba[j + 1]! * 150 + rgba[j + 2]! * 29) >> 8
    return { w: this.w, h: this.h, d }
  }
}

/** zero-mean mean absolute difference between template samples tv (pixels idx of frame a) and the pixels idx + off of frame b;
 *  Infinity as soon as it is clear that it will not be below `limit` (most candidates of the sweep are far worse than the best) */
function zmad(bd: Uint8Array, idx: Int32Array, tv: Uint8Array, dif: Int16Array, n: number, off: number, limit: number) {
  let s = 0
  for (let k = 0; k < n; k++) { const v = bd[idx[k]! + off]! - tv[k]!; dif[k] = v; s += v }
  const mean = s / n, cap = limit * n
  let c = 0
  for (let k = 0; k < n; k++) {
    c += Math.abs(dif[k]! - mean)
    if ((k & 31) === 31 && c >= cap) return Infinity
  }
  return c / n
}

/** Shift of the box content from frame a to frame b (zero-mean SAD over ~500 sampled pixels, coarse grid + refine) in normalized
 *  units, searched in `center` ± R gray pixels (center: where the shift is expected, default 0,0). Samples whose shifted pixel is
 *  outside the frame are skipped (a bottle may be half out of the frame; at least half of them must stay in), the cost is the mean
 *  over the valid ones. edge: the best shift lies on the window boundary, i.e. the real one is probably further out (unreliable).
 *  null: nothing to track (tiny or textureless box) or no reliable match. */
export function matchShift(a: Gray, b: Gray, box: Box, R: number, center?: { x: number, y: number }): { dx: number, dy: number, edge: boolean } | null {
  const { w, h } = a
  if (b.w !== w || b.h !== h) return null
  // template: the box without its margins (the edges of a bottle box are background)
  const bw = box[2] - box[0], bh = box[3] - box[1]
  const x0 = clamp(Math.round((box[0] + bw * 0.15) * w), 0, w - 1), x1 = clamp(Math.round((box[2] - bw * 0.15) * w), 0, w)
  const y0 = clamp(Math.round((box[1] + bh * 0.08) * h), 0, h - 1), y1 = clamp(Math.round((box[3] - bh * 0.08) * h), 0, h)
  if (x1 - x0 < 4 || y1 - y0 < 6) return null
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 500)))
  const cap = Math.ceil((x1 - x0) / step) * Math.ceil((y1 - y0) / step)
  const idx = new Int32Array(cap), xs = new Int16Array(cap), ys = new Int16Array(cap), tv = new Uint8Array(cap), dif = new Int16Array(cap)
  let n = 0
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { idx[n] = y * w + x; xs[n] = x; ys[n] = y; tv[n++] = a.d[y * w + x]! }
  const flat = (dx: number, dy: number) => {          // textureless: any shift fits (std of the samples that are in the frame)
    let k = 0, s = 0, s2 = 0
    for (let j = 0; j < n; j++) {
      const x = xs[j]! + dx, y = ys[j]! + dy
      if (x < 0 || x >= w || y < 0 || y >= h) continue
      const v = tv[j]!; k++; s += v; s2 += v * v
    }
    return k === 0 || Math.sqrt(Math.max(0, s2 / k - (s / k) ** 2)) < 7
  }
  if (flat(0, 0)) return null
  const need = n / 2, bd = b.d
  let ci: Int32Array | null = null, ct: Uint8Array | null = null     // scratch for a template that is partly outside the frame
  // zero-mean mean absolute difference (brightness-invariant); Infinity when less than half of the template is inside the frame
  const cost = (dx: number, dy: number, limit = Infinity) => {
    const off = dy * w + dx
    if (x0 + dx >= 0 && x1 - 1 + dx < w && y0 + dy >= 0 && y1 - 1 + dy < h) return zmad(bd, idx, tv, dif, n, off, limit)
    ci ??= new Int32Array(cap); ct ??= new Uint8Array(cap)
    let m = 0
    for (let k = 0; k < n; k++) {
      const x = xs[k]! + dx, y = ys[k]! + dy
      if (x >= 0 && x < w && y >= 0 && y < h) { ci[m] = idx[k]!; ct[m++] = tv[k]! }
    }
    return m < need ? Infinity : zmad(bd, ci, ct, dif, m, off, limit)
  }
  // a centre beyond the frame can match nothing anyway; clamped, because ±Infinity / 1e17 would never leave the refine loop below
  const cx = clamp(Math.round(center?.x ?? 0), -w, w), cy = clamp(Math.round(center?.y ?? 0), -h, h)
  const stride = R > 14 ? 3 : 2
  const grid = (c: number) => { const g: number[] = []; for (let v = -R; v < R; v += stride) g.push(c + v); g.push(c + R); return g }
  let best = cost(cx, cy), bx = cx, by = cy                          // the expected shift first: ties are resolved in its favour
  const gx = grid(cx)
  for (const dy of grid(cy)) for (const dx of gx) { const c = cost(dx, dy, best); if (c < best) { best = c; bx = dx; by = dy } }
  const rx = bx, ry = by
  for (let dy = Math.max(ry - stride + 1, cy - R); dy <= Math.min(ry + stride - 1, cy + R); dy++) {
    for (let dx = Math.max(rx - stride + 1, cx - R); dx <= Math.min(rx + stride - 1, cx + R); dx++) {
      const c = cost(dx, dy, best); if (c < best) { best = c; bx = dx; by = dy }
    }
  }
  // the content is not there any more (occluded / left the frame). 30 is the old threshold, kept: correct matches stay below ~16 even
  // at noise sd 12 (<= 0.7 x the template's std) and a blur or zoom must not make a track let go, but it does not reject a wrong
  // place on low-contrast content (11–15 there). A half-visible template must still have texture in its visible half (flat again)
  if (!Number.isFinite(best) || best > 30 || flat(bx, by)) return null
  // sub-pixel: the cost is V-shaped around its minimum, so the two neighbours tell where between the pixels it really is. Without it
  // the fraction is dropped at every re-anchor (1.2 px/frame: -2 px after 60 frames); with it ~0.07 px on the test clips
  const sub = (lo: number, hi: number) => Number.isFinite(lo) && Number.isFinite(hi) ? clamp((lo - hi) / (2 * (Math.max(lo, hi) - best) || 1), -0.5, 0.5) : 0
  const sx = sub(cost(bx - 1, by), cost(bx + 1, by)), sy = sub(cost(bx, by - 1), cost(bx, by + 1))
  return { dx: (bx + sx) / w, dy: (by + sy) / h, edge: Math.abs(bx - cx) >= R || Math.abs(by - cy) >= R }
}

export function iou(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const i = ix * iy, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
  return u > 0 ? i / u : 0
}
const moved = (b: Box, m: { dx: number, dy: number }): Box => [b[0] + m.dx, b[1] + m.dy, b[2] + m.dx, b[3] + m.dy]
// is the bottle still on screen: 30% of its box, or a sizeable part of the screen (a close-up box is wider than the viewfinder)
const onScreen = (b: Box) => {
  const a = (b[2] - b[0]) * (b[3] - b[1])
  const v = Math.max(0, Math.min(1, b[2]) - Math.max(0, b[0])) * Math.max(0, Math.min(1, b[3]) - Math.max(0, b[1]))
  return a > 0 && (v / a >= 0.3 || v >= 0.08)
}
const WHOLE: Box = [0.18, 0.14, 0.82, 0.86]
// on-screen area weighted by closeness to the centre: which followed bottle a whole-frame match belongs to
const centrality = (b: Box) => {
  const v = Math.max(0, Math.min(1, b[2]) - Math.max(0, b[0])) * Math.max(0, Math.min(1, b[3]) - Math.max(0, b[1]))
  return v * (1 - 0.5 * Math.min(1, Math.hypot((b[0] + b[2]) / 2 - 0.5, (b[1] + b[3]) / 2 - 0.5) / 0.707))
}
const CAM: Box = [0.08, 0.08, 0.92, 0.92]      // the template of the camera motion: most of the viewfinder

export class ArTracks {
  tracks: Track[] = []
  private next = 1
  private frame = 0
  // recently removed recognised tracks: a bottle re-detected there (other box, track churn on a close-up) keeps its wine
  private gone: { box: Box, slug: string, votes: string[], read: LabelRead, frame: number }[] = []
  private g = { x: 0, y: 0 }                                          // camera motion: cumulative displacement of the scene, normalized
  private cam: (Anchor & { g0: { x: number, y: number } }) | null = null   // its anchor: CAM in the frame where G was g0

  /** how far the scene has moved in the viewfinder since the start (normalized); the page stores it with every frame it sends */
  motion() { return { ...this.g } }

  /** every video frame: follow each bottle (and the camera) from its anchor, ease the drawn boxes */
  step(cur: Gray) {
    const { w, h } = cur
    this.frame++
    const a = this.cam
    if (!a || a.gray.w !== w || a.gray.h !== h) this.cam = { gray: cur, box: CAM, age: 0, g0: { ...this.g } }
    else {
      const m = matchShift(a.gray, cur, CAM, 16, { x: (this.g.x - a.g0.x) * w, y: (this.g.y - a.g0.y) * h })
      if (m && !m.edge) this.g = { x: a.g0.x + m.dx, y: a.g0.y + m.dy }
      // renew the anchor after 8 px / 30 frames; after a failed match too (G stays as it was, the next frames measure from here)
      if (!m || m.edge || ++a.age >= 30 || Math.max(Math.abs(m.dx * w), Math.abs(m.dy * h)) > 8) this.cam = { gray: cur, box: CAM, age: 0, g0: { ...this.g } }
    }
    for (const t of this.tracks) {
      const an = t.anchor
      if (t.whole) { /* the whole frame: nothing to follow */ }
      else if (!an || an.gray.w !== w || an.gray.h !== h) t.anchor = { gray: cur, box: t.box, age: 0 }   // first frame / viewfinder resized
      else {
        // search around the offset found last time: the content keeps moving the way it moved
        const m = matchShift(an.gray, cur, an.box, 14, { x: (t.box[0] - an.box[0]) * w, y: (t.box[1] - an.box[1]) * h })
        if (m && !m.edge) {
          t.box = moved(an.box, m); t.lost = 0
          // never renew onto a flat frame (lens covered, black frame: a flat cost surface "matches" anywhere): that template would match nothing for good
          if ((++an.age >= 20 || Math.max(Math.abs(m.dx * w), Math.abs(m.dy * h)) > 6) && matchShift(cur, cur, t.box, 0)) t.anchor = { gray: cur, box: t.box, age: 0 }
        } else t.lost++
      }
      const k = 0.4
      t.disp = t.disp.map((v, i) => v + (t.box[i]! - v) * k) as Box
    }
    this.prune()
  }

  /** a server answer for the frame `sent` (grayscale snapshot taken when it was captured, `sentMotion` = motion() at that moment);
   *  `now` = the current frame (after step()) */
  update(dets: Det[], sent: Gray, sentMotion: { x: number, y: number }, now: Gray) {
    // the answer is 0.4–1.6 s old: the camera has moved meanwhile. G gives the window centre (the box is never taken raw),
    // the template match then refines it; when it fails or hits the window edge the camera motion alone carries the box
    const mo = this.motion()
    const prior = { x: (mo.x - sentMotion.x) * now.w, y: (mo.y - sentMotion.y) * now.h }
    const bottles = dets.filter(d => d.box).map(d => {
      // sides where the detector box was cut by the edge of the sent frame: the bottle goes on beyond it
      const cut = [d.box![0] <= 0.01, d.box![1] <= 0.01, d.box![2] >= 0.99, d.box![3] >= 0.99]
      let m = matchShift(sent, now, d.box!, 12, prior)
      // still camera, moving bottle (taken from the shelf): the narrow window around the camera prior misses it — retry wide
      if (!m || m.edge) { const w = matchShift(sent, now, d.box!, 36, prior); if (w && !w.edge) m = w }
      return { ...d, cut, box: moved(d.box!, m && !m.edge ? m : { dx: mo.x - sentMotion.x, dy: mo.y - sentMotion.y }) }
    })
    const whole = dets.find(d => !d.box)
    if (bottles.length) for (const t of this.tracks.filter(t => t.whole)) this.retire(t)
    if (bottles.length) this.tracks = this.tracks.filter(t => !t.whole)
    const pairs: [number, Track, typeof bottles[number]][] = []
    // same bottle: boxes overlap, or one box's centre lies inside the other (a detector box of the label part vs the whole bottle)
    const inside = (p: Box, q: Box) => { const cx = (p[0] + p[2]) / 2, cy = (p[1] + p[3]) / 2; return cx > q[0] && cx < q[2] && cy > q[1] && cy < q[3] }
    for (const t of this.tracks) for (const d of bottles) {
      if (t.whole) continue
      const v = iou(t.box, d.box)
      if (v > 0.2) pairs.push([v, t, d]); else if (inside(d.box, t.box) || inside(t.box, d.box)) pairs.push([0.2 * (1 - Math.min(1, t.misses / 3)), t, d])
    }
    pairs.sort((p, q) => q[0] - p[0])
    const usedT = new Set<Track>(), usedD = new Set<object>()
    const take = (t: Track, d: typeof bottles[number]) => {
      usedT.add(t); usedD.add(d)
      // on a cut side keep the tracked extent (it follows the bottle beyond the screen edge), elsewhere take the fresh box
      const b = d.box.map((v, i) => (d.cut[i] ? (i < 2 ? Math.min(v, t.box[i]!) : Math.max(v, t.box[i]!)) : v)) as Box
      t.box = b; t.misses = 0; t.lost = 0; t.anchor = { gray: now, box: b, age: 0 }
      this.vote(t, d)
    }
    for (const [, t, d] of pairs) if (!usedT.has(t) && !usedD.has(d)) take(t, d)
    // the same wine nearby is the same bottle even when the boxes drifted apart (otherwise a stale twin track lingers as a chip)
    for (const d of bottles) {
      if (usedD.has(d) || !d.slug) continue
      const cx = (d.box[0] + d.box[2]) / 2, cy = (d.box[1] + d.box[3]) / 2
      const t = this.tracks.find(t => !t.whole && !usedT.has(t) && t.slug === d.slug
        && Math.hypot((t.box[0] + t.box[2]) / 2 - cx, (t.box[1] + t.box[3]) / 2 - cy) < 0.25)
      if (t) take(t, d)
    }
    for (const d of bottles) if (!usedD.has(d)) { const t = this.born(d, d.box, false, now); this.tracks.push(t); usedT.add(t) }
    if (whole && !bottles.length) {
      // the whole frame matched but bottles are being followed: on a close-up that is the central bottle, not a new object
      const central = this.tracks.filter(t => !t.whole).sort((a, b) => centrality(b.box) - centrality(a.box))[0]
      if (central && centrality(central.box) > 0.05) { usedT.add(central); central.misses = 0; this.vote(central, whole) }
      else {
        const t = this.tracks.find(x => x.whole)
        if (t) { t.misses = 0; this.vote(t, whole) } else this.tracks.push(this.born(whole, WHOLE, true, now))
        usedT.add(this.tracks.find(x => x.whole)!)
      }
    }
    for (const t of this.tracks) if (!usedT.has(t)) t.misses++
    // a track that was not in this answer and sits on top of one that was is a duplicate of the same bottle
    this.tracks = this.tracks.filter(t => {
      const keep = t.misses < (t.whole ? 1 : 3) && !(t.misses > 0 && this.tracks.some(o => o !== t && o.misses === 0 && !o.whole && iou(o.box, t.box) > 0.4))
      if (!keep) this.retire(t)
      return keep
    })
    this.prune()
  }

  private retire(t: Track) {
    if (t.slug) this.gone = [...this.gone.filter(g => this.frame - g.frame < 60), { box: t.box, slug: t.slug, votes: t.votes, read: t.read, frame: this.frame }].slice(-8)
  }

  /** ~1.5 s without a match: the bottle is gone; (almost) off screen: it is gone too (no bracket stuck at the screen edge) */
  private prune() {
    this.tracks = this.tracks.filter(t => {
      const keep = t.whole || (t.lost < 45 && onScreen(t.box))
      if (!keep) this.retire(t)
      return keep
    })
  }

  private born(d: Det, box: Box, whole: boolean, now: Gray): Track {
    const t: Track = { id: this.next++, box, disp: [...box] as Box, whole, misses: 0, votes: [], slug: null, agree: 0, status: 'pending', read: {}, lost: 0,
      anchor: whole ? undefined : { gray: now, box, age: 0 } }
    // a recognised track removed here in the last ~2 s (whole-frame match, other box of the same close-up): same bottle, same wine
    const inside = (p: Box, q: Box) => { const cx = (p[0] + p[2]) / 2, cy = (p[1] + p[3]) / 2; return cx > q[0] && cx < q[2] && cy > q[1] && cy < q[3] }
    const g = this.gone.filter(g => this.frame - g.frame < 60).reverse().find(g => iou(g.box, box) > 0.2 || inside(g.box, box) || inside(box, g.box))
    if (g) { t.votes = g.votes; t.slug = g.slug; t.status = 'found'; t.read = g.read; this.gone = this.gone.filter(x => x !== g) }
    this.vote(t, d)
    return t
  }

  private vote(t: Track, d: Det) {
    const v = d.status === 'found' && d.slug ? d.slug : ''
    t.votes = [...t.votes, v].slice(-5)
    if (d.read && Object.values(d.read).some(Boolean)) t.read = d.read
    const last = t.votes.slice(-2)
    if (!t.slug) {
      if (v) { t.slug = v; t.status = 'found' }                       // first answer is shown at once: speed matters
      else if (last.length === 2 && last.every(x => x === '')) t.status = 'not_found'
    } else if (v && v !== t.slug && last.length === 2 && last[0] === v) {
      t.slug = v                                                      // a different wine twice in a row
    } else if (t.votes.length === 5 && t.votes.every(x => x === '')) {
      t.slug = null; t.status = 'not_found'                           // a recognised bottle stays recognised through blurry frames
    }
    t.agree = t.slug ? t.votes.slice(-3).filter(x => x === t.slug).length : 0
  }
}
