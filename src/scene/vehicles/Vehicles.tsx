import { useMemo } from 'react'
import * as THREE from 'three'
import { engineLayout } from '../../sim/engines'
import { BOOSTER_LEN, SHIP_LEN } from '../../sim/replay'
import { bellMaterial, bellProfile, darkSteelMaterial, gridFinMaterial, sootMaterial, steelMaterial, tileMaterial } from '../materials'

const R = 4.5

/** Instanced Raptor bells at given 2D positions on the aft dome (y = engine exit plane). */
function EngineCluster({ points, exit, length, y }: { points: { x: number; y: number }[]; exit: number; length: number; y: number }) {
  const geom = useMemo(() => new THREE.LatheGeometry(bellProfile(exit, length), 20), [exit, length])
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geom, bellMaterial(), points.length)
    const o = new THREE.Object3D()
    points.forEach((p, i) => {
      o.position.set(p.x, y, p.y)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    })
    m.castShadow = true
    return m
  }, [geom, points, y])
  return <primitive object={mesh} />
}

export const BOOSTER_ENGINE_RADII = { ring: [1.05, 2.55, 3.85] }

export function boosterEnginePositions() {
  return engineLayout([3, 10, 20]).map((p) => ({ x: p.x * 4.25, y: p.y * 4.25 }))
}
export function shipEnginePositions() {
  const pts = engineLayout([3, 3])
  return pts.map((p, i) => (i < 3 ? { x: p.x * 5.5, y: p.y * 5.5 } : { x: p.x * 3.4, y: p.y * 3.4 }))
}

export function SuperHeavy() {
  const L = BOOSTER_LEN
  const bottom = -L / 2
  const engines = useMemo(boosterEnginePositions, [])
  const fins = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]
  return (
    <group>
      {/* main tank barrel */}
      <mesh position={[0, bottom + 3 + (L - 6.5) / 2, 0]} material={steelMaterial()} castShadow receiveShadow>
        <cylinderGeometry args={[R, R, L - 6.5, 64, 1, true]} />
      </mesh>
      {/* aft skirt (soot stained) */}
      <mesh position={[0, bottom + 1.5, 0]} material={sootMaterial()} castShadow>
        <cylinderGeometry args={[R, R * 0.98, 3, 64, 1, true]} />
      </mesh>
      {/* aft heat shield plate */}
      <mesh position={[0, bottom + 2.6, 0]} rotation={[Math.PI / 2, 0, 0]} material={darkSteelMaterial()}>
        <circleGeometry args={[R, 48]} />
      </mesh>
      {/* integrated hot-stage ring (vented) */}
      <mesh position={[0, L / 2 - 1.75, 0]} material={darkSteelMaterial()} castShadow>
        <cylinderGeometry args={[R, R, 3.5, 48, 1, true]} />
      </mesh>
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.sin(a) * (R + 0.02), L / 2 - 1.75, Math.cos(a) * (R + 0.02)]} rotation={[0, a, 0]} material={sootMaterial()}>
            <planeGeometry args={[0.6, 2.6]} />
          </mesh>
        )
      })}
      <mesh position={[0, L / 2, 0]} rotation={[-Math.PI / 2, 0, 0]} material={darkSteelMaterial()}>
        <circleGeometry args={[R, 48]} />
      </mesh>
      {/* grid fins (3 on Block 3) */}
      {fins.map((a) => (
        <group key={a} rotation={[0, a, 0]}>
          <mesh position={[0, L / 2 - 6.5, R + 2.6]} material={gridFinMaterial()} castShadow>
            <boxGeometry args={[4.6, 6.2, 5]} />
          </mesh>
          <mesh position={[0, L / 2 - 6.5, R + 0.4]} material={darkSteelMaterial()}>
            <boxGeometry args={[1.4, 2.2, 1]} />
          </mesh>
        </group>
      ))}
      {/* chines */}
      {[Math.PI / 2, -Math.PI / 2].map((a) => (
        <mesh key={a} position={[Math.sin(a) * (R + 0.3), 0, Math.cos(a) * (R + 0.3)]} rotation={[0, a, 0]} material={steelMaterial()}>
          <boxGeometry args={[0.5, L - 14, 0.6]} />
        </mesh>
      ))}
      {/* COPVs / raceway */}
      <mesh position={[0, 0, -R - 0.25]} material={steelMaterial()}>
        <boxGeometry args={[1.1, L - 10, 0.5]} />
      </mesh>
      <EngineCluster points={engines} exit={0.66} length={2.2} y={bottom - 2.2} />
    </group>
  )
}

export function Starship() {
  const L = SHIP_LEN
  const bottom = -L / 2
  const noseLen = 17.5
  const barrel = L - noseLen - 2
  const noseProfile = useMemo(() => {
    const pts: THREE.Vector2[] = []
    const N = 24
    for (let i = 0; i <= N; i++) {
      const k = i / N
      // tangent ogive
      const r = R * Math.sqrt(Math.max(0, 1 - k * k)) ** 0.9
      pts.push(new THREE.Vector2(Math.max(0.15, r), k * noseLen))
    }
    pts.push(new THREE.Vector2(0.0, noseLen + 0.2))
    return pts
  }, [])
  const nose = useMemo(() => new THREE.LatheGeometry(noseProfile, 64), [noseProfile])
  const noseTiles = useMemo(() => new THREE.LatheGeometry(noseProfile.map((p) => new THREE.Vector2(p.x + 0.04, p.y)), 48, -Math.PI / 2 - 0.15, Math.PI + 0.3), [noseProfile])
  const engines = useMemo(shipEnginePositions, [])
  const flap = (span: number, rootChord: number, tipChord: number) => {
    const s = new THREE.Shape()
    s.moveTo(0, -rootChord / 2)
    s.lineTo(span, -tipChord / 2)
    s.lineTo(span, tipChord / 2)
    s.lineTo(0, rootChord / 2)
    s.closePath()
    return new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false })
  }
  const fwdFlap = useMemo(() => flap(3.4, 7.5, 3.5), [])
  const aftFlap = useMemo(() => flap(4.6, 10, 6), [])
  return (
    <group>
      {/* barrel */}
      <mesh position={[0, bottom + 2 + barrel / 2, 0]} material={steelMaterial()} castShadow receiveShadow>
        <cylinderGeometry args={[R, R, barrel, 64, 1, true]} />
      </mesh>
      {/* heat shield (windward half, +Z = belly) */}
      <mesh position={[0, bottom + 2 + barrel / 2, 0]} material={tileMaterial()}>
        <cylinderGeometry args={[R + 0.05, R + 0.05, barrel, 48, 1, true, -Math.PI / 2 - 0.15, Math.PI + 0.3]} />
      </mesh>
      {/* nose cone */}
      <mesh geometry={nose} position={[0, bottom + 2 + barrel, 0]} material={steelMaterial()} castShadow />
      <mesh geometry={noseTiles} position={[0, bottom + 2 + barrel, 0]} material={tileMaterial()} />
      {/* aft skirt */}
      <mesh position={[0, bottom + 1, 0]} material={sootMaterial()} castShadow>
        <cylinderGeometry args={[R, R, 2, 48, 1, true]} />
      </mesh>
      <mesh position={[0, bottom + 1.6, 0]} rotation={[Math.PI / 2, 0, 0]} material={darkSteelMaterial()}>
        <circleGeometry args={[R, 48]} />
      </mesh>
      {/* Starlink PEZ door (leeward side) */}
      <mesh position={[0, bottom + 2 + barrel - 6, -R - 0.06]} rotation={[0, Math.PI, 0]} material={darkSteelMaterial()}>
        <planeGeometry args={[6.5, 2.2]} />
      </mesh>
      {/* forward flaps */}
      {[1, -1].map((s) => (
        <group key={`f${s}`} position={[s * (R - 0.6), bottom + 2 + barrel + 4.5, -0.8]} rotation={[0, 0, 0]}>
          <mesh geometry={fwdFlap} rotation={[0, s > 0 ? 0 : Math.PI, Math.PI / 2 - s * 0.06]} material={tileMaterial()} castShadow />
        </group>
      ))}
      {/* aft flaps */}
      {[1, -1].map((s) => (
        <group key={`a${s}`} position={[s * (R - 0.2), bottom + 6.5, -0.4]}>
          <mesh geometry={aftFlap} rotation={[0, s > 0 ? 0 : Math.PI, Math.PI / 2]} material={tileMaterial()} castShadow />
        </group>
      ))}
      {/* engines: 3 sea-level (centre), 3 RVac (outer, large bells) */}
      <EngineCluster points={engines.slice(0, 3)} exit={0.66} length={2.0} y={bottom - 2} />
      <EngineCluster points={engines.slice(3)} exit={1.18} length={3.3} y={bottom - 3.3} />
    </group>
  )
}
