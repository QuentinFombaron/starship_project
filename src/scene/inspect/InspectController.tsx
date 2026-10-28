import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { R_EARTH } from '../../sim/coords'
import { useInspect } from './data'

/**
 * Objects tagged with userData.inspect (pad hardware, vehicle hit proxies) are hover targets; userData.pick
 * marks surfaces the free camera can focus on (ground, sea). Only these are raycast, never the GLB meshes,
 * particles or the sky.
 */
const targets: { inspect: THREE.Object3D[]; pick: THREE.Object3D[]; scene: THREE.Object3D | null; frame: number } = { inspect: [], pick: [], scene: null, frame: -1e9 }
const raycaster = new THREE.Raycaster()

function refresh(scene: THREE.Object3D, frame: number) {
  if (targets.scene === scene && frame - targets.frame < 90) return
  targets.scene = scene
  targets.frame = frame
  targets.inspect = []
  targets.pick = []
  scene.traverse((o) => {
    if (o.userData.inspect) targets.inspect.push(o)
    if (o.userData.pick) targets.pick.push(o)
  })
}

const inspectIdOf = (o: THREE.Object3D | null) => {
  let id: string | null = null
  for (; o; o = o.parent) {
    if (!o.visible) return null // e.g. a vehicle after it has splashed down
    id ??= (o.userData.inspect as string | undefined) ?? null
  }
  return id
}

/** Nearest inspectable under the pointer, with the hit point. */
function hitInspect(ndc: THREE.Vector2, camera: THREE.Camera) {
  raycaster.setFromCamera(ndc, camera)
  for (const h of raycaster.intersectObjects(targets.inspect, true)) {
    const id = inspectIdOf(h.object)
    if (id) return { id, point: h.point }
  }
  return null
}

/** World point under the pointer: inspectables, then ground/sea, then the sea-level sphere. */
export function pick(ndc: THREE.Vector2, camera: THREE.Camera, scene: THREE.Object3D) {
  refresh(scene, Infinity)
  const a = hitInspect(ndc, camera)
  raycaster.setFromCamera(ndc, camera)
  const b = raycaster.intersectObjects(targets.pick, true)[0]
  const best = a && (!b || a.point.distanceTo(camera.position) <= b.distance) ? a : b ? { id: null, point: b.point } : null
  if (best) return best
  const p = raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), R_EARTH), new THREE.Vector3())
  return p ? { id: null, point: p } : null
}

export function InspectController() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const st = useMemo(() => ({ ndc: new THREE.Vector2(), x: 0, y: 0, inside: false, dragging: false, down: null as null | { x: number; y: number; t: number }, frame: 0 }), [])
  useEffect(() => {
    const el = gl.domElement
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      st.x = e.clientX
      st.y = e.clientY
      st.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      st.inside = true
      if (st.down && Math.hypot(e.clientX - st.down.x, e.clientY - st.down.y) > 4) st.dragging = true
    }
    const down = (e: PointerEvent) => {
      st.down = { x: e.clientX, y: e.clientY, t: performance.now() }
      st.dragging = false
    }
    const up = (e: PointerEvent) => {
      const d = st.down
      st.down = null
      if (!d || st.dragging || e.button !== 0 || performance.now() - d.t > 400) return
      // click: pin what's under the pointer, or unpin when clicking empty space
      const s = useInspect.getState()
      s.set({ pinned: s.hover && s.hover !== s.pinned ? s.hover : null })
    }
    const leave = () => {
      st.inside = false
      useInspect.getState().set({ hover: null })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointerleave', leave)
      useInspect.getState().set({ hover: null, pinned: null })
    }
  }, [gl, st])

  useFrame(() => {
    st.frame++
    // things move under a still pointer, so re-test a few times a second even without pointer motion
    if (!st.inside || st.dragging || st.frame % 4) return
    refresh(scene, st.frame)
    const hit = hitInspect(st.ndc, camera)
    const id = hit?.id ?? null
    const s = useInspect.getState()
    if (id !== s.hover || (id && (Math.abs(s.x - st.x) > 1 || Math.abs(s.y - st.y) > 1))) s.set({ hover: id, x: st.x, y: st.y })
    gl.domElement.style.cursor = id ? 'pointer' : ''
  })
  return null
}
