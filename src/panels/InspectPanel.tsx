import { useState } from 'react'
import { EngineRings } from '../hud/EngineRings'
import { inspectInfo, useInspect, type EngineRow } from '../scene/inspect/data'
import { useClock } from '../sim/clock'
import { useReplay } from '../sim/replay'

const STATUS: Record<EngineRow['status'], { label: string; cls: string }> = {
  lit: { label: 'Running', cls: 'text-white' },
  off: { label: 'Off', cls: 'text-dim' },
  failed: { label: 'Failed', cls: 'text-fail' },
  'failed-active': { label: 'Failing', cls: 'text-fail' },
}

/**
 * Live data card for whatever is under the pointer in the 3D scene (or was clicked to pin it). Follows the
 * pointer while hovering; a pinned card docks at the top centre.
 */
export function InspectPanel() {
  const replay = useReplay()
  const { hover, pinned, x, y, set } = useInspect()
  const t = useClock((s) => Math.round(s.t * 4) / 4)
  const [engine, setEngine] = useState<number | null>(null)
  const id = pinned ?? hover
  const info = id ? inspectInfo(id, replay, t) : null
  if (!info) return null
  const docked = !!pinned
  const style = docked ? undefined : { left: Math.min(x + 18, window.innerWidth - 340), top: Math.min(y + 18, window.innerHeight - 420) }
  const sel = engine !== null ? info.engines?.list[engine] : undefined
  return (
    <div
      className={`panel absolute z-30 w-[320px] p-4 text-[12px] ${docked ? 'pointer-events-auto left-1/2 top-[76px] -translate-x-1/2' : 'pointer-events-none'}`}
      style={style}
      role="dialog"
      aria-label={info.title}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="label !text-[10px]">{info.kicker}</div>
          <div className="heading mt-1 text-[16px] tracking-[0.12em]">{info.title}</div>
        </div>
        {docked ? (
          <button className="btn-sm !px-1.5 !py-0.5" onClick={() => set({ pinned: null })} aria-label="Close">
            ✕
          </button>
        ) : (
          <span className="label !text-[9px] text-faint">click to pin</span>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {info.rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-dim">{k}</dt>
            <dd className="text-right tabular-nums text-white">{v}</dd>
          </div>
        ))}
      </dl>
      {info.levels && (
        <div className="mt-3 space-y-2">
          {info.levels.map((l) => (
            <div key={l.label}>
              <div className="flex justify-between text-[11px]">
                <span className="text-dim">{l.label}</span>
                <span className="tabular-nums">
                  {Math.round(l.frac * 100)}% · {l.detail}
                </span>
              </div>
              <div className="mt-1 h-1.5 bg-white/10">
                <div className="h-full" style={{ width: `${Math.max(0, Math.min(1, l.frac)) * 100}%`, background: l.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {info.engines && (
        <div className="mt-3 flex gap-3">
          <EngineRings rings={info.engines.rings} status={info.engines.status} size={110} />
          <div className="max-h-[150px] min-w-0 flex-1 overflow-y-auto pr-1 text-[11px]" onMouseLeave={() => setEngine(null)}>
            {info.engines.list.map((e, i) => (
              <div key={e.name} className={`flex justify-between gap-2 ${engine === i ? 'bg-white/10' : ''}`} onMouseEnter={() => setEngine(i)}>
                <span className="heading tracking-[0.08em]">{e.name}</span>
                <span className={STATUS[e.status].cls}>{STATUS[e.status].label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {sel && (
        <div className="mt-2 border-t border-line pt-2 text-[11px] text-dim">
          <span className="text-white">{sel.name}</span> · {sel.group}
          {sel.note && <div className="mt-0.5 text-fail/90">{sel.note}</div>}
        </div>
      )}
      {info.note && <p className="mt-3 text-[10px] leading-snug text-faint">{info.note}</p>}
    </div>
  )
}
