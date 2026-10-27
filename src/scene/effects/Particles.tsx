import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { useSettings, QUALITY } from '../../lib/settings'
import { useClock } from '../../sim/clock'

/**
 * Deterministic GPU particle burst: every particle's state is a pure function of mission time,
 * so scrubbing backwards/forwards always shows the right smoke/steam/fire.
 * Rendered in the parent's local frame (Y up).
 */
export interface BurstProps {
  t0: number
  spawn: number // seconds over which particles are emitted
  life: number // particle lifetime
  count: number
  speed: number // initial outward speed (m/s)
  spread: number // 0 = straight up … 1 = horizontal ring
  rise: number // buoyant rise (m/s)
  size: [number, number] // start/end size (m)
  color: string
  color2?: string
  additive?: boolean
  opacity?: number
  drag?: number // seconds — time constant of the outward velocity decay
  wind?: [number, number, number]
  dirBias?: [number, number, number] // preferred outward direction (e.g. flame trench)
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 seed;
uniform float t; uniform float t0; uniform float spawn; uniform float life;
uniform float speed; uniform float spread; uniform float rise; uniform vec2 size;
uniform float drag; uniform vec3 wind; uniform vec3 dirBias;
varying float vAge; varying vec2 vUv; varying float vSeed;
void main() {
  float ts = t0 + seed.x * spawn;
  float age = t - ts;
  vAge = age / life;
  vSeed = seed.w;
  vUv = uv;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float a = seed.y * 6.2831853;
  float el = mix(1.5707, 0.05, spread) * (0.6 + 0.4 * seed.z);
  vec3 dir = normalize(vec3(cos(a) * cos(el), sin(el), sin(a) * cos(el)) + dirBias);
  float travel = speed * drag * (1.0 - exp(-age / drag)) * (0.4 + 0.6 * seed.w);
  vec3 center = dir * travel + vec3(0.0, rise * age * (0.6 + 0.8 * seed.z), 0.0) + wind * age;
  float s = mix(size.x, size.y, sqrt(clamp(age / life, 0.0, 1.0))) * (0.6 + 0.8 * seed.y);
  vec4 mv = modelViewMatrix * vec4(center, 1.0);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 color; uniform vec3 color2; uniform float opacity; uniform float additive;
varying float vAge; varying vec2 vUv; varying float vSeed;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(vUv - 0.5) * 2.0;
  float soft = (1.0 - smoothstep(0.2, 1.0, d));
  float fade = smoothstep(0.0, 0.08, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
  vec3 c = mix(color, color2, clamp(vAge * 1.4 + vSeed * 0.2, 0.0, 1.0));
  float alpha = soft * fade * opacity;
  if (alpha < 0.004) discard;
  gl_FragColor = additive > 0.5 ? vec4(c * alpha, alpha) : vec4(c, alpha);
}
`

export function ParticleBurst(p: BurstProps) {
  const quality = useSettings((s) => s.quality)
  const count = Math.max(8, Math.round(p.count * QUALITY[quality].particles))
  const geom = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.getAttribute('position'))
    g.setAttribute('uv', base.getAttribute('uv'))
    const seeds = new Float32Array(count * 4)
    let s = 1234.567
    const rnd = () => {
      s = (s * 9301 + 49297) % 233280
      return s / 233280
    }
    for (let i = 0; i < count * 4; i++) seeds[i] = rnd()
    g.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4))
    g.instanceCount = count
    return g
  }, [count])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: p.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          t: { value: 0 },
          t0: { value: p.t0 },
          spawn: { value: p.spawn },
          life: { value: p.life },
          speed: { value: p.speed },
          spread: { value: p.spread },
          rise: { value: p.rise },
          size: { value: new THREE.Vector2(...p.size) },
          drag: { value: p.drag ?? 3 },
          wind: { value: new THREE.Vector3(...(p.wind ?? [1.5, 0, 0.5])) },
          dirBias: { value: new THREE.Vector3(...(p.dirBias ?? [0, 0, 0])) },
          color: { value: new THREE.Color(p.color) },
          color2: { value: new THREE.Color(p.color2 ?? p.color) },
          opacity: { value: p.opacity ?? 0.7 },
          additive: { value: p.additive ? 1 : 0 },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const tEnd = p.t0 + p.spawn + p.life
  useFrame(() => {
    const t = useClock.getState().t
    mat.uniforms.t.value = t
  })
  return <Visible from={p.t0} to={tEnd}><mesh geometry={geom} material={mat} frustumCulled={false} renderOrder={4} /></Visible>
}

/** Mounts children only while mission time is inside [from, to] (checked every frame). */
function Visible({ from, to, children }: { from: number; to: number; children: React.ReactNode }) {
  const ref = useMemo(() => ({ g: null as THREE.Group | null }), [])
  useFrame(() => {
    const t = useClock.getState().t
    if (ref.g) ref.g.visible = t >= from && t <= to
  })
  return <group ref={(g) => void (ref.g = g)}>{children}</group>
}
