import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useClock } from '../../sim/clock'
import { smoothstep } from '../../sim/interpolate'
import { SHIP_LEN, useReplay } from '../../sim/replay'
import { live } from '../live'

/** Release time of satellite i (0-based) — evenly spaced across the deploy window. */
export function starlinkReleaseTimes(start: number, end: number, n: number) {
  return Array.from({ length: n }, (_, i) => start + ((i + 0.5) * (end - start)) / n)
}

/** Starlink V3 satellites sliding out of the PEZ door and drifting away, arrays unfolding. */
export function StarlinkDeploy() {
  const replay = useReplay()
  const n = replay.data.mission.payload?.count ?? 0
  const start = replay.t('payload-deploy-start', 1e9)
  const end = replay.t('payload-deploy-end', start + 1800)
  const times = useMemo(() => starlinkReleaseTimes(start, end, n), [start, end, n])
  const { bodies, panels } = useMemo(() => {
    const bodyGeo = new THREE.BoxGeometry(6.6, 0.45, 2.6)
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#8c8f95', metalness: 0.7, roughness: 0.35 })
    const panelGeo = new THREE.BoxGeometry(1, 0.06, 2.5)
    panelGeo.translate(0.5, 0, 0)
    const panelMat = new THREE.MeshStandardMaterial({ color: '#1b2440', metalness: 0.5, roughness: 0.3, emissive: '#05070d' })
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, Math.max(1, n))
    const panels = new THREE.InstancedMesh(panelGeo, panelMat, Math.max(1, n * 2))
    bodies.frustumCulled = panels.frustumCulled = false
    return { bodies, panels }
  }, [n])
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), right: new THREE.Vector3(), off: new THREE.Vector3(), q: new THREE.Quaternion() }), [])
  // instances are positioned relative to the ship (float32 instance matrices lose precision at ECEF scale)
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const t = useClock.getState().t
    const s = live.ship
    group.current?.position.copy(s.com)
    const { o, right, off } = tmp
    right.crossVectors(s.nose, s.belly).normalize()
    let visible = 0
    for (let i = 0; i < n; i++) {
      const age = t - times[i]
      if (age < -0.5 || !s.visible) {
        o.scale.setScalar(0)
      } else {
        // slide out of the door (leeward side = -belly), then drift ~0.35 m/s with slow tumble
        const slide = smoothstep(-0.5, 6, age) * 5
        const drift = Math.max(0, age - 6) * (0.32 + (i % 5) * 0.03)
        off
          .set(0, 0, 0)
          .addScaledVector(s.nose, SHIP_LEN / 2 - 15.5 - (i % 3) * 0.15)
          .addScaledVector(s.belly, -(4.6 + slide + drift))
          .addScaledVector(right, (((i * 7) % 11) - 5) * 0.004 * Math.max(0, age - 6) + Math.sin(i) * 0.3)
          .addScaledVector(s.nose, -0.06 * Math.max(0, age - 6) * ((i % 4) - 1.5))
        o.position.copy(off)
        // flat slabs, long side around the hull, leaving through the horizontal dispenser slot
        o.quaternion.copy(s.quat)
        o.rotateY(Math.max(0, age - 6) * 0.01 * ((i % 3) - 1))
        o.scale.setScalar(1)
        visible++
      }
      o.updateMatrix()
      bodies.setMatrixAt(i, o.matrix)
      const unfold = smoothstep(40, 110, age)
      for (const side of [0, 1]) {
        const po = new THREE.Object3D()
        po.position.copy(o.position)
        po.quaternion.copy(o.quaternion)
        if (side) po.rotateY(Math.PI)
        po.translateX(3.3)
        po.scale.set(age < 0 ? 0 : 0.01 + unfold * 11, age < 0 ? 0 : 1, age < 0 ? 0 : 1)
        po.updateMatrix()
        panels.setMatrixAt(i * 2 + side, po.matrix)
      }
    }
    bodies.instanceMatrix.needsUpdate = true
    panels.instanceMatrix.needsUpdate = true
    bodies.visible = panels.visible = visible > 0
  })
  if (!n) return null
  return (
    <group ref={group}>
      <primitive object={bodies} />
      <primitive object={panels} />
    </group>
  )
}
