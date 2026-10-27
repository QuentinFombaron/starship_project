import { Link } from 'react-router'
import { getMedia, missions } from '../content/loader'
import { OutcomeBadge, SafeImg, Section, Starfield, Stat, useCountdown } from '../components/ui'
import { fmtDate } from '../lib/format'
import { FlightCard } from './Flights'

function HeroBackdrop({ src }: { src?: string }) {
  return (
    <div className="absolute inset-0">
      <SafeImg
        src={src}
        alt=""
        className="h-full w-full object-cover"
        fallback={
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_110%,#1d2a3f_0%,#05070b_55%,#000_100%)]">
            <Starfield />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-[radial-gradient(ellipse_at_50%_140%,rgba(79,179,255,0.35),transparent_60%)]" />
          </div>
        }
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/40" />
    </div>
  )
}

export function Home() {
  const flown = missions.filter((m) => m.outcome !== 'scheduled')
  const latest = flown.at(-1)
  const next = missions.find((m) => m.outcome === 'scheduled')
  const cd = useCountdown(next?.launchTime ?? Date.now())
  const media = latest ? getMedia(latest.id) : []
  const hero = latest?.heroImage ?? media[0]?.src

  const orbital = flown.filter((m) => m.orbit?.orbital).length
  const successes = flown.filter((m) => m.outcome === 'success').length
  const catches = flown.filter((m) => /^caught/i.test(m.boosterFate ?? '')).length

  return (
    <>
      <section className="relative flex min-h-[100svh] items-end overflow-hidden">
        <HeroBackdrop src={hero} />
        {latest && (
          <div className="relative mx-auto w-full max-w-[1600px] px-5 pb-20 md:px-10 md:pb-28">
            <div className="label mb-4 flex items-center gap-3">
              <span>Latest flight · {fmtDate(latest.launchTime)}</span>
              <OutcomeBadge outcome={latest.outcome} />
            </div>
            <h1 className="heading max-w-4xl text-5xl leading-[0.95] md:text-7xl lg:text-[88px]">
              {latest.name}
              <span className="block text-white/80">{latest.orbit?.orbital ? 'First orbit' : latest.vehicles.ship.id}</span>
            </h1>
            <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-white/80">{latest.summary}</p>
            <div className="mt-10 flex flex-wrap gap-4">
              {latest.hasReplay && (
                <Link to={`/flights/${latest.id}/replay`} className="btn">
                  ▶ Relive the mission in 3D
                </Link>
              )}
              <Link to={`/flights/${latest.id}`} className="btn border-white/40">
                Mission details
              </Link>
            </div>
          </div>
        )}
        <div className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 md:block">
          <div className="h-10 w-px animate-pulse bg-white/50" />
        </div>
      </section>

      {next && (
        <section className="border-y border-line bg-black">
          <div className="mx-auto flex max-w-[1600px] flex-col gap-8 px-5 py-12 md:flex-row md:items-center md:justify-between md:px-10">
            <div>
              <div className="label mb-2">Next flight · NET {fmtDate(next.launchTime)}</div>
              <div className="heading text-3xl">
                {next.name} <span className="text-dim">· {next.vehicles.booster.id} / {next.vehicles.ship.id}</span>
              </div>
            </div>
            <div className="flex gap-8">
              {(['d', 'h', 'm', 's'] as const).map((k) => (
                <div key={k} className="text-center">
                  <div className="heading num text-4xl md:text-5xl">{String(cd[k]).padStart(2, '0')}</div>
                  <div className="label mt-1">{{ d: 'Days', h: 'Hours', m: 'Min', s: 'Sec' }[k]}</div>
                </div>
              ))}
            </div>
            <Link to={`/flights/${next.id}`} className="btn self-start md:self-auto">
              Preview
            </Link>
          </div>
        </section>
      )}

      <Section eyebrow="The program" title="Starship by the numbers">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <Stat label="Flights flown" value={flown.length} />
          <Stat label="Full successes" value={successes} />
          <Stat label="Orbital flights" value={orbital} />
          <Stat label="Booster catches" value={catches} />
        </div>
      </Section>

      <Section eyebrow="Archive" title="Every flight">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[...missions].reverse().slice(0, 6).map((m) => (
            <FlightCard key={m.id} m={m} />
          ))}
        </div>
        <div className="mt-10">
          <Link to="/flights" className="btn">
            All flights
          </Link>
        </div>
      </Section>

      <section className="relative overflow-hidden border-t border-line">
        <Starfield />
        <div className="relative mx-auto grid max-w-[1400px] gap-10 px-5 py-24 md:grid-cols-2 md:px-10">
          <div>
            <div className="label mb-3">Explore</div>
            <h2 className="heading text-4xl">Starbase, Texas</h2>
            <p className="mt-5 max-w-lg leading-relaxed text-white/75">
              Walk around the launch site in 3D: the launch tower and its chopsticks, the orbital launch mounts, the tank farm and
              the Gulf coast at Boca Chica.
            </p>
            <Link to="/starbase" className="btn mt-8">
              Enter Starbase
            </Link>
          </div>
          <div>
            <div className="label mb-3">Learn</div>
            <h2 className="heading text-4xl">Speak Starship</h2>
            <p className="mt-5 max-w-lg leading-relaxed text-white/75">
              Hot staging, boostback, RVac, Max Q, chopsticks. Every term from the webcast, explained.
            </p>
            <Link to="/glossary" className="btn mt-8">
              Glossary
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
