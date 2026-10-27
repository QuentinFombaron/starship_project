import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * Rocket plume: an open tube whose radius profile expands with altitude (lower ambient pressure),
 * rendered additively with a hot core, Mach diamonds near sea level and a blue methalox tint in vacuum.
 * Geometry spans y ∈ [0, -1] (pointing aft); scaled by `length`.
 */
const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float expansion; // 0 sea level … 1 vacuum
uniform float radius;
uniform float plumeLen;
varying float vAxial;
varying float vRadial;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  float a = clamp(-position.y, 0.0, 1.0); // 0 at nozzle → 1 at tail
  vAxial = a;
  vec2 dir = normalize(position.xz + 1e-5);
  // sea level: slim column flaring slightly; vacuum: wide bell
  float slim = radius * (1.0 + a * 0.9);
  float wide = radius * (1.0 + pow(a, 0.55) * 9.0);
  float r = mix(slim, wide, expansion);
  vec3 p = vec3(dir.x * r, -a * plumeLen, dir.y * r);
  vRadial = length(position.xz);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;
  vViewN = normalize(normalMatrix * vec3(dir.x, 0.0, dir.y));
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float intensity;
uniform float expansion;
uniform float time;
uniform vec3 coreColor;
uniform vec3 edgeColor;
varying float vAxial;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  #include <logdepthbuf_fragment>
  vec3 v = normalize(-vViewPos);
  float facing = clamp(abs(dot(normalize(vViewN), v)), 0.0, 1.0);
  float ax = clamp(vAxial, 0.0, 1.0); // 1 at centre of silhouette, 0 at edges
  float core = pow(facing, mix(1.6, 0.6, expansion));
  float fade = pow(1.0 - ax, mix(1.4, 2.6, expansion));
  float flicker = 0.92 + 0.08 * sin(time * 47.0 + vAxial * 31.0) * sin(time * 23.0);
  // Mach diamonds (sea level only)
  float diamonds = (1.0 - expansion) * (1.0 - smoothstep(0.0, 0.55, ax)) * pow(max(0.0, 0.5 + 0.5 * cos(ax * 60.0)), 6.0) * 0.8;
  vec3 col = mix(edgeColor, coreColor, core) * (fade * (0.55 + core) + diamonds);
  // sea-level plumes are much brighter (and must read against a daylight sky)
  float bright = mix(3.2, 1.4, expansion);
  float a = clamp(fade * core * intensity * flicker, 0.0, 1.0);
  gl_FragColor = vec4(max(col * intensity * flicker * fade * (0.4 + core) * bright, vec3(0.0)), a);
}
`

export function Plume({
  intensityRef,
  expansionRef,
  radius,
  length,
  vacuumBlue = false,
}: {
  intensityRef: React.RefObject<number>
  expansionRef: React.RefObject<number>
  radius: number
  length: number
  vacuumBlue?: boolean
}) {
  const ref = useRef<THREE.Mesh>(null)
  const geom = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 32, 48, true)
    g.translate(0, -0.5, 0)
    return g
  }, [])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          intensity: { value: 0 },
          expansion: { value: 0 },
          radius: { value: radius },
          plumeLen: { value: length },
          time: { value: 0 },
          coreColor: { value: new THREE.Color(vacuumBlue ? '#ffe9d6' : '#fff4dc') },
          edgeColor: { value: new THREE.Color(vacuumBlue ? '#5a7dff' : '#ff8a3c') },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [radius, length, vacuumBlue],
  )
  useFrame((state) => {
    const i = intensityRef.current ?? 0
    const e = expansionRef.current ?? 0
    mat.uniforms.intensity.value = i
    mat.uniforms.expansion.value = e
    mat.uniforms.time.value = state.clock.elapsedTime
    // plume length grows a lot in vacuum
    mat.uniforms.plumeLen.value = length * (1 + e * 5)
    mat.uniforms.edgeColor.value.set(e > 0.6 || vacuumBlue ? '#6f8dff' : '#ff8a3c').lerp(new THREE.Color('#ff8a3c'), 1 - e)
    if (ref.current) ref.current.visible = i > 0.01
  })
  return <mesh ref={ref} geometry={geom} material={mat} frustumCulled={false} renderOrder={5} />
}

/** Small additive glow at each nozzle exit; per-engine visibility & colour follow engine status. */
export function EngineGlows({
  points,
  y,
  size,
  statusRef,
  offset = 0,
}: {
  points: { x: number; y: number }[]
  y: number
  size: number
  statusRef: React.RefObject<string[]>
  /** index of the first engine of this cluster in the stage's status array */
  offset?: number
}) {
  const mesh = useMemo(() => {
    const g = new THREE.CircleGeometry(size, 16)
    g.rotateX(Math.PI / 2)
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    const im = new THREE.InstancedMesh(g, m, points.length)
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(points.length * 3), 3)
    const o = new THREE.Object3D()
    points.forEach((p, i) => {
      o.position.set(p.x, y, p.y)
      o.updateMatrix()
      im.setMatrixAt(i, o.matrix)
    })
    im.frustumCulled = false
    im.renderOrder = 6
    return im
  }, [points, y, size])
  const c = useMemo(() => new THREE.Color(), [])
  useFrame(() => {
    const st = statusRef.current
    if (!st) return
    for (let i = 0; i < points.length; i++) {
      const s = st[i + offset]
      if (s === 'lit') c.setRGB(4, 3.2, 2.2)
      else if (s === 'failed-active') c.setRGB(3, 0.6, 0.2)
      else c.setRGB(0, 0, 0)
      mesh.setColorAt(i, c)
    }
    mesh.instanceColor!.needsUpdate = true
  })
  return <primitive object={mesh} />
}
