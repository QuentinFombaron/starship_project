import { useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as THREE from 'three'

const exists = new Map<string, Promise<boolean>>()
function probe(url: string) {
  if (!exists.has(url))
    exists.set(
      url,
      fetch(url, { method: 'HEAD' })
        .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'))
        .catch(() => false),
    )
  return exists.get(url)!
}

function GlbModel({ url, length }: { url: string; length: number }) {
  const { scene } = useGLTF(url)
  const obj = useMemo(() => {
    const root = scene.clone(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const k = length / Math.max(size.x, size.y, size.z)
    // centre vertically only: the bounding box is lopsided (grid fins, flaps), so models are expected to have
    // their body axis on x = z = 0 already, which keeps a booster and ship from the same source coaxial
    root.position.set(0, -center.y * k, 0)
    root.scale.setScalar(k)
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true
    })
    return root
  }, [scene, length])
  return <primitive object={obj} />
}

/**
 * Drop-in slot for purchased/community models: if `/public/models/<name>.glb` exists it replaces the
 * procedural model. The model is scaled so its full height, engine bells included, equals `length`, and is
 * centred vertically, so its base sits at -length/2 and its top at +length/2. It must be Y up with its body
 * axis on x = z = 0. Otherwise children render. `onModel` reports whether the GLB is in use.
 */
export function GlbOverride({ url, length, children, onModel }: { url: string; length: number; children: ReactNode; onModel?: (glb: boolean) => void }) {
  const [has, setHas] = useState(false)
  useEffect(() => {
    let alive = true
    probe(url).then((ok) => alive && setHas(ok))
    return () => {
      alive = false
    }
  }, [url])
  useEffect(() => {
    onModel?.(has)
  }, [has, onModel])
  if (!has) return <>{children}</>
  return (
    <Suspense fallback={children}>
      <GlbModel url={url} length={length} />
    </Suspense>
  )
}
