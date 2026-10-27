import { useMemo } from 'react'
import { fmtAlt, fmtSpeed } from '../lib/format'
import { useSettings } from '../lib/settings'
import { formatT, useMissionTime } from '../sim/clock'
import { useReplay, type Vehicle } from '../sim/replay'
import { EngineRings } from './EngineRings'

function Readout({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="leading-none">
      <div className="label !text-[10px] !text-white/70">{label}</div>
      <div className="heading num mt-1 text-[22px] tracking-[0.04em] md:text-[26px]">
        {value}
        <span className="ml-1.5 text-[11px] tracking-[0.12em] text-white/70">{unit}</span>
      </div>
    </div>
  )
}

function PropBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="label w-8 !text-[9px] !text-white/70">{label}</span>
      <div className="h-[3px] w-20 bg-white/15">
        <div className="h-full bg-white" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
    </div>
  )
}

function StagePanel({ vehicle, t, align }: { vehicle: Vehicle; t: number; align: 'left' | 'right' }) {
  const replay = useReplay()
  const s = useSettings()
  const smp = (vehicle === 'booster' ? replay.booster : replay.ship).sample(t)
  const eng = replay.engines(vehicle, t)
  const cfg = replay.data.engines[vehicle]
  const name = vehicle === 'booster' ? 'Super Heavy' : 'Starship'
  const id = vehicle === 'booster' ? replay.data.mission.vehicles.booster.id : replay.data.mission.vehicles.ship.id
  const sp = fmtSpeed(smp.speed, s.units)
  const al = fmtAlt(smp.alt, s.units)
  const ended = vehicle === 'booster' && t > replay.t('booster-fts', replay.booster.tEnd)
  return (
    <div className={`flex items-end gap-4 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      {s.hudEngines && (
        <div className="relative shrink-0">
          <EngineRings rings={cfg.rings} status={eng.status} size={86} highlightFailures={s.highlightFailures} label={`${name} engines`} />
          <div className="label absolute inset-x-0 -bottom-4 text-center !text-[9px] !text-white/70">
            {eng.lit}/{eng.total}
          </div>
        </div>
      )}
      <div className={`flex flex-col gap-2 ${align === 'right' ? 'items-end' : ''}`}>
        <div className="heading text-[13px] tracking-[0.22em]">
          {name} <span className="text-white/60">{id}</span>
        </div>
        {s.hudTelemetry && (
          <div className={`flex gap-6 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
            <Readout label="Speed" value={ended ? '—' : sp.value} unit={sp.unit} />
            <Readout label="Altitude" value={ended ? '—' : al.value} unit={al.unit} />
          </div>
        )}
        {s.hudPropellant && (
          <div className="flex flex-col gap-1">
            <PropBar label="LOX" value={smp.lox} />
            <PropBar label="CH4" value={smp.ch4} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Centre arc with event dots, like the SpaceX webcast timeline. */
function EventArc({ t }: { t: number }) {
  const replay = useReplay()
  const events = useMemo(() => replay.data.timeline.filter((e) => e.t >= 0 && e.kind !== 'countdown'), [replay])
  const window = t < 600 ? 600 : t < 4000 ? 4000 : replay.tEnd
  const R = 150
  const toAngle = (et: number) => {
    // map [t - window/2, t + window/2] onto the visible arc (-70°..70°)
    const k = (et - t) / (window / 2)
    return Math.max(-1.2, Math.min(1.2, k)) * 70
  }
  const pt = (deg: number, r = R) => [Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r + R] as const
  return (
    <svg viewBox="-170 -10 340 70" className="h-[70px] w-[340px]">
      <path d={`M ${pt(-70).join(' ')} A ${R} ${R} 0 0 1 ${pt(70).join(' ')}`} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
      {(() => {
        // label only events far enough apart to stay legible; prefer the next upcoming one
        const labelled = new Set<string>()
        const next = events.find((e) => e.t > t)
        const placed: number[] = []
        const order = [...events].sort((a, b) => (a === next ? -1 : b === next ? 1 : Math.abs(a.t - t) - Math.abs(b.t - t)))
        for (const e of order) {
          const a = toAngle(e.t)
          if (Math.abs(a) > 34 || placed.some((p) => Math.abs(p - a) < 13)) continue
          placed.push(a)
          labelled.add(e.id)
        }
        return events.map((e) => ({ e, label: labelled.has(e.id) }))
      })().map(({ e, label }) => {
        const a = toAngle(e.t)
        if (Math.abs(a) > 70) return null
        const [x, y] = pt(a)
        const past = e.t <= t
        const bad = e.status === 'off-nominal'
        return (
          <g key={e.id}>
            <circle cx={x} cy={y} r={past ? 3.4 : 3} fill={past ? (bad ? '#ff4d4d' : '#fff') : '#000'} stroke={bad ? '#ff4d4d' : '#fff'} strokeWidth={1} />
            {label && (
              <text x={x} y={y + 13} fontSize={6.5} textAnchor="middle" fill={past ? '#fff' : 'rgba(255,255,255,0.6)'} style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>
                {e.title.length > 22 ? e.title.slice(0, 21) + '…' : e.title}
              </text>
            )}
          </g>
        )
      })}
      <line x1={0} y1={-4} x2={0} y2={6} stroke="#fff" strokeWidth={1.5} />
    </svg>
  )
}

export function MissionClock({ t }: { t: number }) {
  const replay = useReplay()
  const fmt = useSettings((s) => s.timeFormat)
  let main = formatT(t)
  if (fmt !== 'mission') {
    const d = new Date(replay.launchDate.getTime() + t * 1000)
    main =
      fmt === 'utc'
        ? d.toISOString().slice(11, 19) + ' UTC'
        : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }
  return (
    <div className="text-center">
      <div className="heading num text-[30px] leading-none tracking-[0.06em] md:text-[36px]">{main}</div>
      <div className="label mt-1 !text-[10px] !text-white/70">{replay.data.mission.name.toUpperCase()}</div>
    </div>
  )
}

/** Compact readouts for phones, where the side panels are hidden. */
function MobileTelemetry({ t }: { t: number }) {
  const replay = useReplay()
  const units = useSettings((s) => s.units)
  const show = useSettings((s) => s.hudTelemetry)
  if (!show) return null
  const rows = (['booster', 'ship'] as const).filter((v) => v === 'ship' || t < replay.t('booster-fts', replay.booster.tEnd))
  return (
    <div className="mt-2 flex gap-5 sm:hidden">
      {rows.map((v) => {
        const smp = (v === 'booster' ? replay.booster : replay.ship).sample(t)
        const sp = fmtSpeed(smp.speed, units)
        const al = fmtAlt(smp.alt, units)
        const eng = replay.engines(v, t)
        return (
          <div key={v} className="text-center">
            <div className="label !text-[9px]">{v === 'booster' ? 'Booster' : 'Ship'} · {eng.lit}/{eng.total}</div>
            <div className="heading num text-[15px]">
              {sp.value} <span className="text-[9px] text-white/60">{sp.unit}</span> · {al.value} <span className="text-[9px] text-white/60">{al.unit}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function Hud() {
  const t = useMissionTime(20)
  const arc = useSettings((s) => s.hudArc)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[118px] z-10 px-4 sm:bottom-[86px] md:bottom-[92px] md:px-8">
      <div className="absolute inset-x-0 bottom-[-30px] h-48 bg-gradient-to-t from-black/75 to-transparent" />
      <div className="relative flex items-end justify-between gap-4">
        <div className="hidden sm:block">
          <StagePanel vehicle="booster" t={t} align="left" />
        </div>
        <div className="flex flex-1 flex-col items-center sm:flex-none">
          {arc && (
            <div className="max-sm:scale-75">
              <EventArc t={t} />
            </div>
          )}
          <MissionClock t={t} />
          <MobileTelemetry t={t} />
        </div>
        <div className="hidden sm:block">
          <StagePanel vehicle="ship" t={t} align="right" />
        </div>
      </div>
    </div>
  )
}
