import { useEffect } from 'react'
import { useSettings } from '../lib/settings'
import { useClock } from '../sim/clock'
import { clamp } from '../sim/interpolate'
import { useReplay } from '../sim/replay'
import { live } from '../scene/live'

/**
 * Synthesised engine rumble: low-passed brown noise + crackle, loudness follows lit engines,
 * throttle and distance from the camera (sound arrives with speed-of-sound delay near the pad).
 */
export function EngineAudio() {
  const replay = useReplay()
  const enabled = useSettings((s) => s.audio)
  useEffect(() => {
    if (!enabled) return
    const ctx = new AudioContext()
    const len = ctx.sampleRate * 4
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5 + (Math.random() < 0.0008 ? (Math.random() - 0.5) * 1.6 : 0)
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 400
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(lp).connect(gain).connect(ctx.destination)
    src.start()
    let raf = 0
    const loop = () => {
      const c = useClock.getState()
      const vol = useSettings.getState().volume
      // delayed time for sound travel (camera distance / 343 m/s), capped
      let level = 0
      for (const v of ['booster', 'ship'] as const) {
        const L = live[v]
        const dist = live.camera.distanceTo(L.com)
        const delay = Math.min(dist / 343, 30)
        const e = replay.engines(v, c.t - delay)
        const air = clamp(1 - L.alt / 60_000)
        level += (e.lit / e.total) * (0.4 + 0.6 * e.throttle) * air * clamp(800 / Math.max(200, dist)) * (v === 'booster' ? 1 : 0.5)
      }
      const playing = c.playing && c.rate <= 4
      gain.gain.setTargetAtTime(playing ? clamp(level) * vol : 0, ctx.currentTime, 0.08)
      lp.frequency.setTargetAtTime(180 + 900 * clamp(level), ctx.currentTime, 0.2)
      raf = requestAnimationFrame(loop)
    }
    ctx.resume().then(() => (raf = requestAnimationFrame(loop)))
    return () => {
      cancelAnimationFrame(raf)
      src.stop()
      ctx.close()
    }
  }, [enabled, replay])
  return null
}
