import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useClock } from '../../sim/clock'
import { smoothstep } from '../../sim/interpolate'
import { SHIP_LEN, useReplay } from '../../sim/replay'
import { live } from '../live'

/** Release time of satellite i (0-based) — evenly spaced across the deploy window. */
export function starlinkReleaseTimes(start: number, end: number, n: number) {
  return Array.from({ length: n }, (_, i) => start + ((i + 0.5) * (end - start)) / n)
}

// Starlink V3 (satellite frame: x = long axis, y = up out of the sunward deck, z = short axis). The flat bus has
// the phased-array panels underneath; the deck carries the two folded solar-array stacks and four parabolic
// dishes. Sized to the 0.435 m dispenser pitch and the PEZ slot.
const BUS = { x: 6.4, y: 0.36, z: 2.5 }
const DECK = BUS.y / 2
const STACK = { x: 3, y: 0.12, z: 0.9, z0: 0.62 }
/** Each wing unfolds from its stack: 16 panels of the stack's depth, as wide as the stack is long. */
const WING = { w: STACK.x, len: 16 * STACK.z, t: 0.05 }
const BOOM = 2.6
const DISH_R = 0.55
const DISH_ARM = 0.95
const DISH_CORNERS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const
/** Hall thrusters at two diagonally opposite corners, firing along the long axis. */
const THRUSTERS = [
  { x: BUS.x / 2, z: 0.9, dir: 1 },
  { x: -BUS.x / 2, z: -0.9, dir: -1 },
] as const

/**
 * Seconds after release (it takes ~6 s to clear the slot): the satellite turns its phased arrays to the Earth,
 * the dishes swing out from the deck to below the long edges, the array stacks rise into two tall vertical wings,
 * the wings fold down flat onto their diamond booms, then the Hall thrusters start orbit raising. Spaced so the
 * wings open well clear of the ship.
 */
const PHASE = { acquire: [8, 30], dish: [24, 38], rise: [44, 62], lower: [64, 92], thrust: [140, 150] } as const
const phase = (p: readonly [number, number], age: number) => smoothstep(p[0], p[1], age)

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Deck: silver radiator panels in a 3 × 2 grid either side of a ribbed central spine. */
function deckTexture() {
  return canvas(1024, 400, (ctx) => {
    const W = 1024
    const H = 400
    ctx.fillStyle = '#9ea4ab'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#5d6269'
    ctx.fillRect(0, 0, W, 14)
    ctx.fillRect(0, H - 14, W, 14)
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++) {
        const x = 26 + col * 330
        const y = row ? 222 : 24
        ctx.fillStyle = '#cfd3d7'
        ctx.fillRect(x, y, 310, 154)
        ctx.strokeStyle = 'rgba(70,75,82,0.35)'
        ctx.lineWidth = 1
        for (let k = 8; k < 154; k += 9) {
          ctx.beginPath()
          ctx.moveTo(x + 4, y + k)
          ctx.lineTo(x + 306, y + k)
          ctx.stroke()
        }
        ctx.strokeStyle = '#737981'
        ctx.lineWidth = 4
        ctx.strokeRect(x, y, 310, 154)
      }
    ctx.fillStyle = '#3b3f45'
    ctx.fillRect(0, 186, W, 28)
    ctx.fillStyle = '#aeb3b9'
    for (let x = 10; x < W; x += 22) ctx.fillRect(x, 190, 9, 20)
  })
}

/** Underside: dark phased-array antenna panels. */
function arrayTexture() {
  return canvas(1024, 400, (ctx) => {
    ctx.fillStyle = '#2a2d32'
    ctx.fillRect(0, 0, 1024, 400)
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++) {
        const x = 20 + col * 334
        const y = row ? 210 : 20
        ctx.fillStyle = '#101215'
        ctx.fillRect(x, y, 316, 170)
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        for (let k = 12; k < 316; k += 12) {
          ctx.beginPath()
          ctx.moveTo(x + k, y)
          ctx.lineTo(x + k, y + 170)
          ctx.stroke()
        }
      }
  })
}

/** Solar wing: 16 hinged panels of dark blue cells with silver frames (v runs along the wing). */
function solarTexture() {
  return canvas(256, 1024, (ctx) => {
    ctx.fillStyle = '#c3c8ce'
    ctx.fillRect(0, 0, 256, 1024)
    const seg = 1024 / 16
    for (let i = 0; i < 16; i++) {
      const y = i * seg + 3
      ctx.fillStyle = '#16233f'
      ctx.fillRect(6, y, 244, seg - 6)
      ctx.strokeStyle = 'rgba(120,150,210,0.28)'
      ctx.lineWidth = 1
      for (let x = 6; x < 250; x += 15.25) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + seg - 6)
        ctx.stroke()
      }
      for (let k = y; k < y + seg - 6; k += 14.5) {
        ctx.beginPath()
        ctx.moveTo(6, k)
        ctx.lineTo(250, k)
        ctx.stroke()
      }
    }
  })
}

/** Parabolic dish (opening +y) on a short mast. */
function dishGeometry() {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 12; i++) {
    const r = (i / 12) * DISH_R
    pts.push(new THREE.Vector2(r, 0.12 + 0.75 * r * r))
  }
  const bowl = new THREE.LatheGeometry(pts, 32)
  const mast = new THREE.CylinderGeometry(0.07, 0.11, 0.14, 12)
  mast.translate(0, 0.06, 0)
  return mergeGeometries([bowl.toNonIndexed(), mast.toNonIndexed()])!
}

/** Diamond pantograph boom from the bus edge (origin) to the wing root (+y = 1). */
function boomGeometry() {
  const bar = (a: THREE.Vector2, b: THREE.Vector2) => {
    const g = new THREE.BoxGeometry(0.06, 1, 0.06)
    const d = b.clone().sub(a)
    g.scale(1, d.length(), 1)
    g.rotateZ(-Math.atan2(d.x, d.y))
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, 0)
    return g
  }
  const w = 0.55
  const p = [new THREE.Vector2(0, 0), new THREE.Vector2(w, 0.5), new THREE.Vector2(0, 1), new THREE.Vector2(-w, 0.5)]
  return mergeGeometries([bar(p[0], p[1]), bar(p[1], p[2]), bar(p[2], p[3]), bar(p[3], p[0])])!
}

function thrusterTexture() {
  return canvas(16, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 128, 0, 0)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 16, 128)
  })
}

function useStarlinkMeshes(n: number) {
  return useMemo(() => {
    const metal = new THREE.MeshStandardMaterial({ color: '#5a5f66', metalness: 0.8, roughness: 0.4 })
    // mostly diffuse: a mirror-like deck would just reflect black space
    const deck = new THREE.MeshStandardMaterial({ map: deckTexture(), metalness: 0.3, roughness: 0.5 })
    const under = new THREE.MeshStandardMaterial({ map: arrayTexture(), metalness: 0.4, roughness: 0.55 })
    const solar = new THREE.MeshStandardMaterial({ map: solarTexture(), metalness: 0.55, roughness: 0.28, side: THREE.DoubleSide })
    const frame = new THREE.MeshStandardMaterial({ color: '#c4c9cf', metalness: 0.5, roughness: 0.4 })
    const chrome = new THREE.MeshStandardMaterial({ color: '#e1e5ea', metalness: 0.65, roughness: 0.22, side: THREE.DoubleSide })
    const stackMat = new THREE.MeshStandardMaterial({ color: '#2a3550', metalness: 0.6, roughness: 0.35 })
    const plume = new THREE.MeshBasicMaterial({ color: '#7d9bff', alphaMap: thrusterTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })

    const unitUp = (g: THREE.BufferGeometry) => g.translate(0, 0.5, 0)
    const plumeGeo = unitUp(new THREE.CylinderGeometry(0.32, 0.06, 1, 12, 1, true))
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], count: number) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count))
      m.frustumCulled = false
      m.count = count
      return m
    }
    // box face order: +x, −x, +y, −y, +z, −z
    return {
      bus: make(new THREE.BoxGeometry(BUS.x, BUS.y, BUS.z), [metal, metal, deck, under, metal, metal], n),
      stacks: make(unitUp(new THREE.BoxGeometry(STACK.x, 1, STACK.z)), stackMat, n * 2),
      wings: make(unitUp(new THREE.BoxGeometry(WING.w, 1, WING.t)), [frame, frame, frame, frame, solar, solar], n * 2),
      booms: make(boomGeometry(), frame, n * 2),
      dishes: make(dishGeometry(), chrome, n * 4),
      arms: make(unitUp(new THREE.BoxGeometry(0.09, 1, 0.09)), frame, n * 4),
      plumes: make(plumeGeo, plume, n * 2),
    }
  }, [n])
}

/**
 * Starlink V3 satellites sliding out of the PEZ slot one by one, drifting away and deploying (see PHASE).
 * Instances are positioned relative to the ship: float32 instance matrices lose precision at ECEF scale.
 */
export function StarlinkDeploy() {
  const replay = useReplay()
  const n = replay.data.mission.payload?.count ?? 0
  const start = replay.t('payload-deploy-start', 1e9)
  const end = replay.t('payload-deploy-end', start + 1800)
  const times = useMemo(() => starlinkReleaseTimes(start, end, n), [start, end, n])
  const meshes = useStarlinkMeshes(n)
  const tmp = useMemo(
    () => ({
      sat: new THREE.Matrix4(),
      part: new THREE.Matrix4(),
      out: new THREE.Matrix4(),
      o: new THREE.Object3D(),
      q: new THREE.Quaternion(),
      q2: new THREE.Quaternion(),
      nadir: new THREE.Quaternion(),
      basis: new THREE.Matrix4(),
      along: new THREE.Vector3(),
      cross: new THREE.Vector3(),
      p: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      s: new THREE.Vector3(),
      v: new THREE.Vector3(),
      right: new THREE.Vector3(),
      off: new THREE.Vector3(),
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      zero: new THREE.Matrix4().makeScale(0, 0, 0),
    }),
    [],
  )
  const group = useRef<THREE.Group>(null)
  useFrame((state) => {
    const t = useClock.getState().t
    const ship = live.ship
    group.current?.position.copy(ship.com)
    const { sat, part, out, o, q, q2, nadir, basis, along, cross, p, dir, s, v, right, off, x, y, zero } = tmp
    const set = (mesh: THREE.InstancedMesh, i: number, pos: THREE.Vector3, rot: THREE.Quaternion, scl: THREE.Vector3) => {
      part.compose(pos, rot, scl)
      mesh.setMatrixAt(i, out.multiplyMatrices(sat, part))
    }
    const hide = (mesh: THREE.InstancedMesh, i: number) => mesh.setMatrixAt(i, zero)
    right.crossVectors(ship.nose, ship.belly).normalize()
    // Earth-pointing attitude: deck up, phased arrays at nadir, long axis along track, wings cross-track
    along.copy(ship.nose).addScaledVector(ship.up, -ship.nose.dot(ship.up)).normalize()
    cross.crossVectors(along, ship.up)
    nadir.setFromRotationMatrix(basis.makeBasis(along, ship.up, cross))
    const pairs = [meshes.stacks, meshes.wings, meshes.booms, meshes.plumes]
    const quads = [meshes.dishes, meshes.arms]
    const time = state.clock.elapsedTime
    let visible = 0
    for (let i = 0; i < n; i++) {
      const age = t - times[i]
      if (age < -0.5 || !ship.visible) {
        hide(meshes.bus, i)
        for (let k = 0; k < 2; k++) for (const m of pairs) hide(m, i * 2 + k)
        for (let k = 0; k < 4; k++) for (const m of quads) hide(m, i * 4 + k)
        continue
      }
      visible++
      // slide out of the door (leeward side = −belly), then drift ~0.35 m/s with a slow tumble
      const free = Math.max(0, age - 6)
      const slide = smoothstep(-0.5, 6, age) * 5
      off
        .set(0, 0, 0)
        .addScaledVector(ship.nose, SHIP_LEN / 2 - 15.5 - (i % 3) * 0.15 - 0.06 * free * ((i % 4) - 1.5))
        .addScaledVector(ship.belly, -(4.6 + slide + free * (0.32 + (i % 5) * 0.03)))
        .addScaledVector(right, (((i * 7) % 11) - 5) * 0.004 * free + Math.sin(i) * 0.3)
      // leaves as stacked in the dispenser (long side around the hull, deck towards the nose), then turns its
      // phased arrays to the Earth before deploying, keeping a slow yaw drift
      o.position.copy(off)
      o.quaternion.copy(ship.quat).slerp(nadir, phase(PHASE.acquire, age))
      o.rotateY(free * 0.004 * ((i % 3) - 1))
      o.scale.setScalar(1)
      o.updateMatrix()
      sat.copy(o.matrix)
      meshes.bus.setMatrixAt(i, sat)

      const dish = phase(PHASE.dish, age)
      const rise = phase(PHASE.rise, age)
      const lower = phase(PHASE.lower, age)
      const thrust = phase(PHASE.thrust, age)

      for (let k = 0; k < 2; k++) {
        const side = k ? -1 : 1
        const j = i * 2 + k
        // the folded stack empties as the wing pulls panels out of it
        if (rise < 1) set(meshes.stacks, j, p.set(0, DECK, side * STACK.z0), q.identity(), s.set(1, STACK.y * (1 - rise) + 0.004, 1))
        else hide(meshes.stacks, j)
        if (rise > 0) {
          // stands up from its stack, then hinges outwards onto the boom, ending flat in the deck plane
          const root = p.set(0, DECK + STACK.y * (1 - rise), side * (STACK.z0 + lower * (BUS.z / 2 - STACK.z0 + BOOM)))
          q.setFromAxisAngle(x, (side * lower * Math.PI) / 2)
          set(meshes.wings, j, root, q, s.set(1, Math.max(STACK.y, rise * WING.len), 1))
        } else hide(meshes.wings, j)
        if (lower > 0) set(meshes.booms, j, p.set(0, DECK, (side * BUS.z) / 2), q.setFromAxisAngle(x, (side * Math.PI) / 2), s.set(1, lower * BOOM, 1))
        else hide(meshes.booms, j)
        const th = THRUSTERS[k]
        if (thrust > 0) {
          const flicker = 0.9 + 0.1 * Math.sin(time * 31 + i * 3 + k)
          q.setFromUnitVectors(y, v.set(th.dir, 0, 0))
          set(meshes.plumes, j, p.set(th.x, 0, th.z), q, s.set(thrust, thrust * 3.2 * flicker, thrust))
        } else hide(meshes.plumes, j)
      }

      // dishes: bowl up on the deck → swung over the long edge on their arms, hanging below it facing down
      DISH_CORNERS.forEach(([cx, cz], k) => {
        const j = i * 4 + k
        const pivot = p.set(cx * (BUS.x / 2 - 0.75), DECK, (cz * BUS.z) / 2)
        q.setFromAxisAngle(x, cz * dish * Math.PI)
        dir.set(0, 0.3, -cz * 0.9).normalize().applyQuaternion(q)
        set(meshes.dishes, j, off.copy(pivot).addScaledVector(dir, DISH_ARM), q, s.set(1, 1, 1))
        set(meshes.arms, j, pivot, q2.setFromUnitVectors(y, dir), s.set(1, DISH_ARM, 1))
      })
    }
    for (const m of Object.values(meshes)) {
      m.instanceMatrix.needsUpdate = true
      m.visible = visible > 0
    }
  })
  if (!n) return null
  return (
    <group ref={group}>
      {Object.entries(meshes).map(([k, m]) => (
        <primitive key={k} object={m} />
      ))}
    </group>
  )
}
