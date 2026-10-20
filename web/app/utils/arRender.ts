// The geometry of the live AR page /scan/ar, in screen CSS px:
//  - one pinhole camera for the whole view (focal 1000 px on a 720 px short side); the world «up» from the bottle
//    axes (midlines of the RF-DETR-Seg masks): their vanishing point (one bottle: the roll only), pitch at 0.7, at most 20°;
//  - cards: flat rectangles in the vertical plane through the label point, facing the camera, projected with that camera;
//    bottles of one shelf row get one level along the shelf and one width;
//  - the panel: a plate standing by the bottle, as tall as the bottle, its bottom on the bottle's base, the outer edge turned
//    TURN° towards the viewer and the top TILT° nearer.
export type V2 = [number, number]
export type V3 = [number, number, number]
export type Quad = [V2, V2, V2, V2]                   // TL, TR, BR, BL

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n] }
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]]

export class Cam {
  constructor(public f: number, public cx: number, public cy: number) {}
  ray(x: number, y: number): V3 { return [(x - this.cx) / this.f, (y - this.cy) / this.f, 1] }
  px(p: V3): V2 { return [this.f * p[0] / p[2] + this.cx, this.f * p[1] / p[2] + this.cy] }
}

/** the bottle axis (mask midline) as a homogeneous image line, null if the bottle is cut by the frame / too short / leaning */
export function axisLine(poly: V2[], bbox: number[], W: number, H: number): V3 | null {
  const [x0, y0, x1, y1] = bbox as [number, number, number, number]
  if (!poly || poly.length < 3 || x0 <= 2 || x1 >= W - 3 || y0 <= 2 || y1 >= H - 3 || y1 - y0 < 0.4 * H) return null
  const rows: { y: number, w: number, m: number }[] = []
  for (let i = 0; i < 80; i++) {                                     // scanlines: the mask's left / right edge per row
    const y = y0 + (i + 0.5) * (y1 - y0) / 80; let lo = Infinity, hi = -Infinity
    for (let j = 0; j < poly.length; j++) {
      const a = poly[j]!, b = poly[(j + 1) % poly.length]!
      if ((a[1] <= y) !== (b[1] <= y)) { const x = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]); lo = Math.min(lo, x); hi = Math.max(hi, x) }
    }
    if (hi > lo) rows.push({ y, w: hi - lo, m: (lo + hi) / 2 })
  }
  if (rows.length < 40) return null
  const ws = rows.map(r => r.w).sort((a, b) => a - b), p90 = ws[Math.floor(0.9 * (ws.length - 1))]!
  const body = rows.filter(r => r.w >= 0.75 * p90)                   // the body, not the neck
  if (body.length < 20) return null
  const n = body.length, my = body.reduce((s, r) => s + r.y, 0) / n, mm = body.reduce((s, r) => s + r.m, 0) / n
  let sxy = 0, syy = 0; for (const r of body) { sxy += (r.y - my) * (r.m - mm); syy += (r.y - my) ** 2 }
  const a = sxy / (syy || 1), b = mm - a * my                          // x = a*y + b
  if (Math.abs(a) > 0.5) return null
  const p1: V3 = [a * body[0]!.y + b, body[0]!.y, 1], p2: V3 = [a * body[n - 1]!.y + b, body[n - 1]!.y, 1]
  const l = cross(p1, p2), k = Math.hypot(l[0], l[1]) || 1
  return [l[0] / k, l[1] / k, l[2] / k]
}

/** the eigenvector of the smallest eigenvalue of a symmetric 3x3 matrix (Jacobi) */
function smallestEig(A: number[][]): V3 {
  const a = A.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 30; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as [number, number][]) {
      if (Math.abs(a[p]![q]!) < 1e-12) continue
      const th = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < 3; k++) { const akp = a[k]![p]!, akq = a[k]![q]!; a[k]![p] = c * akp - s * akq; a[k]![q] = s * akp + c * akq }
      for (let k = 0; k < 3; k++) { const apk = a[p]![k]!, aqk = a[q]![k]!; a[p]![k] = c * apk - s * aqk; a[q]![k] = s * apk + c * aqk }
      for (let k = 0; k < 3; k++) { const vkp = v[k]![p]!, vkq = v[k]![q]!; v[k]![p] = c * vkp - s * vkq; v[k]![q] = s * vkp + c * vkq }
    }
  }
  const i = [0, 1, 2].reduce((b, k) => (a[k]![k]! < a[b]![b]! ? k : b), 0)
  return [v[0]![i]!, v[1]![i]!, v[2]![i]!]
}

/** world «up» in camera coordinates from the bottle axes of one frame (null: no usable axis) */
export function upFromAxes(lines: V3[], cam: Cam): V3 | null {
  if (!lines.length) return null
  if (lines.length === 1) {                                          // one bottle: its axis gives the roll only
    let dx = lines[0]![1], dy = -lines[0]![0]
    if (dy > 0) { dx = -dx; dy = -dy }
    return norm([dx, dy, 0])
  }
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const l of lines) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i]![j]! += l[i]! * l[j]!
  const vp = smallestEig(M)                                          // the point closest to all axes (may be at infinity)
  let u = norm([(vp[0] - cam.cx * vp[2]) / cam.f, (vp[1] - cam.cy * vp[2]) / cam.f, vp[2]])
  const c = add(cam.ray(cam.cx, cam.cy), u, 0.01)
  if (cam.px(c)[1] > cam.cy) u = [-u[0], -u[1], -u[2]]                // «up» goes up in the image
  return u
}
/** the render's pitch handling: 0.7 of the estimated pitch, at most 20° (the roll is kept as is) */
export function tamePitch(u: V3): V3 {
  const pitch = Math.max(-20, Math.min(20, Math.asin(Math.max(-1, Math.min(1, u[2]))) * 180 / Math.PI * 0.7)) * Math.PI / 180
  const h = Math.hypot(u[0], u[1]) || 1
  return [u[0] / h * Math.cos(pitch), u[1] / h * Math.cos(pitch), Math.sin(pitch)]
}
export function slerpUp(a: V3, b: V3, k: number): V3 { return norm(add(a, add(b, a, -1), k)) }

/** a card of cw x ch px centred at P: vertical (along up), facing the camera, left -> right */
export function cardQuad(cam: Cam, P: V2, cw: number, ch: number, up: V3): Quad {
  const X = cam.ray(P[0], P[1]); let hz = norm(cross(up, X))
  if (cam.px(add(X, hz, 0.01))[0] < P[0]) hz = [-hz[0], -hz[1], -hz[2]]
  const W3 = cw / cam.f, H3 = ch / cam.f
  return [add(add(X, hz, -W3 / 2), up, H3 / 2), add(add(X, hz, W3 / 2), up, H3 / 2), add(add(X, hz, W3 / 2), up, -H3 / 2), add(add(X, hz, -W3 / 2), up, -H3 / 2)]
    .map(c => cam.px(c)) as Quad
}

/** the panel plate by the bottle (comp_panel.panel_quad): lw label width, base px below the label point, height px, aspect w/h */
export function panelQuad(cam: Cam, P: V2, lw: number, base: number, height: number, aspect: number, up: V3, right: boolean, turn = 14, tilt = 8): Quad {
  const X = cam.ray(P[0], P[1]); let hz = norm(cross(up, X))
  if (cam.px(add(X, hz, 0.01))[0] < P[0]) hz = [-hz[0], -hz[1], -hz[2]]
  const sgn = right ? 1 : -1, T = turn * Math.PI / 180, L = tilt * Math.PI / 180
  const H3 = height / cam.f, W3 = H3 * aspect, hw = 0.66 * lw / cam.f, gap = 0.12 * lw / cam.f
  const b = add(X, up, -base / cam.f)                                 // on the bottle's base line
  let fw = norm(cross(hz, up)); if (dot(fw, X) < 0) fw = [-fw[0], -fw[1], -fw[2]]
  const d = add([sgn * Math.cos(T) * hz[0], sgn * Math.cos(T) * hz[1], sgn * Math.cos(T) * hz[2]], fw, -Math.sin(T))
  let n = norm(cross(d, up)); if (dot(n, X) < 0) n = [-n[0], -n[1], -n[2]]
  const v = add([Math.cos(L) * up[0], Math.cos(L) * up[1], Math.cos(L) * up[2]], n, -Math.sin(L))
  const A = add(b, hz, sgn * (hw + gap)), B = add(A, d, W3)
  const [l, r] = right ? [A, B] : [B, A]
  return [add(l, v, H3), add(r, v, H3), r, l].map(c => cam.px(c)) as Quad
}

export function onScreen(q: Quad, W: number, H: number) {
  const xs = q.map(p => p[0]), ys = q.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  return Math.max(0, Math.min(x1, W) - Math.max(x0, 0)) * Math.max(0, Math.min(y1, H) - Math.max(y0, 0)) / Math.max(1, (x1 - x0) * (y1 - y0))
}
export const lerpQuad = (a: Quad, b: Quad, e: number): Quad => a.map((p, i) => [p[0] + (b[i]![0] - p[0]) * e, p[1] + (b[i]![1] - p[1]) * e]) as Quad

/** CSS matrix3d that maps a w x h box (transform-origin 0 0) onto the quad */
export function quadMatrix(w: number, h: number, q: Quad): string {
  // square -> quad (Heckbert), then pre-scale by 1/w, 1/h
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9
  const g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3
  const m = [a / w, b / h, x0, d / w, e / h, y0, g / w, hh / h, 1]
  return `matrix3d(${m[0]},${m[3]},0,${m[6]},${m[1]},${m[4]},0,${m[7]},0,0,1,0,${m[2]},${m[5]},0,${m[8]})`
}
