import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EnginesSchema, KeyframesSchema, TelemetrySchema, TimelineSchema } from '../content/schema'
import { RATE_PRESETS, formatT, useClock } from './clock'
import { R_EARTH, destination, ecefToEci, ecefToGeo, eciToEcef, geoToEcef, haversine } from './coords'
import { stageEngineState } from './engines'
import { pchip } from './interpolate'
import { elementsFromState, periodFromAlts } from './orbit'
import { TrackSampler } from './vehicleState'

const dir = 'content/flights/flight-14'
const read = (f: string) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))
const engines = EnginesSchema.parse(read('engines.json'))
const timeline = TimelineSchema.parse(read('timeline.json'))
const keyframes = KeyframesSchema.parse(read('keyframes.json'))
const telemetry = TelemetrySchema.parse(read('telemetry.json'))
const at = (id: string) => timeline.find((e) => e.id === id)!.t

describe('coordinates', () => {
  it('round-trips geodetic ↔ ECEF', () => {
    const g = ecefToGeo(geoToEcef(25.9959, -97.154, 123))
    expect(g.lat).toBeCloseTo(25.9959, 8)
    expect(g.lon).toBeCloseTo(-97.154, 8)
    expect(g.alt).toBeCloseTo(123, 4)
  })
  it('converts between inertial and Earth-fixed frames', () => {
    const p = geoToEcef(0, 0, 0)
    const back = ecefToEci(eciToEcef(p, 3600), 3600)
    expect(back[0]).toBeCloseTo(p[0], 3)
    // a fixed inertial point drifts ~15°/h west over the ground
    const g = ecefToGeo(eciToEcef(p, 3600))
    expect(g.lon).toBeCloseTo(-15.04, 1)
  })
  it('computes great-circle destinations consistent with haversine', () => {
    const d = destination(26, -97, 73, 500_000)
    expect(haversine(26, -97, d.lat, d.lon)).toBeCloseTo(500_000, -1)
  })
})

describe('orbit', () => {
  it('has a ~89.7 min period for a 262 × 275 km orbit', () => {
    expect(periodFromAlts(262_000, 275_000) / 60).toBeCloseTo(89.7, 0)
  })
  it('recovers elements of a circular equatorial orbit', () => {
    const r = R_EARTH + 270_000
    const v = Math.sqrt(3.986004418e14 / r)
    const el = elementsFromState({ r: [r, 0, 0], v: [0, 0, -v] })
    expect(el.i).toBeCloseTo(0, 5)
    expect(el.e).toBeLessThan(1e-9)
  })
})

describe('interpolation', () => {
  it('pchip passes through anchors without overshoot', () => {
    const f = pchip([0, 10, 20, 30], [0, 100, 100, 50])
    expect(f(10)).toBe(100)
    for (let x = 10; x <= 20; x += 0.5) expect(f(x)).toBeLessThanOrEqual(100 + 1e-9)
  })
})

describe('engines', () => {
  it('lights all 33 booster engines at liftoff', () => {
    expect(stageEngineState(engines.booster, 5).lit).toBe(33)
  })
  it('loses one booster engine on ascent', () => {
    expect(stageEngineState(engines.booster, at('booster-engine-out') + 5).lit).toBe(32)
  })
  it('relights 31 of 33 for boostback', () => {
    expect(stageEngineState(engines.booster, at('boostback-start') + 10).lit).toBe(31)
  })
  it('relights 11 of 13 for the landing burn', () => {
    expect(stageEngineState(engines.booster, at('booster-landing-burn-start') + 5).lit).toBe(11)
  })
  it('flies the ship ascent on 5 of 6 engines after the RVac failure', () => {
    expect(stageEngineState(engines.ship, at('rvac-out') + 5).lit).toBe(5)
  })
  it('uses one sea-level Raptor for the deorbit burn', () => {
    expect(stageEngineState(engines.ship, at('deorbit-start') + 5).lit).toBe(1)
  })
})

describe('reconstructed telemetry', () => {
  const ship = new TrackSampler(telemetry.ship)
  const booster = new TrackSampler(telemetry.booster)
  it('starts on the pad', () => {
    const s = ship.sample(0)
    expect(s.alt).toBeLessThan(1)
    expect(haversine(s.lat, s.lon, 25.9968, -97.15818)).toBeLessThan(50)
  })
  it('matches ship ascent anchors', () => {
    for (const a of keyframes.ship.filter((x) => x.t < 400)) {
      const s = ship.sample(a.t)
      if (a.altKm !== undefined) expect(Math.abs(s.alt / 1000 - a.altKm)).toBeLessThan(1.5)
      if (a.speedKmh !== undefined && a.t > 5) expect(Math.abs(s.speed * 3.6 - a.speedKmh) / a.speedKmh).toBeLessThan(0.06)
    }
  })
  it('reaches the reported orbit', () => {
    let lo = Infinity
    let hi = 0
    for (let t = at('oib-end') + 60; t < at('deorbit-start'); t += 10) {
      const a = ship.sample(t).alt / 1000
      lo = Math.min(lo, a)
      hi = Math.max(hi, a)
    }
    // J2 oblateness makes geometric altitude oscillate ~±10 km around the osculating 262 × 275 km orbit
    expect(lo).toBeGreaterThan(245)
    expect(hi).toBeLessThan(288)
  })
  it('coasts at ~26,380 km/h at T+45 min as reported', () => {
    expect(Math.abs(ship.sample(2700).speed * 3.6 - 26_380)).toBeLessThan(250)
  })
  it('splashes both stages down at sea level', () => {
    expect(ship.sample(at('ship-splashdown')).alt).toBeLessThan(5)
    expect(booster.sample(at('booster-splashdown')).alt).toBeLessThan(5)
  })
  it('keeps telemetry continuous (no teleporting)', () => {
    const sp = telemetry.ship.speed
    for (let i = 1; i < sp.length; i++) expect(Math.abs(sp[i] - sp[i - 1])).toBeLessThan(80)
  })
})

describe('clock', () => {
  it('formats mission time', () => {
    expect(formatT(-30)).toBe('T-00:00:30')
    expect(formatT(11310)).toBe('T+03:08:30')
  })
  it('advances by rate and clamps to bounds', () => {
    const c = useClock.getState()
    c.setBounds(-10, 100)
    c.seek(0)
    c.setRate(10)
    c.setReverse(false)
    c.play()
    useClock.getState().advance(1)
    expect(useClock.getState().t).toBe(10)
    useClock.getState().advance(100)
    expect(useClock.getState().t).toBe(100)
    expect(useClock.getState().playing).toBe(false)
    expect(RATE_PRESETS).toContain(1)
  })
})
