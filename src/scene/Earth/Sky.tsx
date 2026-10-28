import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { R_EARTH } from '../../sim/coords'

/**
 * Single-scattering sky (Rayleigh + Mie) using air-mass optical depths: blue zenith, pale horizon, red
 * sunrises/sunsets, a sun that reddens near the horizon, and a sky that darkens to black with altitude.
 * Shared by the sky dome, the water reflections and the cloud lighting.
 *   d, up, sun: unit vectors in any common frame; density: 1 at sea level → 0 in space.
 */
export const SKY_GLSL = /* glsl */ `
const vec3 BETA_R = vec3(0.0464, 0.108, 0.265);
const float BETA_M = 0.045;
float airMass(float c) {
  // Kasten–Young, extended a little below the horizon
  float z = acos(clamp(c, -0.2, 1.0)) * 57.29578;
  return 1.0 / (max(c, -0.02) + 0.50572 * pow(max(96.07995 - z, 0.3), -1.6364));
}
vec3 sunTransmittance(vec3 up, vec3 sun, float density) {
  return exp(-(BETA_R + BETA_M) * airMass(dot(up, sun)) * density);
}
vec3 skyRadiance(vec3 d, vec3 up, vec3 sun, float density) {
  float h = dot(d, up);
  float mu = dot(d, sun);
  float pr = 0.0597 * (1.0 + mu * mu);
  float g = 0.76;
  float pm = 0.0796 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
  vec3 tView = exp(-(BETA_R + BETA_M) * airMass(max(h, 0.0)) * density);
  vec3 sunT = sunTransmittance(up, sun, density);
  vec3 scatter = (BETA_R * pr + BETA_M * pm) / (BETA_R + BETA_M) * (1.0 - tView);
  float twilight = smoothstep(-0.2, 0.02, dot(up, sun));
  vec3 col = scatter * mix(vec3(0.3, 0.35, 0.6) * 0.15, vec3(1.0), smoothstep(-0.03, 0.06, dot(up, sun))) * (sunT * 0.85 + 0.15 * twilight) * 26.0;
  // below the horizon: hazy ground glow seen through the atmosphere
  col = mix(col, vec3(0.32, 0.36, 0.42) * twilight * density, smoothstep(0.0, -0.08, h) * density);
  return col;
}
`

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
${SKY_GLSL}
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  float density = exp(-altitude / 8000.0) * (1.0 - smoothstep(60000.0, 100000.0, altitude));
  vec3 sky = skyRadiance(d, upDir, sunDir, density);
  // horizon dip: from altitude the limb sits below the local horizontal
  float dip = -sqrt(max(0.0, 2.0 * altitude / 6371000.0));
  float h = dot(d, upDir);
  // thin blue limb glow seen from space
  sky += vec3(0.25, 0.5, 1.0) * exp(-abs(h - dip) * 160.0) * (1.0 - density) * smoothstep(-0.2, 0.1, dot(upDir, sunDir)) * 0.6;
  // sun: limb-darkened disc reddened by the air it shines through, plus a soft aureole
  float mu = dot(d, sunDir);
  vec3 sunT = sunTransmittance(upDir, sunDir, density);
  float cosR = 0.999981; // ~0.35° radius, a touch larger than real for visibility
  float r = clamp((1.0 - mu) / (1.0 - cosR), 0.0, 1.0);
  float disc = (1.0 - smoothstep(0.85, 1.0, r)) * (0.6 + 0.4 * sqrt(max(0.0, 1.0 - r * r)));
  vec3 sun = sunT * (disc * 60.0 + pow(max(mu, 0.0), 1200.0) * 4.0 + pow(max(mu, 0.0), 60.0) * 0.12 * density);
  // stars where the sky is dark
  vec3 p = floor(d * 900.0);
  float st = step(0.9985, hash(p)) * (0.4 + 0.6 * hash(p + 3.1));
  float skyLum = dot(sky, vec3(0.33));
  vec3 col = sky + sun + vec3(st) * (1.0 - smoothstep(0.01, 0.15, skyLum)) * step(dip - 0.01, h);
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
