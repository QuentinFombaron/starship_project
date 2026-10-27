import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'
import { useClock } from '../sim/clock'
import { useReplay } from '../sim/replay'
import { fmtAlt, fmtSpeed } from '../lib/format'
import { useSettings } from '../lib/settings'

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

type LngLat = [number, number]

/** Splits a track wherever it crosses the antimeridian so lines don't streak across the map. */
function splitLines(pts: LngLat[]) {
  const lines: LngLat[][] = [[]]
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const prev = pts[i - 1]
    if (prev && Math.abs(p[0] - prev[0]) > 180) lines.push([])
    lines.at(-1)!.push(p)
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'MultiLineString' as const, coordinates: lines.filter((l) => l.length > 1) } }
}

function trackUpTo(lat: number[], lon: number[], t0: number, dt: number, t: number, step: number) {
  const n = Math.min(lat.length, Math.max(0, Math.floor((t - t0) / dt) + 1))
  const out: LngLat[] = []
  for (let i = 0; i < n; i += step) out.push([lon[i], lat[i]])
  if (n > 0) out.push([lon[n - 1], lat[n - 1]])
  return out
}

export default function MapPanel() {
  const replay = useReplay()
  const units = useSettings((s) => s.units)
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [follow, setFollow] = useState(true)
  const followRef = useRef(follow)
  followRef.current = follow
  const [info, setInfo] = useState({ lat: 0, lon: 0, alt: 0, speed: 0 })

  useEffect(() => {
    const tel = replay.data.telemetry
    const site = replay.data.mission.launchSite.position
    const m = new maplibregl.Map({
      container: el.current!,
      style: {
        version: 8,
        sources: {
          s2: {
            type: 'raster',
            tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
            tileSize: 256,
            maxzoom: 13,
            attribution: 'Sentinel-2 cloudless 2016 © EOX IT Services GmbH (CC BY 4.0)',
          },
        },
        layers: [
          { id: 's2', type: 'raster', source: 's2', paint: { 'raster-brightness-max': 0.75, 'raster-saturation': -0.3 } },
        ],
      },
      center: [site.lon, site.lat],
      zoom: 4,
      attributionControl: { compact: true },
      renderWorldCopies: true,
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.on('load', () => {
      const planned = (tel.plannedShipGroundTrack ?? []).map(([la, lo]) => [lo, la] as LngLat)
      m.addSource('planned', { type: 'geojson', data: splitLines(planned) })
      m.addSource('ship', { type: 'geojson', data: splitLines([]) })
      m.addSource('booster', { type: 'geojson', data: splitLines([]) })
      m.addSource('pos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const zones = [
        { name: 'Starbase', lon: site.lon, lat: site.lat },
        { name: 'Booster splashdown', lon: tel.booster.lon.at(-1)!, lat: tel.booster.lat.at(-1)! },
        { name: 'Ship splashdown', lon: tel.ship.lon.at(-1)!, lat: tel.ship.lat.at(-1)! },
      ]
      m.addSource('zones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: zones.map((z) => ({ type: 'Feature', properties: { name: z.name }, geometry: { type: 'Point', coordinates: [z.lon, z.lat] } })) },
      })
      m.addLayer({ id: 'planned', type: 'line', source: 'planned', paint: { 'line-color': '#ffffff', 'line-opacity': 0.35, 'line-width': 1, 'line-dasharray': [2, 3] } })
      m.addLayer({ id: 'booster', type: 'line', source: 'booster', paint: { 'line-color': '#d95926', 'line-width': 2 } })
      m.addLayer({ id: 'ship', type: 'line', source: 'ship', paint: { 'line-color': '#3987e5', 'line-width': 2 } })
      m.addLayer({ id: 'zones', type: 'circle', source: 'zones', paint: { 'circle-radius': 4, 'circle-color': '#000', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
      m.addLayer({
        id: 'zone-labels',
        type: 'symbol',
        source: 'zones',
        layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': [] },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1 },
      })
      m.addLayer({
        id: 'pos',
        type: 'circle',
        source: 'pos',
        paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#000', 'circle-stroke-width': 2 },
      })
    })
    m.on('dragstart', () => setFollow(false))
    return () => {
      m.remove()
      map.current = null
    }
  }, [replay])

  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 120) return
      last = now
      const m = map.current
      if (!m || !m.isStyleLoaded() || !m.getSource('ship')) return
      const t = useClock.getState().t
      const tel = replay.data.telemetry
      const step = t > 2000 ? 20 : 2
      ;(m.getSource('ship') as GeoJSONSource).setData(splitLines(trackUpTo(tel.ship.lat, tel.ship.lon, tel.ship.t0, tel.ship.dt, t, step)))
      ;(m.getSource('booster') as GeoJSONSource).setData(splitLines(trackUpTo(tel.booster.lat, tel.booster.lon, tel.booster.t0, tel.booster.dt, t, 1)))
      const s = replay.ship.sample(t)
      const b = replay.booster.sample(t)
      ;(m.getSource('pos') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [
          ...(t > replay.tStage && t < replay.t('booster-fts', 1e9) + 5 ? [{ type: 'Feature' as const, properties: { color: '#d95926' }, geometry: { type: 'Point' as const, coordinates: [b.lon, b.lat] } }] : []),
          { type: 'Feature' as const, properties: { color: '#3987e5' }, geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] } },
        ],
      })
      setInfo({ lat: s.lat, lon: s.lon, alt: s.alt, speed: s.speed })
      if (followRef.current) {
        const zoom = t < 30 ? 9 : t < 600 ? 5.5 : 2.2
        m.easeTo({ center: [s.lon, s.lat], zoom, duration: 400 })
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [replay])

  const sp = fmtSpeed(info.speed, units)
  const al = fmtAlt(info.alt, units)
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="label">Ground track</span>
        <button className="btn-sm" aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
          Follow ship
        </button>
      </div>
      <div ref={el} className="relative flex-1" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[12px]">
        <span className="text-dim">
          Ship <span className="num text-white">{info.lat.toFixed(2)}°, {info.lon.toFixed(2)}°</span>
        </span>
        <span className="text-right text-dim">
          <span className="num text-white">
            {sp.value} {sp.unit} · {al.value} {al.unit}
          </span>
        </span>
        <span className="col-span-2 flex items-center gap-4 text-[11px] text-dim">
          <span className="flex items-center gap-1.5">
            <i className="h-0.5 w-4 bg-ship" /> Ship
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-0.5 w-4 bg-booster" /> Booster
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-0 w-4 border-t border-dashed border-white/50" /> Planned 6-orbit path
          </span>
        </span>
      </div>
    </div>
  )
}
