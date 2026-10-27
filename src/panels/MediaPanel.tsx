import { SafeImg } from '../components/ui'
import { formatT, useClock } from '../sim/clock'
import { useReplay } from '../sim/replay'

export function MediaPanel() {
  const replay = useReplay()
  const media = replay.data.media
  return (
    <div className="flex h-full flex-col">
      <div className="label border-b border-line px-4 py-3">Mission photos</div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {media.map((m) => (
          <figure key={m.src}>
            <a href={m.page ?? m.src} target="_blank" rel="noreferrer">
              <SafeImg src={m.thumb ?? m.src} alt={m.caption} className="w-full border border-line" />
            </a>
            <figcaption className="mt-1.5 text-[12px] text-white/75">
              {m.caption}
              <span className="block text-[11px] text-dim">
                © {m.credit} · {m.license}
              </span>
              {m.t !== undefined && (
                <button className="label mt-1 !text-[10px] hover:!text-white" onClick={() => useClock.getState().seek(m.t! - 2)}>
                  Jump to {formatT(m.t)} →
                </button>
              )}
            </figcaption>
          </figure>
        ))}
        {!media.length && <p className="text-sm text-dim">No photos yet.</p>}
      </div>
    </div>
  )
}
