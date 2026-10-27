import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { getMedia, getMission, getTimeline, missions, vehicles } from '../content/loader'
import { OutcomeBadge, SafeImg, Section, Starfield, useCountdown } from '../components/ui'
import { formatT } from '../sim/clock'
import { fmtDate, fmtDuration, fmtUtcTime } from '../lib/format'
import { NotFound } from './NotFound'

const OBJ_ICON = { achieved: ['✓', 'text-ok'], partial: ['◐', 'text-warn'], failed: ['✕', 'text-fail'], 'not-attempted': ['–', 'text-dim'], pending: ['○', 'text-accent'] } as const

export function FlightDetail() {
  const { id = '' } = useParams()
  const m = getMission(id)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const cd = useCountdown(m?.launchTime ?? Date.now())
  if (!m) return <NotFound />
  const media = getMedia(m.id)
  const timeline = getTimeline(m.id).filter((e) => e.t >= -60)
  const hero = m.heroImage ?? media[0]?.src
  const idx = missions.findIndex((x) => x.id === m.id)
  const prev = missions[idx - 1]
  const next = missions[idx + 1]
  const vehs = vehicles.filter((v) => v.id === m.vehicles.booster.id || v.id === m.vehicles.ship.id)

  return (
    <>
      <section className="relative flex min-h-[78svh] items-end overflow-hidden">
        <div className="absolute inset-0">
          <SafeImg
            src={hero}
            alt=""
            className="h-full w-full object-cover"
            fallback={
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_120%,#1a2b44,#000_65%)]">
                <Starfield />
              </div>
            }
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/50" />
        </div>
        <div className="relative mx-auto w-full max-w-[1400px] px-5 pb-16 md:px-10">
          <div className="label mb-4 flex flex-wrap items-center gap-3">
            <span>
              {fmtDate(m.launchTime)} · {fmtUtcTime(m.launchTime)}
            </span>
            <OutcomeBadge outcome={m.outcome} />
          </div>
          <h1 className="heading text-5xl md:text-7xl">{m.name}</h1>
          <div className="mt-3 text-lg text-white/75">
            Super Heavy {m.vehicles.booster.id} · Starship {m.vehicles.ship.id} · {m.vehicles.ship.block}
          </div>
          {m.outcome === 'scheduled' && !cd.past && (
            <div className="heading num mt-6 text-3xl">
              T-{cd.d}D {String(cd.h).padStart(2, '0')}:{String(cd.m).padStart(2, '0')}:{String(cd.s).padStart(2, '0')}
            </div>
          )}
          <div className="mt-8 flex flex-wrap gap-4">
            {m.hasReplay && (
              <Link to={`/flights/${m.id}/replay`} className="btn">
                ▶ 3D mission replay
              </Link>
            )}
            {m.webcast && (
              <a className="btn border-white/40" href={`https://www.youtube.com/watch?v=${m.webcast.youtubeId}`} target="_blank" rel="noreferrer">
                Watch webcast
              </a>
            )}
          </div>
        </div>
      </section>

      <Section eyebrow="Overview" title="Mission summary">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-lg leading-relaxed text-white/85">{m.summary}</p>
            {m.highlights.length > 0 && (
              <ul className="mt-8 space-y-3">
                {m.highlights.map((h) => (
                  <li key={h} className="flex gap-3 text-white/80">
                    <span className="mt-2 h-px w-4 shrink-0 bg-white" />
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-px self-start border border-line bg-line">
            {[
              ['Launch site', `${m.launchSite.name} · ${m.launchSite.pad}`],
              ['Booster', `${m.vehicles.booster.id} (${m.vehicles.booster.block})`],
              ['Ship', `${m.vehicles.ship.id} (${m.vehicles.ship.block})`],
              ...(m.payload ? [['Payload', `${m.payload.name}${m.payload.count ? ` · ${m.payload.count}` : ''}`]] : []),
              ...(m.orbit ? [['Trajectory', m.orbit.orbital ? `Orbit ${m.orbit.perigeeKm} × ${m.orbit.apogeeKm} km · ${m.orbit.inclinationDeg}°` : `Suborbital · ~${m.orbit.apogeeKm} km`]] : []),
              ...(m.durationSec ? [['Duration', fmtDuration(m.durationSec)]] : []),
              ...(m.boosterFate ? [['Booster fate', m.boosterFate]] : []),
              ...(m.shipFate ? [['Ship fate', m.shipFate]] : []),
              ...m.stats.map((s) => [s.label, s.value]),
            ].map(([k, v]) => (
              <div key={k} className="bg-black p-4">
                <dt className="label">{k}</dt>
                <dd className="mt-1 text-sm text-white/90">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      {m.objectives.length > 0 && (
        <Section eyebrow="Goals" title="Objectives" className="!pt-0">
          <ul className="grid gap-px border border-line bg-line md:grid-cols-2">
            {m.objectives.map((o) => {
              const [icon, color] = OBJ_ICON[o.status]
              return (
                <li key={o.label} className="flex items-start gap-4 bg-black p-5">
                  <span className={`heading text-xl ${color}`}>{icon}</span>
                  <div>
                    <div className="text-white">{o.label}</div>
                    <div className="label mt-1">
                      {o.status.replace('-', ' ')}
                      {o.note ? ` · ${o.note}` : ''}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {timeline.length > 0 && (
        <Section eyebrow="Sequence of events" title="Timeline" className="!pt-0">
          <ol className="relative border-l border-line">
            {timeline.map((e) => (
              <li key={e.id} className="relative pb-7 pl-8">
                <span
                  className={`absolute -left-[5px] top-1.5 h-[9px] w-[9px] rounded-full ${
                    e.status === 'off-nominal' ? 'bg-fail' : e.status === 'partial' ? 'bg-warn' : 'bg-white'
                  }`}
                />
                <div className="flex flex-wrap items-baseline gap-x-4">
                  <span className="heading num w-32 text-sm text-dim">{formatT(e.t)}</span>
                  <span className="heading text-[15px]">{e.title}</span>
                  {e.estimated && <span className="label !text-[9px] text-faint">est.</span>}
                </div>
                {e.description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/65 md:ml-36">{e.description}</p>}
              </li>
            ))}
          </ol>
          {m.hasReplay && (
            <Link to={`/flights/${m.id}/replay`} className="btn mt-6">
              Replay this timeline in 3D
            </Link>
          )}
        </Section>
      )}

      {vehs.length > 0 && (
        <Section eyebrow="Hardware" title="The vehicles" className="!pt-0">
          <div className="grid gap-5 md:grid-cols-2">
            {vehs.map((v) => (
              <div key={v.id} className="border border-line p-6">
                <div className="label">{v.type === 'booster' ? 'Super Heavy' : 'Starship'} · {v.block}</div>
                <div className="heading mt-1 text-3xl">{v.id}</div>
                <p className="mt-3 text-sm leading-relaxed text-white/75">{v.summary}</p>
                {v.history.length > 0 && (
                  <ul className="mt-5 space-y-2 border-t border-line pt-4">
                    {v.history.slice(-6).map((h) => (
                      <li key={h.date + h.event} className="flex gap-4 text-sm">
                        <span className="num w-24 shrink-0 text-dim">{h.date}</span>
                        <span className="text-white/80">{h.event}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <Link to="/vehicles" className="label mt-6 inline-block hover:text-white">
            Full fleet tracker →
          </Link>
        </Section>
      )}

      {media.length > 0 && (
        <Section eyebrow="Gallery" title="Photos" className="!pt-0">
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
            {media.map((img, i) => (
              <button key={img.src} className="group mb-4 block w-full break-inside-avoid text-left" onClick={() => setLightbox(i)}>
                <SafeImg src={img.thumb ?? img.src} alt={img.caption} className="w-full border border-line transition group-hover:border-white/60" />
                <div className="mt-2 text-xs text-dim">
                  {img.caption} · © {img.credit} ({img.license})
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {m.sources.length > 0 && (
        <Section eyebrow="References" title="Sources" className="!pt-0">
          <ul className="space-y-2">
            {m.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-sm text-white/80 underline decoration-white/30 underline-offset-4 hover:decoration-white">
                  {s.title}
                </a>
                {s.publisher && <span className="text-sm text-dim"> · {s.publisher}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <nav className="mx-auto flex max-w-[1400px] justify-between border-t border-line px-5 py-10 md:px-10">
        {prev ? (
          <Link to={`/flights/${prev.id}`} className="label hover:text-white">
            ← {prev.name}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={`/flights/${next.id}`} className="label hover:text-white">
            {next.name} →
          </Link>
        )}
      </nav>

      {lightbox !== null && media[lightbox] && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-4" onClick={() => setLightbox(null)} role="dialog">
          <img src={media[lightbox].src} alt={media[lightbox].caption} className="max-h-[82vh] max-w-full object-contain" referrerPolicy="no-referrer" />
          <div className="mt-4 max-w-3xl text-center text-sm text-white/75">
            {media[lightbox].caption} · © {media[lightbox].credit} · {media[lightbox].license}
            {media[lightbox].page && (
              <>
                {' · '}
                <a href={media[lightbox].page} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>
                  source
                </a>
              </>
            )}
          </div>
          <div className="mt-4 flex gap-3" onClick={(e) => e.stopPropagation()}>
            <button className="btn-sm" onClick={() => setLightbox((lightbox - 1 + media.length) % media.length)}>
              ← Prev
            </button>
            <button className="btn-sm" onClick={() => setLightbox(null)}>
              Close
            </button>
            <button className="btn-sm" onClick={() => setLightbox((lightbox + 1) % media.length)}>
              Next →
            </button>
          </div>
        </div>
      )}
    </>
  )
}
