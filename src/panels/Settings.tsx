import type { ReactNode } from 'react'
import { useSettings, type Settings, type Quality } from '../lib/settings'
import { IMAGERY_CREDIT, MODEL_CREDIT } from '../scene/Starbase/imagery'
import { useReplay } from '../sim/replay'

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]

function Toggle({ k, label, hint }: { k: BoolKey; label: string; hint?: string }) {
  const value = useSettings((s) => s[k]) as boolean
  const set = useSettings((s) => s.set)
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="text-[13px] text-white">{label}</span>
        {hint && <span className="block text-[11px] text-dim">{hint}</span>}
      </span>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => set({ [k]: !value } as Partial<Settings>)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${value ? 'border-white bg-white' : 'border-line bg-transparent'}`}
      >
        <span className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all ${value ? 'left-[18px] bg-black' : 'left-0.5 bg-white/70'}`} />
      </button>
    </label>
  )
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="py-2">
      <div className="mb-1.5 text-[13px] text-white">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button key={o.v} className="btn-sm" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4">
      <div className="label mb-1">{title}</div>
      {children}
    </section>
  )
}

export function SettingsDrawer() {
  const s = useSettings()
  const replay = useReplay()
  if (!s.showSettings) return null
  return (
    <div className="pointer-events-auto absolute inset-0 z-30" onClick={() => s.set({ showSettings: false })}>
      <aside className="panel absolute bottom-0 right-0 top-0 w-[min(380px,100vw)] overflow-y-auto !bg-black/90" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="heading tracking-[0.2em]">Settings</div>
          <button className="btn-sm" onClick={() => s.set({ showSettings: false })}>
            Close
          </button>
        </div>
        <Group title="Live content">
          <Toggle k="commentary" label="Live commentary" hint="Webcast host quotes and explainers" />
          <Choice label="Commentary detail" value={s.commentaryLevel} options={[{ v: 'essential', l: 'Essential' }, { v: 'detailed', l: 'Detailed' }]} onChange={(v) => s.set({ commentaryLevel: v })} />
          <Toggle k="posts" label="X posts" hint="Curated posts shown when they were published" />
          <Toggle k="toasts" label="Event callouts" />
          <Toggle k="video" label="Webcast picture-in-picture" hint="Synced to the mission clock" />
        </Group>
        <Group title="HUD">
          <Toggle k="hudTelemetry" label="Speed & altitude" />
          <Toggle k="hudEngines" label="Engine diagrams" />
          <Toggle k="hudPropellant" label="Propellant levels" />
          <Toggle k="hudArc" label="Event arc" />
          <Toggle k="highlightFailures" label="Highlight failed engines in red" />
          <Choice label="Units" value={s.units} options={[{ v: 'metric', l: 'Metric' }, { v: 'imperial', l: 'Imperial' }]} onChange={(v) => s.set({ units: v })} />
          <Choice label="Clock" value={s.timeFormat} options={[{ v: 'mission', l: 'T+ mission' }, { v: 'utc', l: 'UTC' }, { v: 'local', l: 'Local' }]} onChange={(v) => s.set({ timeFormat: v })} />
        </Group>
        <Group title="3D world">
          <Choice<Quality> label="Graphics quality" value={s.quality} options={[{ v: 'low', l: 'Low' }, { v: 'medium', l: 'Medium' }, { v: 'high', l: 'High' }, { v: 'ultra', l: 'Ultra' }]} onChange={(v) => s.set({ quality: v })} />
          <Toggle k="trajectories" label="Flight paths" />
          <Toggle k="plannedTrack" label="Planned 6-orbit ground track" hint="What the full mission would have flown" />
          <Toggle k="atmosphere" label="Atmosphere glow" />
          <Toggle k="clouds" label="Clouds" />
          <Toggle k="labels" label="Labels" />
        </Group>
        <Group title="Audio">
          <Toggle k="audio" label="Engine sound" hint="Synthesised rumble that follows thrust and distance" />
          <label className="flex items-center gap-3 py-2 text-[13px]">
            Volume
            <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => s.set({ volume: Number(e.target.value) })} className="flex-1 accent-white" />
          </label>
        </Group>
        <div className="space-y-3 px-5 py-5 text-[11px] leading-relaxed text-dim">
          <p>Telemetry is reconstructed from the reported timeline and orbit, not from raw SpaceX data. {replay.data.keyframes.notes}</p>
          <p>{IMAGERY_CREDIT}. Earth: NASA Blue Marble Next Generation via NASA GIBS, relief from GEBCO 2008 via NASA Visible Earth, Black Marble night lights via the three.js examples.</p>
          <p>
            {MODEL_CREDIT} (
            <a className="underline" href="https://sketchfab.com/3d-models/spacex-starship-block-3-6f6c6f88a3eb4b4d822fdca66733fbb2" target="_blank" rel="noreferrer">
              source
            </a>
            ).
          </p>
          <button className="btn-sm" onClick={() => s.reset()}>
            Reset all settings
          </button>
        </div>
      </aside>
    </div>
  )
}
