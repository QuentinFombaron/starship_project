import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../lib/settings'
import { useClock, formatT } from '../sim/clock'
import { useReplay } from '../sim/replay'
import type { TimelineEvent } from '../content/schema'

/** Big centred callouts when the playhead crosses an event (e.g. "HOT STAGING"). */
export function EventToasts() {
  const replay = useReplay()
  const enabled = useSettings((s) => s.toasts)
  const [toast, setToast] = useState<TimelineEvent | null>(null)
  const last = useRef<number>(useClock.getState().t)
  const timer = useRef<number | null>(null)
  useEffect(
    () =>
      useClock.subscribe((s) => {
        const prev = last.current
        last.current = s.t
        if (!s.playing || s.t <= prev || s.t - prev > 30) return
        const ev = replay.data.timeline.find((e) => e.t > prev && e.t <= s.t && e.kind !== 'countdown')
        if (!ev) return
        setToast(ev)
        if (timer.current) clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setToast(null), 4200 / Math.max(1, Math.min(s.rate, 4)))
      }),
    [replay],
  )
  if (!enabled || !toast) return null
  const bad = toast.status === 'off-nominal'
  return (
    <div key={toast.id} className="pointer-events-none absolute inset-x-0 top-[22%] z-10 flex justify-center px-4">
      <div className="animate-[toast_4s_ease-out_forwards] text-center">
        <div className={`label mb-2 ${bad ? '!text-fail' : ''}`}>{formatT(toast.t)} {bad ? '· ANOMALY' : ''}</div>
        <div className={`heading text-3xl tracking-[0.18em] md:text-5xl ${bad ? 'text-fail' : ''}`} style={{ textShadow: '0 2px 24px rgba(0,0,0,0.8)' }}>
          {toast.title}
        </div>
      </div>
      <style>{`@keyframes toast{0%{opacity:0;transform:translateY(8px)}8%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0}}`}</style>
    </div>
  )
}
