import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useSettings, type CameraMode } from '../../lib/settings'
import { useClock } from '../../sim/clock'
import { R_EARTH } from '../../sim/coords'
import { clamp } from '../../sim/interpolate'
import { BOOSTER_LEN, SHIP_LEN, useReplay, type Replay } from '../../sim/replay'
import { live } from '../live'
import { OLP2 } from '../Starbase/Starbase'
import { geoToEcef, enuBasis } from '../../sim/coords'

type Shot = { mode: Exclude<CameraMode, 'director'>; az?: number; el?: number; dist?: number; fixed?: [number, number, number] }

/** The auto-director: picks a cinematic shot for each phase of flight. */
export function directorShot(r: Replay, t: number): Shot {
  const T = (id: string, f = 0) => r.t(id, f)
  const stage = r.tStage
  if (t < -25) return { mode: 'tower', fixed: [-120, 40, 260] }
  if (t < 4) return { mode: 'tower', fixed: [70, 8, 140] }
  if (t < 25) return { mode: 'tower', fixed: [-30, 4, 380] }
  if (t < 70) return { mode: 'ground' }
  if (t < stage - 8) return { mode: 'chase-booster', az: 0.5, el: 0.1, dist: 260 }
  if (t < stage + 12) return { mode: 'chase-booster', az: 1.45, el: 0.08, dist: 330 }
  if (t < T('boostback-end') + 5) return { mode: 'chase-booster', az: 2.6, el: 0.25, dist: 260 }
  if (t < T('booster-landing-burn-start') - 45) return { mode: 'chase-ship', az: 0.35, el: 0.18, dist: 160 }
  if (t < T('booster-fts', T('booster-splashdown') + 7) + 6) return { mode: 'chase-booster', az: 0.8, el: 0.05, dist: 220 }
  if (t < T('seco') + 30) return { mode: 'onboard-ship' }
  if (t < T('oib-start') - 20) return { mode: 'orbital', az: 2.4, el: 0.35, dist: 420 }
  if (t < T('oib-end') + 20) return { mode: 'chase-ship', az: 0.25, el: 0.1, dist: 150 }
  if (t < T('payload-deploy-start') - 30) return { mode: 'globe' }
  if (t < T('payload-deploy-end') + 60) return { mode: 'chase-ship', az: -1.9, el: 0.25, dist: 150 }
  if (t < T('deorbit-start') - 200) return { mode: 'orbital', az: 0.9, el: 0.45, dist: 900 }
  if (t < T('deorbit-end') + 60) return { mode: 'chase-ship', az: 0.4, el: 0.12, dist: 140 }
  if (t < T('ship-entry') - 300) return { mode: 'globe' }
  if (t < T('ship-subsonic')) return { mode: 'chase-ship', az: 3.0, el: -0.25, dist: 190 }
  if (t < T('ship-landing-flip') - 25) return { mode: 'chase-ship', az: 1.4, el: 0.1, dist: 170 }
  return { mode: 'chase-ship', az: 1.75, el: 0.02, dist: 230 }
}

const DEFAULTS: Record<string, { az: number; el: number; dist: number }> = {
  'chase-ship': { az: 0.4, el: 0.15, dist: 170 },
  'chase-booster': { az: 0.4, el: 0.15, dist: 220 },
  orbital: { az: 0.7, el: 0.4, dist: 700 },
  free: { az: 0.6, el: 0.25, dist: 420 },
}

/** Rig state mutated by input handlers; read every frame. */
const rig = {
  az: 0.4,
  el: 0.15,
  dist: 200,
  userAz: 0,
  userEl: 0,
  userZoom: 1,
  lastInput: -1e9,
  freeTarget: new THREE.Vector3(),
  freeInit: false,
}

export function CameraRig() {
  const replay = useReplay()
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const mode = useSettings((s) => s.camera)
  const lastMode = useRef<string>('')
  const v = useMemo(
    () => ({
      target: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      up: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      right: new THREE.Vector3(),
      tmp: new THREE.Vector3(),
      look: new THREE.Vector3(),
      padOrigin: new THREE.Vector3(...geoToEcef(OLP2.lat, OLP2.lon, 0)),
      padBasis: enuBasis(OLP2.lat, OLP2.lon),
    }),
    [],
  )

  // ── input ──
  useEffect(() => {
    const el = gl.domElement
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch = 0
    let button = 0
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      button = e.button
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      rig.lastInput = performance.now()
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) rig.userZoom = clamp(rig.userZoom * (pinch / d), 0.02, 400)
        pinch = d
        return
      }
      const s = useSettings.getState()
      if (s.camera === 'free' && (button === 2 || e.shiftKey)) {
        // pan the free target in the local horizontal plane
        const up = v.tmp.copy(rig.freeTarget).normalize()
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
        const fwd = new THREE.Vector3().crossVectors(up, right)
        const k = rig.dist * rig.userZoom * 0.0015
        rig.freeTarget.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k)
        return
      }
      rig.userAz -= dx * 0.005
      rig.userEl = clamp(rig.userEl + dy * 0.004, -1.4, 1.4)
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      pinch = 0
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      rig.lastInput = performance.now()
      rig.userZoom = clamp(rig.userZoom * Math.exp(e.deltaY * 0.0012), 0.02, 400)
    }
    const ctx = (e: Event) => e.preventDefault()
    const keys = new Set<string>()
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      keys.add(e.key.toLowerCase())
    }
    const ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
    let raf = 0
    const tick = () => {
      if (useSettings.getState().camera === 'free' && keys.size) {
        const upv = v.tmp.copy(rig.freeTarget).normalize()
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
        const fwd = new THREE.Vector3().crossVectors(upv, right)
        const k = Math.max(2, rig.dist * rig.userZoom * 0.01)
        if (keys.has('w')) rig.freeTarget.addScaledVector(fwd, k)
        if (keys.has('s')) rig.freeTarget.addScaledVector(fwd, -k)
        if (keys.has('a')) rig.freeTarget.addScaledVector(right, -k)
        if (keys.has('d')) rig.freeTarget.addScaledVector(right, k)
        if (keys.has('e')) rig.freeTarget.addScaledVector(upv, k)
        if (keys.has('q')) rig.freeTarget.addScaledVector(upv, -k)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', ctx)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('contextmenu', ctx)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [gl, camera, v])

  useFrame(() => {
    const t = useClock.getState().t
    let shot: Shot
    if (mode === 'director') shot = directorShot(replay, t)
    else shot = { mode, ...DEFAULTS[mode] }

    const key = mode === 'director' ? `d:${shot.mode}:${shot.az}:${shot.fixed?.join()}` : mode
    if (key !== lastMode.current) {
      lastMode.current = key
      // reset user offsets on a cut (keep zoom when switching manual modes)
      rig.userAz = 0
      rig.userEl = 0
      if (mode === 'director') rig.userZoom = 1
    }
    if (shot.mode === 'free' && !rig.freeInit && live.ship.com.lengthSq() > 1) {
      rig.freeTarget.copy(live.ship.com)
      rig.freeInit = true
    }

    let fov = 50
    const vehicleOf = (m: string) => (m.includes('booster') ? live.booster : live.ship)
    switch (shot.mode) {
      case 'chase-ship':
      case 'chase-booster':
      case 'orbital':
      case 'free': {
        const L = shot.mode === 'free' ? null : vehicleOf(shot.mode)
        if (L) v.target.copy(L.com)
        else v.target.copy(rig.freeTarget)
        v.up.copy(v.target).normalize()
        // horizontal reference: velocity heading (falls back to local north)
        const vel = L ? L.velocity : v.tmp.set(0, 0, 0)
        v.fwd.copy(vel).addScaledVector(v.up, -vel.dot(v.up))
        if (v.fwd.lengthSq() < 25) v.fwd.set(0, 1, 0).addScaledVector(v.up, -v.up.y)
        v.fwd.normalize()
        v.right.crossVectors(v.fwd, v.up).normalize()
        const az = (shot.az ?? 0.4) + rig.userAz
        const el = clamp((shot.el ?? 0.15) + rig.userEl, -1.45, 1.45)
        const dist = (shot.dist ?? 200) * rig.userZoom
        v.pos
          .copy(v.target)
          .addScaledVector(v.fwd, -Math.cos(el) * Math.cos(az) * dist)
          .addScaledVector(v.right, Math.cos(el) * Math.sin(az) * dist)
          .addScaledVector(v.up, Math.sin(el) * dist)
        v.look.copy(v.target)
        // keep the camera above ground/sea
        const minR = R_EARTH + 2
        if (v.pos.length() < minR) v.pos.setLength(minR)
        break
      }
      case 'tower':
      case 'ground': {
        const local = shot.fixed ?? (shot.mode === 'ground' ? ([1800, 3, -5200] as [number, number, number]) : ([-16, 62, 22] as [number, number, number]))
        const { e, n, u } = v.padBasis
        v.pos
          .copy(v.padOrigin)
          .addScaledVector(v.tmp.set(e[0], e[1], e[2]), local[0])
          .addScaledVector(v.tmp.set(u[0], u[1], u[2]), local[1])
          .addScaledVector(v.tmp.set(-n[0], -n[1], -n[2]), local[2])
        v.up.copy(v.pos).normalize()
        // look at the active vehicle (stack until staging, then whichever is lower/closer)
        const tgt = t < replay.tStage ? live.booster : live.booster.visible && live.booster.alt < 60000 ? live.booster : live.ship
        // look a bit above the CoM during the stack phase so the full vehicle is framed
        v.look.copy(tgt.com).addScaledVector(tgt.nose, t < replay.tStage ? BOOSTER_LEN * 0.25 : 0)
        const d = v.pos.distanceTo(v.look)
        const frame = shot.mode === 'ground' ? 260 : 240
        fov = clamp((2 * Math.atan((frame * Math.max(1, 1 + (d - 3000) / 30000)) / 2 / d) * 180) / Math.PI, 0.25, 70) / rig.userZoom
        fov = clamp(fov, 0.2, 90)
        // user drag pans the view direction slightly
        v.look.addScaledVector(v.tmp.crossVectors(v.up, v.look.clone().sub(v.pos).normalize()).normalize(), -rig.userAz * d * 0.3)
        v.look.addScaledVector(v.up, rig.userEl * d * 0.3)
        break
      }
      case 'onboard-ship': {
        const s = live.ship
        v.pos.copy(s.com).addScaledVector(s.nose, -SHIP_LEN / 2 + 9).addScaledVector(s.belly, -5.6)
        v.look.copy(v.pos).addScaledVector(s.nose, -40).addScaledVector(s.belly, 6)
        v.up.copy(s.belly).negate()
        fov = 70
        v.look.addScaledVector(v.tmp.crossVectors(s.nose, s.belly), rig.userAz * 30).addScaledVector(s.belly, -rig.userEl * 30)
        break
      }
      case 'onboard-booster': {
        const b = live.booster
        const right = v.tmp.crossVectors(b.nose, b.belly).normalize()
        v.pos.copy(b.com).addScaledVector(b.nose, BOOSTER_LEN / 2 - 9).addScaledVector(b.belly, -5.4)
        v.look.copy(v.pos).addScaledVector(b.nose, -60).addScaledVector(b.belly, 4).addScaledVector(right, rig.userAz * 40)
        v.up.copy(b.belly).negate()
        fov = 75
        break
      }
      case 'globe': {
        const s = live.ship
        const dist = 21_000_000 * rig.userZoom
        v.up.set(0, 1, 0)
        const dir = v.tmp.copy(s.com).normalize()
        // tilt by user drag
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rig.userAz)
        dir.applyQuaternion(q)
        dir.y = clamp(dir.y + rig.userEl, -0.95, 0.95)
        dir.normalize()
        v.pos.copy(dir).multiplyScalar(R_EARTH + dist)
        v.look.set(0, 0, 0).lerp(s.com, 0.35)
        fov = 40
        break
      }
    }
    camera.position.copy(v.pos)
    live.camera.copy(v.pos)
    camera.up.copy(v.up)
    camera.lookAt(v.look)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    const near = clamp(camera.position.distanceTo(v.look) * 0.004, 0.2, 2000)
    if (Math.abs(camera.near - near) / near > 0.2) {
      camera.near = near
      camera.updateProjectionMatrix()
    }
  }, -1)
  return null
}

