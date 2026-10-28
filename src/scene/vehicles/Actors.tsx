import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useClock } from '../../sim/clock'
import { clamp, smoothstep } from '../../sim/interpolate'
import { BOOSTER_LEN, SHIP_LEN, useReplay, type Vehicle } from '../../sim/replay'
import { quatFromBasis, toV3 } from '../frame'
import { live } from '../live'
import { EngineGlows, Plume } from '../effects/Plume'
import { headerLevel, pezDoor, propLevels, starlinksAboard, useInspect, xrayOn } from '../inspect/data'
import { GlbOverride } from './GlbOverride'
import { Starship, SuperHeavy, boosterEnginePositions, shipEnginePositions } from './Vehicles'

const PRIORITY = -2

function useVehicleDriver(vehicle: Vehicle) {
  const replay = useReplay()
  const group = useRef<THREE.Group>(null)
  const plumeI = useRef(0)
  const plumeE = useRef(0)
  const status = useRef<string[]>([])
  const prev = useRef(new THREE.Vector3())
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const endT = vehicle === 'booster' ? replay.t('booster-fts', replay.t('booster-splashdown') + 7) : replay.t('ship-explosion', replay.t('ship-splashdown') + 6)
  useFrame((_, dt) => {
    const t = useClock.getState().t
    const g = group.current
    if (!g) return
    const p = replay.pose(vehicle, t)
    const L = live[vehicle]
    toV3(p.com, L.com)
    quatFromBasis(p.right, p.nose, p.belly, L.quat)
    toV3(p.nose, L.nose)
    toV3(p.belly, L.belly)
    toV3(p.up, L.up)
    if (dt > 0) {
      tmp.copy(L.com).sub(prev.current).divideScalar(Math.max(dt, 1e-3))
      L.velocity.lerp(tmp, 0.2)
    }
    prev.current.copy(L.com)
    L.alt = p.sample.alt
    L.speed = p.sample.speed
    L.visible = t < endT + 0.5
    g.position.copy(L.com)
    g.quaternion.copy(L.quat)
    g.visible = L.visible
    const eng = replay.engines(vehicle, t)
    status.current = eng.status
    const frac = eng.lit / eng.total
    plumeI.current = eng.lit ? clamp(0.35 + frac * 0.9) * (0.6 + 0.4 * eng.throttle) : 0
    plumeE.current = smoothstep(4_000, 60_000, p.sample.alt)
  }, PRIORITY)
  return { group, plumeI, plumeE, status }
}

// GLB models span the full vehicle length including engine bells; the procedural models hang their
// bells below the barrel. The plume starts at the nozzle exit either way.
export function BoosterActor() {
  const { group, plumeI, plumeE, status } = useVehicleDriver('booster')
  const pts = useMemo(boosterEnginePositions, [])
  const [glb, setGlb] = useState(false)
  const bottom = -BOOSTER_LEN / 2 - (glb ? 0 : 2.2)
  const hull = useRef<THREE.Group>(null)
  const xray = useInspect((s) => xrayOn(s, 'booster'))
  useGhost(hull, xray, glb)
  return (
    <group ref={group}>
      <group ref={hull}>
        <GlbOverride url="/models/super-heavy.glb" length={BOOSTER_LEN} onModel={setGlb}>
          <SuperHeavy />
        </GlbOverride>
      </group>
      <HitProxy id="booster" radius={4.8} y0={-BOOSTER_LEN / 2 + 4.5} y1={BOOSTER_LEN / 2} />
      <HitProxy id="booster-engines" radius={5.1} y0={-BOOSTER_LEN / 2 - 1} y1={-BOOSTER_LEN / 2 + 4.5} />
      {xray && <TankXray vehicle="booster" />}
      <group position={[0, bottom, 0]}>
        {!glb && <EngineGlows points={pts} y={0.05} size={0.62} statusRef={status} />}
        <Plume intensityRef={plumeI} expansionRef={plumeE} radius={4.6} length={120} />
      </group>
    </group>
  )
}

export function ShipActor() {
  const { group, plumeI, plumeE, status } = useVehicleDriver('ship')
  const pts = useMemo(shipEnginePositions, [])
  const [glb, setGlb] = useState(false)
  const bottom = -SHIP_LEN / 2 - (glb ? 0 : 2.6)
  const hull = useRef<THREE.Group>(null)
  const xray = useInspect((s) => xrayOn(s, 'ship'))
  useGhost(hull, xray, glb)
  return (
    <group ref={group}>
      <group ref={hull}>
        <GlbOverride url="/models/starship.glb" length={SHIP_LEN} onModel={setGlb}>
          <Starship />
        </GlbOverride>
        <PezDoor />
      </group>
      <HitProxy id="ship" radius={4.9} y0={-SHIP_LEN / 2 + 4} y1={SHIP_LEN / 2} />
      <HitProxy id="ship-engines" radius={5.1} y0={-SHIP_LEN / 2 - 1} y1={-SHIP_LEN / 2 + 4} />
      {xray && <TankXray vehicle="ship" />}
      <group position={[0, bottom, 0]}>
        {!glb && (
          <>
            <EngineGlows points={pts.slice(0, 3)} y={0.6} size={0.6} statusRef={status} />
            <EngineGlows points={pts.slice(3)} y={-0.7} size={1.1} statusRef={status} offset={3} />
          </>
        )}
        <Plume intensityRef={plumeI} expansionRef={plumeE} radius={3.8} length={55} vacuumBlue />
      </group>
      <ReentryPlasma />
    </group>
  )
}

/** Pink-orange plasma sheath on the windward (belly) side during reentry. */
function ReentryPlasma() {
  const replay = useReplay()
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { intensity: { value: 0 }, time: { value: 0 } },
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main() {
            vP = position;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          uniform float intensity; uniform float time;
          varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main() {
            #include <logdepthbuf_fragment>
            float rim = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 1.5);
            float belly = smoothstep(-2.0, 6.0, vP.z);
            float flick = 0.85 + 0.15 * sin(time * 30.0 + vP.y * 0.7);
            vec3 col = mix(vec3(1.0, 0.35, 0.55), vec3(1.0, 0.75, 0.45), belly);
            float a = intensity * (0.35 + rim * 1.4) * belly * flick;
            gl_FragColor = vec4(col * a * 5.0, clamp(a, 0.0, 1.0));
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const tEntry = replay.t('ship-entry', 1e9)
  useFrame((state) => {
    const t = useClock.getState().t
    const s = live.ship
    let heat = 0
    if (t > tEntry - 300) {
      const smp = replay.ship.sample(t)
      heat = Math.pow(clamp((smp.q * smp.speed) / 2.5e7), 0.6) * smoothstep(tEntry - 300, tEntry + 60, t)
    }
    mat.uniforms.intensity.value = heat
    mat.uniforms.time.value = state.clock.elapsedTime
    if (ref.current) ref.current.visible = heat > 0.01 && s.visible
  })
  return (
    <mesh ref={ref} material={mat} scale={[7.5, SHIP_LEN * 0.62, 8.5]} position={[0, 2, 2.2]} renderOrder={7}>
      <sphereGeometry args={[1, 32, 24]} />
    </mesh>
  )
}

/** Invisible cylinder the inspect raycaster can hit (the GLB meshes themselves are never raycast). */
const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 })
function HitProxy({ id, radius, y0, y1 }: { id: string; radius: number; y0: number; y1: number }) {
  return (
    <mesh position={[0, (y0 + y1) / 2, 0]} material={proxyMat} userData={{ inspect: id }} renderOrder={-20}>
      <cylinderGeometry args={[radius, radius, y1 - y0, 20, 1]} />
    </mesh>
  )
}

/** Swaps the hull's materials for a faint glass so the tanks show through; restores them afterwards. */
const ghostMat = new THREE.MeshStandardMaterial({ color: '#b9cad8', metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide })
function useGhost(hull: React.RefObject<THREE.Group | null>, on: boolean, glb: boolean) {
  useEffect(() => {
    const root = hull.current
    if (!root) return
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      if (on) {
        if (!m.userData.origMat) m.userData.origMat = m.material
        m.material = ghostMat
        m.castShadow = false
      } else if (m.userData.origMat) {
        m.material = m.userData.origMat
        delete m.userData.origMat
        m.castShadow = true
      }
    })
  }, [hull, on, glb])
}

const LOX_COLOR = new THREE.Color('#8fd0ff')
const CH4_COLOR = new THREE.Color('#ffae66')

/** Lathe profile of a tank: cylinder of radius r from y0 to y1 closed by elliptical domes of height d. */
function tankProfile(r: number, y0: number, y1: number, d: number, n = 10) {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2)
    pts.push(new THREE.Vector2(Math.sin(a) * r, y0 + d - Math.cos(a) * d))
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2)
    pts.push(new THREE.Vector2(Math.cos(a) * r, y1 - d + Math.sin(a) * d))
  }
  return pts
}

interface TankDef {
  kind: 'lox' | 'ch4'
  y0: number
  y1: number
}

/**
 * Tank layout fitted to the GLB's own bulkheads (model frame, y up, centred). Ship: LOX aft up to the common dome
 * at y ≈ −6, methane to the forward dome, the 26-satellite payload bay at y 6.8–18.2. Booster: LOX up to the
 * common dome at y ≈ +9.5, methane up to the hot-stage ring.
 */
const TANKS: Record<Vehicle, TankDef[]> = {
  ship: [
    { kind: 'lox', y0: -20.8, y1: -6 },
    { kind: 'ch4', y0: -6, y1: 5.6 },
  ],
  booster: [
    { kind: 'lox', y0: -27.2, y1: 9.5 },
    { kind: 'ch4', y0: 9.5, y1: 32.8 },
  ],
}

// faint tank walls so the liquid level reads clearly against them
const shellMat = (c: THREE.Color) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide })
const liquidMat = (c: THREE.Color, plane: THREE.Plane) =>
  new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.3, transparent: true, opacity: 0.88, side: THREE.DoubleSide, clippingPlanes: [plane] })

/**
 * Cut-away of the propellant tanks: domed tanks fitted to the model, the booster's methane downcomer through
 * the LOX tank, the ship's header tanks and Starlink stack. Each liquid is the full tank shape clipped by a
 * plane at the live fill level, so domes fill and drain naturally.
 */
function TankXray({ vehicle }: { vehicle: Vehicle }) {
  const replay = useReplay()
  const R = 4.25
  const tanks = TANKS[vehicle]
  const res = useMemo(() => {
    const planes = tanks.map(() => new THREE.Plane())
    return {
      planes,
      geoms: tanks.map((k) => new THREE.LatheGeometry(tankProfile(R, k.y0, k.y1, 1.6), 48)),
      shells: { lox: shellMat(LOX_COLOR), ch4: shellMat(CH4_COLOR) },
      liquids: tanks.map((k, i) => liquidMat(k.kind === 'lox' ? LOX_COLOR : CH4_COLOR, planes[i])),
      solid: { lox: new THREE.MeshStandardMaterial({ color: LOX_COLOR, emissive: LOX_COLOR, emissiveIntensity: 0.45 }), ch4: new THREE.MeshStandardMaterial({ color: CH4_COLOR, emissive: CH4_COLOR, emissiveIntensity: 0.45 }) },
      sat: new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.6, roughness: 0.4 }),
    }
  }, [tanks])
  const root = useRef<THREE.Group>(null)
  const headers = useRef<(THREE.Mesh | null)[]>([])
  const sats = useRef<THREE.Group>(null)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.localClippingEnabled = true
  }, [gl])
  const tmp = useMemo(() => ({ n: new THREE.Vector3(), p: new THREE.Vector3() }), [])
  useFrame(() => {
    const t = useClock.getState().t
    const g = root.current
    if (!g) return
    const lv = propLevels(replay, vehicle, t)
    // liquid settles towards the engines: keep everything below a plane normal to the body axis
    tmp.n.set(0, 1, 0).transformDirection(g.matrixWorld)
    tanks.forEach((k, i) => {
      const f = k.kind === 'lox' ? lv.lox : lv.ch4
      const y = k.y0 + (k.y1 - k.y0) * Math.max(0.002, f)
      tmp.p.set(0, y, 0).applyMatrix4(g.matrixWorld)
      res.planes[i].setFromNormalAndCoplanarPoint(tmp.n.clone().negate(), tmp.p)
    })
    if (vehicle === 'ship') {
      const h = headerLevel(replay, t)
      for (const m of headers.current) m?.scale.setScalar(Math.max(0.05, Math.cbrt(h)))
      const aboard = starlinksAboard(replay, t).aboard
      sats.current?.children.forEach((c, i) => (c.visible = i < aboard))
    }
  })
  return (
    <group ref={root}>
      {tanks.map((k, i) => (
        <group key={k.kind}>
          <mesh geometry={res.geoms[i]} material={res.shells[k.kind]} renderOrder={6} />
          <mesh geometry={res.geoms[i]} material={res.liquids[i]} scale={[0.985, 1, 0.985]} renderOrder={5} />
        </group>
      ))}
      {vehicle === 'booster' && (
        <mesh position={[0, (TANKS.booster[0].y0 + TANKS.booster[1].y0) / 2 + 0.8, 0]} material={res.solid.ch4}>
          <cylinderGeometry args={[0.55, 0.55, TANKS.booster[1].y0 - TANKS.booster[0].y0 - 1.6, 16]} />
        </mesh>
      )}
      {vehicle === 'ship' && (
        <>
          {/* LOX header in the nose, methane header inside the main LOX tank */}
          <mesh ref={(el) => void (headers.current[0] = el)} position={[0, 20.6, 0]} material={res.solid.lox}>
            <sphereGeometry args={[1.35, 24, 16]} />
          </mesh>
          <mesh ref={(el) => void (headers.current[1] = el)} position={[0, -15.5, 0]} material={res.solid.ch4}>
            <sphereGeometry args={[1.05, 24, 16]} />
          </mesh>
          <group ref={sats}>
            {Array.from({ length: replay.data.mission.payload?.count ?? 0 }, (_, i) => (
              <mesh key={i} position={[0, 7.05 + i * 0.435, 0]} material={res.sat}>
                <boxGeometry args={[6.4, 0.36, 2.5]} />
              </mesh>
            ))}
          </group>
        </>
      )}
    </group>
  )
}

/** Alpha mask of a stadium ("oval": fully rounded ends) filling a w × h texture. */
function stadiumMask(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = Math.round((512 * h) / w)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.roundRect(1, 1, c.width - 2, c.height - 2, c.height / 2)
  ctx.fill()
  return new THREE.CanvasTexture(c)
}

/** Starlink dispenser ("PEZ") door on the leeward side: an oval slot whose panel slides up inside the hull. */
function PezDoor() {
  const replay = useReplay()
  const panel = useRef<THREE.Group>(null)
  const slot = useRef<THREE.Mesh>(null)
  const W = 7.4
  const H = 1.9
  const R = 4.43 // hull radius of the model at the door
  const y = SHIP_LEN / 2 - 15.5
  const res = useMemo(() => {
    const mask = stadiumMask(W, H)
    // densely segmented cylinder patch centred on −Z (three's theta 0 is +Z), so it hugs the curved hull
    const patch = (r: number) => new THREE.CylinderGeometry(r, r, H, 48, 1, true, Math.PI - W / r / 2, W / r)
    return {
      hole: patch(R + 0.012),
      door: patch(R + 0.03),
      holeMat: new THREE.MeshBasicMaterial({ color: '#040506', alphaMap: mask, alphaTest: 0.5, side: THREE.DoubleSide }),
      doorMat: new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 0.85, roughness: 0.35, alphaMap: mask, alphaTest: 0.5 }),
    }
  }, [])
  useFrame(() => {
    const k = pezDoor(replay, useClock.getState().t)
    if (panel.current) {
      panel.current.position.y = y + k * (H + 0.1)
      panel.current.scale.setScalar(1 - 0.04 * k)
    }
    if (slot.current) slot.current.visible = k > 0.01
  })
  return (
    <group userData={{ inspect: 'ship' }}>
      <mesh ref={slot} geometry={res.hole} material={res.holeMat} position={[0, y, 0]} />
      <group ref={panel} position={[0, y, 0]}>
        <mesh geometry={res.door} material={res.doorMat} />
      </group>
    </group>
  )
}
