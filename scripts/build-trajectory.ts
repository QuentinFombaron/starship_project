/**
 * Reconstructs a plausible, internally consistent telemetry track for a flight from
 * sparse anchors (webcast HUD readouts + event times). Usage:
 *   npm run trajectory -- flight-14
 *
 * Phases
 *  - Ascent (stack + ship to SECO): kinematic — altitude & speed are monotone splines
 *    through the anchors, downrange is integrated from the horizontal speed.
 *  - Booster after staging: kinematic — altitude & downrange splines.
 *  - Ship after SECO: numerical integration (RK4, J2) in an inertial frame with impulsive-ish
 *    finite burns tuned to hit the target orbit and the entry time; drag+lift entry tuned to
 *    reach the landing-flip altitude on time; kinematic landing burn.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  EnginesSchema,
  KeyframesSchema,
  MissionSchema,
  TimelineSchema,
  type Keyframes,
  type StageEngines,
  type TimelineEvent,
} from '../src/content/schema.ts'
import {
  DEG,
  MU_EARTH,
  R_EARTH,
  add,
  destination,
  dot,
  ecefToEci,
  ecefToGeo,
  eciToEcef,
  earthSurfaceVelocity,
  enuBasis,
  geoToEcef,
  len,
  norm,
  scale,
  sub,
  type Vec3,
} from '../src/sim/coords.ts'
import { stageEngineState } from '../src/sim/engines.ts'
import { clamp, pchip, smoothstep } from '../src/sim/interpolate.ts'
import { elementsFromState, gravity, rk4, type State } from '../src/sim/orbit.ts'

const flightId = process.argv[2] ?? 'flight-14'
const dir = path.resolve('content/flights', flightId)
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))

const mission = MissionSchema.parse(read('mission.json'))
const timeline = TimelineSchema.parse(read('timeline.json'))
const engines = EnginesSchema.parse(read('engines.json'))
const kf: Keyframes = KeyframesSchema.parse(read('keyframes.json'))

const ev = (id: string): TimelineEvent => {
  const e = timeline.find((x) => x.id === id)
  if (!e) throw new Error(`timeline.json is missing event "${id}"`)
  return e
}
const evOpt = (id: string) => timeline.find((x) => x.id === id)

const pad = mission.launchSite.position
const DT = 1

// ───────────────────────── atmosphere ─────────────────────────
const rho = (h: number) => (h > 150_000 ? 0 : 1.225 * Math.exp(-h / 8_400))
const speedOfSound = (h: number) => (h < 11_000 ? 340 - 0.0039 * h : h < 25_000 ? 295 : 295 + 0.0009 * (h - 25_000))

// ───────────────────────── ascent (kinematic) ─────────────────────────
interface Sample {
  t: number
  r: Vec3 // ECEF
  pitch: number // body pitch, deg from local horizontal towards downrange (90 = up, 180 = nose back)
  heading: number // deg
}

function kinematicAltSpeed(anchors: { t: number; altKm?: number; speedKmh?: number }[]) {
  const a = anchors.filter((x) => x.altKm !== undefined)
  const s = anchors.filter((x) => x.speedKmh !== undefined)
  const alt = pchip(
    a.map((x) => x.t),
    a.map((x) => x.altKm! * 1000),
  )
  const spd = pchip(
    s.map((x) => x.t),
    s.map((x) => x.speedKmh! / 3.6),
  )
  // PCHIP leaves the pad already climbing at ~20 m/s; start from rest instead with a cubic that meets the
  // first airborne anchor in value and slope (constant-ish ~0.45 g net acceleration off the mount)
  const t1 = a.find((x) => x.t > 0)?.t ?? 10
  const h1 = alt(t1)
  const m1 = (alt(t1 + 0.01) - alt(t1 - 0.01)) / 0.02
  const liftoffAlt = (t: number) => {
    if (t <= 0) return 0
    if (t >= t1) return alt(t)
    const k = t / t1
    return Math.max(0, h1 * (3 * k * k - 2 * k * k * k) + m1 * t1 * (k * k * k - k * k))
  }
  return { alt: liftoffAlt, spd }
}

/**
 * Horizontal speed for the ascent. Altitude and speed come from independent splines, so the raw
 * sqrt(v² − vz²) flickers between zero and tens of m/s and the stack would lurch sideways. Instead: hold
 * vertical until the tower is cleared, then follow a non-decreasing, smoothed envelope of the raw value.
 */
const PITCH_KICK = 9
function horizontalSpeed(t0: number, t1: number, alt: (t: number) => number, spd: (t: number) => number) {
  const step = 0.1
  const n = Math.ceil((t1 + 4 - t0) / step) + 1
  const raw = new Float64Array(n)
  let peak = 0
  for (let i = 0; i < n; i++) {
    const t = t0 + i * step
    const vz = (alt(t + 0.25) - alt(t - 0.25)) / 0.5
    const v = spd(t)
    const vh = t < PITCH_KICK ? 0 : Math.sqrt(Math.max(0, v * v - vz * vz))
    peak = Math.max(peak, vh)
    raw[i] = peak
  }
  const w = Math.round(3 / step)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    let c = 0
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++, c++) s += raw[j]
    out[i] = (s / c) * smoothstep(PITCH_KICK, PITCH_KICK + 10, t0 + i * step)
  }
  // a gravity turn never pitches back up: keep the flight-path angle non-increasing while near the pad
  let γMin = Math.PI / 2
  for (let i = 0; i < n; i++) {
    const t = t0 + i * step
    const vz = (alt(t + 0.25) - alt(t - 0.25)) / 0.5
    if (t > PITCH_KICK + 2 && t < 90 && vz > 0) out[i] = Math.max(out[i], vz / Math.tan(γMin))
    γMin = Math.min(γMin, Math.atan2(vz, Math.max(out[i], 1e-3)))
  }
  return (t: number) => {
    const f = clamp((t - t0) / step, 0, n - 1)
    const i = Math.min(n - 2, Math.floor(f))
    return out[i] + (out[i + 1] - out[i]) * (f - i)
  }
}

/** Integrates ground track for a given altitude/speed profile. Returns ECEF samples. */
function integrateAscent(t0: number, t1: number, azimuth: number, alt: (t: number) => number, spd: (t: number) => number) {
  const out: (Sample & { downrange: number; vz: number; vh: number; lat: number; lon: number; bearing: number })[] = []
  let lat = pad.lat
  let lon = pad.lon
  let bearing = azimuth
  let downrange = 0
  const steps = 10
  const hspd = horizontalSpeed(t0, t1, alt, spd)
  for (let t = t0; t <= t1 + 1e-9; t += DT) {
    const h = alt(t)
    const vz = (alt(t + 0.25) - alt(t - 0.25)) / 0.5
    const vh = hspd(t)
    const γ = Math.atan2(vz, Math.max(vh, 1e-3)) / DEG
    out.push({ t, r: geoToEcef(lat, lon, h), pitch: γ, heading: bearing, downrange, vz, vh, lat, lon, bearing })
    // advance ground position with sub-steps (ground speed scaled to surface)
    for (let k = 0; k < steps; k++) {
      const tt = t + (k * DT) / steps
      const hh = alt(tt)
      const vhh = hspd(tt)
      const ds = ((vhh * DT) / steps) * (R_EARTH / (R_EARTH + hh))
      if (ds < 0.01) continue
      const d = destination(lat, lon, bearing, ds)
      lat = d.lat
      lon = d.lon
      bearing = d.bearing
      downrange += ds
    }
  }
  return out
}

// launch azimuth for target inclination (great-circle approximation, corrected later)
const incl = kf.targets.inclinationDeg
let azimuth = kf.targets.launchAzimuthDeg ?? Math.asin(clamp(Math.cos(incl * DEG) / Math.cos(pad.lat * DEG), -1, 1)) / DEG

const tStage = ev('hot-staging').t
const tSeco = ev('seco').t
const shipAnchors = kf.ship.slice().sort((a, b) => a.t - b.t)

/** Builds the ship ascent and returns the inertial SECO state. */
function buildShipAscent(az: number, anchors = shipAnchors) {
  const { alt, spd } = kinematicAltSpeed(anchors)
  const samples = integrateAscent(0, tSeco, az, alt, spd)
  const last = samples[samples.length - 1]
  const { e, n, u } = enuBasis(last.lat, last.lon)
  const b = last.bearing * DEG
  const hdir = add(scale(e, Math.sin(b)), scale(n, Math.cos(b)))
  const vRel = add(scale(hdir, last.vh), scale(u, last.vz))
  const rEcef = last.r
  const vEcef = vRel
  // inertial frame == ECEF at T-0; rotate both to inertial at tSeco and add Earth rotation
  const rI = ecefToEci(rEcef, tSeco)
  const vI = ecefToEci(add(vEcef, earthSurfaceVelocity(rEcef)), tSeco)
  return { samples, seco: { r: rI, v: vI } as State, alt, spd }
}

// tune azimuth so that the inertial inclination matches the target
for (let iter = 0; iter < 30; iter++) {
  const { seco } = buildShipAscent(azimuth)
  const el = elementsFromState(seco)
  const err = el.i - incl
  if (Math.abs(err) < 0.01) break
  azimuth += err * 1.2
}

// Tune the SECO speed and vertical speed so the coast arc peaks at the target apogee right at the
// orbital insertion burn (the burn then raises perigee). Folds the solution back into the anchors so
// HUD speed/altitude stay continuous.
const tOibMid = (ev('oib-start').t + ev('oib-end').t) / 2
function coastApogee(seco: State) {
  let best = { h: -Infinity, t: tSeco }
  let s = seco
  for (let t = tSeco; t < tSeco + 4000; t += 5) {
    s = rk4(s, t, 5, (st) => gravity(st.r))
    const h = len(s.r) - R_EARTH
    if (h > best.h) best = { h, t: t + 5 }
    else if (h < best.h - 2000) break
  }
  return best
}
{
  const secoIdx = shipAnchors.findIndex((a) => a.t === tSeco)
  const prevIdx = secoIdx - 1
  if (secoIdx < 0 || prevIdx < 0) throw new Error('keyframes.ship needs anchors at SECO and before it')
  const altSeco = shipAnchors[secoIdx].altKm!
  // inner: bisection on SECO speed for the target apogee altitude
  const solveSpeed = (prevAlt: number) => {
    shipAnchors[prevIdx].altKm = prevAlt
    let lo = 22_000
    let hi = 29_000
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2
      shipAnchors[secoIdx].speedKmh = mid
      const ap = coastApogee(buildShipAscent(azimuth).seco)
      if (ap.h > kf.targets.apogeeKm * 1000) hi = mid
      else lo = mid
    }
    shipAnchors[secoIdx].speedKmh = (lo + hi) / 2
    return coastApogee(buildShipAscent(azimuth).seco)
  }
  // outer: golden-section search on the previous anchor's altitude (sets vertical speed at SECO) for apogee timing
  const cost = (prevAlt: number) => Math.abs(solveSpeed(prevAlt).t - tOibMid)
  let lo = altSeco - 30
  let hi = altSeco - 0.3
  const φ = (Math.sqrt(5) - 1) / 2
  let x1 = hi - φ * (hi - lo)
  let x2 = lo + φ * (hi - lo)
  let f1 = cost(x1)
  let f2 = cost(x2)
  for (let i = 0; i < 22; i++) {
    if (f1 < f2) {
      hi = x2
      x2 = x1
      f2 = f1
      x1 = hi - φ * (hi - lo)
      f1 = cost(x1)
    } else {
      lo = x1
      x1 = x2
      f1 = f2
      x2 = lo + φ * (hi - lo)
      f2 = cost(x2)
    }
  }
  const best = solveSpeed((lo + hi) / 2)
  console.log(`SECO solved: ${shipAnchors[secoIdx].speedKmh!.toFixed(0)} km/h, prev anchor alt ${shipAnchors[prevIdx].altKm!.toFixed(2)} km → apogee ${(best.h / 1000).toFixed(1)} km at T+${best.t}s (target ${tOibMid})`)
}

const ascent = buildShipAscent(azimuth)
console.log(`Launch azimuth ${azimuth.toFixed(2)}°  SECO elements:`, fmtEl(elementsFromState(ascent.seco)))

// ───────────────────────── ship post-SECO (dynamic) ─────────────────────────
const tOibS = ev('oib-start').t
const tOibE = ev('oib-end').t
const tDeoS = ev('deorbit-start').t
const tDeoE = ev('deorbit-end').t
const tEntry = ev('ship-entry').t
const tFlip = ev('ship-landing-flip').t
const tSplash = ev('ship-splashdown').t

const targetRp = R_EARTH + kf.targets.perigeeKm * 1000

type Burn = { t0: number; t1: number; dir: 'pro' | 'retro'; dv: number }

function propagate(s0: State, tStart: number, tEnd: number, burns: Burn[], drag?: { beta: number; ld: number }, onStep?: (t: number, s: State) => boolean | void) {
  let s = s0
  const accel = (st: State, t: number): Vec3 => {
    let a = gravity(st.r)
    for (const b of burns) {
      if (t >= b.t0 && t < b.t1) {
        const k = (b.dv / (b.t1 - b.t0)) * (b.dir === 'pro' ? 1 : -1)
        a = add(a, scale(norm(st.v), k))
      }
    }
    if (drag) {
      const h = len(st.r) - R_EARTH
      const ρ = rho(h)
      if (ρ > 0) {
        // air co-rotates with Earth: relative velocity in inertial frame
        const vAir = sub(st.v, earthSurfaceVelocity(st.r))
        const vm = len(vAir)
        const dragAcc = (0.5 * ρ * vm * vm) / drag.beta
        const dHat = scale(vAir, -1 / (vm || 1))
        // lift perpendicular to velocity in the vertical plane, pointing up-ish
        const up = norm(st.r)
        const lHat = norm(sub(up, scale(norm(vAir), dot(up, norm(vAir)))))
        // lift only while hypersonic/supersonic in the upper atmosphere; belly-flop below is pure drag
        const ld = drag.ld * smoothstep(25_000, 45_000, h)
        a = add(a, add(scale(dHat, dragAcc), scale(lHat, dragAcc * ld)))
      }
    }
    return a
  }
  const steps = Math.round((tEnd - tStart) / DT)
  let t = tStart
  for (let i = 0; i < steps; i++) {
    s = rk4(s, t, DT, accel)
    t += DT
    if (onStep && onStep(t, s) === false) break
  }
  return { s, t }
}

// insertion Δv: raise perigee to target at current orbital position (approx: vis-viva at burn mid-point)
function insertionDv(sBefore: State) {
  const r = len(sBefore.r)
  const aT = (r + targetRp) / 2
  const vNeeded = Math.sqrt(MU_EARTH * (2 / r - 1 / aT))
  return vNeeded - len(sBefore.v)
}

const coast1 = propagate(ascent.seco, tSeco, tOibS, [])
let dvIns = insertionDv(coast1.s)
for (let i = 0; i < 20; i++) {
  const after = propagate(coast1.s, tOibS, tOibE, [{ t0: tOibS, t1: tOibE, dir: 'pro', dv: dvIns }])
  const el = elementsFromState(after.s)
  const err = el.perigeeAlt - kf.targets.perigeeKm * 1000
  if (Math.abs(err) < 200) break
  dvIns -= err / 1800
}
const orbitState = propagate(coast1.s, tOibS, tOibE, [{ t0: tOibS, t1: tOibE, dir: 'pro', dv: dvIns }]).s
console.log(`Insertion Δv ${dvIns.toFixed(1)} m/s → orbit:`, fmtEl(elementsFromState(orbitState)))

// deorbit Δv: tune so the ship crosses entry altitude at tEntry
const ENTRY_ALT = 120_000
const preDeorbit = propagate(orbitState, tOibE, tDeoS, []).s
function entryTimeFor(dv: number) {
  let crossed = Infinity
  const beta = kf.targets.shipBallisticCoeff
  propagate(preDeorbit, tDeoS, tEntry + 3_000, [{ t0: tDeoS, t1: tDeoE, dir: 'retro', dv }], { beta, ld: 0 }, (t, s) => {
    if (len(s.r) - R_EARTH < ENTRY_ALT) {
      crossed = t
      return false
    }
  })
  return crossed
}
let lo = 20
let hi = 400
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2
  // more Δv → earlier entry
  if (entryTimeFor(mid) > tEntry) lo = mid
  else hi = mid
}
const dvDeorbit = (lo + hi) / 2
console.log(`Deorbit Δv ${dvDeorbit.toFixed(1)} m/s → entry interface at T+${entryTimeFor(dvDeorbit).toFixed(0)} s (target ${tEntry})`)

// entry: β fixed, tune lift-to-drag so altitude at the landing-flip time ≈ FLIP_ALT
const FLIP_ALT = 700
const beta = kf.targets.shipBallisticCoeff
function entryRun(ld: number, record = false) {
  const states: { t: number; s: State }[] = []
  let ground = Infinity
  const res = propagate(
    preDeorbit,
    tDeoS,
    tFlip,
    [{ t0: tDeoS, t1: tDeoE, dir: 'retro', dv: dvDeorbit }],
    { beta, ld },
    (t, s) => {
      if (record) states.push({ t, s })
      if (len(s.r) - R_EARTH < 0) {
        ground = t
        return false
      }
    },
  )
  return { states, altAtFlip: ground < Infinity ? -(tFlip - ground) * 100 : len(res.s.r) - R_EARTH }
}
let ldLo = 0
let ldHi = 2
for (let i = 0; i < 40; i++) {
  const mid = (ldLo + ldHi) / 2
  // more lift → stays higher for longer
  if (entryRun(mid).altAtFlip > FLIP_ALT) ldHi = mid
  else ldLo = mid
}
const ld = (ldLo + ldHi) / 2
const entry = entryRun(ld, true)
console.log(`Entry β ${beta} kg/m², L/D ${ld.toFixed(3)} → altitude at flip ${entry.altAtFlip.toFixed(0)} m`)

// coast/orbit states before deorbit, recorded per second
const shipDyn: { t: number; s: State }[] = []
propagate(ascent.seco, tSeco, tOibS, [], undefined, (t, s) => void shipDyn.push({ t, s }))
propagate(coast1.s, tOibS, tOibE, [{ t0: tOibS, t1: tOibE, dir: 'pro', dv: dvIns }], undefined, (t, s) => void shipDyn.push({ t, s }))
propagate(orbitState, tOibE, tDeoS, [], undefined, (t, s) => void shipDyn.push({ t, s }))
for (const x of entry.states) shipDyn.push(x)

// Splashdown location correction: blend a lat/lon offset during descent so the track ends at the reported point.
const lastDyn = shipDyn[shipDyn.length - 1]
const flipGeo = ecefToGeo(eciToEcef(lastDyn.s.r, lastDyn.t))
const shipTarget = mission.shipLanding
const corr = shipTarget ? { dLat: shipTarget.lat - flipGeo.lat, dLon: wrap180(shipTarget.lon - flipGeo.lon) } : { dLat: 0, dLon: 0 }
console.log(`Ship flip point ${flipGeo.lat.toFixed(2)}, ${flipGeo.lon.toFixed(2)}; correction`, corr)
if (Math.hypot(corr.dLat, corr.dLon) > 8) console.warn('⚠ large landing-point correction — check event times / targets')
const corrStart = tEntry

// ───────────────────────── assemble ship track ─────────────────────────
const tEnd = tSplash + 90
const ship: Sample[] = []
for (const a of ascent.samples) ship.push({ t: a.t, r: a.r, pitch: 0, heading: a.bearing })
for (const { t, s } of shipDyn) {
  if (t <= tSeco) continue
  let r = eciToEcef(s.r, t)
  if (t > tDeoE) {
    // apply the correction while still hypersonic so it never distorts the slow descent
    const k = smoothstep(tDeoE, corrStart + 500, t)
    const g = ecefToGeo(r)
    r = geoToEcef(g.lat + corr.dLat * k, g.lon + corr.dLon * k, g.alt)
  }
  ship.push({ t, r, pitch: 0, heading: 0 })
}
// landing burn: decelerate to zero at splashdown (kinematic, vertical)
{
  const last = ship[ship.length - 1]
  const g = ecefToGeo(last.r)
  const prev = ecefToGeo(ship[ship.length - 2].r)
  const v0 = prev.alt - g.alt // m/s downwards
  const T = tSplash - last.t
  for (let t = last.t + DT; t <= tEnd; t += DT) {
    const k = clamp((t - last.t) / T)
    // cubic Hermite from (alt, -v0) to (0, 0)
    const h = hermite(g.alt, 0, -v0 * T, 0, k)
    ship.push({ t, r: geoToEcef(g.lat, g.lon, Math.max(0, h)), pitch: 90, heading: 0 })
  }
}

// ───────────────────────── booster track ─────────────────────────
// Separation → boostback start: integrated in the (downrange, altitude) plane from the staging state, so the
// velocity is continuous at staging. The ship's plume shoves the booster back for a second or two, the three
// centre engines keep a little thrust until the flip turns them sideways. Boostback: cubic Hermite onto the
// boostback-end anchor with the anchors' own velocity there. After that: splines through the anchors.
const tBoosterSplash = ev('booster-splashdown').t
const tBbS = ev('boostback-start').t
const tBbE = ev('boostback-end').t
const FLIP_END = tBbS + 8
const IMPINGE = 30 // m/s², ship plume on the booster's forward dome, decaying in ~0.7 s
const CENTRE_THRUST = 3 // m/s², three centre Raptors at ~50 % on a nearly empty booster
const boosterAnchors = kf.booster.slice().sort((a, b) => a.t - b.t)
const bAlt: number[][] = []
const bX: number[][] = []
for (const a of boosterAnchors) {
  if (a.t < tBbE) continue
  if (a.altKm !== undefined) bAlt.push([a.t, a.altKm * 1000])
  if (a.downrangeKm !== undefined) bX.push([a.t, a.downrangeKm * 1000])
}
if (bX[0]?.[0] !== tBbE || bAlt[0]?.[0] !== tBbE) throw new Error(`keyframes.json needs a booster anchor (altKm + downrangeKm) at boostback end, t=${tBbE}`)
const bAltF = pchip(
  bAlt.map((p) => p[0]),
  bAlt.map((p) => p[1]),
)
const bXF = pchip(
  bX.map((p) => p[0]),
  bX.map((p) => p[1]),
)
const stageSample = ascent.samples.find((s) => s.t === tStage)!
const coast: { x: number; h: number }[] = []
let bbStart = { x: 0, h: 0, vx: 0, vz: 0 }
{
  let x = stageSample.downrange
  let h = ecefToGeo(stageSample.r).alt
  let vx = stageSample.vh
  let vz = stageSample.vz
  const sub = 100
  const step = DT / sub
  for (let i = 0; i < ((tBbS - tStage) / DT) * sub; i++) {
    const t = tStage + i * step
    if (i % sub === 0) coast.push({ x, h })
    const v = Math.hypot(vx, vz)
    const τ = t - tStage
    const turned = Math.PI * smoothstep(tStage, FLIP_END, t) * (138 / 180)
    const along = -IMPINGE * Math.exp(-τ / 0.7) + CENTRE_THRUST * Math.max(0, Math.cos(turned))
    const g = MU_EARTH / (R_EARTH + h) ** 2 - vx * vx / (R_EARTH + h)
    vx += (along * vx) / v * step
    vz += ((along * vz) / v - g) * step
    x += vx * step
    h += vz * step
  }
  bbStart = { x, h, vx, vz }
}
const dT = 0.01
const bbEnd = { x: bXF(tBbE), h: bAltF(tBbE), vx: (bXF(tBbE + dT) - bXF(tBbE)) / dT, vz: (bAltF(tBbE + dT) - bAltF(tBbE)) / dT }
{
  const T = tBbE - tBbS
  const a0 = (p0: number, p1: number, v0: number, v1: number) => (6 * (p1 - p0) - (4 * v0 + 2 * v1) * T) / (T * T)
  const a1 = (p0: number, p1: number, v0: number, v1: number) => (-6 * (p1 - p0) + (2 * v0 + 4 * v1) * T) / (T * T)
  const ax = [a0(bbStart.x, bbEnd.x, bbStart.vx, bbEnd.vx), a1(bbStart.x, bbEnd.x, bbStart.vx, bbEnd.vx)]
  const az = [a0(bbStart.h, bbEnd.h, bbStart.vz, bbEnd.vz), a1(bbStart.h, bbEnd.h, bbStart.vz, bbEnd.vz)]
  console.log(
    `Booster: boostback ${(bbStart.x / 1000).toFixed(1)} → ${(bbEnd.x / 1000).toFixed(1)} km downrange, v ${bbStart.vx.toFixed(0)} → ${bbEnd.vx.toFixed(0)} m/s, ` +
      `accel ${ax.map((a, i) => (Math.hypot(a, az[i] + 9.6) / 9.81).toFixed(1)).join(' → ')} g`,
  )
}
const booster: Sample[] = []
const bEnd = tBoosterSplash + 60
for (let t = 0; t <= bEnd; t += DT) {
  if (t <= tStage) {
    const a = ascent.samples[t]
    booster.push({ t, r: a.r, pitch: 0, heading: a.bearing })
    continue
  }
  let x: number
  let h: number
  if (t < tBbS) ({ x, h } = coast[t - tStage])
  else if (t < tBbE) {
    const T = tBbE - tBbS
    const k = (t - tBbS) / T
    x = hermite(bbStart.x, bbEnd.x, bbStart.vx * T, bbEnd.vx * T, k)
    h = hermite(bbStart.h, bbEnd.h, bbStart.vz * T, bbEnd.vz * T, k)
  } else {
    x = bXF(t)
    h = bAltF(t)
  }
  const d = destination(pad.lat, pad.lon, azimuth, x)
  booster.push({ t, r: geoToEcef(d.lat, d.lon, Math.max(0, h)), pitch: 0, heading: d.bearing })
}

// ───────────────────────── derived channels ─────────────────────────
function attitudeBooster(t: number, γ: number, vzDown: boolean) {
  if (t <= tStage) return γ
  if (t < FLIP_END) return lerpAngle(γ, 168, smoothstep(tStage, FLIP_END, t))
  if (t < tBbE) return 168
  // reorient engines-down for descent
  const k = smoothstep(tBbE, tBbE + 25, t)
  return lerpAngle(168, 90, k) + (vzDown ? 0 : 0)
}

function attitudeShip(t: number, γ: number, h: number) {
  if (t <= tStage) return γ
  if (t <= tSeco) return γ + 10 * smoothstep(tStage, tStage + 30, t)
  const tDeoPrep = tDeoS - 180
  if (t < tDeoPrep) return 0 // nose prograde, belly to Earth
  if (t < tDeoE + 60) {
    // flip to retrograde for the deorbit burn and back
    const into = smoothstep(tDeoPrep, tDeoS - 30, t)
    const out = smoothstep(tDeoE + 5, tDeoE + 60, t)
    return lerpAngle(0, 180, into * (1 - out))
  }
  if (t < tFlip) {
    // entry: ~55° angle of attack, increasing to belly-flop (~flat) in the lower atmosphere
    const aoa = 55 + 35 * smoothstep(40_000, 15_000, h)
    return γ + aoa
  }
  // landing flip
  return lerpAngle(0, 90, smoothstep(tFlip, tFlip + 4, t))
}

function buildTrack(samples: Sample[], which: 'booster' | 'ship', eng: StageEngines) {
  const n = samples.length
  const lat: number[] = []
  const lon: number[] = []
  const alt: number[] = []
  const speed: number[] = []
  const vspeed: number[] = []
  const heading: number[] = []
  const pitch: number[] = []
  const q: number[] = []
  const accel: number[] = []
  const lox: number[] = []
  const ch4: number[] = []
  // propellant: integrate lit engines × throttle
  const cons: number[] = []
  let c = 0
  for (let i = 0; i < n; i++) {
    const st = stageEngineState(eng, samples[i].t)
    c += st.lit * Math.max(0.4, st.throttle) * DT
    cons.push(c)
  }
  const cTotal = c || 1
  const finalRemaining = which === 'booster' ? 0.025 : 0.035
  // booster: MECO residual ~ 8% for boostback/landing
  const tMeco = ev('meco').t
  const cMeco = cons[Math.min(n - 1, tMeco)] ?? cTotal

  for (let i = 0; i < n; i++) {
    const s = samples[i]
    const g = ecefToGeo(s.r)
    const rp = samples[Math.max(0, i - 1)].r
    const rn = samples[Math.min(n - 1, i + 1)].r
    const span = (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * DT || 1
    const vEcef = scale(sub(rn, rp), 1 / span)
    const v = len(vEcef)
    const up = norm(s.r)
    const vz = dot(vEcef, up)
    const vh = Math.sqrt(Math.max(0, v * v - vz * vz))
    // direction of horizontal motion relative to heading (for booster boostback sign)
    const { e, n: nn } = enuBasis(g.lat, g.lon)
    const he = dot(vEcef, e)
    const hn = dot(vEcef, nn)
    const trackHeading = vh > 2 ? (Math.atan2(he, hn) / DEG + 360) % 360 : s.heading
    const hdg = which === 'booster' ? s.heading : trackHeading
    const forward = which === 'booster' ? Math.cos((trackHeading - s.heading) * DEG) >= 0 : true
    const γ = Math.atan2(vz, forward ? vh : -vh) / DEG
    // sensed acceleration in inertial frame
    const t = s.t
    const iPrev = Math.max(0, i - 1)
    const iNext = Math.min(n - 1, i + 1)
    let aSensed = 0
    if (iNext - iPrev === 2) {
      const r0 = ecefToEci(samples[iPrev].r, samples[iPrev].t)
      const r1 = ecefToEci(s.r, t)
      const r2 = ecefToEci(samples[iNext].r, samples[iNext].t)
      const aI = scale(add(sub(r2, scale(r1, 2)), r0), 1 / (DT * DT))
      aSensed = len(sub(aI, g.alt < 1 && t < 1 ? [0, 0, 0] : gravity(r1))) / 9.80665
    }
    if (g.alt < 5 && (t < 1 || (which === 'booster' ? t >= tBoosterSplash : t >= tSplash))) aSensed = 1
    let p = which === 'booster' ? attitudeBooster(t, γ, vz < 0) : attitudeShip(t, γ, g.alt)
    if (t < 8) p = 90
    if (which === 'ship' && t > tSplash) p = lerpAngle(90, 4, smoothstep(tSplash + 2, tSplash + 9, t))
    if (which === 'booster' && t > tBoosterSplash) p = lerpAngle(90, 6, smoothstep(tBoosterSplash + 3, tBoosterSplash + 12, t))
    let rem: number
    if (which === 'booster') {
      rem = cons[i] <= cMeco ? 1 - (0.92 * cons[i]) / cMeco : 0.08 - (0.08 - finalRemaining) * ((cons[i] - cMeco) / Math.max(1, cTotal - cMeco))
    } else rem = 1 - (1 - finalRemaining) * (cons[i] / cTotal)
    lat.push(round(g.lat, 5))
    lon.push(round(g.lon, 5))
    alt.push(round(Math.max(0, g.alt), 1))
    speed.push(round(t <= 0 ? 0 : v, 2))
    vspeed.push(round(vz, 2))
    heading.push(round(hdg, 2))
    pitch.push(round(p, 2))
    q.push(round(0.5 * rho(g.alt) * v * v, 0))
    accel.push(round(aSensed, 3))
    lox.push(round(clamp(rem), 4))
    ch4.push(round(clamp(rem * 1.015 - 0.005), 4))
  }
  return { dt: DT, t0: samples[0].t, lat, lon, alt, speed, vspeed, heading, pitch, q, accel, lox, ch4 }
}

const boosterTrack = buildTrack(booster, 'booster', engines.booster)
const shipTrack = buildTrack(ship, 'ship', engines.ship)

// planned ground track: what the full-duration mission would have flown (continue the orbit, no deorbit)
const planned: [number, number][] = []
{
  const plannedEnd = mission.durationSec && mission.durationSec > 0 ? Math.max(tEnd, 6 * 5400) : 6 * 5400
  propagate(orbitState, tOibE, plannedEnd, [], undefined, (t, s) => {
    if (t % 60 === 0) {
      const g = ecefToGeo(eciToEcef(s.r, t))
      planned.push([round(g.lat, 3), round(g.lon, 3)])
    }
  })
}

// report key numbers
const maxQi = shipTrack.q.indexOf(Math.max(...shipTrack.q.slice(0, tStage)))
console.log(`Max Q at T+${maxQi}s: ${(shipTrack.q[maxQi] / 1000).toFixed(1)} kPa`)
const ms = (tr: typeof shipTrack, t: number) => `${(tr.speed[t] * 3.6).toFixed(0)} km/h @ ${(tr.alt[t] / 1000).toFixed(1)} km`
for (const id of ['meco', 'hot-staging', 'boostback-end', 'booster-landing-burn-start']) {
  const e = evOpt(id)
  if (e) console.log(`booster ${id.padEnd(28)} ${ms(boosterTrack, Math.round(e.t))}`)
}
for (const id of ['meco', 'seco', 'oib-start', 'payload-deploy-start', 'deorbit-start', 'ship-entry', 'ship-transonic', 'ship-subsonic', 'ship-landing-flip']) {
  const e = evOpt(id)
  if (e && e.t < shipTrack.speed.length) console.log(`ship    ${id.padEnd(28)} ${ms(shipTrack, Math.round(e.t))}`)
}
const bApex = Math.max(...boosterTrack.alt)
console.log(`Booster apex ${(bApex / 1000).toFixed(1)} km; ship splash ${shipTrack.lat.at(-1)}, ${shipTrack.lon.at(-1)}; booster splash ${boosterTrack.lat.at(-1)}, ${boosterTrack.lon.at(-1)}`)
{
  const mach1 = shipTrack.speed.findIndex((v, i) => i > tEntry && v < speedOfSound(shipTrack.alt[i]))
  console.log(`Ship subsonic (computed) at T+${mach1}s`)
}

const out = { generated: new Date().toISOString(), booster: boosterTrack, ship: shipTrack, plannedShipGroundTrack: planned }
fs.writeFileSync(path.join(dir, 'telemetry.json'), JSON.stringify(out))
console.log(`wrote ${path.join(dir, 'telemetry.json')} (${(fs.statSync(path.join(dir, 'telemetry.json')).size / 1e6).toFixed(2)} MB)`)

// ───────────────────────── helpers ─────────────────────────
function round(x: number, d: number) {
  const k = 10 ** d
  return Math.round(x * k) / k
}
function wrap180(x: number) {
  return ((((x + 180) % 360) + 360) % 360) - 180
}
function lerpAngle(a: number, b: number, k: number) {
  return a + (b - a) * k
}
function hermite(p0: number, p1: number, m0: number, m1: number, t: number) {
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1
}
function fmtEl(el: ReturnType<typeof elementsFromState>) {
  return `${(el.perigeeAlt / 1000).toFixed(1)} × ${(el.apogeeAlt / 1000).toFixed(1)} km, i=${el.i.toFixed(2)}°, P=${(el.period / 60).toFixed(1)} min`
}
