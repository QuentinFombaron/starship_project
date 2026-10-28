import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useClock } from '../../sim/clock'
import { smoothstep } from '../../sim/interpolate'
import { MOUNT_HEIGHT } from '../../sim/replay'
import { concreteMaterial, darkSteelMaterial, latticeTexture, sootMaterial, steelMaterial } from '../materials'

/**
 * Orbital Launch Pad 2 ("Pad B"), as of 2026. Sources: NASASpaceflight pad articles (2025–2026), the FAA
 * tower filing (144.5 m) and NOAA/Vantor aerials. Numbers marked ~ are estimates from photos.
 *
 * Local frame: origin at the launch mount centre at grade, y up. The pad group is turned so local +x points
 * at the tower (~27 m NNE of the mount) and the flame trench runs along local z (WNW–ESE).
 */
export const PAD_B_YAW = 1.272
export const GRADE = 0.45
/** Top of the mount deck; the booster's engine exit plane hangs MOUNT_HEIGHT above grade inside the opening. */
export const DECK_Y = MOUNT_HEIGHT + 2.6
const TOWER_X = 27
const TOWER_W = 13.5
const TOWER_H = 140
const BASE_H = 18

const once = <T,>(make: () => T) => {
  let v: T | undefined
  return () => (v ??= make())
}

const towerSteel = once(() => {
  const t = latticeTexture().clone()
  t.repeat.set(2, 20)
  t.needsUpdate = true
  return new THREE.MeshStandardMaterial({ color: '#3e4044', alphaMap: t, alphaTest: 0.5, metalness: 0.7, roughness: 0.55, side: THREE.DoubleSide })
})
const armSteel = once(() => {
  const t = latticeTexture().clone()
  t.repeat.set(9, 1)
  t.needsUpdate = true
  return new THREE.MeshStandardMaterial({ color: '#45474b', alphaMap: t, alphaTest: 0.5, metalness: 0.75, roughness: 0.5, side: THREE.DoubleSide })
})
const cladding = once(() => new THREE.MeshStandardMaterial({ color: '#a9abae', metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide }))
const deckPlate = once(() => new THREE.MeshStandardMaterial({ color: '#4c4a47', metalness: 0.75, roughness: 0.55 }))
const tankWhite = once(() => new THREE.MeshStandardMaterial({ color: '#e6e4df', metalness: 0.25, roughness: 0.45 }))
const tankTan = once(() => new THREE.MeshStandardMaterial({ color: '#e3d6bf', metalness: 0.25, roughness: 0.5 }))

/** Sloped, steel-clad face of the pyramid mount; the trench faces get an arched exhaust opening. */
function MountFace({ base, top, height, opening }: { base: number; top: number; height: number; opening?: { w: number; h: number } }) {
  const geom = useMemo(() => {
    const inset = (base - top) / 2
    const slant = Math.hypot(height, inset)
    const s = new THREE.Shape()
    s.moveTo(-base / 2, 0)
    s.lineTo(base / 2, 0)
    s.lineTo(top / 2, slant)
    s.lineTo(-top / 2, slant)
    s.closePath()
    if (opening) {
      const k = slant / height
      const hole = new THREE.Path()
      const r = opening.w / 2
      hole.moveTo(-r, 0.01)
      hole.lineTo(r, 0.01)
      hole.lineTo(r, (opening.h - r) * k)
      hole.absarc(0, (opening.h - r) * k, r, 0, Math.PI, false)
      hole.lineTo(-r, 0.01)
      s.holes.push(hole)
    }
    return new THREE.ShapeGeometry(s, 24)
  }, [base, top, height, opening])
  const tilt = Math.atan((base - top) / 2 / height)
  return (
    <group position={[0, 0, base / 2]} rotation={[-tilt, 0, 0]}>
      <mesh geometry={geom} material={cladding()} castShadow receiveShadow />
    </group>
  )
}

function LaunchMount() {
  const deck = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-12, -12)
    s.lineTo(12, -12)
    s.lineTo(12, 12)
    s.lineTo(-12, 12)
    s.closePath()
    const hole = new THREE.Path()
    hole.absarc(0, 0, 5.4, 0, Math.PI * 2, true)
    s.holes.push(hole)
    return new THREE.ExtrudeGeometry(s, { depth: 1.4, bevelEnabled: false, curveSegments: 48 })
  }, [])
  const diverter = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-8, 0)
    s.lineTo(0, 7)
    s.lineTo(8, 0)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 14, bevelEnabled: false })
    g.translate(0, 0, -7)
    return g
  }, [])
  const faceH = DECK_Y - 1.4 - GRADE
  return (
    <group userData={{ inspect: 'olm-b' }}>
      {/* pyramid cladding: four sloped faces, trench exits on the ±z faces */}
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a, i) => (
        <group key={a} rotation={[0, a, 0]} position={[0, GRADE, 0]}>
          <MountFace base={44} top={24} height={faceH} opening={i % 2 === 0 ? { w: 17, h: 13 } : undefined} />
        </group>
      ))}
      {/* water-cooled steel deck with the booster opening */}
      <mesh geometry={deck} rotation={[-Math.PI / 2, 0, 0]} position={[0, DECK_Y - 1.4, 0]} material={deckPlate()} castShadow receiveShadow />
      {/* 20 hold-down clamps with hoods */}
      {Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2
        return (
          <group key={i} position={[Math.cos(a) * 5.9, DECK_Y + 0.7, Math.sin(a) * 5.9]} rotation={[0, -a, 0]}>
            <mesh material={darkSteelMaterial()} castShadow>
              <boxGeometry args={[1.5, 1.4, 1.1]} />
            </mesh>
            <mesh position={[0.5, 0.75, 0]} rotation={[0, 0, 0.6]} material={sootMaterial()}>
              <boxGeometry args={[1.0, 0.25, 1.2]} />
            </mesh>
          </group>
        )
      })}
      {/* split booster quick-disconnects (LOX, methane) under angular hoods on the tower side */}
      {[-0.42, 0.42].map((a) => (
        <group key={a} position={[Math.cos(a) * 8.6, DECK_Y + 1.6, Math.sin(a) * 8.6]} rotation={[0, -a, 0]} userData={{ inspect: 'bqd' }}>
          <mesh material={cladding()} castShadow>
            <boxGeometry args={[3.2, 3.2, 3.6]} />
          </mesh>
          <mesh position={[0.4, 1.9, 0]} rotation={[0, 0, -0.5]} material={cladding()} castShadow>
            <boxGeometry args={[3.6, 0.3, 3.8]} />
          </mesh>
        </group>
      ))}
      {/* dark interior so the opening doesn't show sky through the pyramid */}
      <mesh position={[0, (DECK_Y - 1.4) / 2 + 0.3, 0]} material={sootMaterial()}>
        <boxGeometry args={[20, DECK_Y - 2.2, 8]} />
      </mesh>
      {/* double-sided, water-cooled flame diverter with its spray ridge cap */}
      <mesh geometry={diverter} position={[0, GRADE, 0]} rotation={[0, Math.PI / 2, 0]} material={sootMaterial()} castShadow userData={{ inspect: 'diverter' }} />
      <mesh position={[0, GRADE + 7.1, 0]} material={darkSteelMaterial()}>
        <boxGeometry args={[14, 0.5, 0.8]} />
      </mesh>
      <FlameTrench />
    </group>
  )
}

/** Steel-lined trench with two exits; the exhaust leaves along ±z. */
function FlameTrench() {
  return (
    <group userData={{ inspect: 'trench' }}>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0, GRADE + 0.08, s * 36]} material={sootMaterial()} receiveShadow>
            <boxGeometry args={[18, 0.15, 30]} />
          </mesh>
          {[-1, 1].map((w) => (
            <mesh key={w} position={[w * 9.6, GRADE + 2.2, s * 34]} material={concreteMaterial()} castShadow receiveShadow>
              <boxGeometry args={[1.2, 4.4, 26]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

/** Integration Tower 2: 144.5 m, nine lattice modules on a clad concrete "speed-core" base, new roof. */
function Tower() {
  const W = TOWER_W
  return (
    <group position={[TOWER_X, GRADE, 0]}>
      <group userData={{ inspect: 'tower-b' }}>
        <mesh position={[0, BASE_H / 2, 0]} material={cladding()} castShadow receiveShadow>
          <boxGeometry args={[W + 1.5, BASE_H, W + 1.5]} />
        </mesh>
        <mesh position={[0, BASE_H + (TOWER_H - BASE_H) / 2, 0]} material={towerSteel()} castShadow>
          <boxGeometry args={[W, TOWER_H - BASE_H, W]} />
        </mesh>
        {/* corner columns and module floors */}
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[(sx * W) / 2, TOWER_H / 2, (sz * W) / 2]} material={darkSteelMaterial()} castShadow>
              <boxGeometry args={[1.1, TOWER_H, 1.1]} />
            </mesh>
          )),
        )}
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} position={[0, BASE_H + ((TOWER_H - BASE_H) * (i + 1)) / 9, 0]} material={darkSteelMaterial()}>
            <boxGeometry args={[W + 0.4, 0.7, W + 0.4]} />
          </mesh>
        ))}
        {/* elevator/stair core */}
        <mesh position={[-2, TOWER_H / 2, 3]} material={darkSteelMaterial()}>
          <boxGeometry args={[3.5, TOWER_H, 3.5]} />
        </mesh>
        {/* clad roof shielding the drawworks, and the lightning rod */}
        <mesh position={[0, TOWER_H + 2.5, 0]} material={cladding()} castShadow>
          <boxGeometry args={[W + 2, 5, W + 2]} />
        </mesh>
        <mesh position={[0, TOWER_H + 5.6, 0]} rotation={[0, Math.PI / 4, 0]} material={cladding()}>
          <coneGeometry args={[(W + 2) * 0.72, 2.4, 4]} />
        </mesh>
        <mesh position={[0, TOWER_H + 9, 0]} material={darkSteelMaterial()}>
          <cylinderGeometry args={[0.12, 0.3, 6, 6]} />
        </mesh>
      </group>
      <Chopsticks height={84} spread={0.5} />
      <ShipQdArm height={DECK_Y + 72.3 + 3 - GRADE} />
    </group>
  )
}

/** Shorter (~26 m) electromechanical chopsticks: one sled per catch rail plus a telescopic tip pusher. */
function Chopsticks({ height, spread }: { height: number; spread: number }) {
  const L = 26
  return (
    <group position={[-TOWER_W / 2 - 1.6, height, 0]} userData={{ inspect: 'chopsticks' }}>
      {/* carriage riding the tower face */}
      <mesh material={darkSteelMaterial()} castShadow>
        <boxGeometry args={[3.2, 9, TOWER_W + 1]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, (s * TOWER_W) / 2]} rotation={[0, Math.PI - s * spread, 0]}>
          <mesh position={[L / 2, 0, 0]} material={armSteel()} castShadow>
            <boxGeometry args={[L, 3.4, 2.2]} />
          </mesh>
          <mesh position={[L / 2, 0, 0]} material={darkSteelMaterial()}>
            <boxGeometry args={[L, 0.5, 0.6]} />
          </mesh>
          {/* catch rail, sled and tip pusher */}
          <mesh position={[L / 2 + 2, 1.95, -s * 1.1]} material={darkSteelMaterial()}>
            <boxGeometry args={[L - 6, 0.5, 0.7]} />
          </mesh>
          <mesh position={[L * 0.62, 2.5, -s * 1.1]} material={steelMaterial()}>
            <boxGeometry args={[2.4, 0.7, 1]} />
          </mesh>
          <mesh position={[L - 0.4, 0, -s * 0.9]} material={steelMaterial()}>
            <boxGeometry args={[1.2, 1.4, 1.6]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Separate, reinforced ship quick-disconnect swing arm; it swings clear in the last seconds of the count. */
function ShipQdArm({ height }: { height: number }) {
  const pivot = useRef<THREE.Group>(null)
  useFrame(() => {
    const t = useClock.getState().t
    if (pivot.current) pivot.current.rotation.y = -1.25 * smoothstep(-22, -12, t)
  })
  const reach = TOWER_X - TOWER_W / 2 - 4.5
  return (
    <group position={[-TOWER_W / 2, height, -TOWER_W / 2 + 1.5]} userData={{ inspect: 'sqd' }}>
      <group ref={pivot}>
        <mesh position={[-reach / 2, 0, 0]} material={armSteel()} castShadow>
          <boxGeometry args={[reach, 4.2, 3.2]} />
        </mesh>
        <mesh position={[-reach / 2, -2.2, 0]} material={darkSteelMaterial()}>
          <boxGeometry args={[reach, 0.4, 3.4]} />
        </mesh>
        {/* QD plate that mates with the ship's aft skirt */}
        <mesh position={[-reach - 0.6, -0.6, 3.4]} material={cladding()} castShadow>
          <boxGeometry args={[2.2, 5, 3.6]} />
        </mesh>
      </group>
    </group>
  )
}

/** Deluge water farm ~80 m ENE of the tower: horizontal water tanks plus vertical nitrogen tanks. */
function DelugeFarm() {
  return (
    <group userData={{ inspect: 'deluge-farm' }}>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[58 + i * 4.8, GRADE + 2.4, -73]} rotation={[Math.PI / 2, 0, 0]} material={tankWhite()} castShadow receiveShadow>
          <cylinderGeometry args={[2.1, 2.1, 38, 20]} />
        </mesh>
      ))}
      {[0, 1, 2].map((i) => (
        <mesh key={`n${i}`} position={[124 + i * 5, GRADE + 9, -86]} material={steelMaterial()} castShadow>
          <cylinderGeometry args={[1.9, 1.9, 18, 20]} />
        </mesh>
      ))}
    </group>
  )
}

export const FARM_GROUPS = [
  { id: 'farm-lox', from: 0, to: 9 },
  { id: 'farm-ch4', from: 10, to: 15 },
  { id: 'farm-ln2', from: 16, to: 21 },
] as const

/** Shared propellant farm between the two pads: a long row of horizontal LOX, methane and nitrogen tanks. */
function PropellantFarm() {
  return (
    <group position={[226, GRADE, -46]}>
      {FARM_GROUPS.map((g) => (
        <group key={g.id} userData={{ inspect: g.id }}>
          {Array.from({ length: g.to - g.from + 1 }, (_, k) => {
            const i = g.from + k
            return (
              <mesh key={i} position={[i * 7.4, 3.6, 0]} rotation={[Math.PI / 2, 0, 0]} material={g.id === 'farm-ch4' ? tankWhite() : tankTan()} castShadow receiveShadow>
                <cylinderGeometry args={[3.3, 3.3, 62, 24]} />
              </mesh>
            )
          })}
        </group>
      ))}
      {/* pump and subcooler skid along the north side */}
      <mesh position={[78, 3, -38]} material={darkSteelMaterial()} castShadow receiveShadow>
        <boxGeometry args={[160, 6, 8]} />
      </mesh>
    </group>
  )
}

export function PadB() {
  return (
    <group>
      <group rotation={[0, PAD_B_YAW, 0]}>
        {/* the 2022 aerial still shows dunes here: concrete apron for the 2026 pad */}
        <mesh position={[8, GRADE + 0.12, 0]} material={concreteMaterial()} receiveShadow>
          <boxGeometry args={[150, 0.3, 140]} />
        </mesh>
        <LaunchMount />
        <Tower />
      </group>
      <DelugeFarm />
      <PropellantFarm />
    </group>
  )
}
