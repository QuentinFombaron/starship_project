import { useState } from 'react'
import { Link } from 'react-router'
import { missions } from '../content/loader'
import { Section, Stat } from '../components/ui'
import { OUTCOME_LABEL, fmtDate } from '../lib/format'

interface Bar {
  key: string
  label: string
  value: number
  detail: string
  href?: string
}

/** Single-series column chart with hover tooltip. Recessive axes, 4px rounded caps, value on hover. */
function ColumnChart({ bars, unit, color = 'var(--color-ship)', height = 220 }: { bars: Bar[]; unit: string; color?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...bars.map((b) => b.value))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const W = 100 / bars.length
  return (
    <div className="relative">
      <div className="relative ml-12" style={{ height }}>
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 border-t border-white/10" style={{ bottom: `${(t / top) * 100}%` }}>
            <span className="num absolute -left-12 -translate-y-1/2 text-[11px] text-dim">{compact(t)}</span>
          </div>
        ))}
        {bars.map((b, i) => (
          <div
            key={b.key}
            className="absolute bottom-0 top-0 flex cursor-default items-end justify-center"
            style={{ left: `${i * W}%`, width: `${W}%` }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className="w-full max-w-[24px] rounded-t-[4px] transition-opacity"
              style={{ height: `${(b.value / top) * 100}%`, background: color, opacity: hover === null || hover === i ? 1 : 0.45 }}
            />
          </div>
        ))}
        {hover !== null && (
          <div
            className="panel pointer-events-none absolute z-10 -translate-x-1/2 px-3 py-2 text-xs"
            style={{ left: `${(hover + 0.5) * W}%`, bottom: `${Math.min(85, (bars[hover].value / top) * 100) + 4}%` }}
          >
            <div className="heading text-[13px]">{bars[hover].label}</div>
            <div className="num text-white/90">
              {bars[hover].value.toLocaleString('en-US')} {unit}
            </div>
            <div className="text-dim">{bars[hover].detail}</div>
          </div>
        )}
      </div>
      <div className="relative ml-12 mt-2 h-4">
        {bars.map((b, i) => (
          <span key={b.key} className="num absolute -translate-x-1/2 text-[11px] text-dim" style={{ left: `${(i + 0.5) * W}%` }}>
            {b.label.replace('Flight ', 'F')}
          </span>
        ))}
      </div>
    </div>
  )
}

function niceStep(max: number) {
  const raw = max / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? p * 10
}
const compact = (n: number) => (n >= 1000 ? `${n / 1000}K` : String(n))

const STATUS = {
  success: { cls: 'border-ok/60 text-ok', icon: '✓' },
  partial: { cls: 'border-warn/60 text-warn', icon: '◐' },
  failure: { cls: 'border-fail/60 text-fail', icon: '✕' },
  scheduled: { cls: 'border-accent/60 text-accent', icon: '○' },
  scrubbed: { cls: 'border-line text-dim', icon: '–' },
} as const

export function Stats() {
  const flown = missions.filter((m) => m.outcome !== 'scheduled')
  const [table, setTable] = useState(false)
  const gaps: Bar[] = flown.slice(1).map((m, i) => {
    const d = Math.round((+new Date(m.launchTime) - +new Date(flown[i].launchTime)) / 86_400_000)
    return { key: m.id, label: m.name, value: d, detail: `after ${flown[i].name}`, href: `/flights/${m.id}` }
  })
  const apogee: Bar[] = flown.filter((m) => m.orbit).map((m) => ({ key: m.id, label: m.name, value: Math.round(m.orbit!.apogeeKm), detail: m.orbit!.orbital ? 'orbital' : 'suborbital' }))
  const duration: Bar[] = flown.filter((m) => m.durationSec).map((m) => ({ key: m.id, label: m.name, value: Math.round(m.durationSec! / 60), detail: fmtDate(m.launchTime) }))
  const avgGap = gaps.length ? Math.round(gaps.slice(-4).reduce((a, b) => a + b.value, 0) / Math.min(4, gaps.length)) : 0

  return (
    <>
      <Section eyebrow="Program statistics" title="The Starship program">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <Stat label="Flights flown" value={flown.length} />
          <Stat label="Full successes" value={flown.filter((m) => m.outcome === 'success').length} />
          <Stat label="Orbital flights" value={flown.filter((m) => m.orbit?.orbital).length} />
          <Stat label="Avg. days between flights" value={avgGap} sub="last four flights" />
        </div>
      </Section>

      <Section eyebrow="Outcomes" title="Flight by flight" className="!pt-0">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {missions.map((m) => (
            <Link key={m.id} to={`/flights/${m.id}`} className={`border p-3 transition-colors hover:bg-white/5 ${STATUS[m.outcome].cls}`}>
              <div className="heading text-2xl text-white">{m.number}</div>
              <div className="label mt-1 !text-inherit">
                {STATUS[m.outcome].icon} {OUTCOME_LABEL[m.outcome]}
              </div>
              <div className="mt-1 text-[11px] text-dim">{fmtDate(m.launchTime, { year: 'numeric', month: 'short' })}</div>
            </Link>
          ))}
        </div>
      </Section>

      <Section eyebrow="Cadence" title="Days between flights" className="!pt-0">
        <ColumnChart bars={gaps} unit="days" />
      </Section>

      <div className="mx-auto grid max-w-[1400px] gap-16 px-5 pb-24 md:grid-cols-2 md:px-10">
        <div>
          <div className="label mb-2">Altitude</div>
          <h3 className="heading mb-8 text-2xl">Peak altitude per flight (km)</h3>
          <ColumnChart bars={apogee} unit="km" height={200} />
        </div>
        <div>
          <div className="label mb-2">Endurance</div>
          <h3 className="heading mb-8 text-2xl">Mission duration (min)</h3>
          <ColumnChart bars={duration} unit="min" height={200} />
        </div>
        <div className="md:col-span-2">
          <button className="btn-sm" aria-pressed={table} onClick={() => setTable((t) => !t)}>
            {table ? 'Hide' : 'Show'} data table
          </button>
          {table && (
            <div className="mt-4 overflow-x-auto border border-line">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="label border-b border-line">
                  <tr>
                    {['Flight', 'Date', 'Booster', 'Ship', 'Outcome', 'Apogee (km)', 'Duration (min)'].map((h) => (
                      <th key={h} className="p-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {missions.map((m) => (
                    <tr key={m.id} className="border-b border-line">
                      <td className="p-3">{m.name}</td>
                      <td className="num p-3 text-white/80">{fmtDate(m.launchTime, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                      <td className="p-3">{m.vehicles.booster.id}</td>
                      <td className="p-3">{m.vehicles.ship.id}</td>
                      <td className="p-3">{OUTCOME_LABEL[m.outcome]}</td>
                      <td className="num p-3">{m.orbit ? Math.round(m.orbit.apogeeKm) : '—'}</td>
                      <td className="num p-3">{m.durationSec ? Math.round(m.durationSec / 60) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
