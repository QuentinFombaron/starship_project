export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
export const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp((x - a) / (b - a))
  return k * k * (3 - 2 * k)
}

/**
 * Monotone cubic (Fritsch–Carlson / PCHIP) interpolant through (xs, ys).
 * Never overshoots between anchors — essential for altitude/speed curves.
 */
export function pchip(xs: number[], ys: number[]) {
  const n = xs.length
  if (n === 1) return () => ys[0]
  const h: number[] = []
  const δ: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i]
    δ[i] = (ys[i + 1] - ys[i]) / h[i]
  }
  const m: number[] = new Array(n)
  m[0] = δ[0]
  m[n - 1] = δ[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (δ[i - 1] * δ[i] <= 0) m[i] = 0
    else {
      const w1 = 2 * h[i] + h[i - 1]
      const w2 = h[i] + 2 * h[i - 1]
      m[i] = (w1 + w2) / (w1 / δ[i - 1] + w2 / δ[i])
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] > x) hi = mid
      else lo = mid
    }
    const t = (x - xs[lo]) / h[lo]
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h[lo] * m[lo] +
      (-2 * t3 + 3 * t2) * ys[lo + 1] +
      (t3 - t2) * h[lo] * m[lo + 1]
    )
  }
}

/** Sample a uniformly spaced series at time t with Catmull-Rom smoothing. */
export function sampleSeries(series: ArrayLike<number>, t0: number, dt: number, t: number) {
  const n = series.length
  const f = (t - t0) / dt
  if (f <= 0) return series[0]
  if (f >= n - 1) return series[n - 1]
  const i = Math.floor(f)
  const k = f - i
  const p0 = series[Math.max(0, i - 1)]
  const p1 = series[i]
  const p2 = series[i + 1]
  const p3 = series[Math.min(n - 1, i + 2)]
  return catmull(p0, p1, p2, p3, k)
}

export function sampleSeriesLinear(series: ArrayLike<number>, t0: number, dt: number, t: number) {
  const n = series.length
  const f = (t - t0) / dt
  if (f <= 0) return series[0]
  if (f >= n - 1) return series[n - 1]
  const i = Math.floor(f)
  return lerp(series[i], series[i + 1], f - i)
}

/** Angle-aware sampling (degrees) for longitude/heading wrap-around. */
export function sampleAngle(series: ArrayLike<number>, t0: number, dt: number, t: number) {
  const n = series.length
  const f = (t - t0) / dt
  if (f <= 0) return series[0]
  if (f >= n - 1) return series[n - 1]
  const i = Math.floor(f)
  const a = series[i]
  let b = series[i + 1]
  if (b - a > 180) b -= 360
  if (a - b > 180) b += 360
  return lerp(a, b, f - i)
}

export function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/** Binary search: index of last element with key(el) <= t, or -1. */
export function lastIndexAtOrBefore<T>(arr: T[], t: number, key: (x: T) => number) {
  let lo = 0
  let hi = arr.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (key(arr[mid]) <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
