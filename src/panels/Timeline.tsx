import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSettings, type CameraMode } from '../lib/settings'
import { RATE_PRESETS, formatT, useClock, useMissionTime } from '../sim/clock'
import { clamp } from '../sim/interpolate'
import { useReplay } from '../sim/replay'

/** Piecewise-linear time scale so the dense first minutes get room on the scrubber. */
function useScale(adaptive: boolean) {
  const replay = useReplay()
  const { tMin, tMax } = useClock.getState()
  return useMemo(() => {
    const entry = replay.t('deorbit-start', tMax * 0.7)
    const xs = adaptive ? [tMin, 0, 620, entry, tMax] : [tMin, tMax]
    const ys = adaptive ? [0, 0.05, 0.4, 0.62, 1] : [0, 1]
    const toX = (t: number) => {
      for (let i = 0; i < xs.length - 1; i++) if (t <= xs[i + 1]) return ys[i] + ((ys[i + 1] - ys[i]) * (t - xs[i])) / (xs[i + 1] - xs[i])
      return 1
    }
    const toT = (x: number) => {
      for (let i = 0; i < ys.length - 1; i++) if (x <= ys[i + 1]) return xs[i] + ((xs[i + 1] - xs[i]) * (x - ys[i])) / (ys[i + 1] - ys[i])
      return tMax
    }
    return { toX, toT, xs }
  }, [adaptive, replay, tMin, tMax])
}

export const CAMERAS: { id: CameraMode; label: string; key: string }[] = [
  { id: 'director', label: 'Director', key: '1' },
  { id: 'chase-ship', label: 'Chase ship', key: '2' },
  { id: 'chase-booster', label: 'Chase booster', key: '3' },
  { id: 'tower', label: 'Tower', key: '4' },
  { id: 'ground', label: 'Long lens', key: '5' },
  { id: 'onboard-ship', label: 'Ship cam', key: '6' },
  { id: 'onboard-booster', label: 'Booster cam', key: '7' },
  { id: 'orbital', label: 'Orbital', key: '8' },
  { id: 'globe', label: 'Globe', key: '9' },
  { id: 'free', label: 'Free roam', key: '0' },
]

export function useKeyboardShortcuts(onToggleHelp: () => void) {
  const replay = useReplay()
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const c = useClock.getState()
      const s = useSettings.getState()
      const events = replay.data.timeline
      if (e.code === 'Space') {
        e.preventDefault()
        c.toggle()
      } else if (e.key === 'ArrowRight') c.nudge(e.shiftKey ? 60 : 10)
      else if (e.key === 'ArrowLeft') c.nudge(e.shiftKey ? -60 : -10)
      else if (e.key === '.') {
        const n = events.find((x) => x.t > c.t + 0.5)
        if (n) c.seek(n.t - 2)
      } else if (e.key === ',') {
        const p = [...events].reverse().find((x) => x.t < c.t - 3)
        if (p) c.seek(p.t - 2)
      } else if (e.key === ']' || e.key === '[') {
        const i = RATE_PRESETS.indexOf(c.rate as (typeof RATE_PRESETS)[number])
        const j = clamp((i < 0 ? 4 : i) + (e.key === ']' ? 1 : -1), 0, RATE_PRESETS.length - 1)
        c.setRate(RATE_PRESETS[j])
      } else if (e.key.toLowerCase() === 'r' && !e.metaKey) c.setReverse(!c.reverse)
      else if (e.key.toLowerCase() === 'c' && !e.metaKey) s.set({ commentary: !s.commentary })
      else if (e.key.toLowerCase() === 'm' && !e.metaKey) s.set({ panel: s.panel === 'map' ? 'none' : 'map' })
      else if (e.key.toLowerCase() === 'g' && !e.metaKey) s.set({ panel: s.panel === 'charts' ? 'none' : 'charts' })
      else if (e.key.toLowerCase() === 'v' && !e.metaKey) s.set({ video: !s.video })
      else if (e.key.toLowerCase() === 'h' && !e.metaKey) s.set({ hudTelemetry: !s.hudTelemetry, hudEngines: !s.hudTelemetry, hudPropellant: !s.hudTelemetry, hudArc: !s.hudTelemetry })
      else if (e.key.toLowerCase() === 'f' && !e.metaKey) {
        if (document.fullscreenElement) document.exitFullscreen()
        else document.documentElement.requestFullscreen?.()
      } else if (e.key === '?') onToggleHelp()
      else {
        const cam = CAMERAS.find((x) => x.key === e.key)
        if (cam) s.set({ camera: cam.id })
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [replay, onToggleHelp])
}

function Scrubber() {
  const replay = useReplay()
  const t = useMissionTime(30)
  const [adaptive, setAdaptive] = useState(true)
  const { toX, toT, xs } = useScale(adaptive)
  const bar = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const dragging = useRef(false)
  const fromEvent = useCallback(
    (clientX: number) => {
      const r = bar.current!.getBoundingClientRect()
      const x = clamp((clientX - r.left) / r.width)
      return { x, t: toT(x) }
    },
    [toT],
  )
  const events = replay.data.timeline
  const hoverEvent = hover ? events.reduce<(typeof events)[number] | null>((best, e) => (Math.abs(toX(e.t) - hover.x) < 0.006 && (!best || Math.abs(toX(e.t) - hover.x) < Math.abs(toX(best.t) - hover.x)) ? e : best), null) : null
  return (
    <div className="flex items-center gap-3">
      <div
        ref={bar}
        className="relative h-8 flex-1 cursor-pointer touch-none"
        onPointerDown={(e) => {
          dragging.current = true
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          useClock.getState().seek(fromEvent(e.clientX).t)
        }}
        onPointerMove={(e) => {
          const h = fromEvent(e.clientX)
          setHover(h)
          if (dragging.current) useClock.getState().seek(h.t)
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => setHover(null)}
        role="slider"
        aria-label="Mission time"
        aria-valuemin={useClock.getState().tMin}
        aria-valuemax={useClock.getState().tMax}
        aria-valuenow={Math.round(t)}
        tabIndex={0}
      >
        <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-white/20" />
        <div className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-white" style={{ width: `${toX(t) * 100}%` }} />
        {adaptive &&
          xs.slice(1, -1).map((x) => <div key={x} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-white/25" style={{ left: `${toX(x) * 100}%` }} />)}
        {events.map((e) => (
          <div
            key={e.id}
            className={`absolute top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 ${e.status === 'off-nominal' ? 'bg-fail' : e.status === 'partial' ? 'bg-warn' : e.kind === 'countdown' ? 'bg-white/30' : 'bg-white/70'}`}
            style={{ left: `${toX(e.t) * 100}%` }}
          />
        ))}
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black bg-white" style={{ left: `${toX(t) * 100}%` }} />
        {hover && (
          <div className="panel pointer-events-none absolute bottom-8 -translate-x-1/2 whitespace-nowrap px-2 py-1 text-[11px]" style={{ left: `${hover.x * 100}%` }}>
            <span className="num">{formatT(hoverEvent ? hoverEvent.t : hover.t)}</span>
            {hoverEvent && <span className="ml-2 heading">{hoverEvent.title}</span>}
          </div>
        )}
      </div>
      <button className="btn-sm hidden md:inline-flex" onClick={() => setAdaptive((a) => !a)} title="Toggle adaptive / linear timeline scale">
        {adaptive ? 'Adaptive' : 'Linear'}
      </button>
    </div>
  )
}

export function Transport() {
  const replay = useReplay()
  const playing = useClock((s) => s.playing)
  const rate = useClock((s) => s.rate)
  const reverse = useClock((s) => s.reverse)
  const camera = useSettings((s) => s.camera)
  const set = useSettings((s) => s.set)
  const c = useClock.getState()
  const events = replay.data.timeline
  const nextEvent = () => {
    const t = useClock.getState().t
    const n = events.find((x) => x.t > t + 0.5)
    if (n) useClock.getState().seek(n.t - 2)
  }
  const prevEvent = () => {
    const t = useClock.getState().t
    const p = [...events].reverse().find((x) => x.t < t - 3)
    if (p) useClock.getState().seek(p.t - 2)
  }
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 border-t border-line bg-black/80 px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:px-6">
      <Scrubber />
      <div className="flex flex-wrap items-center gap-1.5 pb-1">
        <button className="btn-sm" onClick={prevEvent} title="Previous event (,)" aria-label="Previous event">
          ⏮
        </button>
        <button className="btn-sm hidden sm:inline-flex" onClick={() => c.nudge(-60)} title="Back 1 min (Shift+←)">
          −1m
        </button>
        <button className="btn-sm" onClick={() => c.nudge(-10)} title="Back 10 s (←)">
          −10s
        </button>
        <button className="btn-sm min-w-[64px] !border-white" onClick={() => useClock.getState().toggle()} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button className="btn-sm" onClick={() => c.nudge(10)} title="Forward 10 s (→)">
          +10s
        </button>
        <button className="btn-sm hidden sm:inline-flex" onClick={() => c.nudge(60)} title="Forward 1 min (Shift+→)">
          +1m
        </button>
        <button className="btn-sm" onClick={nextEvent} title="Next event (.)" aria-label="Next event">
          ⏭
        </button>
        <span className="mx-1 h-5 w-px bg-line max-sm:hidden" />
        <button className="btn-sm max-sm:hidden" aria-pressed={reverse} onClick={() => c.setReverse(!reverse)} title="Reverse playback (R)">
          ◀◀ Rev
        </button>
        <label className="label flex items-center gap-1.5">
          <span className="hidden sm:inline">Speed</span>
          <select
            value={rate}
            onChange={(e) => c.setRate(Number(e.target.value))}
            className="border border-line bg-black px-1.5 py-1 font-display text-[11px] font-semibold tracking-[0.08em] text-white outline-none focus:border-white"
            aria-label="Playback speed"
          >
            {RATE_PRESETS.map((r) => (
              <option key={r} value={r}>
                {r < 1 ? `${r}× slow-mo` : `${r}×`}
              </option>
            ))}
          </select>
        </label>
        <span className="mx-1 hidden h-5 w-px bg-line md:block" />
        <label className="label flex items-center gap-1.5">
          <span className="hidden sm:inline">Camera</span>
          <select
            value={camera}
            onChange={(e) => set({ camera: e.target.value as CameraMode })}
            className="border border-line bg-black px-1.5 py-1 font-display text-[11px] font-semibold tracking-[0.08em] text-white outline-none focus:border-white"
            aria-label="Camera"
          >
            {CAMERAS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.key} · {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
