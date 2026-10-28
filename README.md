# Starship Flight Replay

A fan-made, SpaceX-styled website to relive Starship flights in 3D. It has reconstructed telemetry, a
webcast-style HUD, a timeline with events, a ground-track map, charts, live commentary, curated X
posts, the synced webcast and a Starbase explorer. Not affiliated with SpaceX.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # simulation tests
npm run validate     # check all content against the schemas
npm run trajectory -- flight-14   # rebuild a flight's telemetry.json from its keyframes
npm run build

# optional: re-download and bake the ground/Earth textures (Python 3 + Pillow + NumPy)
python3 -m venv .venv && .venv/bin/pip install pillow numpy
.venv/bin/python -I scripts/bake-imagery.py            # or: ground | dem | earth
```

## Stack

- **App:** Vite, React 19, TypeScript, React Router and Tailwind v4.
- **3D:** three.js through `@react-three/fiber`, `drei` and `postprocessing`.
- **Data panels:** MapLibre for the map, uPlot for the charts, Zod for the content schemas and zustand for state.

## How the replay works

- **A single clock.** `src/sim/clock.ts` holds the mission time. Everything is a pure function of that
  time: the 3D scene, HUD, engines, map, charts, commentary, posts and particles. That is why
  scrubbing, reverse playback, slow motion and 1000× all stay exact.
- **Real-scale world.** The scene uses Earth-centred, Earth-fixed metres: a true-scale Earth, the real
  Starbase coordinates and the real sun position for the launch date. It uses a logarithmic depth
  buffer and keeps per-object matrices in float64, so one scene works from the launch pad out to orbit.
- **Reconstructed telemetry.** SpaceX does not publish raw telemetry. `scripts/build-trajectory.ts`
  turns sparse anchors (`keyframes.json`) and the event timeline into a consistent 1 Hz track:
  - **Ascent:** monotone splines through the anchors.
  - **Orbit and entry:** RK4 + J2 integration, with burns tuned to hit the reported orbit and the
    entry time.
  - **Descent:** drag and lift tuned to the landing-flip time.

## The 3D world

- **Starbase ground.** Three nested layers of USDA NAIP aerial imagery (about 4.4 m, 2.1 m and 0.5 m per pixel)
  are blended in one shader over lidar relief, with the mesh densest around the pads. NAIP's latest flight (June 2022)
  predates Pad B, so the pad is modelled on a concrete apron. `scripts/bake-imagery.py` writes everything under
  `public/textures/starbase/`.
- **Water.** A sea-level cap reaching 80 km out from the pad (and another at the ship's splashdown) draws water wherever the
  DEM water mask or the global ocean mask says so. It has a sum of wind waves (anti-aliased with distance), Fresnel sky
  reflection, sun glitter, shallow-water colour, and surf that rolls in along a baked distance-to-shore field. Beyond
  the ground patch, the same cap draws Blue Marble land.
- **Sky and clouds.** The sky uses single-scattering Rayleigh + Mie, so the sun reddens at sunrise and the sky
  darkens with altitude. Three cumulus layers follow the camera; their noise tiles every 40 km, which keeps it precise
  at Earth-centred coordinates.
- **Pad B (Orbital Launch Pad 2)** in `src/scene/Starbase/PadB.tsx`:
  - the 144.5 m tower and its roof
  - the shorter chopsticks and the ship quick-disconnect arm, which swings away before liftoff
  - the clad pyramid mount with 20 clamps and split booster QDs
  - the two-exit flame trench with its water-cooled diverter
  - the deluge water farm and the propellant farm

  Sources: NASASpaceflight pad reports and the FAA filings; the photos are in a local, git-ignored `reference/`.
- **Hover to inspect.** Point at the booster, the ship, their engine sections or the pad hardware to get a live data
  card; click to pin it. Vehicles turn see-through to show their LOX/methane tanks filled to the current level, along
  with the ship's header tanks and Starlink stack. The engine grid lists every Raptor with its status. The PEZ door
  opens for the Starlink deploy.
- **Free roam (camera 0).**
  - WASD/QE flies, with eased velocity; Shift makes it 5× faster.
  - Double-click flies to a point, or locks onto the booster or ship.
  - T cycles following the booster, the ship, or nothing.
  - Right-drag pans; drags and zoom have inertia.

## Content database (`content/`)

One folder per flight in `content/flights/flight-NN/`:

| File | Purpose |
|---|---|
| `mission.json` | Metadata, summary, objectives, vehicles, orbit, landing points, sources (required) |
| `timeline.json` | Events with T+ seconds, status and descriptions |
| `engines.json` | Engine ring layout, burns (which engines, throttle), and failures |
| `keyframes.json` | Altitude and speed anchors plus orbit targets for the reconstruction |
| `telemetry.json` | **Generated** by `npm run trajectory` |
| `commentary.json` | Host quotes, explainers and callouts keyed to T+ |
| `posts.json` | Curated X posts keyed to T+ |
| `media.json` | Photos with credit and licence |
| `webcast.json` | YouTube id and the video time of T-0 (read off the HUD clock in the video) |

To add a past or future flight, create its folder with `mission.json`. A summary page appears
automatically. For a 3D replay, also add `timeline.json`, `engines.json` and `keyframes.json`, run
`npm run trajectory -- flight-NN`, then set `"hasReplay": true`.

Vehicles live in `content/vehicles/*.json`, and the glossary is in `content/glossary.json`.

## Swapping in real 3D models

The booster and ship are procedural V3 models. If you drop `public/models/super-heavy.glb` or
`public/models/starship.glb` in place, it replaces the procedural model automatically. It is scaled to
the real length (72.3 m and 52.1 m) and centred vertically. Model it with Y up, the body axis on x = z = 0,
and the heat shield facing +Z.

## Credits

- **3D models:** “SpaceX Starship Block 3” by [Clarence365](https://sketchfab.com/clarence365) ([source](https://sketchfab.com/3d-models/spacex-starship-block-3-6f6c6f88a3eb4b4d822fdca66733fbb2)), CC BY 4.0. It was split into `public/models/starship.glb` and `super-heavy.glb`, the ship rotated so its heat shield faces +Z, and both compressed with meshopt and WebP.

- **Ground imagery:** USDA NAIP 2022 via the USGS National Map (public domain). Gaps are filled with Sentinel-2 cloudless
  2016 by EOX IT Services GmbH (CC BY 4.0).
- **Terrain:** AWS Terrain Tiles (Mapzen terrarium: USGS 3DEP, SRTM, GMTED, ETOPO1).
- **Earth textures:** NASA Blue Marble Next Generation via NASA GIBS, relief from GEBCO 2008 via NASA Visible Earth,
  and Black Marble night lights via the three.js examples.
- **Mission photos:** © SpaceX and the credited outlets, linked for non-commercial fan use.
