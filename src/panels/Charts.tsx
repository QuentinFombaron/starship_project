import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useClock } from '../sim/clock'
import { useReplay } from '../sim/replay'
import { useSettings } from '../lib/settings'

const SHIP = '#3987e5'
const BOOSTER = '#d95926'

type Metric = 'alt' | 'speed' | 'accel' | 'q' | 'prop'
const METRICS: { id: Metric; label: string }[] = [
  { id: 'alt', label: 'Altitude' },
  { id: 'speed', label: 'Speed' },
  { id: 'accel', label: 'Acceleration' },
  { id: 'q', label: 'Dynamic pressure' },
  { id: 'prop', label: 'Propellant' },
]

const RANGES = [
  { id: 'ascent', label: 'Ascent' },
  { id: 'full', label: 'Full flight' },
  { id: 'entry', label: 'Entry' },
] as const

/** One small-multiple chart: one metric, booster + ship series, cursor synced to the mission clock. */
function MetricChart({ metric, range }: { metric: Metric; range: (typeof RANGES)[number]['id'] }) {
  const replay = useReplay()
  const units = useSettings((s) => s.units)
  const host = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const { data, unit, from, to } = useMemo(() => {
    const tel = replay.data.telemetry
    const entry = replay.t('deorbit-start', 0)
    let from = range === 'entry' ? entry - 120 : -10
    let to = range === 'ascent' ? 620 : replay.tEnd
    from = Math.max(0, from)
    to = Math.min(replay.tEnd, to)
    const step = to - from > 3000 ? 10 : 1
    const ts: number[] = []
    for (let t = from; t <= to; t += step) ts.push(t)
    const imperial = units === 'imperial'
    const conv = {
      alt: (m: number) => (imperial ? m / 1609.344 : m / 1000),
      speed: (ms: number) => (imperial ? ms * 2.23694 : ms * 3.6),
      accel: (g: number) => g,
      q: (pa: number) => pa / 1000,
      prop: (f: number) => f * 100,
    }[metric]
    const key = metric === 'prop' ? 'lox' : metric
    const pick = (tr: typeof tel.ship, t: number) => {
      const i = Math.round((t - tr.t0) / tr.dt)
      if (i < 0 || i >= tr[key].length) return null
      return conv(tr[key][i])
    }
    const boosterEnd = replay.t('booster-fts', replay.booster.tEnd)
    const b = ts.map((t) => (t <= boosterEnd ? pick(tel.booster, t) : null))
    const s = ts.map((t) => pick(tel.ship, t))
    const unit = { alt: imperial ? 'mi' : 'km', speed: imperial ? 'mph' : 'km/h', accel: 'g', q: 'kPa', prop: '% LOX' }[metric]
    return { data: [ts, b, s] as uPlot.AlignedData, unit, from, to }
  }, [replay, metric, range, units])

  useEffect(() => {
    const el = host.current!
    const fmtT = (t: number) => {
      const a = Math.abs(Math.round(t))
      const h = Math.floor(a / 3600)
      const m = Math.floor((a % 3600) / 60)
      const s = a % 60
      return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
    }
    const axis = { stroke: 'rgba(255,255,255,0.55)', grid: { stroke: 'rgba(255,255,255,0.08)', width: 1 }, ticks: { show: false }, font: '10px Barlow' }
    const p = new uPlot(
      {
        width: el.clientWidth,
        height: 150,
        padding: [8, 8, 0, 0],
        legend: { show: false },
        cursor: { y: false, points: { size: 8 }, drag: { x: false, y: false } },
        scales: { x: { time: false, min: from, max: to } },
        series: [
          { value: (_u, v) => (v == null ? '' : fmtT(v)) },
          { label: 'Booster', stroke: BOOSTER, width: 2, spanGaps: false, points: { show: false } },
          { label: 'Ship', stroke: SHIP, width: 2, spanGaps: false, points: { show: false } },
        ],
        axes: [
          { ...axis, values: (_u, vals) => vals.map((v) => `T+${fmtT(v)}`) },
          { ...axis, size: 46, values: (_u, vals) => vals.map((v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}K` : String(Math.round(v * 10) / 10))) },
        ],
        hooks: {
          draw: [
            (u) => {
              // mission-time playhead
              const t = useClock.getState().t
              if (t < from || t > to) return
              const x = u.valToPos(t, 'x', true)
              const ctx = u.ctx
              ctx.save()
              ctx.strokeStyle = 'rgba(255,255,255,0.9)'
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.moveTo(x, u.bbox.top)
              ctx.lineTo(x, u.bbox.top + u.bbox.height)
              ctx.stroke()
              ctx.restore()
            },
          ],
        },
      },
      data,
      el,
    )
    plot.current = p
    const ro = new ResizeObserver(() => p.setSize({ width: el.clientWidth, height: 150 }))
    ro.observe(el)
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last > 100) {
        last = now
        p.redraw(false, false)
      }
    }
    raf = requestAnimationFrame(tick)
    // click to seek
    const over = el.querySelector('.u-over') as HTMLElement
    const onClick = (e: MouseEvent) => {
      const r = over.getBoundingClientRect()
      useClock.getState().seek(p.posToVal(e.clientX - r.left, 'x'))
    }
    over?.addEventListener('click', onClick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      over?.removeEventListener('click', onClick)
      p.destroy()
    }
  }, [data, from, to])

  return (
    <div>
      <div className="flex items-baseline justify-between px-1">
        <span className="heading text-[12px] tracking-[0.14em]">{METRICS.find((m) => m.id === metric)!.label}</span>
        <span className="label !text-[10px]">{unit}</span>
      </div>
      <div ref={host} className="w-full" />
    </div>
  )
}

export default function Charts() {
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('ascent')
  const [table, setTable] = useState(false)
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2.5">
        <span className="label mr-auto">Telemetry</span>
        {RANGES.map((r) => (
          <button key={r.id} className="btn-sm" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-4 px-4 pt-3 text-[11px] text-dim">
        <span className="flex items-center gap-1.5">
          <i className="h-0.5 w-4" style={{ background: BOOSTER }} /> Super Heavy
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-0.5 w-4" style={{ background: SHIP }} /> Starship
        </span>
        <button className="label ml-auto hover:!text-white" onClick={() => setTable((t) => !t)}>
          {table ? 'Charts' : 'Table'}
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {table ? <DataTable /> : METRICS.map((m) => <MetricChart key={m.id + range} metric={m.id} range={range} />)}
        <p className="text-[11px] leading-relaxed text-faint">Reconstructed from reported events and orbit. Click a chart to jump to that moment.</p>
      </div>
    </div>
  )
}

function DataTable() {
  const replay = useReplay()
  const rows = replay.data.timeline.filter((e) => e.t >= 0)
  return (
    <table className="w-full text-left text-[12px]">
      <thead className="label">
        <tr>
          <th className="py-1 font-semibold">Event</th>
          <th className="py-1 text-right font-semibold">Alt km</th>
          <th className="py-1 text-right font-semibold">km/h</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const v = e.vehicle === 'booster' ? replay.booster.sample(e.t) : replay.ship.sample(e.t)
          return (
            <tr key={e.id} className="border-t border-line/60">
              <td className="py-1.5 pr-2 text-white/85">{e.title}</td>
              <td className="num py-1.5 text-right">{(v.alt / 1000).toFixed(1)}</td>
              <td className="num py-1.5 text-right">{Math.round(v.speed * 3.6).toLocaleString('en-US')}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
