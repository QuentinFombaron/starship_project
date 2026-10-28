import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { clamp } from './interpolate'

export const RATE_PRESETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300, 1000] as const

interface ClockState {
  t: number
  rate: number
  playing: boolean
  reverse: boolean
  tMin: number
  tMax: number
  /** Increments on discontinuous jumps (seek) so consumers (video, audio) can resync. */
  seekId: number
  setBounds: (tMin: number, tMax: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  nudge: (dt: number) => void
  setRate: (rate: number) => void
  setReverse: (r: boolean) => void
  advance: (realDt: number) => void
}

export const useClock = create<ClockState>((set, get) => ({
  t: -30,
  rate: 1,
  playing: false,
  reverse: false,
  tMin: -60,
  tMax: 3600,
  seekId: 0,
  setBounds: (tMin, tMax) => set((s) => ({ tMin, tMax, t: clamp(s.t, tMin, tMax) })),
  play: () => {
    const s = get()
    if (!s.reverse && s.t >= s.tMax) set({ t: s.tMin, seekId: s.seekId + 1 })
    set({ playing: true })
  },
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  seek: (t) => set((s) => ({ t: clamp(t, s.tMin, s.tMax), seekId: s.seekId + 1 })),
  nudge: (dt) => get().seek(get().t + dt),
  setRate: (rate) => set({ rate }),
  setReverse: (reverse) => set({ reverse }),
  advance: (realDt) => {
    const s = get()
    if (!s.playing) return
    const dir = s.reverse ? -1 : 1
    const t = clamp(s.t + realDt * s.rate * dir, s.tMin, s.tMax)
    const atEnd = (dir > 0 && t >= s.tMax) || (dir < 0 && t <= s.tMin)
    set({ t, playing: !atEnd })
  },
}))

if (import.meta.env.DEV && typeof window !== 'undefined') Object.assign(window, { __clock: useClock })

/** Drives the clock from requestAnimationFrame. Mount once per replay. */
export function useClockDriver() {
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      // clamp to avoid huge jumps when the tab was in background
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      useClock.getState().advance(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
}

/** Mission time sampled at a limited rate, for React UI that doesn't need 60 fps. */
export function useMissionTime(hz = 15) {
  const [t, setT] = useState(() => useClock.getState().t)
  useEffect(() => {
    let last = 0
    let pending: number | null = null
    const unsub = useClock.subscribe((s) => {
      const now = performance.now()
      if (now - last >= 1000 / hz) {
        last = now
        setT(s.t)
      } else if (pending === null) {
        pending = window.setTimeout(() => {
          pending = null
          last = performance.now()
          setT(useClock.getState().t)
        }, 1000 / hz)
      }
    })
    return () => {
      unsub()
      if (pending !== null) clearTimeout(pending)
    }
  }, [hz])
  return t
}

/** Formats mission time as T±HH:MM:SS. */
export function formatT(t: number, withPrefix = true) {
  const sign = t < 0 ? '-' : '+'
  const a = Math.abs(Math.trunc(t))
  const h = Math.floor(a / 3600)
  const m = Math.floor((a % 3600) / 60)
  const s = a % 60
  const body = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return withPrefix ? `T${sign}${body}` : `${sign === '-' ? '-' : ''}${body}`
}
