import * as THREE from 'three'
import type { Vec3 } from '../sim/coords'

const m = new THREE.Matrix4()
const vx = new THREE.Vector3()
const vy = new THREE.Vector3()
const vz = new THREE.Vector3()

/** Quaternion whose local axes are X = right, Y = nose (up the body), Z = belly. */
export function quatFromBasis(right: Vec3, nose: Vec3, belly: Vec3, out = new THREE.Quaternion()) {
  vx.set(right[0], right[1], right[2])
  vy.set(nose[0], nose[1], nose[2])
  vz.set(belly[0], belly[1], belly[2])
  m.makeBasis(vx, vy, vz)
  return out.setFromRotationMatrix(m)
}

/** Quaternion for a local ENU frame: X = east, Y = up, Z = -north (three.js convention: -Z forward = north). */
export function quatFromEnu(e: Vec3, n: Vec3, u: Vec3, out = new THREE.Quaternion()) {
  vx.set(e[0], e[1], e[2])
  vy.set(u[0], u[1], u[2])
  vz.set(-n[0], -n[1], -n[2])
  m.makeBasis(vx, vy, vz)
  return out.setFromRotationMatrix(m)
}

export const toV3 = (p: Vec3, out = new THREE.Vector3()) => out.set(p[0], p[1], p[2])
