import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { R_EARTH, destination } from '../../sim/coords'
import { live } from '../live'
import { useEarthTextures } from '../Earth/Earth'
import { SKY_GLSL } from '../Earth/Sky'
import { BOUNDS, loadStarbaseTerrain, mercUv, type StarbaseTerrain } from './imagery'
import { PadFrame, WATER_LEVEL, localFromGeo } from './Starbase'

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 latLon;
attribute vec2 demUv;
attribute vec2 naipUv;
attribute float edge;
varying vec2 vLatLon; varying vec2 vDemUv; varying vec2 vNaipUv; varying float vEdge;
varying vec3 vLocal; varying vec3 vView; varying vec3 vUp; varying vec3 vEast; varying vec3 vSouth;
void main() {
  vLatLon = latLon; vDemUv = demUv; vNaipUv = naipUv; vEdge = edge;
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vUp = normalize(normalMatrix * normal);
  vEast = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
  vSouth = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D earthDay; uniform sampler2D earthBrc;
uniform sampler2D dem; uniform sampler2D shore; uniform sampler2D naip;
uniform float hasTerrain; uniform float time; uniform float opacity;
uniform vec3 sunWorld;
varying vec2 vLatLon; varying vec2 vDemUv; varying vec2 vNaipUv; varying float vEdge;
varying vec3 vLocal; varying vec3 vView; varying vec3 vUp; varying vec3 vEast; varying vec3 vSouth;
${SKY_GLSL}
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}
float inside(vec2 uv) { vec2 e = min(uv, 1.0 - uv); return step(0.0, min(e.x, e.y)); }
// Slope sum of 24 wind waves spread around the onshore south-east wind. Wavelengths step by an irrational
// ratio and directions are scattered so no interference pattern lines up. Waves too short for the pixel
// footprint are dropped (they would alias) and their slope variance is returned in .z as roughness.
vec3 waveSlope(vec2 p, float t, float footprint) {
  vec3 g = vec3(0.0);
  float lambda = 120.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float k = 6.2831853 / lambda;
    float steep = 0.03;
    float ang = 2.35 + (hash2(vec2(fi, 4.7)) - 0.5) * 2.4;
    vec2 dir = vec2(cos(ang), sin(ang));
    float w = sqrt(9.81 * k);
    float ph = k * dot(dir, p) - w * t + hash2(vec2(fi, 1.3)) * 6.2831853;
    float aa = smoothstep(3.0 * footprint, 9.0 * footprint, lambda);
    g.xy += dir * (steep * cos(ph)) * aa;
    g.z += steep * steep * 0.5 * (1.0 - aa);
    lambda *= 0.818;
  }
  return g;
}
void main() {
  #include <logdepthbuf_fragment>
  float lat = vLatLon.x; float lon = vLatLon.y;
  vec2 earthUv = vec2((lon + 180.0) / 360.0, (lat + 90.0) / 180.0);
  vec3 dayCol = texture2D(earthDay, earthUv).rgb;
  float oceanGlobal = 1.0 - smoothstep(0.25, 0.55, texture2D(earthBrc, earthUv).g);
  // water mask: lidar DEM near Starbase, the global ocean mask elsewhere
  float inDem = hasTerrain * inside(vDemUv);
  vec4 demS = texture2D(dem, vDemUv);
  float wet = mix(oceanGlobal, smoothstep(0.3, 0.7, demS.b), inDem);
  float shoreD = mix(255.0, texture2D(shore, vDemUv).r * 255.0, inDem); // px of ~8.6 m

  vec3 V = normalize(-vView);
  vec3 up = normalize(vUp);
  vec3 sunV = normalize((viewMatrix * vec4(sunWorld, 0.0)).xyz);
  float sunElev = dot(up, sunV);
  vec3 sunT = sunTransmittance(up, sunV, 1.0);
  float dist = length(vView);
  float footprint = dist * 0.0012 / max(dot(V, up), 0.08); // grazing angles stretch pixels

  // ── land (only visible beyond the ground patch): Blue Marble, lambert-lit ──
  vec3 land = dayCol * (0.05 + 1.1 * max(sunElev, 0.0) * sunT);

  // ── water ──
  vec3 ws = waveSlope(vLocal.xz, time, footprint);
  vec2 g = ws.xy;
  float rough = clamp(sqrt(ws.z) * 6.0, 0.0, 1.0); // unresolved chop
  // capillary ripples for close-ups
  float rip = 1.0 - smoothstep(20.0, 120.0, dist);
  vec2 q = vLocal.xz * 0.9 + vec2(time * 0.6, time * 0.35);
  g += rip * 0.06 * vec2(vnoise(q) - vnoise(q + vec2(3.1, 0.0)), vnoise(q) - vnoise(q + vec2(0.0, 3.1)));
  // waves steepen in shallow water
  float shallow = 1.0 - smoothstep(3.0, 60.0, shoreD);
  g *= 1.0 + shallow * 0.8;
  vec3 N = normalize(up - vEast * g.x - vSouth * g.y);
  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  if (dot(R, up) < 0.0) R = normalize(R - 2.0 * dot(R, up) * up);
  // rough (unresolved) chop scatters the reflection towards the average sky
  vec3 skyR = mix(skyRadiance(R, up, sunV, 1.0), skyRadiance(normalize(R + up * 0.6), up, sunV, 1.0), rough * 0.6);
  // body colour: the aerial's own nearshore water near Starbase, deep Gulf/ocean blue elsewhere
  vec3 deep = vec3(0.012, 0.045, 0.07);
  vec3 body = mix(deep, dayCol * 0.8, 0.35);
  // ponds, lagoons and the surf zone keep the photo's own water colour (blurred: the photo has frozen waves)
  if (hasTerrain > 0.5 && inside(vNaipUv) > 0.5) body = mix(body, texture2D(naip, vNaipUv, 5.0).rgb * 0.8, 0.9 * (1.0 - smoothstep(40.0, 230.0, shoreD)));
  body = mix(body, vec3(0.09, 0.22, 0.2), shallow * 0.35);
  vec3 bodyLight = skyRadiance(up, up, sunV, 1.0) * 0.6 + sunT * max(sunElev, 0.0) * 1.2;
  vec3 water = body * bodyLight * (1.0 - F) + skyR * F;
  // sun glitter
  vec3 H = normalize(sunV + V);
  float shin = mix(900.0, 70.0, rough);
  float spec = pow(max(dot(N, H), 0.0), shin) * shin * 0.1 + pow(max(dot(N, H), 0.0), 40.0) * 0.4 * rough;
  water += sunT * spec * smoothstep(-0.02, 0.05, sunElev);
  // surf: breaking bands rolling towards the beach, plus swash right at the shoreline
  float band = sin(shoreD * 1.6 + time * 1.2 + vnoise(vLocal.xz * 0.02) * 6.0);
  float n1 = vnoise(vLocal.xz * 0.15 + time * 0.2);
  float surf = smoothstep(0.7, 1.0, band) * (1.0 - smoothstep(2.0, 14.0, shoreD)) * smoothstep(0.35, 0.75, n1);
  surf += (1.0 - smoothstep(0.6, 2.2, shoreD)) * (0.5 + 0.5 * n1);
  // scattered whitecaps on the open sea
  surf += smoothstep(0.82, 0.95, vnoise(vLocal.xz * 0.05 + time * 0.08)) * smoothstep(0.75, 1.0, vnoise(vLocal.xz * 0.4 - time * 0.3)) * 0.35;
  water = mix(water, vec3(0.85, 0.88, 0.9) * (0.08 + 0.9 * max(sunElev, 0.0)) * sunT, clamp(surf, 0.0, 1.0) * 0.85 * wet);

  vec3 col = mix(land, water, wet);
  // aerial perspective towards the horizon
  vec3 haze = skyRadiance(-V, up, sunV, 1.0);
  col = mix(col, haze, 1.0 - exp(-dist / 38000.0));
  gl_FragColor = vec4(col, opacity * vEdge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/**
 * Sea-level cap (radius ~80 km) around a point: animated water wherever the DEM / global ocean mask says
 * water, Blue Marble land elsewhere. It fills the gap between local ground and the coarsely tessellated
 * global sphere, which sags hundreds of metres below sea level between its vertices.
 */
export function SurfaceCap({ origin, withTerrain = false, radius = 80_000 }: { origin: { lat: number; lon: number }; withTerrain?: boolean; radius?: number }) {
  const { day, brc } = useEarthTextures()
  const [terrain, setTerrain] = useState<StarbaseTerrain | null>(null)
  useEffect(() => {
    if (!withTerrain) return
    let alive = true
    loadStarbaseTerrain().then((t) => alive && setTerrain(t))
    return () => {
      alive = false
    }
  }, [withTerrain])
  const geom = useMemo(() => {
    const SEG = 160
    const radii = [0]
    for (let r = 25; r < radius; r *= 1.055) radii.push(r)
    radii.push(radius)
    const pos: number[] = []
    const ll: number[] = []
    const duv: number[] = []
    const nuv: number[] = []
    const edge: number[] = []
    const idx: number[] = []
    const naipB = terrain?.outer.bounds ?? BOUNDS
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i]
      const ring = i === 0 ? 1 : SEG
      for (let k = 0; k < ring; k++) {
        const g = r === 0 ? origin : destination(origin.lat, origin.lon, (k / SEG) * 360, r)
        const p = localFromGeo(g.lat, g.lon, WATER_LEVEL, origin)
        pos.push(...p)
        ll.push(g.lat, g.lon)
        duv.push(...mercUv(BOUNDS, g.lat, g.lon))
        nuv.push(...mercUv(naipB, g.lat, g.lon))
        edge.push(1 - Math.min(1, Math.max(0, (r - radius * 0.7) / (radius * 0.3))))
      }
    }
    for (let k = 0; k < SEG; k++) idx.push(0, 1 + ((k + 1) % SEG), 1 + k)
    for (let i = 1; i < radii.length - 1; i++) {
      const a0 = 1 + (i - 1) * SEG
      const b0 = a0 + SEG
      for (let k = 0; k < SEG; k++) {
        const k1 = (k + 1) % SEG
        idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('latLon', new THREE.Float32BufferAttribute(ll, 2))
    geo.setAttribute('demUv', new THREE.Float32BufferAttribute(duv, 2))
    geo.setAttribute('naipUv', new THREE.Float32BufferAttribute(nuv, 2))
    geo.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    // normals must point away from the Earth's centre (local +y); flip the winding if they don't
    if (geo.getAttribute('normal').getY(0) < 0) {
      geo.setIndex(idx.map((_, i) => idx[i - (i % 3) + (2 - (i % 3))]))
      geo.computeVertexNormals()
    }
    return geo
  }, [origin, radius, terrain])
  const blank = useMemo(() => new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1), [])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          earthDay: { value: day },
          earthBrc: { value: brc },
          dem: { value: blank },
          shore: { value: blank },
          naip: { value: blank },
          hasTerrain: { value: 0 },
          time: { value: 0 },
          opacity: { value: 1 },
          sunWorld: { value: new THREE.Vector3(1, 0, 0) },
        },
        transparent: true,
      }),
    [day, brc, blank],
  )
  useEffect(() => {
    if (!terrain) return
    terrain.demTex.needsUpdate = true
    mat.uniforms.dem.value = terrain.demTex
    mat.uniforms.shore.value = terrain.shoreTex
    mat.uniforms.naip.value = terrain.outer.map
    mat.uniforms.hasTerrain.value = 1
  }, [terrain, mat])
  useFrame((state) => {
    mat.uniforms.time.value = state.clock.elapsedTime
    mat.uniforms.sunWorld.value.copy(live.sunDir)
    // fade out on the way up: from tens of km the global sphere's sag no longer shows, while the cap's haze would wash out the view
    const alt = live.camera.length() - R_EARTH
    mat.uniforms.opacity.value = 1 - THREE.MathUtils.smoothstep(alt, 30_000, 60_000)
  })
  return (
    <PadFrame origin={origin}>
      <mesh geometry={geom} material={mat} renderOrder={-1} frustumCulled={false} />
    </PadFrame>
  )
}
