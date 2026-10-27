import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useClock } from '../../sim/clock'
import { clamp, smoothstep } from '../../sim/interpolate'
import { BOOSTER_LEN, SHIP_LEN, useReplay, type Vehicle } from '../../sim/replay'
import { quatFromBasis, toV3 } from '../frame'
import { live } from '../live'
import { EngineGlows, Plume } from '../effects/Plume'
import { GlbOverride } from './GlbOverride'
import { Starship, SuperHeavy, boosterEnginePositions, shipEnginePositions } from './Vehicles'

const PRIORITY = -2

function useVehicleDriver(vehicle: Vehicle) {
  const replay = useReplay()
  const group = useRef<THREE.Group>(null)
  const plumeI = useRef(0)
  const plumeE = useRef(0)
  const status = useRef<string[]>([])
  const prev = useRef(new THREE.Vector3())
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const endT = vehicle === 'booster' ? replay.t('booster-fts', replay.t('booster-splashdown') + 7) : replay.t('ship-explosion', replay.t('ship-splashdown') + 6)
  useFrame((_, dt) => {
    const t = useClock.getState().t
    const g = group.current
    if (!g) return
    const p = replay.pose(vehicle, t)
    const L = live[vehicle]
    toV3(p.com, L.com)
    quatFromBasis(p.right, p.nose, p.belly, L.quat)
    toV3(p.nose, L.nose)
    toV3(p.belly, L.belly)
    toV3(p.up, L.up)
    if (dt > 0) {
      tmp.copy(L.com).sub(prev.current).divideScalar(Math.max(dt, 1e-3))
      L.velocity.lerp(tmp, 0.2)
    }
    prev.current.copy(L.com)
    L.alt = p.sample.alt
    L.speed = p.sample.speed
    L.visible = t < endT + 0.5
    g.position.copy(L.com)
    g.quaternion.copy(L.quat)
    g.visible = L.visible
    const eng = replay.engines(vehicle, t)
    status.current = eng.status
    const frac = eng.lit / eng.total
    plumeI.current = eng.lit ? clamp(0.35 + frac * 0.9) * (0.6 + 0.4 * eng.throttle) : 0
    plumeE.current = smoothstep(4_000, 60_000, p.sample.alt)
  }, PRIORITY)
  return { group, plumeI, plumeE, status }
}

// GLB models span the full vehicle length including engine bells; the procedural models hang their
// bells below the barrel. The plume starts at the nozzle exit either way.
export function BoosterActor() {
  const { group, plumeI, plumeE, status } = useVehicleDriver('booster')
  const pts = useMemo(boosterEnginePositions, [])
  const [glb, setGlb] = useState(false)
  const bottom = -BOOSTER_LEN / 2 - (glb ? 0 : 2.2)
  return (
    <group ref={group}>
      <GlbOverride url="/models/super-heavy.glb" length={BOOSTER_LEN} onModel={setGlb}>
        <SuperHeavy />
      </GlbOverride>
      <group position={[0, bottom, 0]}>
        {!glb && <EngineGlows points={pts} y={0.05} size={0.62} statusRef={status} />}
        <Plume intensityRef={plumeI} expansionRef={plumeE} radius={4.6} length={120} />
      </group>
    </group>
  )
}

export function ShipActor() {
  const { group, plumeI, plumeE, status } = useVehicleDriver('ship')
  const pts = useMemo(shipEnginePositions, [])
  const [glb, setGlb] = useState(false)
  const bottom = -SHIP_LEN / 2 - (glb ? 0 : 2.6)
  return (
    <group ref={group}>
      <GlbOverride url="/models/starship.glb" length={SHIP_LEN} onModel={setGlb}>
        <Starship />
      </GlbOverride>
      <group position={[0, bottom, 0]}>
        {!glb && (
          <>
            <EngineGlows points={pts.slice(0, 3)} y={0.6} size={0.6} statusRef={status} />
            <EngineGlows points={pts.slice(3)} y={-0.7} size={1.1} statusRef={status} offset={3} />
          </>
        )}
        <Plume intensityRef={plumeI} expansionRef={plumeE} radius={3.8} length={55} vacuumBlue />
      </group>
      <ReentryPlasma />
    </group>
  )
}

/** Pink-orange plasma sheath on the windward (belly) side during reentry. */
function ReentryPlasma() {
  const replay = useReplay()
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { intensity: { value: 0 }, time: { value: 0 } },
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main() {
            vP = position;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          uniform float intensity; uniform float time;
          varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main() {
            #include <logdepthbuf_fragment>
            float rim = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 1.5);
            float belly = smoothstep(-2.0, 6.0, vP.z);
            float flick = 0.85 + 0.15 * sin(time * 30.0 + vP.y * 0.7);
            vec3 col = mix(vec3(1.0, 0.35, 0.55), vec3(1.0, 0.75, 0.45), belly);
            float a = intensity * (0.35 + rim * 1.4) * belly * flick;
            gl_FragColor = vec4(col * a * 5.0, clamp(a, 0.0, 1.0));
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const tEntry = replay.t('ship-entry', 1e9)
  useFrame((state) => {
    const t = useClock.getState().t
    const s = live.ship
    let heat = 0
    if (t > tEntry - 300) {
      const smp = replay.ship.sample(t)
      heat = Math.pow(clamp((smp.q * smp.speed) / 2.5e7), 0.6) * smoothstep(tEntry - 300, tEntry + 60, t)
    }
    mat.uniforms.intensity.value = heat
    mat.uniforms.time.value = state.clock.elapsedTime
    if (ref.current) ref.current.visible = heat > 0.01 && s.visible
  })
  return (
    <mesh ref={ref} material={mat} scale={[7.5, SHIP_LEN * 0.62, 8.5]} position={[0, 2, 2.2]} renderOrder={7}>
      <sphereGeometry args={[1, 32, 24]} />
    </mesh>
  )
}
