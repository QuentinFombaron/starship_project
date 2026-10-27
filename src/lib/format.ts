import type { Mission } from '../content/schema'

export type Units = 'metric' | 'imperial'

export function fmtSpeed(ms: number, units: Units) {
  return units === 'metric' ? { value: Math.round(ms * 3.6).toLocaleString('en-US'), unit: 'KM/H' } : { value: Math.round(ms * 2.23694).toLocaleString('en-US'), unit: 'MPH' }
}

export function fmtAlt(m: number, units: Units) {
  if (units === 'imperial') {
    const ft = m * 3.28084
    return ft < 10_000 ? { value: Math.round(ft).toLocaleString('en-US'), unit: 'FT' } : { value: (m / 1609.344).toFixed(m < 160_000 ? 1 : 0), unit: 'MI' }
  }
  return m < 1000 ? { value: Math.round(m).toLocaleString('en-US'), unit: 'M' } : { value: (m / 1000).toFixed(m < 100_000 ? 1 : 0), unit: 'KM' }
}

export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }) =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })

export const fmtUtcTime = (iso: string) => new Date(iso).toISOString().slice(11, 19) + ' UTC'

export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

export const OUTCOME_LABEL: Record<Mission['outcome'], string> = {
  success: 'Success',
  partial: 'Partial success',
  failure: 'Failure',
  scheduled: 'Upcoming',
  scrubbed: 'Scrubbed',
}

export const OUTCOME_COLOR: Record<Mission['outcome'], string> = {
  success: 'text-ok border-ok/50',
  partial: 'text-warn border-warn/50',
  failure: 'text-fail border-fail/50',
  scheduled: 'text-accent border-accent/50',
  scrubbed: 'text-dim border-line',
}
