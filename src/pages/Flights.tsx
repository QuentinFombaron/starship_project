import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { Mission } from '../content/schema'
import { getMedia, missions } from '../content/loader'
import { OutcomeBadge, SafeImg, Starfield } from '../components/ui'
import { fmtDate } from '../lib/format'

export function FlightCard({ m }: { m: Mission }) {
  const img = m.heroImage ?? getMedia(m.id)[0]?.thumb ?? getMedia(m.id)[0]?.src
  return (
    <Link to={`/flights/${m.id}`} className="group relative block overflow-hidden border border-line bg-neutral-950 transition-colors hover:border-white/60">
      <div className="relative aspect-[16/10] overflow-hidden">
        <SafeImg
          src={img}
          alt={m.name}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          fallback={
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,#13233a,#000_70%)]">
              <Starfield />
              <div className="heading absolute inset-0 flex items-center justify-center text-[120px] leading-none text-white/[0.06]">{m.number}</div>
            </div>
          }
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
        <div className="absolute left-4 top-4">
          <OutcomeBadge outcome={m.outcome} />
        </div>
        {m.hasReplay && <div className="label absolute right-4 top-4 border border-white/60 bg-black/50 px-2 py-0.5 !text-[10px] !text-white">3D replay</div>}
      </div>
      <div className="p-5">
        <div className="label">{fmtDate(m.launchTime)}</div>
        <div className="heading mt-1 text-2xl">{m.name}</div>
        <div className="mt-1 text-sm text-dim">
          {m.vehicles.booster.id} · {m.vehicles.ship.id} · {m.vehicles.ship.block}
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-white/70">{m.summary}</p>
      </div>
    </Link>
  )
}

const FILTERS = ['all', 'success', 'partial', 'failure', 'scheduled'] as const

export function Flights() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [block, setBlock] = useState('all')
  const blocks = useMemo(() => [...new Set(missions.map((m) => m.vehicles.ship.block))], [])
  const list = [...missions].reverse().filter((m) => (filter === 'all' || m.outcome === filter) && (block === 'all' || m.vehicles.ship.block === block))
  return (
    <div className="mx-auto max-w-[1600px] px-5 py-14 md:px-10">
      <div className="label mb-3">Mission archive</div>
      <h1 className="heading text-4xl md:text-6xl">Starship flights</h1>
      <div className="mt-10 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} className="btn-sm" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'scheduled' ? 'Upcoming' : f}
          </button>
        ))}
        <span className="mx-3 h-5 w-px bg-line" />
        {['all', ...blocks].map((b) => (
          <button key={b} className="btn-sm" aria-pressed={block === b} onClick={() => setBlock(b)}>
            {b === 'all' ? 'All blocks' : b}
          </button>
        ))}
      </div>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.map((m) => (
          <FlightCard key={m.id} m={m} />
        ))}
      </div>
      {!list.length && <p className="mt-10 text-dim">No flights match these filters.</p>}
    </div>
  )
}
