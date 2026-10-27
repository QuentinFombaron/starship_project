import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { useSettings } from '../../lib/settings'
import { useClock } from '../../sim/clock'
import { geoToEcef } from '../../sim/coords'
import { useReplay } from '../../sim/replay'

const SHIP_COLOR = '#5aa0ff'
const BOOSTER_COLOR = '#ff7a3d'

function makeLine(points: number[], color: string, opacity: number, dashed = false) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  const m = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 60_000, gapSize: 40_000, depthWrite: false })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  const l = new THREE.Line(g, m)
  if (dashed) l.computeLineDistances()
  l.frustumCulled = false
  return l
}

/** Flown path (grows with mission time) plus optional planned ground path. */
export function Trajectories() {
  const replay = useReplay()
  const show = useSettings((s) => s.trajectories)
  const planned = useSettings((s) => s.plannedTrack)
  const STEP = 2
  const lines = useMemo(() => {
    const ship = makeLine(replay.ship.polyline(0, replay.ship.tEnd, STEP), SHIP_COLOR, 0.85)
    const booster = makeLine(replay.booster.polyline(0, replay.booster.tEnd, 1), BOOSTER_COLOR, 0.9)
    const pts: number[] = []
    for (const [lat, lon] of replay.data.telemetry.plannedShipGroundTrack ?? []) {
      const p = geoToEcef(lat, lon, 270_000)
      pts.push(p[0], p[1], p[2])
    }
    const plan = makeLine(pts, '#ffffff', 0.35, true)
    return { ship, booster, plan }
  }, [replay])
  useFrame(() => {
    const t = Math.max(0, useClock.getState().t)
    lines.ship.geometry.setDrawRange(0, Math.max(0, Math.floor(t / STEP)))
    lines.booster.geometry.setDrawRange(0, Math.max(0, Math.floor(t)))
    lines.ship.visible = lines.booster.visible = show
    lines.plan.visible = planned
  })
  return (
    <>
      <primitive object={lines.ship} />
      <primitive object={lines.booster} />
      <primitive object={lines.plan} />
    </>
  )
}
