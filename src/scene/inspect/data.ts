import { create } from 'zustand'
import { clamp, smoothstep } from '../../sim/interpolate'
import type { Replay, Vehicle } from '../../sim/replay'
import type { EngineStatus } from '../../sim/engines'
import { starlinkReleaseTimes } from '../effects/Starlink'

/** What the pointer is over (hover) and what the user clicked to keep open (pinned). */
export const useInspect = create<{
  hover: string | null
  pinned: string | null
  x: number
  y: number
  set: (p: Partial<{ hover: string | null; pinned: string | null; x: number; y: number }>) => void
}>((set) => ({ hover: null, pinned: null, x: 0, y: 0, set: (p) => set(p) }))

/** Vehicle whose hull turns see-through to show the tanks (hovered or pinned). */
export function xrayVehicle(s: { hover: string | null; pinned: string | null }): Vehicle | null {
  const id = s.pinned ?? s.hover
  if (!id) return null
  if (id.startsWith('booster')) return 'booster'
  if (id.startsWith('ship')) return 'ship'
  return null
}

/** Approximate Block 3 propellant capacities in tonnes (SpaceX has quoted ~3,650 t and ~1,600 t). */
export const CAPACITY = {
  booster: { lox: 2860, ch4: 790 },
  ship: { lox: 1250, ch4: 350 },
}

/** Raptor 3 figures SpaceX published in 2024. */
export const RAPTOR3 = {
  sl: { thrustMN: 2.75, isp: 350, label: 'Raptor 3 (sea level)' },
  vac: { thrustMN: 3.0, isp: 380, label: 'Raptor 3 Vacuum' },
  chamberBar: 350,
}

/** Main-tank fill fraction: loads during the countdown, then follows the reconstructed telemetry. */
export function propLevels(replay: Replay, vehicle: Vehicle, t: number) {
  const s = (vehicle === 'booster' ? replay.booster : replay.ship).sample(Math.max(0, t))
  if (t >= 0) return { lox: s.lox, ch4: s.ch4 }
  const load = smoothstep(replay.t('prop-load', -3240), replay.t('prop-load-complete', -180), t)
  return { lox: s.lox * load, ch4: s.ch4 * load }
}

/** Ship header tanks: topped off for the relights; the OIB is header-fed, the landing burn drains them. */
export function headerLevel(replay: Replay, t: number) {
  const load = smoothstep(replay.t('prop-load', -3240), replay.t('prop-load-complete', -180), t)
  const oib = smoothstep(replay.t('oib-start', 1e9), replay.t('oib-end', 1e9), t) * 0.22
  const deo = smoothstep(replay.t('deorbit-start', 1e9), replay.t('deorbit-end', 1e9), t) * 0.18
  const land = smoothstep(replay.t('ship-landing-burn-start', 1e9), replay.t('ship-splashdown', 1e9), t) * 0.5
  return clamp(load - oib - deo - land)
}

export function starlinksAboard(replay: Replay, t: number) {
  const n = replay.data.mission.payload?.count ?? 0
  const start = replay.t('payload-deploy-start', 1e9)
  const times = starlinkReleaseTimes(start, replay.t('payload-deploy-end', start + 1800), n)
  return { aboard: times.filter((x) => x > t).length, total: n }
}

/** 0 = closed … 1 = open. Opens with the deploy sequence and closes a minute after the last satellite. */
export function pezDoor(replay: Replay, t: number) {
  const open = replay.t('pez-door-open', replay.t('payload-deploy-start', 1e9) - 45)
  const close = replay.t('payload-deploy-end', 1e9) + 60
  return smoothstep(open, open + 12, t) * (1 - smoothstep(close, close + 12, t))
}

export interface EngineRow {
  name: string
  group: string
  status: EngineStatus
  note?: string
}

export interface InspectInfo {
  kicker: string
  title: string
  rows: [string, string][]
  levels?: { label: string; frac: number; detail: string; color: string }[]
  engines?: { rings: number[]; status: EngineStatus[]; list: EngineRow[] }
  note?: string
}

const pct = (x: number) => `${Math.round(clamp(x) * 100)}%`
const fmtN = (x: number, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
const LOX = '#8fd0ff'
const CH4 = '#ffae66'
const WATER = '#6fb6d6'
const LN2 = '#c9c2ff'

function engineNames(vehicle: Vehicle, total: number, labels: string[] | undefined, rings: number[]) {
  const names: { name: string; group: string }[] = []
  const prefix = vehicle === 'booster' ? ['C', 'M', 'O'] : ['S', 'V']
  rings.forEach((n, r) => {
    for (let k = 0; k < n; k++) names.push({ name: `${prefix[r] ?? 'E'}${k + 1}`, group: labels?.[r] ?? `Ring ${r + 1}` })
  })
  return names.slice(0, total)
}

function engineInfo(replay: Replay, vehicle: Vehicle, t: number): InspectInfo {
  const cfg = replay.data.engines[vehicle]
  const st = replay.engines(vehicle, t)
  const names = engineNames(vehicle, st.total, cfg.labels, cfg.rings)
  const notes = new Map(cfg.failures.map((f) => [f.engine, `${f.kind} at T+${Math.round(f.t)} s${f.note ? ` · ${f.note}` : ''}`]))
  const list = names.map((n, i) => ({ ...n, status: st.status[i], note: notes.get(i) }))
  const vac = vehicle === 'ship'
  const thrust = st.status.reduce((a, s, i) => a + (s === 'lit' ? (vac && i >= 3 ? RAPTOR3.vac.thrustMN : RAPTOR3.sl.thrustMN) * st.throttle : 0), 0)
  return {
    kicker: vehicle === 'booster' ? 'Super Heavy · 33 × Raptor 3' : 'Starship · 3 sea-level + 3 vacuum Raptor 3',
    title: vehicle === 'booster' ? 'Booster engines' : 'Ship engines',
    rows: [
      ['Running', `${st.lit} / ${st.total}`],
      ['Burn', st.burn ?? '—'],
      ['Throttle', st.lit ? pct(st.throttle) : '—'],
      ['Thrust (est.)', st.lit ? `${fmtN(thrust, 1)} MN` : '—'],
      ['Chamber pressure', st.lit ? `~${Math.round(RAPTOR3.chamberBar * (0.6 + 0.4 * st.throttle))} bar` : '—'],
      ['Isp', vac ? `${RAPTOR3.sl.isp} s SL · ${RAPTOR3.vac.isp} s vac` : `${RAPTOR3.sl.isp} s`],
    ],
    engines: { rings: cfg.rings, status: st.status, list },
    note: 'Engine names follow the ring order (C centre, M middle, O outer; S sea level, V vacuum). Which physical engines failed has not been published.',
  }
}

function vehicleInfo(replay: Replay, vehicle: Vehicle, t: number): InspectInfo {
  const m = replay.data.mission
  const s = (vehicle === 'booster' ? replay.booster : replay.ship).sample(Math.max(0, t))
  const st = replay.engines(vehicle, t)
  const lv = propLevels(replay, vehicle, t)
  const cap = CAPACITY[vehicle]
  const onMount = t < 0
  const rows: [string, string][] = [
    ['Altitude', `${fmtN(onMount ? 0 : s.alt / 1000, 1)} km`],
    ['Speed', `${fmtN(onMount ? 0 : s.speed * 3.6)} km/h`],
    ['Vertical speed', `${fmtN(onMount ? 0 : s.vspeed, 0)} m/s`],
    ['Acceleration', `${fmtN(s.accel, 2)} g`],
    ['Engines', `${st.lit} / ${st.total}${st.burn ? ` · ${st.burn}` : ''}`],
    ['Propellant', `${fmtN(lv.lox * cap.lox + lv.ch4 * cap.ch4)} t`],
  ]
  const levels = [
    { label: 'LOX tank', frac: lv.lox, detail: `${fmtN(lv.lox * cap.lox)} / ${fmtN(cap.lox)} t`, color: LOX },
    { label: 'Methane tank', frac: lv.ch4, detail: `${fmtN(lv.ch4 * cap.ch4)} / ${fmtN(cap.ch4)} t`, color: CH4 },
  ]
  if (vehicle === 'ship') {
    const h = headerLevel(replay, t)
    levels.push({ label: 'Header tanks', frac: h, detail: 'for relights and landing', color: '#ffffff' })
    const sl = starlinksAboard(replay, t)
    if (sl.total) rows.push(['Starlink V3 aboard', `${sl.aboard} / ${sl.total}`])
    const door = pezDoor(replay, t)
    rows.push(['PEZ door', door > 0.98 ? 'Open' : door > 0.02 ? 'Moving' : 'Closed'])
  }
  return {
    kicker: vehicle === 'booster' ? 'Super Heavy · Block 3' : 'Starship · Block 3',
    title: vehicle === 'booster' ? `Booster ${m.vehicles.booster.id}` : `Ship ${m.vehicles.ship.id}`,
    rows,
    levels,
    note: 'X-ray view: liquid oxygen aft, methane forward. Capacities are approximate; levels follow the reconstructed burns.',
  }
}

/** Live data for every hoverable object. Pad facts: NASASpaceflight pad reports 2025–26 and the FAA filings. */
export function inspectInfo(id: string, replay: Replay, t: number): InspectInfo | null {
  const tDeluge = replay.t('deluge', -10)
  const load = smoothstep(replay.t('prop-load', -3240), replay.t('prop-load-complete', -180), t)
  const loading = t > replay.t('prop-load', -3240) && t < replay.t('prop-load-complete', -180)
  const delugeOn = t > tDeluge && t < 25
  switch (id) {
    case 'booster':
    case 'ship':
      return vehicleInfo(replay, id, t)
    case 'booster-engines':
      return engineInfo(replay, 'booster', t)
    case 'ship-engines':
      return engineInfo(replay, 'ship', t)
    case 'tower-b':
      return {
        kicker: 'Pad B · Integration Tower 2',
        title: 'Launch and catch tower',
        rows: [
          ['Height', '144.5 m (FAA filing)'],
          ['Structure', '9 steel lattice modules on a clad, concrete-filled base'],
          ['Roof', 'Clad roof shielding the drawworks (2026)'],
          ['Chopsticks', '~26 m arms, electromechanical'],
          ['Status', t < 0 ? 'Stack on the mount' : t < 12 ? 'Vehicle clearing the tower' : 'Clear'],
        ],
      }
    case 'chopsticks':
      return {
        kicker: 'Pad B · Mechazilla',
        title: 'Chopsticks',
        rows: [
          ['Arm length', '~26 m, about 10 m shorter than Pad A'],
          ['Actuation', 'Electromechanical (Pad A: hydraulic)'],
          ['Catch hardware', 'One sled per rail + telescopic tip pusher'],
          ['Load test', '700 US tons (May 2025)'],
          ['Status', t < 0 ? 'Parked open for launch' : 'Parked (booster splashes down on this flight)'],
        ],
      }
    case 'sqd': {
      const swing = smoothstep(-22, -12, t)
      return {
        kicker: 'Pad B',
        title: 'Ship quick-disconnect arm',
        rows: [
          ['Role', 'Feeds the ship LOX, methane and power through its aft skirt'],
          ['Design', 'Separate, reinforced swing arm; swings further clear at launch'],
          ['Status', swing <= 0 ? (loading ? 'Connected · loading the ship' : 'Connected') : swing < 1 ? 'Retracting' : 'Retracted'],
        ],
      }
    }
    case 'bqd':
      return {
        kicker: 'Pad B · launch mount',
        title: 'Booster quick-disconnects',
        rows: [
          ['Layout', 'Two units (LOX, methane) under angular hoods on the tower side'],
          ['Status', t < 0 ? (loading ? 'Connected · loading the booster' : 'Connected') : 'Disconnected at liftoff'],
        ],
      }
    case 'olm-b':
      return {
        kicker: 'Pad B',
        title: 'Launch mount',
        rows: [
          ['Shape', 'Box with a circular booster opening, wrapped in sloped steel cladding'],
          ['Footprint', '~44 m at the base (est.)'],
          ['Hold-down clamps', t < 0 ? '20 · clamped' : '20 · released'],
          ['Deck', `Water-cooled steel plate · ${delugeOn ? 'water ON' : 'water off'}`],
          ['Booster on mount', t < 0 ? 'Yes' : 'No'],
        ],
        levels: [{ label: 'Deluge water flow', frac: delugeOn ? 1 - smoothstep(10, 25, t) * 0.8 : 0, detail: delugeOn ? 'spraying' : 'idle', color: WATER }],
      }
    case 'diverter':
    case 'trench':
      return {
        kicker: 'Pad B',
        title: 'Flame trench and diverter',
        rows: [
          ['Trench', 'Steel-lined concrete “bathtub” with two exits'],
          ['Diverter', 'Double-sided, water-cooled flame bucket of perforated pipes'],
          ['Ridge cap', 'Sprays water along the top of the diverter'],
          ['Exhaust', t > -3 && t < 15 ? 'Flowing' : '—'],
          ['Water', delugeOn ? 'ON' : 'off'],
        ],
        note: 'The deluge sprays water up through the steel deck and the diverter; fans nicknamed Pad A’s water-cooled plate the “booster bidet”.',
      }
    case 'deluge-farm': {
      const level = 1 - 0.85 * smoothstep(tDeluge, 25, t)
      return {
        kicker: 'Pad B',
        title: 'Deluge water farm',
        rows: [
          ['Tanks', '12 horizontal water tanks + vertical nitrogen tanks'],
          ['Per launch', 'Up to ~422,000 gal (1,600 m³), FAA environmental assessment'],
          ['Pressurisation', 'Gas generators boil liquid nitrogen'],
          ['Systems', 'Diverter buckets, ridge cap, deck plate'],
          ['Status', delugeOn ? 'Discharging' : t < tDeluge ? 'Pressurised, ready' : 'Refilling'],
        ],
        levels: [{ label: 'Water', frac: level, detail: pct(level), color: WATER }],
      }
    }
    case 'farm-lox':
    case 'farm-ch4':
    case 'farm-ln2': {
      const kind = id === 'farm-lox' ? 'Liquid oxygen' : id === 'farm-ch4' ? 'Liquid methane' : 'Liquid nitrogen'
      const frac = id === 'farm-ln2' ? 0.8 - 0.15 * load : 0.95 - 0.62 * load
      return {
        kicker: 'Orbital launch site · propellant farm',
        title: `${kind} tanks`,
        rows: [
          ['Tanks', id === 'farm-lox' ? '10 horizontal' : '6 horizontal'],
          ['Use', id === 'farm-ln2' ? 'Subcooling the propellant and purging lines' : 'Shared by Pad A and Pad B, with pumps and subcoolers'],
          ['Status', loading ? 'Flowing to the vehicle' : load >= 1 ? 'Load complete' : 'Standby'],
        ],
        levels: [{ label: kind, frac, detail: pct(frac), color: id === 'farm-lox' ? LOX : id === 'farm-ch4' ? CH4 : LN2 }],
        note: 'Farm levels are illustrative; SpaceX does not publish them.',
      }
    }
    case 'pad-a':
      return {
        kicker: 'Orbital Launch Pad 1',
        title: 'Pad A',
        rows: [
          ['Flights', '1–11, including the first booster catch (Flight 5)'],
          ['Mount', 'Original table-style mount over a water-cooled steel plate'],
          ['2026', 'Being rebuilt to match Pad B'],
        ],
      }
  }
  return null
}
