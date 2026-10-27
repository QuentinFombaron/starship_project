import { useEffect, useState, type ReactNode } from 'react'
import type { Mission } from '../content/schema'
import { OUTCOME_COLOR, OUTCOME_LABEL } from '../lib/format'

export function OutcomeBadge({ outcome }: { outcome: Mission['outcome'] }) {
  return <span className={`label inline-block border px-2 py-0.5 !text-[10px] ${OUTCOME_COLOR[outcome]}`}>{OUTCOME_LABEL[outcome]}</span>
}

export function Section({ eyebrow, title, children, className = '' }: { eyebrow?: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`mx-auto max-w-[1400px] px-5 py-16 md:px-10 md:py-24 ${className}`}>
      {eyebrow && <div className="label mb-3">{eyebrow}</div>}
      {title && <h2 className="heading mb-10 text-3xl md:text-4xl">{title}</h2>}
      {children}
    </section>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="border-l border-line pl-5">
      <div className="heading num text-4xl md:text-5xl">{value}</div>
      <div className="label mt-2">{label}</div>
      {sub && <div className="mt-1 text-xs text-faint">{sub}</div>}
    </div>
  )
}

export function useCountdown(target: string | number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const ms = new Date(target).getTime() - now
  const a = Math.max(0, Math.abs(ms))
  return {
    past: ms < 0,
    d: Math.floor(a / 86_400_000),
    h: Math.floor((a % 86_400_000) / 3_600_000),
    m: Math.floor((a % 3_600_000) / 60_000),
    s: Math.floor((a % 60_000) / 1000),
  }
}

export function Starfield({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        backgroundImage:
          'radial-gradient(1px 1px at 12% 22%, #fff9, transparent), radial-gradient(1px 1px at 72% 12%, #fff8, transparent), radial-gradient(1px 1px at 42% 62%, #fff6, transparent), radial-gradient(1.5px 1.5px at 88% 52%, #fffa, transparent), radial-gradient(1px 1px at 22% 82%, #fff7, transparent), radial-gradient(1px 1px at 58% 32%, #fff5, transparent), radial-gradient(1px 1px at 92% 88%, #fff6, transparent), radial-gradient(1px 1px at 5% 48%, #fff5, transparent)',
        backgroundSize: '520px 520px',
      }}
    />
  )
}

/** Image with graceful fallback when a remote image fails to load. */
export function SafeImg({ src, alt, className = '', fallback }: { src?: string; alt: string; className?: string; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(!src)
  if (failed) return <>{fallback ?? <div className={`bg-gradient-to-br from-neutral-900 to-black ${className}`} />}</>
  return <img src={src} alt={alt} className={className} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}
