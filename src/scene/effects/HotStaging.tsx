import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useClock } from '../../sim/clock'
import { clamp, smoothstep } from '../../sim/interpolate'
import { BOOSTER_LEN, SHIP_LEN, useReplay, type Replay } from '../../sim/replay'
import { quatFromBasis, toV3 } from '../frame'
import { live } from '../live'
import { ParticleBurst } from './Particles'

/** Hot-stage ring: vent band just below the booster's forward dome (model frame, origin at the centre). */
const RING_Y = BOOSTER_LEN / 2 - 1.75
const RING_R = 4.5
const VENTS = 24

/**
 * Hot-staging timing. The ship lights its engines while still latched to the booster (`ignition`); the
 * exhaust has nowhere to go but out through the ring's vents until the stages part at `separation`.
 */
export function hotStagingTimes(replay: Replay) {
  const separation = replay.tStage
  const burn = replay.data.engines.ship.burns.find((b) => b.start <= separation + 1 && b.start >= separation - 10)
  return { ignition: Math.min(burn?.start ?? separation - 1.5, separation - 0.3), separation }
}

const FLAME_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float phase;
varying float vAlong; varying float vPhase; varying float vRim;
void main() {
  vAlong = uv.y; vPhase = phase;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vRim = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`

const FLAME_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float intensity; uniform float time; uniform vec3 hot; uniform vec3 cool;
varying float vAlong; varying float vPhase; varying float vRim;
void main() {
  #include <logdepthbuf_fragment>
  float flicker = 0.7 + 0.3 * sin(time * 47.0 + vPhase * 17.0 + vAlong * 11.0) * sin(time * 23.0 + vPhase * 5.0);
  float along = clamp(vAlong, 0.0, 1.0);
  float body = pow(1.0 - along, 2.2) * smoothstep(0.0, 0.06, along);
  float a = intensity * body * flicker * (0.35 + 0.65 * vRim);
  vec3 c = mix(hot, cool, smoothstep(0.0, 0.7, along));
  gl_FragColor = vec4(max(c * a * 2.0, vec3(0.0)), clamp(a, 0.0, 1.0));
}`

function flameMaterial(hot: string, cool: string) {
  return new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: { intensity: { value: 0 }, time: { value: 0 }, hot: { value: new THREE.Color(hot) }, cool: { value: new THREE.Color(cool) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
}

/** Open cone from the origin along +y (uv.y = 0 at the base), with a per-vertex `phase`. */
function cone(r0: number, r1: number, phase: number) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 12, 6, true)
  g.translate(0, 0.5, 0)
  g.setAttribute('phase', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(phase), 1))
  return g
}

/** Exhaust jets out of each vent, deflected aft, with a little length variation. */
function ventJetsGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < VENTS; i++) {
    const a = ((i + 0.5) / VENTS) * Math.PI * 2
    const radial = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
    const dir = radial.clone().addScaledVector(up, -0.45).normalize()
    const len = 24 + (12 * ((i * 7) % 5)) / 4
    q.setFromUnitVectors(up, dir)
    m.compose(radial.clone().multiplyScalar(RING_R).setY(RING_Y), q, new THREE.Vector3(len, len, len))
    parts.push(cone(0.7 / len, 5.5 / len, i / VENTS).applyMatrix4(m))
  }
  return mergeGeometries(parts)!
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,214,150,0.75)')
  g.addColorStop(0.7, 'rgba(255,120,40,0.2)')
  g.addColorStop(1, 'rgba(255,90,20,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

/**
 * Booster-side hot staging, in the booster's model frame: flame jets out of the vented ring while the stages
 * are latched, then the ship's plume washing over the forward dome and spilling past its rim as the ship pulls
 * away, fading with distance and as the flip turns the dome out of the plume.
 */
export function HotStageVents() {
  const replay = useReplay()
  const { ignition, separation } = hotStagingTimes(replay)
  const res = useMemo(() => {
    const jets = ventJetsGeometry()
    // the plume spreading over the dome and spilling aft past its rim
    const skirt = cone(RING_R, 11, 0)
    skirt.scale(1, 7, 1)
    skirt.rotateX(Math.PI)
    skirt.translate(0, BOOSTER_LEN / 2 + 0.4, 0)
    return { jets, skirt, jetMat: flameMaterial('#ffe7b0', '#ff7414'), washMat: flameMaterial('#ffe9c0', '#ff7a24'), glowMat: new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }) }
  }, [])
  const root = useRef<THREE.Group>(null)
  const glow = useRef<THREE.Mesh>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame((state) => {
    const t = useClock.getState().t
    const g = root.current
    if (!g) return
    const vent = smoothstep(ignition, ignition + 0.35, t) * (1 - smoothstep(separation + 0.15, separation + 1.2, t))
    // plume wash: ship engines → booster dome distance, and how squarely the dome still faces them
    const b = live.booster
    const s = live.ship
    tmp.copy(s.com).addScaledVector(s.nose, -SHIP_LEN / 2).sub(b.com).addScaledVector(b.nose, -BOOSTER_LEN / 2)
    const gap = tmp.length()
    const facing = clamp(b.nose.dot(s.nose))
    const wash = smoothstep(separation - 0.3, separation + 0.2, t) * (1 - smoothstep(25, 170, gap)) * facing * (t < separation + 12 ? 1 : 0)
    g.visible = vent > 0.005 || wash > 0.005
    if (!g.visible) return
    const time = state.clock.elapsedTime
    res.jetMat.uniforms.intensity.value = vent
    res.jetMat.uniforms.time.value = time
    res.washMat.uniforms.intensity.value = wash * 0.9
    res.washMat.uniforms.time.value = time
    const k = Math.max(vent, wash)
    res.glowMat.opacity = k
    glow.current?.scale.setScalar(8 + 10 * k)
  })
  return (
    <group ref={root} visible={false}>
      <mesh geometry={res.jets} material={res.jetMat} frustumCulled={false} renderOrder={6} />
      <mesh geometry={res.skirt} material={res.washMat} frustumCulled={false} renderOrder={6} />
      <mesh ref={glow} material={res.glowMat} position={[0, BOOSTER_LEN / 2 + 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={7}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </group>
  )
}

/**
 * Exhaust and condensate venting out of the ring, expanding into the thin air at ~56 km. Rides with the
 * booster but keeps the separation-time axis, so the cloud doesn't swing round with the flip.
 */
export function HotStagingCloud() {
  const replay = useReplay()
  const { ignition, separation } = hotStagingTimes(replay)
  const group = useRef<THREE.Group>(null)
  const frame = useMemo(() => {
    const p = replay.pose('booster', separation)
    const q = quatFromBasis(p.right, p.nose, p.belly, new THREE.Quaternion())
    return { q, axis: toV3(p.nose, new THREE.Vector3()) }
  }, [replay, separation])
  useFrame(() => {
    const g = group.current
    if (!g) return
    g.position.copy(live.booster.com).addScaledVector(frame.axis, RING_Y)
    g.quaternion.copy(frame.q)
  })
  const spawn = separation + 0.6 - ignition
  return (
    <group ref={group}>
      <ParticleBurst t0={ignition + 0.05} spawn={spawn} life={1.1} count={160} speed={120} spread={0.97} rise={-14} size={[1.5, 9]} color="#ffe6a8" color2="#ff9a3c" additive opacity={0.6} drag={1} wind={[0, 0, 0]} />
      <ParticleBurst t0={ignition + 0.25} spawn={spawn} life={4.5} count={160} speed={55} spread={0.94} rise={-7} size={[4, 30]} color="#f1ece4" color2="#9a958f" opacity={0.1} drag={3} wind={[0, 0, 0]} />
    </group>
  )
}
