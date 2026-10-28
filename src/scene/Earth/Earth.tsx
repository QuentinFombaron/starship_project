import { useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { R_EARTH } from '../../sim/coords'
import { useSettings, QUALITY } from '../../lib/settings'

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`

const EARTH_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D brcMap; // r: bump, g: roughness, b: clouds
uniform sampler2D normalMap; // tangent space: x east, y north
uniform vec3 sunDir;
uniform float cloudAmount;
uniform float time;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n0 = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);
  // relief: perturb the sphere normal with the GEBCO-derived normal map in the local east/north frame
  vec3 east = normalize(vec3(n0.z, 0.0, -n0.x) + vec3(1e-6, 0.0, 0.0));
  vec3 north = cross(n0, east);
  vec3 nm = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
  // soften towards the limb, where exaggerated relief would streak
  nm.xy *= 0.35 + 0.65 * smoothstep(0.05, 0.5, dot(n0, v));
  vec3 n = normalize(east * nm.x + north * nm.y + n0 * nm.z);
  float ndl = dot(n, sunDir);
  vec3 day = texture2D(dayMap, vUv).rgb;
  vec3 night = texture2D(nightMap, vUv).rgb;
  vec3 brc = texture2D(brcMap, vUv).rgb;
  float rough = brc.g;
  float ocean = 1.0 - smoothstep(0.25, 0.55, rough);
  float light = smoothstep(-0.08, 0.25, ndl);
  vec3 col = day * (0.04 + 1.05 * max(ndl, 0.0));
  // ocean glint
  vec3 h = normalize(sunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 90.0) * ocean * light;
  col += vec3(1.0, 0.92, 0.8) * spec * 0.9;
  // city lights on the night side
  float nightK = (1.0 - smoothstep(-0.18, 0.08, ndl));
  col += night * vec3(1.0, 0.82, 0.55) * nightK * 1.6;
  // clouds (static layer baked from texture, shadows the surface a bit)
  float cl = smoothstep(0.25, 0.85, brc.b) * cloudAmount;
  vec3 cloudCol = vec3(1.0) * (0.03 + 1.1 * max(ndl, 0.0)) ;
  col = mix(col, cloudCol, cl * 0.9);
  // atmospheric scattering tint towards the limb
  float fres = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 3.0);
  vec3 sky = mix(vec3(0.95, 0.5, 0.25), vec3(0.32, 0.6, 1.0), smoothstep(-0.12, 0.12, ndl));
  col += sky * fres * smoothstep(-0.2, 0.15, ndl) * 0.75;
  // twilight warmth at the terminator
  col *= mix(vec3(1.0), vec3(1.08, 0.92, 0.82), (1.0 - smoothstep(0.0, 0.18, ndl)) * light * 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const ATMO_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDir;
uniform float intensity;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);
  float rim = clamp(1.0 - abs(dot(n, v)), 0.0, 1.0);
  float glow = pow(rim, 5.0);
  float ndl = dot(n, sunDir);
  vec3 col = mix(vec3(1.0, 0.5, 0.2), vec3(0.32, 0.62, 1.0), smoothstep(-0.18, 0.05, ndl));
  float a = glow * smoothstep(-0.35, 0.15, ndl) * intensity;
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`

export const ATMOSPHERE_THICKNESS = 80_000

/**
 * Earth textures. High/ultra quality uses the 8K Blue Marble Next Generation and a GEBCO relief normal map
 * baked by scripts/bake-imagery.py; lower qualities keep the 4K/2K set to save GPU memory.
 */
export function useEarthTextures() {
  const quality = useSettings((s) => s.quality)
  const big = quality === 'high' || quality === 'ultra'
  const [day, night, brc, normal] = useTexture([
    big ? '/textures/earth/earth_day_8192.jpg' : '/textures/earth/earth_day_4096.jpg',
    '/textures/earth/earth_night_4096.jpg',
    '/textures/earth/earth_bump_roughness_clouds_4096.jpg',
    big ? '/textures/earth/earth_normal_8192.jpg' : '/textures/earth/earth_normal_2048.jpg',
  ])
  useMemo(() => {
    day.colorSpace = THREE.SRGBColorSpace
    night.colorSpace = THREE.SRGBColorSpace
    for (const t of [day, night, brc, normal]) {
      t.anisotropy = 8
      t.needsUpdate = true
    }
  }, [day, night, brc, normal])
  return { day, night, brc, normal }
}

export function Earth({ sunDir }: { sunDir: React.RefObject<THREE.Vector3> }) {
  const quality = useSettings((s) => s.quality)
  const showAtmo = useSettings((s) => s.atmosphere)
  const clouds = useSettings((s) => s.clouds)
  const seg = QUALITY[quality].segments
  const { day, night, brc, normal } = useEarthTextures()

  const earthMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: EARTH_FRAG,
        uniforms: {
          dayMap: { value: day },
          nightMap: { value: night },
          brcMap: { value: brc },
          normalMap: { value: normal },
          sunDir: { value: new THREE.Vector3(1, 0, 0) },
          cloudAmount: { value: 1 },
          time: { value: 0 },
        },
      }),
    [day, night, brc, normal],
  )
  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: ATMO_FRAG,
        uniforms: { sunDir: { value: new THREE.Vector3(1, 0, 0) }, intensity: { value: 1.1 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    [],
  )
  const atmoRef = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (sunDir.current) {
      earthMat.uniforms.sunDir.value.copy(sunDir.current)
      atmoMat.uniforms.sunDir.value.copy(sunDir.current)
    }
    earthMat.uniforms.cloudAmount.value = clouds ? 1 : 0
  })

  return (
    <group>
      <mesh material={earthMat} renderOrder={-2}>
        <sphereGeometry args={[R_EARTH, seg, seg / 2]} />
      </mesh>
      {showAtmo && (
        <mesh ref={atmoRef} material={atmoMat} renderOrder={-1}>
          <sphereGeometry args={[R_EARTH + ATMOSPHERE_THICKNESS, seg / 2, seg / 4]} />
        </mesh>
      )}
    </group>
  )
}
