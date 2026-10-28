"""
Downloads and bakes the high-resolution ground and Earth textures into public/textures.

    python3 -m venv .venv && .venv/bin/pip install pillow numpy
    .venv/bin/python -I scripts/bake-imagery.py

Sources (all public domain unless noted):
  * USDA NAIP 2022 aerial imagery, 0.6 m, via the USGS National Map ImageServer.
  * Terrain + bathymetry: AWS Terrain Tiles (Mapzen terrarium: USGS 3DEP, SRTM, GMTED, ETOPO1; attribution required).
  * Earth: NASA Blue Marble Next Generation via NASA GIBS; relief from GEBCO 2008 via NASA Visible Earth.
The Sentinel-2 cloudless 2016 tiles in scripts/data/sentinel-2016 (EOX, CC BY 4.0) fill any NAIP gaps.
"""
import io
import json
import math
import os
import sys
import time
import urllib.request

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "textures")
R = 6378137.0

# must match src/scene/Starbase/imagery.ts (Sentinel tiles, zoom 14)
TILES = dict(z=14, x0=3766, x1=3773, y0=6962, y1=6969)
LAYERS = {
    # name: (centre lat, centre lon, ground half-size m, pixels); "outer" uses the Sentinel tile bounds
    "outer": (None, None, None, 4000),
    "mid": (25.992, -97.171, 4200, 4000),
    "inner": (25.9963, -97.1557, 800, 3072),
}


def fetch(url, tries=4):
    req = urllib.request.Request(url, headers={"User-Agent": "starship-replay-bake/1.0"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:  # the ImageServer sometimes answers 504 under load
            if i == tries - 1:
                raise
            print(f"  retry ({e})")
            time.sleep(3 * (i + 1))


def merc(lat, lon):
    return math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R


def unmerc(x, y):
    return math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R)


def tile_merc(x, y, z):
    n = 2**z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return merc(lat, lon)


def layer_bbox(name):
    lat, lon, half, _ = LAYERS[name]
    if name == "outer":
        x0, y1 = tile_merc(TILES["x0"], TILES["y0"], TILES["z"])
        x1, y0 = tile_merc(TILES["x1"] + 1, TILES["y1"] + 1, TILES["z"])
        return x0, y0, x1, y1
    cx, cy = merc(lat, lon)
    h = half / math.cos(math.radians(lat))
    return cx - h, cy - h, cx + h, cy + h


def sentinel_mosaic():
    cols = TILES["x1"] - TILES["x0"] + 1
    rows = TILES["y1"] - TILES["y0"] + 1
    im = Image.new("RGB", (cols * 256, rows * 256))
    for y in range(TILES["y0"], TILES["y1"] + 1):
        for x in range(TILES["x0"], TILES["x1"] + 1):
            t = Image.open(os.path.join(ROOT, "scripts", "data", "sentinel-2016", f"{TILES['z']}_{x}_{y}.jpg")).convert("RGB")
            im.paste(t, ((x - TILES["x0"]) * 256, (y - TILES["y0"]) * 256))
    return im, layer_bbox("outer")


def naip(bbox, size, parts=2):
    """Exports in parts × parts pieces: the server times out on single 4000 px requests."""
    out = Image.new("RGB", (size, size))
    step = size // parts
    for j in range(parts):
        for i in range(parts):
            px0, py0 = i * step, j * step
            px1 = size if i == parts - 1 else px0 + step
            py1 = size if j == parts - 1 else py0 + step
            sx = (bbox[2] - bbox[0]) / size
            b = (bbox[0] + px0 * sx, bbox[3] - py1 * sx, bbox[0] + px1 * sx, bbox[3] - py0 * sx)
            url = (
                "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
                f"?bbox={','.join(f'{v:.3f}' for v in b)}&bboxSR=3857&imageSR=3857&size={px1 - px0},{py1 - py0}"
                "&format=jpg&interpolation=RSP_BilinearInterpolation&f=image"
            )
            out.paste(Image.open(io.BytesIO(fetch(url))).convert("RGB"), (px0, py0))
    return out


def bake_ground(sentinel, sbox):
    meta = {}
    for name, (_, _, _, size) in LAYERS.items():
        bbox = layer_bbox(name)
        print(f"NAIP {name}: {size}px over {(bbox[2] - bbox[0]) * math.cos(math.radians(26)) / 1000:.1f} km")
        img = np.asarray(naip(bbox, size)).astype(np.float32)
        # fill no-data (pure black or white) from the Sentinel mosaic resampled to this layer
        sx0, sy0, sx1, sy1 = sbox
        W, H = sentinel.size
        crop = sentinel.crop(
            (
                (bbox[0] - sx0) / (sx1 - sx0) * W,
                (sy1 - bbox[3]) / (sy1 - sy0) * H,
                (bbox[2] - sx0) / (sx1 - sx0) * W,
                (sy1 - bbox[1]) / (sy1 - sy0) * H,
            )
        ).resize((size, size), Image.BICUBIC)
        fill = np.asarray(crop).astype(np.float32)
        hole = (img.max(axis=2) < 4) | (img.min(axis=2) > 251)
        img[hole] = fill[hole]
        Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(os.path.join(OUT, "starbase", f"naip_{name}.jpg"), quality=86, optimize=True)
        sw = unmerc(bbox[0], bbox[1])
        ne = unmerc(bbox[2], bbox[3])
        meta[name] = {"south": sw[0], "west": sw[1], "north": ne[0], "east": ne[1], "size": size}
    return meta


def bake_dem():
    """Terrarium tiles over the outer bounds as 16-bit (R = hi, G = lo) of (h + 100 m) × 100; B = water mask."""
    z = TILES["z"]
    cols = TILES["x1"] - TILES["x0"] + 1
    rows = TILES["y1"] - TILES["y0"] + 1
    h = np.zeros((rows * 256, cols * 256), np.float32)
    for y in range(TILES["y0"], TILES["y1"] + 1):
        for x in range(TILES["x0"], TILES["x1"] + 1):
            t = np.asarray(Image.open(io.BytesIO(fetch(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"))).convert("RGB")).astype(np.float32)
            v = t[..., 0] * 256 + t[..., 1] + t[..., 2] / 256 - 32768
            h[(y - TILES["y0"]) * 256 : (y - TILES["y0"] + 1) * 256, (x - TILES["x0"]) * 256 : (x - TILES["x0"] + 1) * 256] = v
    print(f"DEM {h.shape[1]}×{h.shape[0]}  raw min {h.min():.1f} m  max {h.max():.1f} m")
    # The terrarium mix here is lidar (3DEP) on US land, a flat 10 m GMTED plateau over Mexico, and 0 m at
    # sea with no bathymetry, plus negative spikes along channel banks. Keep the lidar relief, pull the
    # plateau down to the delta's real ~1 m, and flag water (≤ 0.2 m) in the blue channel, blurred.
    n = 2 ** z
    rows_lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (TILES["y0"] + (np.arange(h.shape[0]) + 0.5) / 256) / n))))[:, None]
    h = np.where((np.abs(h - 10) < 0.05) & (rows_lat < 25.975), 1.0, h)
    h = np.clip(h, -1.0, 30.0)
    water = Image.fromarray(((h <= 0.2) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))
    q = np.clip(np.round((h + 100) * 100), 0, 65535).astype(np.uint32)
    rgb = np.stack([(q >> 8) & 255, q & 255, np.asarray(water)], axis=-1).astype(np.uint8)
    Image.fromarray(rgb).save(os.path.join(OUT, "starbase", "dem.png"), optimize=True)
    # distance from the shore into the water (px, ~8.6 m each), for surf and shallow-water colour
    wet = h <= 0.2
    d = np.where(wet, 255.0, 0.0)
    for _ in range(255):
        nb = np.minimum.reduce([np.roll(d, 1, 0), np.roll(d, -1, 0), np.roll(d, 1, 1), np.roll(d, -1, 1)]) + 1
        nd = np.where(wet, np.minimum(d, nb), 0.0)
        if np.array_equal(nd, d):
            break
        d = nd
    Image.fromarray(d.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)).save(os.path.join(OUT, "starbase", "shore.png"), optimize=True)


def bake_earth():
    day = Image.new("RGB", (8192, 4096))
    for i, west in enumerate((-180, 0)):
        url = (
            "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
            f"&LAYERS=BlueMarble_NextGeneration&SRS=EPSG:4326&BBOX={west},-90,{west + 180},90&WIDTH=4096&HEIGHT=4096&FORMAT=image/jpeg&STYLES="
        )
        day.paste(Image.open(io.BytesIO(fetch(url))).convert("RGB"), (i * 4096, 0))
        print(f"Blue Marble half {i + 1}/2")
    day.save(os.path.join(OUT, "earth", "earth_day_8192.jpg"), quality=88, optimize=True)

    print("GEBCO relief → normal map")
    elev = Image.open(io.BytesIO(fetch("https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png"))).convert("L")
    e = np.asarray(elev.resize((8192, 4096), Image.LANCZOS)).astype(np.float32) / 255.0 * 6400.0  # ≈ metres
    lat = np.linspace(90, -90, 4096, dtype=np.float32)[:, None]
    m_per_px_x = 2 * math.pi * 6371000 / 8192 * np.maximum(np.cos(np.radians(lat)), 0.05)
    m_per_px_y = math.pi * 6371000 / 4096
    exag = 18.0  # relief is invisible at true scale from orbit
    dx = (np.roll(e, -1, axis=1) - np.roll(e, 1, axis=1)) / (2 * m_per_px_x) * exag
    dy = (np.vstack([e[1:], e[-1:]]) - np.vstack([e[:1], e[:-1]])) / (2 * m_per_px_y) * exag
    n = np.stack([-dx, dy, np.ones_like(e)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(OUT, "earth", "earth_normal_8192.jpg"), quality=90, optimize=True)


if __name__ == "__main__":
    what = set(sys.argv[1:]) or {"ground", "dem", "earth"}
    if "ground" in what:
        s, sbox = sentinel_mosaic()
        meta = bake_ground(s, sbox)
        with open(os.path.join(OUT, "starbase", "layers.json"), "w") as f:
            json.dump(meta, f, indent=2)
    if "dem" in what:
        bake_dem()
    if "earth" in what:
        bake_earth()
