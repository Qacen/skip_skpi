// Live AR (/scan/ar): spatial anchoring of the info panel to the bottle LABEL.
// The label front is close to a plane, so its motion in the image is a homography: corners inside the label (FAST, jsfeat) are
// followed frame to frame by pyramid Lucas-Kanade optical flow (jsfeat) and a robust homography (own RANSAC below) maps the
// label as it was when the panel was anchored to how it looks now. The panel lives on that plane: it moves, scales, tilts and
// foreshortens with the label when the phone moves or the viewing angle changes, instead of sliding in screen space.
// Chosen after comparing ready-made options on the user's shelf videos (WebXR = Android only, browser SLAM = GPL or proprietary,
// OpenCV.js = 13 MB): jsfeat (MIT, 22 KB gzip) + RANSAC kept the label quad within 0.2–3 px on real and synthetic sequences.
// All coordinates here are pixels of the tracking frame (the visible viewfinder at TRACK width); H maps anchor frame -> now.
import jsfeat from '~/vendor/jsfeat.js'

export type Pt = [number, number]
export type M3 = number[]                      // 3x3 row-major
export const I3 = (): M3 => [1, 0, 0, 0, 1, 0, 0, 0, 1]
export const apply = (M: M3, x: number, y: number): Pt => { const w = M[6]! * x + M[7]! * y + M[8]!; return [(M[0]! * x + M[1]! * y + M[2]!) / w, (M[3]! * x + M[4]! * y + M[5]!) / w] }
export const mul3 = (A: M3, B: M3): M3 => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k]! * B[k * 3 + j]!; return C }
export function inv3(m: M3): M3 | null {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number]
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
}
export const projQuad = (M: M3, q: Pt[]) => q.map(([x, y]) => apply(M, x, y))
export function polyArea(q: Pt[]) { let s = 0; for (let i = 0; i < q.length; i++) { const [x1, y1] = q[i]!, [x2, y2] = q[(i + 1) % q.length]!; s += x1 * y2 - x2 * y1 } return s / 2 }
export function convex(q: Pt[]) {
  let sign = 0
  for (let i = 0; i < q.length; i++) {
    const [ax, ay] = q[i]!, [bx, by] = q[(i + 1) % q.length]!, [cx, cy] = q[(i + 2) % q.length]!
    const cr = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(cr) < 1e-6) return false
    const s = Math.sign(cr); if (sign && s !== sign) return false; sign = s
  }
  return true
}
const inQuad = (q: Pt[], x: number, y: number) => {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i]!, [bx, by] = q[(i + 1) % 4]!
    const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    if (cr === 0) continue
    const s = Math.sign(cr); if (sign && s !== sign) return false; sign = s
  }
  return true
}

// ---------- robust homography: normalised DLT + seeded RANSAC + least-squares refit (jsfeat's own RANSAC proved unreliable) ----------
function normT(pts: Pt[]): M3 {
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1] } cx /= pts.length; cy /= pts.length
  let d = 0; for (const p of pts) d += Math.hypot(p[0] - cx, p[1] - cy); d = d / pts.length || 1
  const k = Math.SQRT2 / d
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1]
}
function solve8(A: number[][], b: number[]) {
  const n = 8
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r
    if (Math.abs(A[p]![i]!) < 1e-12) return null
    ;[A[i], A[p]] = [A[p]!, A[i]!]; [b[i], b[p]] = [b[p]!, b[i]!]
    for (let r = i + 1; r < n; r++) { const f = A[r]![i]! / A[i]![i]!; if (!f) continue; for (let c = i; c < n; c++) A[r]![c]! -= f * A[i]![c]!; b[r]! -= f * b[i]! }
  }
  const x = new Array(n)
  for (let i = n - 1; i >= 0; i--) { let s = b[i]!; for (let c = i + 1; c < n; c++) s -= A[i]![c]! * x[c]; x[i] = s / A[i]![i]! }
  return x as number[]
}
function fit(src: Pt[], dst: Pt[]): M3 | null {               // least squares, h33 = 1, on normalised coordinates
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0)
  const add = (r: number[], t: number) => { for (let i = 0; i < 8; i++) { Atb[i] += r[i]! * t; for (let j = 0; j < 8; j++) AtA[i]![j] += r[i]! * r[j]! } }
  for (let k = 0; k < src.length; k++) {
    const [x, y] = src[k]!, [u, v] = dst[k]!
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u); add([0, 0, 0, x, y, 1, -v * x, -v * y], v)
  }
  const h = solve8(AtA, Atb); return h && h.every(Number.isFinite) ? [...h, 1] : null
}
function rng(seed: number) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }

/** ref -> cur homography; RANSAC on the transfer error (px in cur). Seeded: the same input gives the same answer (no jitter source). */
export function ransacHomography(ref: Pt[], cur: Pt[], thr = 2.5, iters = 120): { H: M3, mask: Uint8Array } | null {
  const n = ref.length; if (n < 6) return null
  const Tr = normT(ref), Tc = normT(cur), Tci = inv3(Tc)
  if (!Tci) return null
  const rn = ref.map(p => apply(Tr, p[0], p[1])), cn = cur.map(p => apply(Tc, p[0], p[1]))
  const rnd = rng(1), t2 = thr * thr
  const denorm = (h: M3) => { const M = mul3(Tci, mul3(h, Tr)); return M.map(v => v / (M[8] || 1)) }
  const score = (M: M3, mask: Uint8Array) => {
    let c = 0
    for (let i = 0; i < n; i++) {
      const [x, y] = ref[i]!, w = M[6]! * x + M[7]! * y + M[8]!
      const dx = (M[0]! * x + M[1]! * y + M[2]!) / w - cur[i]![0], dy = (M[3]! * x + M[4]! * y + M[5]!) / w - cur[i]![1]
      mask[i] = dx * dx + dy * dy <= t2 ? 1 : 0; c += mask[i]!
    }
    return c
  }
  let best: M3 | null = null, bestN = 0, bestMask = new Uint8Array(n)
  const mask = new Uint8Array(n)
  for (let it = 0; it < iters; it++) {
    const ids = new Set<number>(); while (ids.size < 4) ids.add((rnd() * n) | 0)
    const s = [...ids]
    const h = fit(s.map(i => rn[i]!), s.map(i => cn[i]!)); if (!h) continue
    const M = denorm(h); if (!M.every(Number.isFinite)) continue
    const c = score(M, mask)
    if (c > bestN) { bestN = c; best = M; bestMask = mask.slice() }
  }
  if (!best || bestN < 6) return null
  for (let r = 0; r < 2; r++) {                                 // refit on all inliers (the set settles after one more pass)
    const ids: number[] = []; for (let i = 0; i < n; i++) if (bestMask[i]) ids.push(i)
    const h = fit(ids.map(i => rn[i]!), ids.map(i => cn[i]!)); if (!h) break
    const M = denorm(h), m2 = new Uint8Array(n), c = score(M, m2)
    if (c >= bestN * 0.9) { best = M; bestMask = m2; bestN = c }
  }
  return { H: best, mask: bestMask }
}

/** least-squares similarity (rotation + uniform scale + shift) src -> dst, closed form on centred points */
function fitSim(src: Pt[], dst: Pt[]): M3 | null {
  const n = src.length; let sx = 0, sy = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) { sx += src[i]![0]; sy += src[i]![1]; dx += dst[i]![0]; dy += dst[i]![1] }
  sx /= n; sy /= n; dx /= n; dy /= n
  let num = 0, crs = 0, den = 0
  for (let i = 0; i < n; i++) {
    const x = src[i]![0] - sx, y = src[i]![1] - sy, u = dst[i]![0] - dx, v = dst[i]![1] - dy
    num += x * u + y * v; crs += x * v - y * u; den += x * x + y * y
  }
  if (den < 1e-9) return null
  const a = num / den, b = crs / den
  return [a, -b, dx - a * sx + b * sy, b, a, dy - b * sx - a * sy, 0, 0, 1]
}
/** ref -> cur similarity with RANSAC (2-point samples). The label sits on a CYLINDER: when the bottle or the phone turns, its
 *  corners move unevenly and a full homography explains that with shear / tilt — the panel leans off the bottle. A similarity keeps
 *  the panel a rectangle square to the bottle axis; rotation still follows the phone's roll. */
export function ransacSimilarity(ref: Pt[], cur: Pt[], thr = 2.5, iters = 60): { H: M3, mask: Uint8Array } | null {
  const n = ref.length; if (n < 4) return null
  const rnd = rng(1), t2 = thr * thr
  const score = (M: M3, mask: Uint8Array) => {
    let c = 0
    for (let i = 0; i < n; i++) {
      const [x, y] = ref[i]!, ex = M[0]! * x + M[1]! * y + M[2]! - cur[i]![0], ey = M[3]! * x + M[4]! * y + M[5]! - cur[i]![1]
      mask[i] = ex * ex + ey * ey <= t2 ? 1 : 0; c += mask[i]!
    }
    return c
  }
  let best: M3 | null = null, bestN = 0, bestMask = new Uint8Array(n)
  const mask = new Uint8Array(n)
  for (let it = 0; it < iters; it++) {
    const i = (rnd() * n) | 0; let j = (rnd() * n) | 0; if (j === i) j = (i + 1) % n
    const M = fitSim([ref[i]!, ref[j]!], [cur[i]!, cur[j]!]); if (!M) continue
    const c = score(M, mask)
    if (c > bestN) { bestN = c; best = M; bestMask = mask.slice() }
  }
  if (!best || bestN < 4) return null
  for (let r = 0; r < 2; r++) {
    const ids: number[] = []; for (let i = 0; i < n; i++) if (bestMask[i]) ids.push(i)
    const M = fitSim(ids.map(i => ref[i]!), ids.map(i => cur[i]!)); if (!M) break
    const m2 = new Uint8Array(n), c = score(M, m2)
    if (c >= bestN * 0.9) { best = M; bestMask = m2; bestN = c }
  }
  return { H: best, mask: bestMask }
}

/** exact homography mapping 4 points src -> dst (for CSS matrix3d of the panel) */
export function h4(src: Pt[], dst: Pt[]): M3 | null {
  const Ts = normT(src), Td = normT(dst), Tdi = inv3(Td)
  const h = fit(src.map(p => apply(Ts, p[0], p[1])), dst.map(p => apply(Td, p[0], p[1])))
  if (!h || !Tdi) return null
  const M = mul3(Tdi, mul3(h, Ts)); return M.map(v => v / M[8]!)
}
/** CSS matrix3d (transform-origin 0 0) for a 3x3 homography of element px -> screen px */
export const cssMatrix = (M: M3) => `matrix3d(${M[0]},${M[3]},0,${M[6]},${M[1]},${M[4]},0,${M[7]},0,0,1,0,${M[2]},${M[5]},0,${M[8]})`

// plausible result: convex, area within [0.12, 8] x the anchored one, centre not far outside the frame
function sane(q: Pt[], area0: number, w: number, h: number) {
  if (!q.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])) || !convex(q)) return false
  const a = Math.abs(polyArea(q)) / area0
  if (a < 0.12 || a > 8) return false
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4
  return cx > -w && cx < 2 * w && cy > -h && cy < 2 * h
}

/** Gray image pyramids of the previous and the current frame, built ONCE per frame and shared by every label tracker. */
export class FramePyramids {
  prev: any
  cur: any
  gray: Uint8Array | null = null
  frame = 0
  constructor(public w: number, public h: number, public levels = 3) { this.alloc() }
  private alloc() {
    const mk = () => { const p = new jsfeat.pyramid_t(this.levels); p.allocate(this.w, this.h, jsfeat.U8_t | jsfeat.C1_t); return p }
    this.prev = mk(); this.cur = mk(); this.gray = null
  }
  resize(w: number, h: number) { if (w !== this.w || h !== this.h) { this.w = w; this.h = h; this.alloc() } }
  push(gray: Uint8Array) {
    ;[this.prev, this.cur] = [this.cur, this.prev]
    this.cur.data[0].data.set(gray); this.cur.build(this.cur.data[0], true)
    this.gray = gray; this.frame++
  }
}

/** Follows one label. start() with the label quad in the current frame; track() every next frame; H = anchor frame -> current frame. */
export class PlanarTracker {
  H: M3 = I3()
  ok = false
  inliers = 0
  lost = 0                                      // frames in a row without a reliable homography
  private ref: Pt[] = []                        // point positions in the ANCHOR frame (new points are mapped back through H^-1)
  private cur: Pt[] = []                        // the same points in the previous frame
  private quad0: Pt[] = []
  private area0 = 1
  private corners: any[] = []
  constructor(public pyr: FramePyramids, private opt = { maxPts: 80, cell: 8, reseedBelow: 30, minInl: 8, thr: 2.0, win: 21, fast: 12 },
              public model: 'similarity' | 'homography' = 'similarity') {}
  get anchorQuad() { return this.quad0 }

  /** anchor on the label quad of the CURRENT frame (after pyr.push) */
  start(quad: Pt[]) {
    this.quad0 = quad; this.area0 = Math.max(1, Math.abs(polyArea(quad))); this.H = I3(); this.ref = []; this.cur = []; this.lost = 0
    this.seed(quad, true)
    this.ok = this.cur.length >= this.opt.minInl
  }

  /** FAST corners inside the quad (label of the current frame), one per grid cell, strongest first */
  private seed(quad: Pt[], first: boolean) {
    const o = this.opt, { w, h, gray } = this.pyr
    if (!gray) return
    const xs = quad.map(p => p[0]), ys = quad.map(p => p[1])
    const x0 = Math.max(3, Math.floor(Math.min(...xs))), y0 = Math.max(3, Math.floor(Math.min(...ys)))
    const x1 = Math.min(w - 3, Math.ceil(Math.max(...xs))), y1 = Math.min(h - 3, Math.ceil(Math.max(...ys)))
    const rw = x1 - x0, rh = y1 - y0
    if (rw < 12 || rh < 12) return
    const roi = new jsfeat.matrix_t(rw, rh, jsfeat.U8_t | jsfeat.C1_t)      // FAST on the label region only
    for (let y = 0; y < rh; y++) roi.data.set(gray.subarray((y0 + y) * w + x0, (y0 + y) * w + x1), y * rw)
    while (this.corners.length < rw * rh) this.corners.push(new jsfeat.keypoint_t(0, 0, 0, 0, -1))
    jsfeat.fast_corners.set_threshold(o.fast)
    const n = jsfeat.fast_corners.detect(roi, this.corners, 3)
    const cand: { x: number, y: number, s: number }[] = []
    for (let i = 0; i < n; i++) { const c = this.corners[i]; const x = c.x + x0, y = c.y + y0; if (inQuad(quad, x, y)) cand.push({ x, y, s: c.score }) }
    cand.sort((a, b) => b.s - a.s)
    const taken = new Set(this.cur.map(p => ((p[0] / o.cell) | 0) + ',' + ((p[1] / o.cell) | 0)))
    const Hi = first ? I3() : inv3(this.H)
    if (!Hi) return
    for (const c of cand) {
      if (this.cur.length >= o.maxPts) break
      const key = ((c.x / o.cell) | 0) + ',' + ((c.y / o.cell) | 0)
      if (taken.has(key)) continue
      taken.add(key); this.cur.push([c.x, c.y]); this.ref.push(apply(Hi, c.x, c.y))
    }
  }

  /** one frame (call after pyr.push); returns whether the homography is reliable now (H keeps the last good value otherwise) */
  track(): boolean {
    const o = this.opt, { w, h } = this.pyr
    let good = false
    const n = this.cur.length
    if (n) {
      const pxy = new Float32Array(n * 2), cxy = new Float32Array(n * 2), st = new Uint8Array(n)
      for (let i = 0; i < n; i++) { pxy[2 * i] = this.cur[i]![0]; pxy[2 * i + 1] = this.cur[i]![1] }
      jsfeat.optical_flow_lk.track(this.pyr.prev, this.pyr.cur, pxy, cxy, n, o.win, 30, st, 0.01, 0.0001)
      const ref: Pt[] = [], cur: Pt[] = []
      for (let i = 0; i < n; i++) {
        const x = cxy[2 * i]!, y = cxy[2 * i + 1]!
        if (st[i] && x > 2 && x < w - 3 && y > 2 && y < h - 3) { ref.push(this.ref[i]!); cur.push([x, y]) }
      }
      const r = cur.length >= 6 ? (this.model === 'similarity' ? ransacSimilarity(ref, cur, o.thr + 0.5) : ransacHomography(ref, cur, o.thr)) : null
      if (r) {
        let inl = 0; for (const v of r.mask) inl += v
        if (inl >= o.minInl && sane(projQuad(r.H, this.quad0), this.area0, w, h)) {
          good = true; this.H = r.H; this.inliers = inl
          this.ref = []; this.cur = []
          for (let i = 0; i < cur.length; i++) if (r.mask[i]) { this.ref.push(ref[i]!); this.cur.push(cur[i]!) }
        }
      }
      if (!good) { this.ref = []; this.cur = [] }                // unreliable points: start over from fresh corners
    }
    if (this.cur.length < o.reseedBelow && this.lost < 3) this.seed(projQuad(this.H, this.quad0), false)
    this.ok = good
    this.lost = good ? 0 : this.lost + 1
    return good
  }
}

/** One Euro filter (Casiez et al. 2012) on a vector: smooth when still (no jitter), responsive when moving (little lag) */
export class OneEuro {
  private x: number[] | null = null
  private dx: number[] | null = null
  private t = 0
  constructor(private minCutoff = 1.2, private beta = 0.02, private dCutoff = 1) {}
  reset() { this.x = null }
  filter(v: number[], tMs: number): number[] {
    if (!this.x || !this.dx || tMs <= this.t) { this.x = v.slice(); this.dx = v.map(() => 0); this.t = tMs; return v.slice() }
    const dt = (tMs - this.t) / 1000; this.t = tMs
    const a = (c: number) => { const r = 2 * Math.PI * c * dt; return r / (r + 1) }
    const ad = a(this.dCutoff)
    this.dx = v.map((x, i) => this.dx![i]! + ad * ((x - this.x![i]!) / dt - this.dx![i]!))
    this.x = v.map((x, i) => { const c = this.minCutoff + this.beta * Math.abs(this.dx![i]!); return this.x![i]! + a(c) * (x - this.x![i]!) })
    return this.x.slice()
  }
}
