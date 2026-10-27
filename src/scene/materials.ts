import * as THREE from 'three'

const memo = new Map<string, unknown>()
function once<T>(key: string, make: () => T): T {
  if (!memo.has(key)) memo.set(key, make())
  return memo.get(key) as T
}

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

/** Brushed/welded stainless steel rings: subtle horizontal banding every ~1.8 m. */
export const steelTexture = () =>
  once('steel', () =>
    canvasTex(64, 512, (ctx) => {
      ctx.fillStyle = '#c9cbcf'
      ctx.fillRect(0, 0, 64, 512)
      for (let y = 0; y < 512; y += 1) {
        const v = 196 + Math.floor(Math.random() * 18)
        ctx.fillStyle = `rgb(${v},${v + 1},${v + 4})`
        ctx.fillRect(0, y, 64, 1)
      }
      ctx.fillStyle = 'rgba(80,80,85,0.55)'
      for (let y = 0; y < 512; y += 32) ctx.fillRect(0, y, 64, 1.5)
      // vertical weld seams
      ctx.fillStyle = 'rgba(90,90,95,0.35)'
      ctx.fillRect(31, 0, 1, 512)
    }),
  )

export const steelMaterial = () =>
  once(
    'steelMat',
    () =>
      new THREE.MeshStandardMaterial({
        color: '#e6e8ec',
        map: steelTexture(),
        metalness: 0.9,
        roughness: 0.4,
        envMapIntensity: 1.1,
      }),
  )

export const darkSteelMaterial = () => once('darkSteel', () => new THREE.MeshStandardMaterial({ color: '#3a3b3e', metalness: 0.8, roughness: 0.45 }))
export const sootMaterial = () => once('soot', () => new THREE.MeshStandardMaterial({ color: '#77736c', metalness: 0.6, roughness: 0.6, map: steelTexture() }))

/** Hexagonal heat-shield tiles. */
export const tileTexture = () =>
  once('tiles', () =>
    canvasTex(512, 512, (ctx) => {
      ctx.fillStyle = '#060606'
      ctx.fillRect(0, 0, 512, 512)
      const r = 9
      const w = Math.sqrt(3) * r
      for (let row = -1; row < 512 / (1.5 * r) + 1; row++) {
        for (let col = -1; col < 512 / w + 1; col++) {
          const cx = col * w + (row % 2 ? w / 2 : 0)
          const cy = row * 1.5 * r
          const l = 14 + Math.floor(Math.random() * 10) + (Math.random() < 0.015 ? 55 : 0)
          ctx.fillStyle = `rgb(${l},${l},${l + 1})`
          ctx.beginPath()
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k + Math.PI / 6
            ctx.lineTo(cx + Math.cos(a) * (r - 0.9), cy + Math.sin(a) * (r - 0.9))
          }
          ctx.closePath()
          ctx.fill()
        }
      }
    }),
  )

export const tileMaterial = () =>
  once('tileMat', () => {
    const map = tileTexture().clone()
    map.repeat.set(10, 18)
    map.needsUpdate = true
    return new THREE.MeshStandardMaterial({ color: '#ffffff', map, metalness: 0.05, roughness: 0.85 })
  })

/** X-braced lattice for launch towers (alpha-tested). */
export const latticeTexture = () =>
  once('lattice', () =>
    canvasTex(128, 128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 9
      ctx.strokeRect(0, 0, 128, 128)
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(128, 128)
      ctx.moveTo(128, 0)
      ctx.lineTo(0, 128)
      ctx.stroke()
    }),
  )

export const towerMaterial = () =>
  once('towerMat', () => {
    const t = latticeTexture().clone()
    t.repeat.set(2, 24)
    t.needsUpdate = true
    return new THREE.MeshStandardMaterial({ color: '#8d8f93', alphaMap: t, alphaTest: 0.5, metalness: 0.6, roughness: 0.6, side: THREE.DoubleSide })
  })

export const gridFinTexture = () =>
  once('gridfin', () =>
    canvasTex(128, 128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 4
      for (let i = -128; i < 256; i += 16) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i + 128, 128)
        ctx.moveTo(i + 128, 0)
        ctx.lineTo(i, 128)
        ctx.stroke()
      }
      ctx.lineWidth = 10
      ctx.strokeRect(0, 0, 128, 128)
    }),
  )

export const gridFinMaterial = () =>
  once('gridFinMat', () => new THREE.MeshStandardMaterial({ color: '#6b6d71', alphaMap: gridFinTexture(), alphaTest: 0.5, metalness: 0.85, roughness: 0.4, side: THREE.DoubleSide }))

export const concreteMaterial = () =>
  once('concrete', () =>
    new THREE.MeshStandardMaterial({
      color: '#b9b4aa',
      roughness: 0.95,
      map: canvasTex(256, 256, (ctx) => {
        ctx.fillStyle = '#bdb8ae'
        ctx.fillRect(0, 0, 256, 256)
        for (let i = 0; i < 4000; i++) {
          const v = 150 + Math.random() * 60
          ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`
          ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
        }
        ctx.strokeStyle = 'rgba(90,90,90,0.35)'
        ctx.lineWidth = 1
        for (let i = 0; i <= 256; i += 32) {
          ctx.beginPath()
          ctx.moveTo(i, 0)
          ctx.lineTo(i, 256)
          ctx.moveTo(0, i)
          ctx.lineTo(256, i)
          ctx.stroke()
        }
      }),
    }),
  )

/** Engine bell profile for LatheGeometry (y up, nozzle exit at y=0). */
export function bellProfile(exitRadius: number, length: number, throatRadius = exitRadius * 0.3) {
  const pts: THREE.Vector2[] = []
  const N = 14
  for (let i = 0; i <= N; i++) {
    const k = i / N
    const r = throatRadius + (exitRadius - throatRadius) * Math.pow(1 - k, 1.7)
    pts.push(new THREE.Vector2(r, k * length))
  }
  // combustion chamber / powerhead
  pts.push(new THREE.Vector2(throatRadius * 1.35, length * 1.08))
  pts.push(new THREE.Vector2(throatRadius * 1.35, length * 1.35))
  pts.push(new THREE.Vector2(0.01, length * 1.4))
  return pts
}

export const bellMaterial = () =>
  once('bell', () => new THREE.MeshStandardMaterial({ color: '#4a4440', metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide }))
