import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { enuBasis, geoToEcef, sub, dot, type Vec3 } from '../../sim/coords'
import { MOUNT_HEIGHT } from '../../sim/replay'
import { quatFromEnu } from '../frame'
import { concreteMaterial, darkSteelMaterial, sootMaterial, steelMaterial, towerMaterial } from '../materials'
import { GRADE, PadB } from './PadB'
import { BOUNDS, loadStarbaseTerrain, mercUv, type StarbaseTerrain } from './imagery'
import { smoothstep } from '../../sim/interpolate'

export const OLP2 = { lat: 25.9968, lon: -97.15818 }

/** Converts a lat/lon to local ENU coordinates (three.js: x east, y up, z south) around the pad. */
export function localFromGeo(lat: number, lon: number, alt = 0, origin = OLP2): [number, number, number] {
  const o = geoToEcef(origin.lat, origin.lon, 0)
  const p = geoToEcef(lat, lon, alt)
  const { e, n, u } = enuBasis(origin.lat, origin.lon)
  const d = sub(p, o)
  return [dot(d, e), dot(d, u), -dot(d, n)]
}

export const PAD1 = { lat: 25.9962, lon: -97.1544 }
export const FACTORY = { lat: 25.9885, lon: -97.1866 }
/** Ground the 3D site sits on: lidar relief is flattened to grade inside these circles. */
const FLAT_ZONES = [
  { ...OLP2, r: 190 },
  { ...PAD1, r: 170 },
  { ...FACTORY, r: 520 },
]
/** Land never dips below this, so the sea-level water surface (WATER_LEVEL) only shows over water. */
export const LAND_MIN = 0.4
export const WATER_LEVEL = 0.25

/** 1D grid from a to b, ~minStep apart around c and growing linearly away from it up to maxStep. */
function gradedAxis(a: number, b: number, c: number, minStep: number, growth: number, maxStep: number) {
  const side = (from: number, to: number) => {
    const out: number[] = []
    const dir = Math.sign(to - from)
    let x = from
    while ((to - x) * dir > 0) {
      out.push(x)
      x += dir * Math.min(maxStep, minStep + growth * Math.abs(x - c))
    }
    out.push(to)
    return out
  }
  return [...side(c, a).reverse(), ...side(c, b).slice(1)]
}

/**
 * Spherical-cap ground patch with lidar relief, textured by three nested aerial-imagery layers blended in
 * the shader. Water areas sink below the water surface (see Surface.tsx); the edges fade into the
 * surface cap.
 */
function GroundPatch() {
  const [terrain, setTerrain] = useState<StarbaseTerrain | null>(null)
  useEffect(() => {
    let alive = true
    loadStarbaseTerrain().then((t) => alive && setTerrain(t))
    return () => {
      alive = false
    }
  }, [])
  const geom = useMemo(() => {
    if (!terrain) return null
    const mPerLat = 110_790
    const mPerLon = 111_320 * Math.cos((OLP2.lat * Math.PI) / 180)
    // metres east/north of the pad → graded axes, densest (4 m) around the pads
    const xs = gradedAxis((BOUNDS.west - OLP2.lon) * mPerLon, (BOUNDS.east - OLP2.lon) * mPerLon, -150, 4, 0.035, 160)
    const ys = gradedAxis((BOUNDS.south - OLP2.lat) * mPerLat, (BOUNDS.north - OLP2.lat) * mPerLat, 0, 4, 0.035, 160)
    const nx = xs.length
    const ny = ys.length
    const pos = new Float32Array(nx * ny * 3)
    const uvO = new Float32Array(nx * ny * 2)
    const uvM = new Float32Array(nx * ny * 2)
    const uvI = new Float32Array(nx * ny * 2)
    const fade = new Float32Array(nx * ny)
    const idx: number[] = []
    const xMin = xs[0]
    const xMax = xs[nx - 1]
    const yMin = ys[0]
    const yMax = ys[ny - 1]
    const edge = Math.min(xMax - xMin, yMax - yMin) * 0.1
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i
        const lat = OLP2.lat + ys[j] / mPerLat
        const lon = OLP2.lon + xs[i] / mPerLon
        let h = Math.max(LAND_MIN, terrain.height(lat, lon))
        for (const z of FLAT_ZONES) {
          const d = Math.hypot((lat - z.lat) * mPerLat, (lon - z.lon) * mPerLon)
          h += (GRADE - h) * (1 - smoothstep(z.r * 0.75, z.r, d))
        }
        const wet = terrain.water(lat, lon)
        h += (-2.5 - h) * smoothstep(0.35, 0.75, wet)
        const p = localFromGeo(lat, lon, h)
        pos.set(p, k * 3)
        uvO.set(mercUv(terrain.outer.bounds, lat, lon), k * 2)
        uvM.set(mercUv(terrain.mid.bounds, lat, lon), k * 2)
        uvI.set(mercUv(terrain.inner.bounds, lat, lon), k * 2)
        const e = Math.min(xs[i] - xMin, xMax - xs[i], ys[j] - yMin, yMax - ys[j])
        fade[k] = Math.min(1, e / edge)
      }
    }
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i
        const b = a + 1
        const c = a + nx
        const d = c + 1
        idx.push(a, b, c, b, d, c)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('uvO', new THREE.BufferAttribute(uvO, 2))
    g.setAttribute('uvM', new THREE.BufferAttribute(uvM, 2))
    g.setAttribute('uvI', new THREE.BufferAttribute(uvI, 2))
    g.setAttribute('fade', new THREE.BufferAttribute(fade, 1))
    g.setIndex(idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [terrain])
  const mat = useMemo(() => {
    if (!terrain) return null
    const uniforms = { mapOuter: { value: terrain.outer.map }, mapMid: { value: terrain.mid.map }, mapInner: { value: terrain.inner.map } }
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0, transparent: true })
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 uvO; attribute vec2 uvM; attribute vec2 uvI; attribute float fade;\nvarying vec2 vUvO; varying vec2 vUvM; varying vec2 vUvI; varying float vFade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvO = uvO; vUvM = uvM; vUvI = uvI; vFade = fade;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D mapOuter; uniform sampler2D mapMid; uniform sampler2D mapInner;
varying vec2 vUvO; varying vec2 vUvM; varying vec2 vUvI; varying float vFade;
float layerW(vec2 uv, float soft) { vec2 e = min(uv, 1.0 - uv); return smoothstep(0.0, soft, min(e.x, e.y)); }`,
        )
        .replace(
          '#include <map_fragment>',
          `vec4 texelColor = texture2D(mapOuter, vUvO);
texelColor = mix(texelColor, texture2D(mapMid, vUvM), layerW(vUvM, 0.04));
texelColor = mix(texelColor, texture2D(mapInner, vUvI), layerW(vUvI, 0.06));
diffuseColor *= texelColor;`,
        )
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vFade;')
    }
    return m
  }, [terrain])
  if (!geom || !mat) return null
  return <mesh geometry={geom} material={mat} receiveShadow renderOrder={0} />
}

function LatticeTower({ height = 146, width = 12, chopstickHeight = 112, armAngle = 0.32 }: { height?: number; width?: number; chopstickHeight?: number; armAngle?: number }) {
  return (
    <group>
      {/* lattice shell */}
      <mesh position={[0, height / 2, 0]} material={towerMaterial()} castShadow>
        <boxGeometry args={[width, height, width]} />
      </mesh>
      {/* inner core / elevator shaft */}
      <mesh position={[0, height / 2, 0]} material={darkSteelMaterial()}>
        <boxGeometry args={[width * 0.45, height, width * 0.45]} />
      </mesh>
      {/* corner legs */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[(sx * width) / 2, height / 2, (sz * width) / 2]} material={darkSteelMaterial()} castShadow>
            <boxGeometry args={[0.9, height, 0.9]} />
          </mesh>
        )),
      )}
      {/* top + lightning mast */}
      <mesh position={[0, height + 1, 0]} material={darkSteelMaterial()}>
        <boxGeometry args={[width + 1, 2, width + 1]} />
      </mesh>
      <mesh position={[0, height + 14, 0]} material={darkSteelMaterial()}>
        <cylinderGeometry args={[0.15, 0.4, 26, 6]} />
      </mesh>
      {/* chopsticks carriage + arms, pointing towards +x (the launch mount) */}
      <group position={[width / 2, chopstickHeight, 0]}>
        <mesh material={darkSteelMaterial()} castShadow>
          <boxGeometry args={[3, 8, width + 2]} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s} position={[0, 0, (s * width) / 2]} rotation={[0, -s * armAngle, 0]}>
            <mesh position={[18, 0, 0]} material={steelMaterial()} castShadow>
              <boxGeometry args={[36, 3.2, 1.8]} />
            </mesh>
            {/* catch rail */}
            <mesh position={[22, 1.9, -s * 1.2]} material={darkSteelMaterial()}>
              <boxGeometry args={[24, 0.6, 0.8]} />
            </mesh>
          </group>
        ))}
      </group>
      {/* ship quick-disconnect arm */}
      <group position={[width / 2, chopstickHeight - 18, -width / 2 + 1]}>
        <mesh position={[5.5, 0, 0]} material={towerMaterial()}>
          <boxGeometry args={[11, 4, 3]} />
        </mesh>
      </group>
    </group>
  )
}

function LaunchMount({ height = MOUNT_HEIGHT, trenchDir = -1 }: { height?: number; trenchDir?: number }) {
  const legs = 6
  return (
    <group>
      {/* table */}
      <mesh position={[0, height - 2, 0]} material={sootMaterial()} castShadow receiveShadow>
        <cylinderGeometry args={[9, 9, 4, 6, 1, true]} />
      </mesh>
      <mesh position={[0, height - 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]} material={sootMaterial()} receiveShadow>
        <ringGeometry args={[5, 9.6, 6, 1]} />
      </mesh>
      {Array.from({ length: legs }, (_, i) => {
        const a = (i / legs) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * 8, (height - 4) / 2, Math.sin(a) * 8]} material={sootMaterial()} castShadow>
            <boxGeometry args={[2.4, height - 4, 2.4]} />
          </mesh>
        )
      })}
      {/* flame trench */}
      <mesh position={[trenchDir * 40, 0.25, 0]} material={darkSteelMaterial()} receiveShadow>
        <boxGeometry args={[70, 0.4, 18]} />
      </mesh>
      {/* booster quick disconnect / hold-down ring */}
      <mesh position={[0, height + 0.6, 0]} material={darkSteelMaterial()}>
        <torusGeometry args={[4.7, 0.5, 6, 30]} />
      </mesh>
    </group>
  )
}

function Building({ size, color = '#d9d9d6' }: { size: [number, number, number]; color?: string }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.2 }), [color])
  return (
    <mesh position={[0, size[1] / 2, 0]} material={mat} castShadow receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  )
}

export function StarbaseSite() {
  const pad1 = localFromGeo(PAD1.lat, PAD1.lon)
  return (
    <group>
      <GroundPatch />
      <PadB />
      {/* Pad 1 (Pad A): older table-style mount, tower to the north-west with its chopsticks facing the mount */}
      <group position={pad1}>
        <group userData={{ inspect: 'pad-a' }}>
          <mesh position={[0, GRADE + 0.12, 0]} material={concreteMaterial()} receiveShadow>
            <boxGeometry args={[130, 0.3, 110]} />
          </mesh>
          <LaunchMount height={20} trenchDir={1} />
          <group position={[-17, GRADE, -22]} rotation={[0, -0.913, 0]}>
            <LatticeTower height={146} chopstickHeight={108} armAngle={0.55} />
          </group>
        </group>
      </group>
      {/* Starbase production site (~2.5 km west): Starfactory, Mega Bays, high bays */}
      <group position={localFromGeo(FACTORY.lat, FACTORY.lon, GRADE)}>
        <group position={[0, 0, 0]}>
          <Building size={[260, 32, 90]} color="#e8e8e6" />
        </group>
        <group position={[120, 0, -110]}>
          <Building size={[55, 92, 45]} color="#dfe0de" />
        </group>
        <group position={[190, 0, -110]}>
          <Building size={[55, 92, 45]} color="#dfe0de" />
        </group>
        <group position={[-150, 0, -90]}>
          <Building size={[40, 60, 34]} color="#cfd2d4" />
        </group>
      </group>
    </group>
  )
}

/** Group placing children in the pad's local ENU frame at true ECEF position. */
export function PadFrame({ children, origin = OLP2 }: { children: React.ReactNode; origin?: { lat: number; lon: number } }) {
  const { position, quaternion } = useMemo(() => {
    const p: Vec3 = geoToEcef(origin.lat, origin.lon, 0)
    const { e, n, u } = enuBasis(origin.lat, origin.lon)
    return { position: new THREE.Vector3(...p), quaternion: quatFromEnu(e, n, u) }
  }, [origin.lat, origin.lon])
  return (
    <group position={position} quaternion={quaternion}>
      {children}
    </group>
  )
}
