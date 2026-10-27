import { useEffect, useRef } from 'react'
import { formatT, useClock, useMissionTime } from '../sim/clock'
import { useReplay } from '../sim/replay'

export function EventList() {
  const replay = useReplay()
  const t = useMissionTime(4)
  const activeRef = useRef<HTMLButtonElement>(null)
  const current = replay.currentEvent(t)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current?.id])
  return (
    <div className="flex h-full flex-col">
      <div className="label border-b border-line px-4 py-3">Sequence of events</div>
      <ol className="flex-1 overflow-y-auto">
        {replay.data.timeline.map((e) => {
          const active = current?.id === e.id
          const past = e.t <= t
          return (
            <li key={e.id}>
              <button
                ref={active ? activeRef : undefined}
                className={`flex w-full gap-3 border-b border-line/60 px-4 py-2.5 text-left transition-colors hover:bg-white/5 ${active ? 'bg-white/10' : ''}`}
                onClick={() => useClock.getState().seek(e.t - 3)}
              >
                <span className={`num w-[86px] shrink-0 text-[12px] ${past ? 'text-white' : 'text-dim'}`}>{formatT(e.t)}</span>
                <span>
                  <span className={`text-[13px] ${e.status === 'off-nominal' ? 'text-fail' : e.status === 'partial' ? 'text-warn' : past ? 'text-white' : 'text-white/60'}`}>
                    {e.title}
                    {e.estimated && <span className="label ml-1.5 !text-[9px] !text-faint">est.</span>}
                  </span>
                  {active && e.description && <span className="mt-1 block text-[12px] leading-snug text-white/65">{e.description}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
