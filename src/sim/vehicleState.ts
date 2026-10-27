import type { TelemetryTrack } from '../content/schema'
import { enuBasis, geoToEcef, type Vec3 } from './coords'
import { catmull, sampleAngle, sampleSeriesLinear } from './interpolate'

export interface VehicleSample {
  t: number
  pos: Vec3 // ECEF metres
  lat: number
  lon: number
  alt: number
  speed: number
  vspeed: number
  heading: number
  pitch: number
  q: number
  accel: number
  lox: number
  ch4: number
  /** true when t is beyond the end of the track */
  ended: boolean
}

/** Pre-computes ECEF positions for smooth Catmull-Rom sampling of a telemetry track. */
export class TrackSampler {
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly tEnd: number
  readonly tr: TelemetryTrack
  constructor(tr: TelemetryTrack) {
    this.tr = tr
    const n = tr.lat.length
    this.x = new Float64Array(n)
    this.y = new Float64Array(n)
    this.z = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const p = geoToEcef(tr.lat[i], tr.lon[i], tr.alt[i])
      this.x[i] = p[0]
      this.y[i] = p[1]
      this.z[i] = p[2]
    }
    this.tEnd = tr.t0 + (n - 1) * tr.dt
  }

  position(t: number, out: Vec3 = [0, 0, 0]): Vec3 {
    const { t0, dt } = this.tr
    const n = this.x.length
    const f = Math.min(n - 1, Math.max(0, (t - t0) / dt))
    const i = Math.min(n - 2, Math.floor(f))
    const k = f - i
    const i0 = Math.max(0, i - 1)
    const i3 = Math.min(n - 1, i + 2)
    out[0] = catmull(this.x[i0], this.x[i], this.x[i + 1], this.x[i3], k)
    out[1] = catmull(this.y[i0], this.y[i], this.y[i + 1], this.y[i3], k)
    out[2] = catmull(this.z[i0], this.z[i], this.z[i + 1], this.z[i3], k)
    return out
  }

  sample(t: number): VehicleSample {
    const { t0, dt } = this.tr
    const s = (a: number[]) => sampleSeriesLinear(a, t0, dt, t)
    return {
      t,
      pos: this.position(t),
      lat: s(this.tr.lat),
      lon: sampleAngle(this.tr.lon, t0, dt, t),
      alt: s(this.tr.alt),
      speed: s(this.tr.speed),
      vspeed: s(this.tr.vspeed),
      heading: sampleAngle(this.tr.heading, t0, dt, t),
      pitch: s(this.tr.pitch),
      q: s(this.tr.q),
      accel: s(this.tr.accel),
      lox: s(this.tr.lox),
      ch4: s(this.tr.ch4),
      ended: t > this.tEnd,
    }
  }

  /** Down-sampled ECEF polyline between two times, for drawing trajectories. */
  polyline(tFrom: number, tTo: number, step = 2): number[] {
    const pts: number[] = []
    const p: Vec3 = [0, 0, 0]
    for (let t = tFrom; t <= tTo; t += step) {
      this.position(t, p)
      pts.push(p[0], p[1], p[2])
    }
    return pts
  }
}

/**
 * Orientation basis of a vehicle body in ECEF given heading/pitch (deg).
 * Returns the body axis (nose direction), the 'belly' direction (heat-shield side) and right vector.
 */
export function bodyBasis(lat: number, lon: number, heading: number, pitch: number) {
  const { e, n, u } = enuBasis(lat, lon)
  const h = (heading * Math.PI) / 180
  const p = (pitch * Math.PI) / 180
  const fwd: Vec3 = [e[0] * Math.sin(h) + n[0] * Math.cos(h), e[1] * Math.sin(h) + n[1] * Math.cos(h), e[2] * Math.sin(h) + n[2] * Math.cos(h)]
  // nose = fwd·cos(p) + up·sin(p)
  const nose: Vec3 = [fwd[0] * Math.cos(p) + u[0] * Math.sin(p), fwd[1] * Math.cos(p) + u[1] * Math.sin(p), fwd[2] * Math.cos(p) + u[2] * Math.sin(p)]
  // belly is perpendicular to the nose in the vertical plane, facing down when pitch = 0
  const belly: Vec3 = [fwd[0] * Math.sin(p) - u[0] * Math.cos(p), fwd[1] * Math.sin(p) - u[1] * Math.cos(p), fwd[2] * Math.sin(p) - u[2] * Math.cos(p)]
  const right: Vec3 = [
    nose[1] * belly[2] - nose[2] * belly[1],
    nose[2] * belly[0] - nose[0] * belly[2],
    nose[0] * belly[1] - nose[1] * belly[0],
  ]
  return { nose, belly, right, up: u, fwd }
}
