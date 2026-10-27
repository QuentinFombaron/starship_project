import * as THREE from 'three'

/** Sentinel-2 cloudless (2016) tiles bundled in /public, zoom 14, Web Mercator. */
export const TILES = { z: 14, x0: 3766, x1: 3773, y0: 6962, y1: 6969 }
export const IMAGERY_CREDIT = 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0'

const n = 2 ** TILES.z
export const tileLon = (x: number) => (x / n) * 360 - 180
export const tileLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
export const mercY = (lat: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n

export const BOUNDS = {
  west: tileLon(TILES.x0),
  east: tileLon(TILES.x1 + 1),
  north: tileLat(TILES.y0),
  south: tileLat(TILES.y1 + 1),
}

/** UV (0..1, v up) of a lat/lon inside the stitched imagery. */
export function imageryUv(lat: number, lon: number): [number, number] {
  const u = (lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)
  const yTile = mercY(lat)
  const v = 1 - (yTile - TILES.y0) / (TILES.y1 + 1 - TILES.y0)
  return [u, v]
}

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })

let cache: Promise<{ map: THREE.Texture; roughness: THREE.Texture }> | null = null

/** Stitches the tiles into one texture and derives a roughness map (water = glossy). */
export function loadStarbaseImagery() {
  if (cache) return cache
  cache = (async () => {
    const cols = TILES.x1 - TILES.x0 + 1
    const rows = TILES.y1 - TILES.y0 + 1
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = cols * size
    canvas.height = rows * size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const jobs: Promise<void>[] = []
    for (let y = TILES.y0; y <= TILES.y1; y++)
      for (let x = TILES.x0; x <= TILES.x1; x++)
        jobs.push(
          loadImg(`/textures/starbase/${TILES.z}_${x}_${y}.jpg`).then((img) => {
            ctx.drawImage(img, (x - TILES.x0) * size, (y - TILES.y0) * size)
          }),
        )
    await Promise.all(jobs)
    const rc = document.createElement('canvas')
    rc.width = canvas.width / 2
    rc.height = canvas.height / 2
    const rctx = rc.getContext('2d')!
    rctx.drawImage(canvas, 0, 0, rc.width, rc.height)
    const id = rctx.getImageData(0, 0, rc.width, rc.height)
    const d = id.data
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]
      const g = d[i + 1]
      const b = d[i + 2]
      const water = b > r + 6 && g >= r && r < 120
      const v = water ? 40 : 235
      d[i] = d[i + 1] = d[i + 2] = v
    }
    rctx.putImageData(id, 0, 0)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8
    const roughness = new THREE.CanvasTexture(rc)
    return { map, roughness }
  })()
  return cache
}

export const MODEL_CREDIT =
  '3D models: “SpaceX Starship Block 3” by Clarence365 (sketchfab.com/clarence365), CC BY 4.0, split and optimised for the web'
