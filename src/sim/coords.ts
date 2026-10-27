/**
 * Geodesy on a spherical Earth. The scene frame is Earth-centred, Earth-fixed (ECEF):
 * +X → (0°N, 0°E), +Y → North pole, +Z → (0°N, 90°W)... we use the three.js-friendly
 * convention: Y up through the north pole, X through lon 0, Z through lon -90°
 * so that a standard equirectangular texture on a THREE.SphereGeometry lines up.
 */
export const R_EARTH = 6_371_000
export const MU_EARTH = 3.986004418e14
export const OMEGA_EARTH = 7.2921159e-5
export const DEG = Math.PI / 180

export type Vec3 = [number, number, number]

/** lat/lon in degrees, alt in metres → scene ECEF metres. */
export function geoToEcef(lat: number, lon: number, alt = 0): Vec3 {
  const r = R_EARTH + alt
  const φ = lat * DEG
  const λ = lon * DEG
  return [r * Math.cos(φ) * Math.cos(λ), r * Math.sin(φ), -r * Math.cos(φ) * Math.sin(λ)]
}

export function ecefToGeo([x, y, z]: Vec3): { lat: number; lon: number; alt: number } {
  const r = Math.hypot(x, y, z)
  return { lat: Math.asin(y / r) / DEG, lon: Math.atan2(-z, x) / DEG, alt: r - R_EARTH }
}

/** Local East-North-Up unit vectors at a geodetic point, in scene ECEF. */
export function enuBasis(lat: number, lon: number): { e: Vec3; n: Vec3; u: Vec3 } {
  const φ = lat * DEG
  const λ = lon * DEG
  const u: Vec3 = [Math.cos(φ) * Math.cos(λ), Math.sin(φ), -Math.cos(φ) * Math.sin(λ)]
  const e: Vec3 = [-Math.sin(λ), 0, -Math.cos(λ)]
  const n: Vec3 = [-Math.sin(φ) * Math.cos(λ), Math.cos(φ), Math.sin(φ) * Math.sin(λ)]
  return { e, n, u }
}

/** Destination point along a great circle. Distances in metres, bearing in degrees. */
export function destination(lat: number, lon: number, bearing: number, dist: number) {
  const δ = dist / R_EARTH
  const θ = bearing * DEG
  const φ1 = lat * DEG
  const λ1 = lon * DEG
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  // final bearing at destination
  const back = Math.atan2(
    Math.sin(λ1 - λ2) * Math.cos(φ1),
    Math.cos(φ2) * Math.sin(φ1) - Math.sin(φ2) * Math.cos(φ1) * Math.cos(λ1 - λ2),
  )
  return { lat: φ2 / DEG, lon: wrapLon(λ2 / DEG), bearing: (back / DEG + 180 + 360) % 360 }
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dφ = (lat2 - lat1) * DEG
  const dλ = (lon2 - lon1) * DEG
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dλ / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function wrapLon(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

/** Earth rotation angle (rad) since T-0 — used to convert between inertial and Earth-fixed. */
export const earthAngle = (t: number) => OMEGA_EARTH * t

/** Rotate a vector about the polar (Y) axis by angle a (rad). Positive = eastward rotation. */
export function rotY([x, y, z]: Vec3, a: number): Vec3 {
  // Eastward = increasing lon. With z = -r cosφ sinλ, increasing λ rotates X toward -Z.
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [x * c + z * s, y, -x * s + z * c]
}

/** Inertial (frame aligned with ECEF at T-0) → ECEF at time t. */
export const eciToEcef = (v: Vec3, t: number) => rotY(v, -earthAngle(t))
export const ecefToEci = (v: Vec3, t: number) => rotY(v, earthAngle(t))

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
export const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1))

/** Velocity of the rotating Earth's surface (ω × r) at an ECEF point, in m/s. */
export const earthSurfaceVelocity = (r: Vec3): Vec3 => cross([0, OMEGA_EARTH, 0], r)

/** Solar direction (unit, ECEF) for a UTC date — low-precision almanac, good to ~0.1°. */
export function sunDirectionEcef(date: Date): Vec3 {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5
  const n = jd - 2_451_545.0
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG
  const λ = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG
  const ε = (23.439 - 0.0000004 * n) * DEG
  const ra = Math.atan2(Math.cos(ε) * Math.sin(λ), Math.cos(λ))
  const dec = Math.asin(Math.sin(ε) * Math.sin(λ))
  const gmst = ((280.46061837 + 360.98564736629 * n) % 360) * DEG
  const subLon = wrapLon((ra - gmst) / DEG)
  const p = geoToEcef(dec / DEG, subLon, 0)
  return norm(p)
}
