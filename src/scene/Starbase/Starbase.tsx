import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { enuBasis, geoToEcef, sub, dot, type Vec3 } from '../../sim/coords'
import { MOUNT_HEIGHT } from '../../sim/replay'
import { quatFromEnu } from '../frame'
import { concreteMaterial, darkSteelMaterial, sootMaterial, steelMaterial, towerMaterial } from '../materials'
import { BOUNDS, imageryUv, loadStarbaseImagery } from './imagery'

export const OLP2 = { lat: 25.9959, lon: -97.154 }

/** Converts a lat/lon to local ENU coordinates (three.js: x east, y up, z south) around the pad. */
export function localFromGeo(lat: number, lon: number, alt = 0, origin = OLP2): [number, number, number] {
  const o = geoToEcef(origin.lat, origin.lon, 0)
  const p = geoToEcef(lat, lon, alt)
  const { e, n, u } = enuBasis(origin.lat, origin.lon)
  const d = sub(p, o)
  return [dot(d, e), dot(d, u), -dot(d, n)]
}

/** Spherical-cap ground patch textured with satellite imagery; edges fade out over the global Earth. */
function GroundPatch() {
  const [tex, setTex] = useState<{ map: THREE.Texture; roughness: THREE.Texture } | null>(null)
  useEffect(() => {
    let alive = true
    loadStarbaseImagery().then((t) => alive && setTex(t))
    return () => {
      alive = false
    }
  }, [])
  const geom = useMemo(() => {
    const N = 160
    const pos: number[] = []
    const uv: number[] = []
    const fade: number[] = []
    const idx: number[] = []
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const lon = BOUNDS.west + ((BOUNDS.east - BOUNDS.west) * i) / N
        const lat = BOUNDS.south + ((BOUNDS.north - BOUNDS.south) * j) / N
        const p = localFromGeo(lat, lon, 0.15)
        pos.push(p[0], p[1], p[2])
        const [u, v] = imageryUv(lat, lon)
        uv.push(u, v)
        const edge = Math.min(i, N - i, j, N - j) / N
        fade.push(Math.min(1, edge / 0.12))
      }
    }
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i
        const b = a + 1
        const c = a + N + 1
        const d = c + 1
        idx.push(a, b, c, b, d, c)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, transparent: true })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float fade;\nvarying float vFade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = fade;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vFade;')
    }
    return m
  }, [])
  useEffect(() => {
    if (!tex) return
    mat.map = tex.map
    mat.roughnessMap = tex.roughness
    mat.needsUpdate = true
  }, [tex, mat])
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

function TankFarm() {
  const tanks = useMemo(() => {
    const t: { x: number; z: number; r: number; h: number }[] = []
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) t.push({ x: i * 11, z: j * 11, r: 4.2, h: 24 + ((i + j) % 2) * 6 })
    return t
  }, [])
  return (
    <group>
      {tanks.map((k, i) => (
        <mesh key={i} position={[k.x, k.h / 2, k.z]} material={steelMaterial()} castShadow receiveShadow>
          <cylinderGeometry args={[k.r, k.r, k.h, 24]} />
        </mesh>
      ))}
      {/* horizontal tanks */}
      {[0, 1, 2].map((i) => (
        <mesh key={`h${i}`} position={[18, 3.2, 32 + i * 8]} rotation={[0, 0, Math.PI / 2]} material={steelMaterial()} castShadow>
          <cylinderGeometry args={[3, 3, 40, 20]} />
        </mesh>
      ))}
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
  const pad1 = localFromGeo(25.9967, -97.1572)
  return (
    <group>
      <GroundPatch />
      {/* Pad 2 */}
      <mesh position={[0, 0.2, 0]} material={concreteMaterial()} receiveShadow>
        <boxGeometry args={[150, 0.4, 130]} />
      </mesh>
      <LaunchMount />
      <group position={[-24, 0, 0]}>
        <LatticeTower />
      </group>
      <group position={[-60, 0, 70]}>
        <TankFarm />
      </group>
      {/* Pad 1 */}
      <group position={pad1}>
        <mesh position={[0, 0.2, 0]} material={concreteMaterial()} receiveShadow>
          <boxGeometry args={[130, 0.4, 110]} />
        </mesh>
        <LaunchMount height={20} trenchDir={1} />
        <group position={[-22, 0, 4]}>
          <LatticeTower height={146} chopstickHeight={108} armAngle={0.55} />
        </group>
        <group position={[-70, 0, 55]}>
          <TankFarm />
        </group>
      </group>
      {/* Starbase production site (~2.5 km west): Starfactory, Mega Bays, high bays */}
      <group position={localFromGeo(25.9885, -97.1866)}>
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
