import { Environment, Lightformer } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { QUALITY, useSettings } from '../lib/settings'
import { useClock } from '../sim/clock'
import { R_EARTH, sunDirectionEcef } from '../sim/coords'
import { clamp, smoothstep } from '../sim/interpolate'
import { useReplay, ReplayContext, type Replay } from '../sim/replay'
import { CameraRig } from './cameras/CameraRig'
import { InspectController } from './inspect/InspectController'
import { Earth } from './Earth/Earth'
import { Clouds } from './Earth/Clouds'
import { Sky } from './Earth/Sky'
import { Effects } from './effects/Effects'
import { Trajectories } from './effects/Trajectories'
import { StarlinkDeploy } from './effects/Starlink'
import { live } from './live'
import { OLP2, PadFrame, StarbaseSite } from './Starbase/Starbase'
import { SurfaceCap } from './Starbase/Surface'
import { BoosterActor, ShipActor } from './vehicles/Actors'

function SunAndLights({ sunDir }: { sunDir: React.RefObject<THREE.Vector3> }) {
  const replay = useReplay()
  const light = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const shadows = QUALITY[useSettings((s) => s.quality)].shadows
  const date = useMemo(() => new Date(), [])
  useFrame(() => {
    const t = useClock.getState().t
    date.setTime(replay.launchDate.getTime() + t * 1000)
    const d = sunDirectionEcef(date)
    sunDir.current.set(d[0], d[1], d[2])
    live.sunDir.copy(sunDir.current)
    const l = light.current
    if (!l) return
    // centre the shadow frustum on whatever the camera looks at near the camera
    const focus = live.ship.com.distanceTo(camera.position) < live.booster.com.distanceTo(camera.position) ? live.ship.com : live.booster.com
    l.target.position.copy(focus)
    l.position.copy(focus).addScaledVector(sunDir.current, 3000)
    l.target.updateMatrixWorld()
    // dim the light when the sun is below the local horizon
    const up = camera.position.clone().normalize()
    const elev = up.dot(sunDir.current)
    const alt = camera.position.length() - R_EARTH
    const horizonDip = -Math.sqrt(Math.max(0, 2 * alt / R_EARTH))
    l.intensity = 3.2 * smoothstep(horizonDip - 0.04, horizonDip + 0.06, elev)
    if (hemi.current) {
      const air = 1 - smoothstep(20_000, 100_000, alt)
      hemi.current.intensity = (0.15 + 0.55 * air) * smoothstep(-0.1, 0.15, elev) + 0.06
      hemi.current.position.copy(up)
    }
    scene.environmentIntensity = 0.25 + 0.75 * clamp(smoothstep(-0.12, 0.2, elev) * (1 - smoothstep(30_000, 120_000, alt)) + 0.15)
  })
  return (
    <>
      <directionalLight
        ref={light}
        intensity={3}
        color="#fff6ea"
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-220}
        shadow-camera-right={220}
        shadow-camera-top={220}
        shadow-camera-bottom={-220}
        shadow-camera-near={100}
        shadow-camera-far={6000}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
      <hemisphereLight ref={hemi} args={['#bcd6ff', '#6d5c46', 0.5]} />
    </>
  )
}

function SceneEnvironment() {
  // Simple procedural environment for reflections on stainless steel: blue sky, warm ground, sun streak.
  return (
    <Environment resolution={128} frames={1}>
      <mesh scale={100}>
        <sphereGeometry args={[1, 32, 16]} />
        <meshBasicMaterial side={THREE.BackSide} color="#4b6c96" />
      </mesh>
      <mesh position={[0, -40, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={300}>
        <planeGeometry />
        <meshBasicMaterial color="#5d5042" side={THREE.DoubleSide} />
      </mesh>
      <Lightformer form="rect" intensity={6} color="#fff3e0" position={[30, 40, 20]} scale={[30, 10, 1]} target={[0, 0, 0]} />
      <Lightformer form="ring" intensity={2} color="#cfe2ff" position={[-30, 20, -30]} scale={18} target={[0, 0, 0]} />
    </Environment>
  )
}

function PostFX() {
  const quality = useSettings((s) => s.quality)
  const q = QUALITY[quality]
  if (!q.bloom) return null
  return (
    <EffectComposer multisampling={q.msaa} enableNormalPass={false}>
      <Bloom intensity={0.9} luminanceThreshold={0.82} luminanceSmoothing={0.2} mipmapBlur radius={0.7} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <SMAA />
    </EffectComposer>
  )
}

/** Open ocean around the ship's splashdown point, far from Starbase. */
function SplashdownSea() {
  const replay = useReplay()
  const tel = replay.data.telemetry.ship
  const origin = useMemo(() => ({ lat: tel.lat.at(-1)!, lon: tel.lon.at(-1)! }), [tel])
  return <SurfaceCap origin={origin} radius={40_000} />
}

export function ReplayScene({ replay, children }: { replay: Replay; children?: React.ReactNode }) {
  const quality = useSettings((s) => s.quality)
  const q = QUALITY[quality]
  const sunDir = useRef(new THREE.Vector3(1, 0, 0))
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, q.dpr]}
      shadows={q.shadows ? 'soft' : false}
      gl={{ logarithmicDepthBuffer: true, antialias: !q.bloom, powerPreference: 'high-performance' }}
      camera={{ fov: 50, near: 0.5, far: 2e9, position: [R_EARTH, 0, 0] }}
      onCreated={(state) => {
        state.gl.toneMapping = q.bloom ? THREE.NoToneMapping : THREE.AgXToneMapping
        if (import.meta.env.DEV) Object.assign(window, { __r3f: state })
      }}
    >
      <ReplayContext.Provider value={replay}>
        <Suspense fallback={null}>
          <SceneEnvironment />
          <SunAndLights sunDir={sunDir} />
          <Sky sunDir={sunDir} />
          <Earth sunDir={sunDir} />
          <SurfaceCap origin={OLP2} withTerrain />
          <SplashdownSea />
          <PadFrame>
            <StarbaseSite />
          </PadFrame>
          <Clouds />
          <BoosterActor />
          <ShipActor />
          <StarlinkDeploy />
          <Trajectories />
          <Effects />
          {children}
        </Suspense>
        <CameraRig />
        <InspectController />
        <PostFX />
      </ReplayContext.Provider>
    </Canvas>
  )
}
