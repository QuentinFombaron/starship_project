import { Environment, Lightformer, OrbitControls, Sky } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { IMAGERY_CREDIT, MODEL_CREDIT } from '../scene/Starbase/imagery'
import { FACTORY, PAD1, WATER_LEVEL, localFromGeo, StarbaseSite } from '../scene/Starbase/Starbase'
import { GlbOverride } from '../scene/vehicles/GlbOverride'
import { Starship, SuperHeavy } from '../scene/vehicles/Vehicles'
import { BOOSTER_LEN, MOUNT_HEIGHT, SHIP_LEN } from '../sim/replay'

const pad1 = localFromGeo(PAD1.lat, PAD1.lon)
const factory = localFromGeo(FACTORY.lat, FACTORY.lon)

const POIS: { id: string; label: string; text: string; target: [number, number, number]; cam: [number, number, number] }[] = [
  {
    id: 'pad2',
    label: 'Pad 2 · Orbital launch pad',
    text: 'Second orbital launch site, built for Block 3. The tower has a new chopstick design, the launch mount sits over a flame trench, and Flight 14 lifted off from here.',
    target: [0, 70, 0],
    cam: [170, 90, 210],
  },
  {
    id: 'chopsticks',
    label: 'Chopsticks',
    text: 'Mechazilla’s two arms stack the vehicles and catch returning boosters, and on future flights ships, out of the air.',
    target: [5, 84, -17],
    cam: [60, 96, 45],
  },
  {
    id: 'olm',
    label: 'Orbital launch mount',
    text: 'Super Heavy sits on hold-down clamps about 22 m above the ground, over a water-cooled flame trench that carries the exhaust away.',
    target: [0, 18, 0],
    cam: [55, 14, 55],
  },
  {
    id: 'pad1',
    label: 'Pad 1',
    text: 'The original orbital launch pad, home of the first eleven flights and the first booster catches.',
    target: [pad1[0], 70, pad1[2]],
    cam: [pad1[0] - 180, 80, pad1[2] + 220],
  },
  {
    id: 'tankfarm',
    label: 'Tank farm',
    text: 'A long row of horizontal tanks between the two pads holds liquid oxygen, liquid methane and liquid nitrogen. Propellant flows to the vehicle through the launch mount quick-disconnects and the ship quick-disconnect arm.',
    target: [300, 10, -46],
    cam: [300, 90, 140],
  },
  {
    id: 'factory',
    label: 'Production site',
    text: 'About 2.5 km inland: the Starfactory and the Mega Bays, where boosters and ships are stacked. Vehicles roll to the pads along Highway 4.',
    target: [factory[0] + 60, 40, factory[2] - 60],
    cam: [factory[0] + 420, 220, factory[2] + 420],
  },
  {
    id: 'beach',
    label: 'Boca Chica Beach',
    text: 'The Gulf of Mexico lies just east of the pads. Spectators watch launches from South Padre Island to the north.',
    target: [0, 60, 0],
    cam: [900, 6, -1400],
  },
]

function CameraMover({ poi, controls }: { poi: (typeof POIS)[number]; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera)
  const anim = useRef({ t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), tf: new THREE.Vector3(), tt: new THREE.Vector3() })
  useEffect(() => {
    const a = anim.current
    a.t = 0
    a.from.copy(camera.position)
    a.to.set(...poi.cam)
    a.tf.copy(controls.current?.target ?? new THREE.Vector3())
    a.tt.set(...poi.target)
  }, [poi, camera, controls])
  useFrame((_, dt) => {
    const a = anim.current
    if (a.t >= 1) return
    a.t = Math.min(1, a.t + dt / 2.2)
    const k = a.t * a.t * (3 - 2 * a.t)
    camera.position.lerpVectors(a.from, a.to, k)
    controls.current?.target.lerpVectors(a.tf, a.tt, k)
    controls.current?.update()
  })
  return null
}

function sunFromHour(hour: number) {
  // Starbase late September: sunrise ~7:20, sunset ~19:20 local; sun rises in the east (+x)
  const k = (hour - 7.3) / 12
  const elev = Math.sin(k * Math.PI) * 62
  const az = 90 + k * 180 // east → south → west
  const e = (elev * Math.PI) / 180
  const a = (az * Math.PI) / 180
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e))
}

function Lights({ hour }: { hour: number }) {
  const sun = useMemo(() => sunFromHour(hour), [hour])
  const day = THREE.MathUtils.smoothstep(sun.y, -0.08, 0.15)
  return (
    <>
      <directionalLight
        position={sun.clone().multiplyScalar(800)}
        intensity={3.2 * day}
        color="#fff3e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-250}
        shadow-camera-right={250}
        shadow-camera-top={250}
        shadow-camera-bottom={-250}
        shadow-camera-far={2000}
        shadow-bias={-0.0004}
      />
      <hemisphereLight args={['#bcd6ff', '#6d5c46', 0.25 + 0.5 * day]} />
      <Sky sunPosition={sun.toArray()} distance={450000} turbidity={6} rayleigh={1.6} mieCoefficient={0.004} mieDirectionalG={0.85} />
      <fog attach="fog" args={[new THREE.Color().setHSL(0.58, 0.3, 0.18 + 0.5 * day), 3000, 16000]} />
    </>
  )
}

export default function StarbaseExplorer() {
  const [poi, setPoi] = useState(POIS[0])
  const [hour, setHour] = useState(7.9)
  const [showStack, setShowStack] = useState(true)
  const controls = useRef<OrbitControlsImpl | null>(null)
  return (
    <div className="fixed inset-0 bg-black">
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [600, 300, 800], fov: 45, near: 0.5, far: 60000 }} gl={{ toneMapping: THREE.AgXToneMapping }}>
        <Lights hour={hour} />
        <Environment resolution={128} frames={1}>
          <mesh scale={100}>
            <sphereGeometry args={[1, 32, 16]} />
            <meshBasicMaterial side={THREE.BackSide} color="#557aa8" />
          </mesh>
          <Lightformer form="rect" intensity={5} color="#fff3e0" position={[30, 40, 20]} scale={[30, 10, 1]} target={[0, 0, 0]} />
        </Environment>
        <StarbaseSite />
        {/* sea and lagoons: the ground sinks below this wherever the lidar says water */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]} receiveShadow>
          <circleGeometry args={[60000, 64]} />
          <meshStandardMaterial color="#2d4f57" roughness={0.18} metalness={0.15} />
        </mesh>
        {showStack && (
          <>
            <group position={[0, MOUNT_HEIGHT + BOOSTER_LEN / 2, 0]}>
              <GlbOverride url="/models/super-heavy.glb" length={BOOSTER_LEN}>
                <SuperHeavy />
              </GlbOverride>
            </group>
            <group position={[0, MOUNT_HEIGHT + BOOSTER_LEN + SHIP_LEN / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
              <GlbOverride url="/models/starship.glb" length={SHIP_LEN}>
                <Starship />
              </GlbOverride>
            </group>
          </>
        )}
        <OrbitControls ref={controls} makeDefault maxPolarAngle={Math.PI / 2 - 0.02} minDistance={15} maxDistance={12000} enableDamping />
        <CameraMover poi={poi} controls={controls} />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent p-4 md:p-6">
        <div className="pointer-events-auto flex items-center gap-4">
          <Link to="/" className="btn-sm">
            ←
          </Link>
          <div>
            <div className="heading text-[15px] tracking-[0.26em]">STARBASE, TEXAS</div>
            <div className="label !text-[10px]">Interactive site explorer</div>
          </div>
        </div>
        <Link to="/flights/flight-14/replay" className="btn-sm pointer-events-auto">
          ▶ Flight 14 replay
        </Link>
      </div>

      <div className="panel absolute bottom-4 left-4 right-4 p-4 md:bottom-6 md:left-6 md:right-auto md:w-[420px] md:p-5">
        <div className="label mb-1">Point of interest</div>
        <div className="heading text-xl">{poi.label}</div>
        <p className="mt-2 text-[13px] leading-relaxed text-white/80">{poi.text}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {POIS.map((p) => (
            <button key={p.id} className="btn-sm" aria-pressed={p.id === poi.id} onClick={() => setPoi(p)}>
              {p.label.split(' · ')[0]}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3 text-[12px] text-dim">
          <span className="w-20">Time {String(Math.floor(hour)).padStart(2, '0')}:{String(Math.round((hour % 1) * 60)).padStart(2, '0')}</span>
          <input type="range" min={5} max={21} step={0.05} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="flex-1 accent-white" aria-label="Time of day" />
          <button className="btn-sm" aria-pressed={showStack} onClick={() => setShowStack((s) => !s)}>
            Stack
          </button>
        </div>
        <p className="mt-3 text-[10px] leading-snug text-faint">Approximate layout. {IMAGERY_CREDIT}. {MODEL_CREDIT}.</p>
      </div>
    </div>
  )
}
