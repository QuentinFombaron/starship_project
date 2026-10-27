import { useMemo } from 'react'
import { useSettings } from '../lib/settings'
import { formatT, useMissionTime } from '../sim/clock'
import { useReplay } from '../sim/replay'

const SHOW_FOR = 45

/** Curated X posts that pop up at the mission time they were published. */
export function Posts() {
  const replay = useReplay()
  const enabled = useSettings((s) => s.posts)
  const panel = useSettings((s) => s.panel)
  const t = useMissionTime(2)
  const posts = useMemo(() => replay.data.posts, [replay])
  if (!enabled) return null
  const visible = posts.filter((p) => t >= p.t && t - p.t < SHOW_FOR).slice(-2)
  if (!visible.length) return null
  return (
    <div className={`pointer-events-none absolute z-10 flex w-[320px] flex-col gap-2 ${panel === 'none' ? 'right-3 top-[84px] md:right-6' : 'left-3 top-[300px] md:left-6'} max-sm:hidden`}>
      {visible.map((p) => (
        <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="panel pointer-events-auto block p-3.5 transition-colors hover:border-white/60 animate-[fadein_0.4s_ease-out]">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[13px] font-semibold">{p.author}</span>
              <span className="ml-1.5 text-[12px] text-dim">@{p.handle}</span>
            </div>
            <span className="text-[15px] font-bold">𝕏</span>
          </div>
          <p className="mt-1.5 text-[13px] leading-snug text-white/90">{p.text}</p>
          <div className="label mt-2 !text-[9px]">
            {formatT(p.t)} · {p.verified ? 'View on X' : 'Quoted via press · View on X'} ↗
          </div>
        </a>
      ))}
    </div>
  )
}
