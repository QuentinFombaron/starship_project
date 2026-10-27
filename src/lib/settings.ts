import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Units } from './format'

export type Quality = 'low' | 'medium' | 'high' | 'ultra'
export type CameraMode =
  | 'director'
  | 'chase-ship'
  | 'chase-booster'
  | 'tower'
  | 'ground'
  | 'onboard-ship'
  | 'onboard-booster'
  | 'orbital'
  | 'globe'
  | 'free'

export interface Settings {
  commentary: boolean
  commentaryLevel: 'essential' | 'detailed'
  posts: boolean
  video: boolean
  hudTelemetry: boolean
  hudEngines: boolean
  hudPropellant: boolean
  hudArc: boolean
  toasts: boolean
  units: Units
  timeFormat: 'mission' | 'utc' | 'local'
  quality: Quality
  labels: boolean
  trajectories: boolean
  plannedTrack: boolean
  atmosphere: boolean
  clouds: boolean
  constellation: boolean
  highlightFailures: boolean
  audio: boolean
  volume: number
  camera: CameraMode
  panel: 'none' | 'map' | 'charts' | 'events' | 'media'
  showSettings: boolean
  set: (patch: Partial<Settings>) => void
  reset: () => void
}

const DEFAULTS = {
  commentary: true,
  commentaryLevel: 'essential' as const,
  posts: true,
  video: false,
  hudTelemetry: true,
  hudEngines: true,
  hudPropellant: true,
  hudArc: true,
  toasts: true,
  units: 'metric' as Units,
  timeFormat: 'mission' as const,
  quality: 'high' as Quality,
  labels: true,
  trajectories: true,
  plannedTrack: false,
  atmosphere: true,
  clouds: true,
  constellation: false,
  highlightFailures: true,
  audio: false,
  volume: 0.6,
  camera: 'director' as CameraMode,
  panel: 'map' as const,
  showSettings: false,
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set(DEFAULTS),
    }),
    {
      name: 'starship-replay-settings',
      version: 1,
      partialize: ({ set: _s, reset: _r, showSettings: _o, ...rest }) => rest,
    },
  ),
)

export const QUALITY = {
  low: { dpr: 1, shadows: false, bloom: false, particles: 0.3, segments: 96, msaa: 0 },
  medium: { dpr: 1.25, shadows: false, bloom: true, particles: 0.6, segments: 160, msaa: 0 },
  high: { dpr: 1.5, shadows: true, bloom: true, particles: 1, segments: 256, msaa: 4 },
  ultra: { dpr: 2, shadows: true, bloom: true, particles: 1.6, segments: 384, msaa: 8 },
} as const
