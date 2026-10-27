import { useMemo } from 'react'
import { useSettings } from '../lib/settings'
import { useMissionTime } from '../sim/clock'
import { lastIndexAtOrBefore } from '../sim/interpolate'
import { useReplay } from '../sim/replay'

const SHOW_FOR = 14

/** Subtitles for webcast host lines, plus explainer cards. */
export function Commentary() {
  const replay = useReplay()
  const enabled = useSettings((s) => s.commentary)
  const level = useSettings((s) => s.commentaryLevel)
  const t = useMissionTime(4)
  const lines = useMemo(() => replay.data.commentary.filter((l) => level === 'detailed' || l.level === 'essential'), [replay, level])
  if (!enabled) return null
  const host = lines.filter((l) => l.kind !== 'explainer')
  const expl = lines.filter((l) => l.kind === 'explainer')
  const hi = lastIndexAtOrBefore(host, t, (l) => l.t)
  const ei = lastIndexAtOrBefore(expl, t, (l) => l.t)
  const h = hi >= 0 && t - host[hi].t < SHOW_FOR ? host[hi] : null
  const e = ei >= 0 && t - expl[ei].t < SHOW_FOR * 1.6 ? expl[ei] : null
  return (
    <>
      {h && (
        <div key={h.t} className="pointer-events-none absolute inset-x-0 bottom-[250px] z-10 flex justify-center px-4 md:bottom-[230px]">
          <div className="max-w-2xl bg-black/70 px-4 py-2 text-center text-[15px] leading-snug text-white backdrop-blur-sm animate-[fadein_0.4s_ease-out]">
            {h.speaker && <span className="label mr-2 !text-white/60">{h.speaker}</span>}
            {h.kind === 'callout' ? <span className="heading tracking-[0.12em]">{h.text}</span> : <>“{h.text}”</>}
          </div>
        </div>
      )}
      {e && (
        <div key={`e${e.t}`} className="panel pointer-events-none absolute left-3 top-[84px] z-10 hidden w-[300px] p-4 animate-[fadein_0.5s_ease-out] md:left-6 md:block">
          <div className="label mb-1.5 !text-accent">Explainer</div>
          <p className="text-[13px] leading-relaxed text-white/85">{e.text}</p>
        </div>
      )}
      <style>{`@keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`}</style>
    </>
  )
}
