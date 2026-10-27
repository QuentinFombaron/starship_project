import { memo } from 'react'
import { engineLayout, type EngineStatus } from '../sim/engines'

/** Webcast-style engine diagram: white = running, dark = off, red = failed. */
export const EngineRings = memo(function EngineRings({
  rings,
  status,
  size = 92,
  highlightFailures = true,
  label,
}: {
  rings: number[]
  status: EngineStatus[]
  size?: number
  highlightFailures?: boolean
  label?: string
}) {
  const pts = engineLayout(rings).map((p) => (rings.length === 2 && p.ring === 1 ? { ...p, x: p.x * 0.78, y: p.y * 0.78 } : p))
  const total = pts.length
  const dotR = total > 10 ? 0.075 : 0.17
  const big = rings.length === 2 // ship: RVacs drawn larger
  return (
    <svg viewBox="-1.12 -1.12 2.24 2.24" width={size} height={size} role="img" aria-label={label ?? 'Engine status'}>
      <circle r={1.08} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.025} />
      {pts.map((p, i) => {
        const s = status[i] ?? 'off'
        const r = big && p.ring === 1 ? dotR * 1.45 : dotR
        const failed = s === 'failed' || s === 'failed-active'
        const lit = s === 'lit'
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={r}
            fill={lit ? '#ffffff' : failed && highlightFailures ? 'rgba(255,77,77,0.25)' : 'rgba(255,255,255,0.08)'}
            stroke={failed && highlightFailures ? '#ff4d4d' : lit ? '#ffffff' : 'rgba(255,255,255,0.4)'}
            strokeWidth={0.02}
          >
            <title>{`Engine ${i + 1}: ${s}`}</title>
          </circle>
        )
      })}
    </svg>
  )
})
