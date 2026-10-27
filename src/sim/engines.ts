import type { StageEngines } from '../content/schema'
import { pchip } from './interpolate'

export type EngineStatus = 'off' | 'lit' | 'failed' | 'failed-active'

export interface StageEngineState {
  status: EngineStatus[]
  lit: number
  total: number
  throttle: number
  burn: string | null
}

/** Ring layout: positions of each engine on a unit disc, centre outwards. */
export function engineLayout(rings: number[]) {
  const pts: { x: number; y: number; ring: number }[] = []
  rings.forEach((n, ring) => {
    const r = ring === 0 ? (n === 1 ? 0 : 0.2) : 0.2 + (0.72 * ring) / (rings.length - 1)
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (ring % 2 ? Math.PI / n : 0) - Math.PI / 2
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, ring })
    }
  })
  return pts
}

const throttleFns = new WeakMap<object, (t: number) => number>()

export function stageEngineState(cfg: StageEngines, t: number): StageEngineState {
  const total = cfg.rings.reduce((a, b) => a + b, 0)
  const status: EngineStatus[] = new Array(total).fill('off')
  const failedAt = new Map<number, number>()
  for (const f of cfg.failures) {
    const prev = failedAt.get(f.engine)
    if (prev === undefined || f.t < prev) failedAt.set(f.engine, f.t)
  }
  let throttle = 0
  let burn: string | null = null
  for (const b of cfg.burns) {
    if (t < b.start || t > b.end) continue
    burn = b.name
    if (b.throttle?.length) {
      let fn = throttleFns.get(b)
      if (!fn) {
        fn = pchip(
          b.throttle.map((p) => p[0]),
          b.throttle.map((p) => p[1]),
        )
        throttleFns.set(b, fn)
      }
      throttle = fn(t)
    } else throttle = 1
    b.engines.forEach((e, i) => {
      // engines start up in a quick staggered sequence
      const stagger = (i % 13) * 0.08
      const f = failedAt.get(e)
      if (f !== undefined && t >= f) {
        // engine that had been lit in this burn before failing flashes as failed-active for a moment
        status[e] = t - f < 2 && f >= b.start ? 'failed-active' : 'failed'
      } else if (t >= b.start + stagger) status[e] = 'lit'
    })
  }
  for (const [e, f] of failedAt) if (t >= f && status[e] === 'off') status[e] = 'failed'
  const lit = status.filter((s) => s === 'lit').length
  return { status, lit, total, throttle: lit ? throttle : 0, burn }
}
