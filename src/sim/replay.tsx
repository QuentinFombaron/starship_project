import { createContext, useContext } from 'react'
import type { ReplayData } from '../content/loader'
import type { TimelineEvent } from '../content/schema'
import { stageEngineState } from './engines'
import { lastIndexAtOrBefore, smoothstep } from './interpolate'
import { TrackSampler, bodyBasis, type VehicleSample } from './vehicleState'
import { add, scale, type Vec3 } from './coords'

export const BOOSTER_LEN = 72.3
export const SHIP_LEN = 52.1
export const DIAMETER = 9
/** Height of the engine plane above ground when sitting on the OLM. */
export const MOUNT_HEIGHT = 22

export type Vehicle = 'booster' | 'ship'

export interface Pose {
  sample: VehicleSample
  /** Centre of mass in ECEF. */
  com: Vec3
  nose: Vec3
  belly: Vec3
  right: Vec3
  up: Vec3
}

/** Everything derived from the loaded content, shared through context. */
export class Replay {
  readonly booster: TrackSampler
  readonly ship: TrackSampler
  readonly tStage: number
  readonly tEnd: number
  readonly launchDate: Date
  readonly data: ReplayData
  constructor(data: ReplayData) {
    this.data = data
    this.booster = new TrackSampler(data.telemetry.booster)
    this.ship = new TrackSampler(data.telemetry.ship)
    this.tStage = this.event('hot-staging')?.t ?? 160
    this.tEnd = Math.max(this.ship.tEnd, this.booster.tEnd)
    this.launchDate = new Date(data.mission.launchTime)
  }

  event(id: string): TimelineEvent | undefined {
    return this.data.timeline.find((e) => e.id === id)
  }
  t(id: string, fallback = 0) {
    return this.event(id)?.t ?? fallback
  }

  engines(vehicle: Vehicle, t: number) {
    return stageEngineState(this.data.engines[vehicle], t)
  }

  /** Last event at or before t. */
  currentEvent(t: number) {
    const i = lastIndexAtOrBefore(this.data.timeline, t, (e) => e.t)
    return i >= 0 ? this.data.timeline[i] : undefined
  }

  /** Whether the stack is still attached. */
  stacked(t: number) {
    return t < this.tStage
  }

  pose(vehicle: Vehicle, t: number): Pose {
    const sampler = vehicle === 'booster' ? this.booster : this.ship
    const s = sampler.sample(t)
    const b = bodyBasis(s.lat, s.lon, s.heading, s.pitch)
    const L = vehicle === 'booster' ? BOOSTER_LEN : SHIP_LEN
    // telemetry point = interstage during ascent; it relaxes to each stage's centre of mass after staging
    const k = smoothstep(this.tStage, this.tStage + 40, t)
    const sign = vehicle === 'booster' ? -1 : 1
    let com = add(s.pos, scale(b.nose, (sign * (1 - k) * L) / 2))
    // lift the stack onto the launch mount near the pad, and stages above the water at splashdown
    const padLift = (MOUNT_HEIGHT + BOOSTER_LEN) * (1 - smoothstep(1500, 9000, s.alt)) * (t < this.tStage ? 1 : 0)
    const nearSurface = t > this.tStage + 40 ? (1 - smoothstep(0, 400, s.alt)) * (L / 2) * Math.abs(b.nose[0] * b.up[0] + b.nose[1] * b.up[1] + b.nose[2] * b.up[2]) : 0
    com = add(com, scale(b.up, padLift + nearSurface + (vehicle === 'booster' ? 0 : 0)))
    return { sample: s, com, nose: b.nose, belly: b.belly, right: b.right, up: b.up }
  }
}

export const ReplayContext = createContext<Replay | null>(null)

export function useReplay() {
  const r = useContext(ReplayContext)
  if (!r) throw new Error('useReplay outside ReplayContext')
  return r
}
