import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../lib/settings'
import { formatT, useClock } from '../sim/clock'
import { useReplay } from '../sim/replay'

/* Minimal typing for the YouTube IFrame API. */
interface YTPlayer {
  seekTo(s: number, allowSeekAhead: boolean): void
  playVideo(): void
  pauseVideo(): void
  mute(): void
  setPlaybackRate(r: number): void
  getCurrentTime(): number
  getPlayerState(): number
  destroy(): void
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer; PlayerState: Record<string, number> }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null
function loadApi() {
  if (window.YT?.Player) return Promise.resolve()
  if (!apiPromise)
    apiPromise = new Promise((res) => {
      window.onYouTubeIframeAPIReady = () => res()
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    })
  return apiPromise
}

const OFFSET_KEY = (id: string) => `webcast-t0-${id}`
const YT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

/**
 * Webcast picture-in-picture synced to the mission clock. Video time = t0Offset + mission time.
 * Outside YouTube's supported rates (0.25×–2×) the video pauses and resyncs when you return.
 */
export function VideoPiP() {
  const replay = useReplay()
  const enabled = useSettings((s) => s.video)
  const set = useSettings((s) => s.set)
  const wc = replay.data.webcast
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [big, setBig] = useState(false)
  const [offset, setOffset] = useState(() => {
    try {
      const v = localStorage.getItem(OFFSET_KEY(wc?.youtubeId ?? ''))
      return v ? Number(v) : (wc?.t0Offset ?? 0)
    } catch {
      return wc?.t0Offset ?? 0
    }
  })
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  useEffect(() => {
    if (!enabled || !wc || !host.current) return
    let alive = true
    const el = document.createElement('div')
    host.current.appendChild(el)
    loadApi().then(() => {
      if (!alive || !window.YT) return
      player.current = new window.YT.Player(el, {
        videoId: wc.youtubeId,
        width: '100%',
        height: '100%',
        playerVars: { controls: 0, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1 },
        events: {
          onReady: () => {
            if (!alive) return
            player.current?.mute()
            setReady(true)
          },
        },
      })
    })
    return () => {
      alive = false
      setReady(false)
      player.current?.destroy()
      player.current = null
      el.remove()
    }
  }, [enabled, wc])

  // keep the video in step with the clock
  useEffect(() => {
    if (!ready) return
    const sync = () => {
      const p = player.current
      if (!p) return
      const c = useClock.getState()
      const target = offsetRef.current + c.t
      const ok = c.playing && !c.reverse && c.rate >= 0.25 && c.rate <= 2 && target >= 0
      const rate = YT_RATES.reduce((a, b) => (Math.abs(b - c.rate) < Math.abs(a - c.rate) ? b : a), 1)
      if (ok) {
        p.setPlaybackRate(rate)
        if (p.getPlayerState() !== 1) p.playVideo()
        if (Math.abs(p.getCurrentTime() - target) > 1.2) p.seekTo(Math.max(0, target), true)
      } else {
        if (p.getPlayerState() === 1) p.pauseVideo()
        if (Math.abs(p.getCurrentTime() - target) > 0.6) p.seekTo(Math.max(0, target), true)
      }
    }
    const id = setInterval(sync, 500)
    const unsub = useClock.subscribe((s, prev) => {
      if (s.seekId !== prev.seekId || s.playing !== prev.playing || s.rate !== prev.rate) sync()
    })
    sync()
    return () => {
      clearInterval(id)
      unsub()
    }
  }, [ready])

  if (!enabled || !wc) return null
  const nudge = (d: number) => {
    const o = offset + d
    setOffset(o)
    try {
      localStorage.setItem(OFFSET_KEY(wc.youtubeId), String(o))
    } catch {
      /* storage unavailable */
    }
  }
  return (
    <div className={`panel pointer-events-auto absolute z-20 overflow-hidden ${big ? 'left-1/2 top-[76px] w-[min(960px,92vw)] -translate-x-1/2' : 'bottom-[236px] left-3 w-[min(360px,calc(100vw-24px))] md:left-6'}`}>
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="label !text-[10px]">Webcast · synced</span>
        <div className="flex gap-1">
          <button className="btn-sm !px-1.5 !py-0.5" onClick={() => setBig((b) => !b)}>
            {big ? 'Small' : 'Large'}
          </button>
          <button className="btn-sm !px-1.5 !py-0.5" onClick={() => set({ video: false })} aria-label="Close webcast">
            ✕
          </button>
        </div>
      </div>
      <div ref={host} className="aspect-video w-full bg-black [&>iframe]:h-full [&>iframe]:w-full" />
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 text-[11px] text-dim">
        <span>
          T-0 at video {formatT(offset, false).replace(/^-/, '−')}
          {!wc.calibrated && ' (uncalibrated)'}
        </span>
        <span className="ml-auto flex gap-1" title="If the video is ahead of the 3D replay, shift it earlier; if behind, later">
          {[-10, -1, 1, 10].map((d) => (
            <button key={d} className="btn-sm !px-1.5 !py-0.5" onClick={() => nudge(d)}>
              {d > 0 ? `+${d}s` : `${d}s`}
            </button>
          ))}
        </span>
      </div>
    </div>
  )
}
