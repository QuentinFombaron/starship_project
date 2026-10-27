import { useState } from 'react'
import { Link } from 'react-router'
import { missions, vehicles } from '../content/loader'
import type { Vehicle } from '../content/schema'

const STATUS_COLOR: Record<Vehicle['status'], string> = {
  active: 'text-ok',
  'in-production': 'text-accent',
  reflown: 'text-ok',
  expended: 'text-dim',
  retired: 'text-dim',
  destroyed: 'text-fail',
}

export function Vehicles() {
  const [type, setType] = useState<'all' | 'booster' | 'ship'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const list = vehicles.filter((v) => type === 'all' || v.type === type)
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-14 md:px-10">
      <div className="label mb-3">Fleet tracker</div>
      <h1 className="heading text-4xl md:text-6xl">Boosters & ships</h1>
      <p className="mt-4 max-w-2xl text-white/70">Every Super Heavy booster and Starship upper stage that has flown, plus the next vehicles in line.</p>
      <div className="mt-8 flex gap-2">
        {(['all', 'booster', 'ship'] as const).map((t) => (
          <button key={t} className="btn-sm" aria-pressed={type === t} onClick={() => setType(t)}>
            {t === 'all' ? 'All' : t === 'booster' ? 'Super Heavy' : 'Starship'}
          </button>
        ))}
      </div>
      <div className="mt-8 overflow-x-auto border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="label border-b border-line">
            <tr>
              <th className="p-4 font-semibold">Vehicle</th>
              <th className="p-4 font-semibold">Type</th>
              <th className="p-4 font-semibold">Block</th>
              <th className="p-4 font-semibold">Flights</th>
              <th className="p-4 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <FleetRow key={v.id} v={v} open={open === v.id} onToggle={() => setOpen(open === v.id ? null : v.id)} />
            ))}
          </tbody>
        </table>
      </div>
      {!list.length && <p className="mt-6 text-dim">Fleet data is loading into the database.</p>}
    </div>
  )
}

function FleetRow({ v, open, onToggle }: { v: Vehicle; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-b border-line transition-colors hover:bg-white/[0.04]" onClick={onToggle}>
        <td className="heading p-4 text-lg">{v.id}</td>
        <td className="p-4 text-white/80">{v.type === 'booster' ? 'Super Heavy' : 'Starship'}</td>
        <td className="p-4 text-white/80">{v.block}</td>
        <td className="p-4">
          {v.flights.map((f) => {
            const m = missions.find((x) => x.number === f)
            return m ? (
              <Link key={f} to={`/flights/${m.id}`} className="mr-2 underline decoration-white/30 underline-offset-4 hover:decoration-white" onClick={(e) => e.stopPropagation()}>
                F{f}
              </Link>
            ) : (
              <span key={f} className="mr-2">
                F{f}
              </span>
            )
          })}
        </td>
        <td className={`label p-4 ${STATUS_COLOR[v.status]}`}>{v.status.replace('-', ' ')}</td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-white/[0.02]">
          <td colSpan={5} className="p-6">
            <p className="max-w-3xl text-white/80">{v.summary}</p>
            {v.history.length > 0 && (
              <ol className="mt-5 grid gap-2 md:grid-cols-2">
                {v.history.map((h) => (
                  <li key={h.date + h.event} className="flex gap-4">
                    <span className="num w-24 shrink-0 text-dim">{h.date}</span>
                    <span className="text-white/80">{h.event}</span>
                  </li>
                ))}
              </ol>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
