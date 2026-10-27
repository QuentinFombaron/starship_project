import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { R_EARTH } from '../../sim/coords'

/**
 * Camera-centred sky dome: Rayleigh-ish gradient that fades to black with altitude,
 * plus a sun disc and a starfield that becomes visible above the atmosphere.
 */
const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDir;
uniform vec3 upDir;
uniform float altitude; // metres
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  float h = dot(d, upDir);
  float s = dot(d, sunDir);
  float sunElev = dot(upDir, sunDir);
  float air = 1.0 - smoothstep(15000.0, 90000.0, altitude);
  // day sky
  vec3 zenith = vec3(0.13, 0.35, 0.78);
  vec3 horizon = vec3(0.62, 0.78, 0.95);
  float hh = clamp(h, -0.2, 1.0);
  vec3 sky = mix(horizon, zenith, pow(max(hh, 0.0), 0.45));
  // sunset tones when the sun is low
  float low = 1.0 - smoothstep(-0.05, 0.3, sunElev);
  sky = mix(sky, mix(vec3(1.0, 0.55, 0.28), vec3(0.25, 0.32, 0.6), smoothstep(0.0, 0.5, h)), low * 0.7 * smoothstep(-0.3, 0.6, s));
  float dayK = smoothstep(-0.12, 0.08, sunElev);
  sky *= dayK;
  // below horizon haze
  sky = mix(sky, horizon * 0.55 * dayK, (1.0 - smoothstep(-0.15, 0.02, h)));
  // sun glare + disc
  float glare = pow(max(s, 0.0), 220.0) * 3.0 + pow(max(s, 0.0), 8.0) * 0.25 * air;
  float disc = smoothstep(0.99985, 0.99992, s) * 40.0;
  // stars (visible when sky is dark)
  vec3 p = floor(d * 900.0);
  float st = step(0.9985, hash(p)) * (0.4 + 0.6 * hash(p + 3.1));
  float skyLum = dot(sky * air, vec3(0.33));
  vec3 col = sky * air + vec3(1.0, 0.95, 0.85) * (glare + disc) + vec3(st) * (1.0 - smoothstep(0.02, 0.25, skyLum));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function Sky({ sunDir }: { sunDir: React.RefObject<THREE.Vector3> }) {
  const ref = useRef<THREE.Mesh>(null)
  const camera = useThree((s) => s.camera)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { sunDir: { value: new THREE.Vector3() }, upDir: { value: new THREE.Vector3() }, altitude: { value: 0 } },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  )
  useFrame(() => {
    const m = ref.current
    if (!m) return
    m.position.copy(camera.position)
    const r = camera.position.length()
    mat.uniforms.altitude.value = r - R_EARTH
    mat.uniforms.upDir.value.copy(camera.position).normalize()
    if (sunDir.current) mat.uniforms.sunDir.value.copy(sunDir.current)
  })
  // Large radius but within far plane; drawn first, depth not written.
  return (
    <mesh ref={ref} material={mat} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[5e8, 48, 24]} />
    </mesh>
  )
}
