import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Loading } from '../components/Loading'
import { getMission, loadReplay } from '../content/loader'
import { EventToasts } from '../hud/EventToasts'
import { Hud } from '../hud/Hud'
import { useSettings } from '../lib/settings'
import { Commentary } from '../panels/Commentary'
import { EventList } from '../panels/EventList'
import { InspectPanel } from '../panels/InspectPanel'
import { MediaPanel } from '../panels/MediaPanel'
import { Posts } from '../panels/Posts'
import { SettingsDrawer } from '../panels/Settings'
import { Transport, useKeyboardShortcuts } from '../panels/Timeline'
import { VideoPiP } from '../panels/VideoPiP'
import { ReplayScene } from '../scene/ReplayScene'
import { useClock, useClockDriver } from '../sim/clock'
import { Replay as ReplayModel, ReplayContext } from '../sim/replay'
import { NotFound } from './NotFound'
import { EngineAudio } from '../panels/Audio'

const MapPanel = lazy(() => import('../panels/MapPanel'))
const Charts = lazy(() => import('../panels/Charts'))

const PANELS = [
  { id: 'map', label: 'Map', key: 'M' },
  { id: 'charts', label: 'Data', key: 'G' },
  { id: 'events', label: 'Events', key: '' },
  { id: 'media', label: 'Photos', key: '' },
] as const

function TopBar({ replay, onHelp }: { replay: ReplayModel; onHelp: () => void }) {
  const s = useSettings()
  const m = replay.data.mission
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-3 pb-10 pt-3 md:px-6">
      <div className="pointer-events-auto flex items-center gap-4">
        <Link to={`/flights/${m.id}`} className="btn-sm" aria-label="Back to mission page">
          ←
        </Link>
        <div className="hidden sm:block">
          <div className="heading text-[15px] tracking-[0.26em]">STARSHIP · {m.name.toUpperCase()}</div>
          <div className="label !text-[10px]">
            {m.vehicles.booster.id} / {m.vehicles.ship.id} · Reconstructed telemetry
          </div>
        </div>
      </div>
      <div className="pointer-events-auto flex flex-wrap justify-end gap-1.5">
        {PANELS.map((p) => (
          <button key={p.id} className={`btn-sm ${p.id === 'events' || p.id === 'media' ? 'max-sm:hidden' : ''}`} aria-pressed={s.panel === p.id} onClick={() => s.set({ panel: s.panel === p.id ? 'none' : p.id })} title={p.key ? `${p.label} (${p.key})` : p.label}>
            {p.label}
          </button>
        ))}
        <button className="btn-sm max-sm:hidden" aria-pressed={s.video} onClick={() => s.set({ video: !s.video })} title="Webcast picture-in-picture (V)">
          Webcast
        </button>
        <button className="btn-sm" aria-pressed={s.commentary} onClick={() => s.set({ commentary: !s.commentary })} title="Live commentary (C)">
          Comms
        </button>
        <button className="btn-sm" aria-pressed={s.showSettings} onClick={() => s.set({ showSettings: !s.showSettings })} title="Settings">
          ⚙ Settings
        </button>
        <button className="btn-sm max-sm:hidden" onClick={onHelp} title="Keyboard shortcuts (?)">
          ?
        </button>
      </div>
    </div>
  )
}

function SidePanel() {
  const panel = useSettings((s) => s.panel)
  if (panel === 'none') return null
  return (
    <aside className="panel pointer-events-auto absolute bottom-[230px] right-3 top-[76px] z-20 flex w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden max-sm:bottom-[150px] max-sm:top-[64px] md:right-6">
      <Suspense fallback={<div className="label p-4">Loading…</div>}>
        {panel === 'map' && <MapPanel />}
        {panel === 'charts' && <Charts />}
        {panel === 'events' && <EventList />}
        {panel === 'media' && <MediaPanel />}
      </Suspense>
    </aside>
  )
}

const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['← / →', '−10 s / +10 s (Shift: 1 min)'],
  [', / .', 'Previous / next event'],
  ['[ / ]', 'Slower / faster'],
  ['R', 'Reverse'],
  ['1 … 0', 'Cameras (director, chase ship, chase booster, tower, long lens, ship cam, booster cam, orbital, globe, free)'],
  ['Hover / click', 'Live data on the vehicles and pad hardware (click to pin)'],
  ['Drag / wheel', 'Orbit / zoom the camera'],
  ['W A S D Q E', 'Fly (free roam camera, 0): Shift = 5× faster'],
  ['Double-click', 'Free roam: fly to a point, or ride along with the booster/ship'],
  ['T', 'Free roam: follow booster → ship → off'],
  ['Right-drag', 'Free roam: pan (or Shift-drag)'],
  ['Esc', 'Close a pinned info card'],
  ['M / G', 'Map / data panel'],
  ['C / V / H', 'Commentary / webcast / HUD'],
  ['F', 'Fullscreen'],
]

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="panel max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="heading mb-4 text-lg tracking-[0.2em]">Controls</div>
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="heading text-[12px] text-white">{k}</dt>
              <dd className="text-white/75">{v}</dd>
            </div>
          ))}
        </dl>
        <button className="btn-sm mt-6" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function ReplayUI({ replay }: { replay: ReplayModel }) {
  const [help, setHelp] = useState(false)
  const toggleHelp = useCallback(() => setHelp((h) => !h), [])
  useClockDriver()
  useKeyboardShortcuts(toggleHelp)
  return (
    <div className="fixed inset-0 overflow-hidden bg-black select-none">
      <ReplayScene replay={replay} />
      <TopBar replay={replay} onHelp={toggleHelp} />
      <Hud />
      <Commentary />
      <EventToasts />
      <Posts />
      <SidePanel />
      <InspectPanel />
      <VideoPiP />
      <SettingsDrawer />
      <EngineAudio />
      <Transport />
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  )
}

export default function Replay() {
  const { id = '' } = useParams()
  const mission = getMission(id)
  const [replay, setReplay] = useState<ReplayModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!mission?.hasReplay) return
    let alive = true
    loadReplay(mission.id)
      .then((data) => {
        if (!alive) return
        const r = new ReplayModel(data)
        const c = useClock.getState()
        c.setBounds(-120, Math.ceil(r.tEnd))
        c.pause()
        c.setRate(1)
        c.setReverse(false)
        c.seek(-30)
        setReplay(r)
        if (import.meta.env.DEV) Object.assign(window, { __clock: useClock, __settings: useSettings, __replay: r })
      })
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [mission])
  if (!mission) return <NotFound />
  if (!mission.hasReplay)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-5 text-center">
        <div className="label">{mission.name}</div>
        <h1 className="heading text-4xl">3D replay coming soon</h1>
        <p className="max-w-md text-white/70">Replay data for this flight has not been reconstructed yet. Add its timeline, engines and keyframes to the database to enable it.</p>
        <Link to={`/flights/${mission.id}`} className="btn">
          Mission page
        </Link>
      </div>
    )
  if (error) return <div className="p-10 text-fail">Failed to load replay: {error}</div>
  if (!replay) return <Loading label="Loading telemetry" />
  return (
    <ReplayContext.Provider value={replay}>
      <ReplayUI replay={replay} />
    </ReplayContext.Provider>
  )
}
