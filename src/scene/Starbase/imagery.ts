import * as THREE from 'three'

/** Zoom-14 Web Mercator tile block that bounds the ground patch, the DEM and the outer imagery layer. */
export const TILES = { z: 14, x0: 3766, x1: 3773, y0: 6962, y1: 6969 }
export const IMAGERY_CREDIT =
  'Ground imagery: USDA NAIP 2022 via the USGS National Map (public domain), gaps filled with Sentinel-2 cloudless 2016 by EOX (CC BY 4.0). Terrain: AWS Terrain Tiles (USGS 3DEP, SRTM, GMTED)'

const n = 2 ** TILES.z
export const tileLon = (x: number) => (x / n) * 360 - 180
export const tileLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
const mercY = (lat: number) => Math.asinh(Math.tan((lat * Math.PI) / 180))

export interface GeoBounds {
  west: number
  east: number
  north: number
  south: number
}

export const BOUNDS: GeoBounds = {
  west: tileLon(TILES.x0),
  east: tileLon(TILES.x1 + 1),
  north: tileLat(TILES.y0),
  south: tileLat(TILES.y1 + 1),
}

/** UV (0..1, v up) of a lat/lon inside a Web Mercator image covering `b`. */
export function mercUv(b: GeoBounds, lat: number, lon: number): [number, number] {
  const u = (lon - b.west) / (b.east - b.west)
  const v = (mercY(lat) - mercY(b.south)) / (mercY(b.north) - mercY(b.south))
  return [u, v]
}

export interface ImageryLayer {
  bounds: GeoBounds
  map: THREE.Texture
}

export interface StarbaseTerrain {
  outer: ImageryLayer
  mid: ImageryLayer
  inner: ImageryLayer
  /** DEM over BOUNDS: R/G = 16-bit height, B = water mask. */
  demTex: THREE.Texture
  /** Distance from the shore into the water, 0..255 px of ~8.6 m. */
  shoreTex: THREE.Texture
  /** Height in metres above sea level (bilinear). */
  height(lat: number, lon: number): number
  /** 0 = land, 1 = water (bilinear). */
  water(lat: number, lon: number): number
}

const loadBitmap = async (src: string) => {
  const blob = await (await fetch(src)).blob()
  // no colour management: the DEM's channels are data, not colour
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
}

const loadTexture = (src: string, srgb = true) =>
  new Promise<THREE.Texture>((res, rej) =>
    new THREE.TextureLoader().load(
      src,
      (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = 8
        res(t)
      },
      undefined,
      rej,
    ),
  )

let cache: Promise<StarbaseTerrain> | null = null

/**
 * Loads the baked ground (see scripts/bake-imagery.py): three nested NAIP layers (~4.4 m, 2.1 m and 0.5 m
 * per pixel), a lidar DEM with a water mask, and a shore-distance field.
 */
export function loadStarbaseTerrain() {
  if (cache) return cache
  cache = (async () => {
    const base = '/textures/starbase'
    const meta = (await (await fetch(`${base}/layers.json`)).json()) as Record<'outer' | 'mid' | 'inner', GeoBounds>
    const [outer, mid, inner, demBmp, shoreTex] = await Promise.all([
      loadTexture(`${base}/naip_outer.jpg`),
      loadTexture(`${base}/naip_mid.jpg`),
      loadTexture(`${base}/naip_inner.jpg`),
      loadBitmap(`${base}/dem.png`),
      loadTexture(`${base}/shore.png`, false),
    ])
    const w = demBmp.width
    const h = demBmp.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(demBmp, 0, 0)
    const px = ctx.getImageData(0, 0, w, h).data
    const heights = new Float32Array(w * h)
    const wet = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) {
      heights[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 100 - 100
      wet[i] = px[i * 4 + 2] / 255
    }
    const demTex = new THREE.CanvasTexture(canvas)
    demTex.colorSpace = THREE.NoColorSpace
    const bilinear = (a: Float32Array, lat: number, lon: number) => {
      const [u, v] = mercUv(BOUNDS, lat, lon)
      const x = Math.min(w - 1.001, Math.max(0, u * w - 0.5))
      const y = Math.min(h - 1.001, Math.max(0, (1 - v) * h - 0.5))
      const i = Math.floor(x)
      const j = Math.floor(y)
      const fx = x - i
      const fy = y - j
      const k = j * w + i
      return (a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fy) + (a[k + w] * (1 - fx) + a[k + w + 1] * fx) * fy
    }
    return {
      outer: { bounds: meta.outer, map: outer },
      mid: { bounds: meta.mid, map: mid },
      inner: { bounds: meta.inner, map: inner },
      demTex,
      shoreTex,
      height: (lat, lon) => bilinear(heights, lat, lon),
      water: (lat, lon) => bilinear(wet, lat, lon),
    }
  })()
  return cache
}

export const MODEL_CREDIT =
  '3D models: “SpaceX Starship Block 3” by Clarence365 (sketchfab.com/clarence365), CC BY 4.0, split and optimised for the web'
