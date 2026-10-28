import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useSettings } from '../../lib/settings'
import { R_EARTH } from '../../sim/coords'
import { live } from '../live'
import { SKY_GLSL } from './Sky'

/** Noise period in metres: the cloud field tiles every PERIOD, so world position mod PERIOD stays precise. */
const PERIOD = 40_000
const RADIUS = 45_000
const LAYERS = [1500, 1750, 2000]

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 originMod; // layer origin, world mod PERIOD (computed in float64)
varying vec3 vP; varying vec3 vView; varying float vR;
void main() {
  vec3 offset = mat3(modelMatrix) * position; // world-space offset from the layer origin, small
  vP = originMod + offset;
  vR = length(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float period; uniform float radius; uniform float cover; uniform float layer;
uniform vec3 wind; uniform vec3 sunWorld; uniform vec3 upWorld; uniform float opacity; uniform float below;
varying vec3 vP; varying vec3 vView; varying float vR;
${SKY_GLSL}
float hash(vec3 c, float n) { c = mod(c, n); return fract(sin(dot(c, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float pnoise(vec3 p, float n) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash(i, n), hash(i + vec3(1,0,0), n), f.x), mix(hash(i + vec3(0,1,0), n), hash(i + vec3(1,1,0), n), f.x), f.y);
  float b = mix(mix(hash(i + vec3(0,0,1), n), hash(i + vec3(1,0,1), n), f.x), mix(hash(i + vec3(0,1,1), n), hash(i + vec3(1,1,1), n), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm(vec3 p) {
  // octave periods: 20, 40, 80, 160, 320 cells → all tile exactly every 'period' metres
  vec3 q = mod(p, period) / period * 20.0;
  float s = 0.0; float a = 0.5; float n = 20.0;
  for (int i = 0; i < 5; i++) { s += a * pnoise(q, n); q *= 2.0; n *= 2.0; a *= 0.5; }
  return s;
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 p = vP + wind;
  float d = fbm(p);
  float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.22, d);
  if (dens < 0.01) discard;
  // self-shadowing: density a little way towards the sun
  float ds = smoothstep(1.0 - cover, 1.0 - cover + 0.22, fbm(p + sunWorld * 300.0));
  float lit = clamp(1.0 - ds * 0.7, 0.0, 1.0);
  vec3 up = upWorld;
  float sunElev = dot(up, sunWorld);
  vec3 sunT = sunTransmittance(up, sunWorld, 1.0);
  vec3 ambient = skyRadiance(up, up, sunWorld, 1.0) * 0.9 + vec3(0.04);
  vec3 col = ambient * (0.55 + 0.25 * layer) + sunT * lit * max(sunElev, 0.0) * 1.15;
  // underside seen from below is greyer
  col *= mix(1.0, 0.72 + 0.2 * layer, below);
  float dist = length(vView);
  float a = dens * 0.62 * opacity;
  a *= smoothstep(radius, radius * 0.55, vR);
  a *= smoothstep(120.0, 700.0, dist); // fade when the camera flies through the deck
  vec3 haze = skyRadiance(normalize(-vView), up, sunWorld, 1.0);
  col = mix(col, haze, 1.0 - exp(-dist / 30000.0));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Fair-weather cumulus deck that follows the camera; invisible from high altitude, where the Earth's own cloud map takes over. */
export function Clouds() {
  const enabled = useSettings((s) => s.clouds)
  const camera = useThree((s) => s.camera)
  const groups = useRef<(THREE.Group | null)[]>([])
  const geom = useMemo(() => {
    const g = new THREE.CircleGeometry(RADIUS, 96, 0, Math.PI * 2)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const mats = useMemo(
    () =>
      LAYERS.map(
        (_, i) =>
          new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FRAG,
            uniforms: {
              originMod: { value: new THREE.Vector3() },
              period: { value: PERIOD },
              radius: { value: RADIUS },
              cover: { value: 0.36 - i * 0.05 },
              layer: { value: i / (LAYERS.length - 1) },
              wind: { value: new THREE.Vector3() },
              sunWorld: { value: new THREE.Vector3(1, 0, 0) },
              upWorld: { value: new THREE.Vector3(0, 1, 0) },
              opacity: { value: 1 },
              below: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      ),
    [],
  )
  const tmp = useMemo(() => ({ up: new THREE.Vector3(), q: new THREE.Quaternion(), y: new THREE.Vector3(0, 1, 0) }), [])
  useFrame((state) => {
    const camR = camera.position.length()
    const alt = camR - R_EARTH
    const fade = 1 - THREE.MathUtils.smoothstep(alt, 9_000, 16_000)
    tmp.up.copy(camera.position).normalize()
    tmp.q.setFromUnitVectors(tmp.y, tmp.up)
    const t = state.clock.elapsedTime
    LAYERS.forEach((h, i) => {
      const g = groups.current[i]
      if (!g) return
      g.visible = enabled && fade > 0.01
      if (!g.visible) return
      g.position.copy(tmp.up).multiplyScalar(R_EARTH + h)
      g.quaternion.copy(tmp.q)
      const u = mats[i].uniforms
      // float64 here, so the shader only ever sees small numbers
      u.originMod.value.set(((g.position.x % PERIOD) + PERIOD) % PERIOD, ((g.position.y % PERIOD) + PERIOD) % PERIOD, ((g.position.z % PERIOD) + PERIOD) % PERIOD)
      u.wind.value.set(t * 4.5, 0, t * 2.5)
      u.sunWorld.value.copy(live.sunDir)
      u.upWorld.value.copy(tmp.up)
      u.opacity.value = fade
      u.below.value = alt < h ? 1 : 0
    })
  })
  return (
    <>
      {LAYERS.map((h, i) => (
        <group key={h} ref={(el) => void (groups.current[i] = el)}>
          <mesh geometry={geom} material={mats[i]} renderOrder={4 + i} frustumCulled={false} />
        </group>
      ))}
    </>
  )
}
