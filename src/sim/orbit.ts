import { MU_EARTH, R_EARTH, add, cross, dot, len, norm, scale, sub, type Vec3 } from './coords'

export interface State {
  r: Vec3
  v: Vec3
}

export interface Elements {
  a: number
  e: number
  i: number
  perigeeAlt: number
  apogeeAlt: number
  period: number
}

/** Classical elements from an inertial state vector (frame with Y = polar axis). */
export function elementsFromState({ r, v }: State): Elements {
  const rm = len(r)
  const vm = len(v)
  const energy = (vm * vm) / 2 - MU_EARTH / rm
  const a = -MU_EARTH / (2 * energy)
  const h = cross(r, v)
  const eVec = sub(scale(cross(v, h), 1 / MU_EARTH), scale(r, 1 / rm))
  const e = len(eVec)
  const i = Math.acos(Math.abs(h[1]) / len(h)) // polar axis is Y
  const rp = a * (1 - e)
  const ra = a * (1 + e)
  return {
    a,
    e,
    i: (i * 180) / Math.PI,
    perigeeAlt: rp - R_EARTH,
    apogeeAlt: ra - R_EARTH,
    period: a > 0 ? 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH) : Infinity,
  }
}

const J2 = 1.08263e-3

/** Gravitational acceleration with J2 oblateness (Y polar). */
export function gravity(r: Vec3): Vec3 {
  const rm = len(r)
  const k = -MU_EARTH / rm ** 3
  const g: Vec3 = scale(r, k)
  const zr = r[1] / rm
  const f = 1.5 * J2 * MU_EARTH * R_EARTH ** 2 / rm ** 5
  const c1 = 5 * zr * zr - 1
  return add(g, [f * r[0] * c1, f * r[1] * (5 * zr * zr - 3), f * r[2] * c1])
}

export type Accel = (s: State, t: number) => Vec3

/** One RK4 step. */
export function rk4(s: State, t: number, dt: number, accel: Accel): State {
  const a1 = accel(s, t)
  const s2 = { r: add(s.r, scale(s.v, dt / 2)), v: add(s.v, scale(a1, dt / 2)) }
  const a2 = accel(s2, t + dt / 2)
  const s3 = { r: add(s.r, scale(s2.v, dt / 2)), v: add(s.v, scale(a2, dt / 2)) }
  const a3 = accel(s3, t + dt / 2)
  const s4 = { r: add(s.r, scale(s3.v, dt)), v: add(s.v, scale(a3, dt)) }
  const a4 = accel(s4, t + dt)
  return {
    r: add(s.r, scale(add(add(s.v, scale(add(s2.v, s3.v), 2)), s4.v), dt / 6)),
    v: add(s.v, scale(add(add(a1, scale(add(a2, a3), 2)), a4), dt / 6)),
  }
}

/** Unit vectors: prograde, radial-out. */
export function frame(s: State) {
  return { pro: norm(s.v), rad: norm(s.r), normal: norm(cross(s.r, s.v)) }
}

export const altitude = (r: Vec3) => len(r) - R_EARTH
export const radialSpeed = (s: State) => dot(s.v, norm(s.r))

/** Circular orbital speed at altitude h. */
export const circularSpeed = (h: number) => Math.sqrt(MU_EARTH / (R_EARTH + h))

/** Simple Kepler period for a circular-ish orbit with given perigee/apogee altitudes (m). */
export const periodFromAlts = (hp: number, ha: number) => {
  const a = R_EARTH + (hp + ha) / 2
  return 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH)
}
