import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useClock } from '../../sim/clock'
import { clamp, smoothstep } from '../../sim/interpolate'
import { BOOSTER_LEN, MOUNT_HEIGHT, useReplay } from '../../sim/replay'
import { live } from '../live'
import { DECK_Y, PAD_B_YAW } from '../Starbase/PadB'
import { PadFrame } from '../Starbase/Starbase'
import { ParticleBurst } from './Particles'

/** Additive glow sprite that follows a world point and pulses with an intensity curve. */
function Flash({ at, intensity, size, color }: { at: () => THREE.Vector3; intensity: (t: number) => number; size: number; color: string }) {
  const ref = useRef<THREE.Sprite>(null)
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,230,190,0.8)')
    g.addColorStop(0.6, 'rgba(255,150,60,0.25)')
    g.addColorStop(1, 'rgba(255,120,40,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])
  useFrame(() => {
    const s = ref.current
    if (!s) return
    const t = useClock.getState().t
    const k = intensity(t)
    s.visible = k > 0.01
    if (!s.visible) return
    s.position.copy(at())
    s.scale.setScalar(size * (0.6 + 0.4 * k))
    ;(s.material as THREE.SpriteMaterial).opacity = k
  })
  return (
    <sprite ref={ref} renderOrder={8}>
      <spriteMaterial map={tex} color={color} blending={THREE.AdditiveBlending} depthWrite={false} transparent toneMapped={false} />
    </sprite>
  )
}

/** Pad B's flame trench axis in the pad frame (it runs along the pad group's local z). */
const TRENCH = [Math.sin(PAD_B_YAW), 0, Math.cos(PAD_B_YAW)] as const

export function Effects() {
  const replay = useReplay()
  const tDeluge = replay.t('deluge', -10)
  const tel = replay.data.telemetry
  const boosterEnd = { lat: tel.booster.lat.at(-1)!, lon: tel.booster.lon.at(-1)! }
  const shipEnd = { lat: tel.ship.lat.at(-1)!, lon: tel.ship.lon.at(-1)! }
  const tStage = replay.tStage
  const tBoosterLand = replay.t('booster-landing-burn-start', 395)
  const tBoosterSplash = replay.t('booster-splashdown', 421)
  const tFts = replay.t('booster-fts', tBoosterSplash + 7)
  const tShipFlip = replay.t('ship-landing-flip', 1e9)
  const tShipSplash = replay.t('ship-splashdown', 1e9)
  const tShipBoom = replay.t('ship-explosion', tShipSplash + 6)
  const interstage = useMemo(() => new THREE.Vector3(), [])
  return (
    <>
      <PadFrame>
        {/* deluge: water jets up through the steel deck and the diverter from T-10 s */}
        <group position={[0, DECK_Y, 0]}>
          <ParticleBurst t0={tDeluge} spawn={32} life={2.6} count={520} speed={16} spread={0.3} rise={-3} size={[0.6, 4]} color="#eef6fa" color2="#b9d3df" opacity={0.5} drag={0.9} />
        </group>
        {/* deluge steam + exhaust cloud rolling out of both flame-trench exits */}
        {[1, -1].map((s) => (
          <group key={s}>
            <ParticleBurst t0={-5} spawn={28} life={55} count={280} speed={55} spread={0.92} rise={3} size={[18, 110]} color="#f2efea" color2="#a9a59e" opacity={0.55} drag={4} dirBias={[s * TRENCH[0] * 0.75, 0, s * TRENCH[2] * 0.75]} />
            <ParticleBurst t0={-2.5} spawn={10} life={4} count={140} speed={70} spread={1} rise={4} size={[8, 34]} color="#ffd8a0" color2="#ff7a30" additive opacity={0.9} drag={1.2} dirBias={[s * TRENCH[0] * 0.6, 0, s * TRENCH[2] * 0.6]} />
          </group>
        ))}
        <group position={[0, MOUNT_HEIGHT, 0]}>
          <ParticleBurst t0={-1} spawn={8} life={14} count={160} speed={10} spread={0.2} rise={8} size={[6, 40]} color="#ffffff" color2="#c9c5bd" opacity={0.45} drag={2} />
        </group>
      </PadFrame>

      {/* hot staging: ship engines igniting against the vented interstage */}
      <Flash
        at={() => interstage.copy(live.booster.com).addScaledVector(live.booster.nose, BOOSTER_LEN / 2 + 2)}
        intensity={(t) => smoothstep(tStage - 2.2, tStage - 1.6, t) * (1 - smoothstep(tStage + 0.5, tStage + 3.5, t))}
        size={120}
        color="#ffcf9a"
      />
      {/* booster flight-termination demo */}
      <Flash at={() => live.booster.com} intensity={(t) => smoothstep(tFts - 0.1, tFts, t) * (1 - smoothstep(tFts + 0.3, tFts + 3, t))} size={220} color="#ffb070" />
      {/* ship splashdown explosion */}
      <Flash at={() => live.ship.com} intensity={(t) => smoothstep(tShipBoom - 0.1, tShipBoom, t) * (1 - smoothstep(tShipBoom + 0.4, tShipBoom + 4, t))} size={260} color="#ffb070" />

      <PadFrame origin={boosterEnd}>
        <ParticleBurst t0={tBoosterLand + 18} spawn={8} life={22} count={160} speed={30} spread={0.95} rise={2} size={[8, 60]} color="#ffffff" color2="#d7dde2" opacity={0.6} drag={2} />
        <ParticleBurst t0={tFts} spawn={1} life={4} count={140} speed={90} spread={0.5} rise={10} size={[10, 60]} color="#ffe2b0" color2="#ff5a1a" additive opacity={0.9} drag={1} />
        <ParticleBurst t0={tFts + 0.5} spawn={6} life={50} count={140} speed={25} spread={0.4} rise={6} size={[20, 120]} color="#5e5650" color2="#2c2927" opacity={0.6} drag={3} />
      </PadFrame>

      <PadFrame origin={shipEnd}>
        <ParticleBurst t0={tShipFlip + 6} spawn={11} life={20} count={160} speed={28} spread={0.95} rise={2} size={[8, 55]} color="#ffffff" color2="#d7dde2" opacity={0.6} drag={2} />
        <ParticleBurst t0={tShipBoom} spawn={1.2} life={5} count={180} speed={95} spread={0.45} rise={12} size={[12, 70]} color="#ffe2b0" color2="#ff5a1a" additive opacity={0.95} drag={1} />
        <ParticleBurst t0={tShipBoom + 0.5} spawn={50} life={30} count={180} speed={6} spread={0.6} rise={5} size={[6, 40]} color="#ffb060" color2="#ff4010" additive opacity={0.5} drag={2} />
        <ParticleBurst t0={tShipBoom + 0.5} spawn={60} life={70} count={180} speed={12} spread={0.3} rise={7} size={[15, 140]} color="#4f4844" color2="#26221f" opacity={0.55} drag={3} />
      </PadFrame>
      <EngineLight />
    </>
  )
}

/** Point light at the booster's engines while lit, so the pad and smoke glow at ignition. */
function EngineLight() {
  const replay = useReplay()
  const ref = useRef<THREE.PointLight>(null)
  useFrame(() => {
    const l = ref.current
    if (!l) return
    const t = useClock.getState().t
    const eng = replay.engines('booster', t)
    const k = eng.lit / eng.total
    l.intensity = k * 2e4 * clamp(1 - live.booster.alt / 20000)
    l.position.copy(live.booster.com).addScaledVector(live.booster.nose, -BOOSTER_LEN / 2 - 12)
  })
  return <pointLight ref={ref} color="#ffb070" distance={0} decay={2} />
}
