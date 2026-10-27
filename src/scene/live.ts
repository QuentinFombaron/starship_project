import * as THREE from 'three'

/** Per-frame vehicle state shared between actors, camera rig and effects (mutable, no React). */
export interface LiveVehicle {
  com: THREE.Vector3
  quat: THREE.Quaternion
  nose: THREE.Vector3
  belly: THREE.Vector3
  up: THREE.Vector3
  velocity: THREE.Vector3
  alt: number
  speed: number
  visible: boolean
}

const mk = (): LiveVehicle => ({
  com: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  nose: new THREE.Vector3(0, 1, 0),
  belly: new THREE.Vector3(0, 0, 1),
  up: new THREE.Vector3(0, 1, 0),
  velocity: new THREE.Vector3(),
  alt: 0,
  speed: 0,
  visible: true,
})

export const live = {
  booster: mk(),
  ship: mk(),
  sunDir: new THREE.Vector3(1, 0, 0),
  camera: new THREE.Vector3(),
  t: 0,
}
