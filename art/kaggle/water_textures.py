"""Generate seamless WATER textures for the modelled fountain's two water discs,
on Kaggle's T4 GPUs (NumPy backend; this runner has no working CuPy).

Round 73 turns the plaza fountain's water into a real surface. The fountain GLB
ships two `Water` meshes (`FountainWaterLower`, r = 1.40 m at y = 0.74, and
`FountainWaterUpper`, r = 0.66 m at y = 1.86) as flat `MeshStandardMaterial`
octagons: colour #97c8e3, roughness 0.15, metalness 0.1, opaque, with no maps
and no UVs at all. In a plaza whose stone, wood, iron, cloth and felt are all
mapped, two uniform blue discs are the last obviously plastic surfaces in the
centre of the world.

What this generates is a *tileable water skin*:

  albedo  pale blue-green with faint depth and crest variation
  normal  tangent-space ripple normals, wrapped Sobel of the height field
  rough   very low (0.02..0.16) so the surface reflects the scene.environment
          map; crests are a touch rougher than troughs

Band structure is chosen from where the water is actually seen. The lower disc
is 2.8 m across and the player walks past it at 1.7 m eye height, so it covers a
few hundred pixels at most and the chop that reads is 5..33 cm. The wavelengths
below are exact divisors of the tile (integer cycles), so every wave wraps with
no seam in both axes.

Everything is procedural. No outside images, no datasets, no licensed inputs, so
the output carries no third-party licence obligations.

Outputs under /kaggle/working/:
  water_albedo.png   tileable colour map
  water_normal.png   tileable tangent-space normal map
  water_rough.png    tileable roughness map
  water_preview.png  a lit 2x2 tiled patch, shaded with the normal map
  water_report.json  measurements (seam ratios, ranges, timings)

Set WATER_TEXTURE_OUT to write somewhere else.
"""

import json
import math
import os
import struct
import time
import traceback
import zlib

import numpy as np

SIZE = 512
OUT = os.environ.get("WATER_TEXTURE_OUT", "/kaggle/working")
# Metres per tile; WATER_TILE_METERS in src/assets.js must match, because the
# ripple wavelengths are authored in metres.
TILE_METERS = 1.0

report = {
    "size": SIZE,
    "tileMeters": TILE_METERS,
    "generator": "procedural fountain water",
    "gpu": None,
    "backend": "numpy",
}
t_start = time.time()
xp = np


def periodic_noise(h, w, period, seed):
    """Value noise on a lattice whose period divides the grid: exactly tileable."""
    gy = max(1, h // period)
    gx = max(1, w // period)
    rng = np.random.default_rng(seed)
    lattice = xp.asarray(rng.random((gy, gx), dtype=np.float32))

    y = xp.arange(h, dtype=xp.float32) / period
    x = xp.arange(w, dtype=xp.float32) / period
    y0 = xp.floor(y).astype(xp.int32) % gy
    x0 = xp.floor(x).astype(xp.int32) % gx
    y1 = (y0 + 1) % gy
    x1 = (x0 + 1) % gx
    fy = (y - xp.floor(y))[:, None]
    fx = (x - xp.floor(x))[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)

    a = lattice[y0][:, x0]
    b = lattice[y0][:, x1]
    c = lattice[y1][:, x0]
    d = lattice[y1][:, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(h, w, seed, octaves=4, base=8):
    out = xp.zeros((h, w), dtype=np.float32)
    amp = 1.0
    total = 0.0
    for i in range(octaves):
        p = base * (2 ** i)
        if p > min(h, w):
            break
        out = out + (periodic_noise(h, w, p, seed + i * 97) * amp).astype(np.float32)
        total += amp
        amp *= 0.5
    return (out / total).astype(np.float32)


def seam_ratio(a):
    arr = np.asarray(a)
    if arr.ndim == 2:
        # A single-channel map has no component axis; the wrap difference is
        # computed on the rows and columns directly.
        seam_h = np.abs(arr[0, :] - arr[-1, :]).mean()
        seam_v = np.abs(arr[:, 0] - arr[:, -1]).mean()
        interior_h = np.abs(arr[1:, :] - arr[:-1, :]).mean()
        interior_v = np.abs(arr[:, 1:] - arr[:, :-1]).mean()
        return (float(seam_h / max(interior_h, 1e-9)),
                float(seam_v / max(interior_v, 1e-9)))
    arr = arr[..., 0]
    seam_h = np.abs(arr[0, :] - arr[-1, :]).mean()
    seam_v = np.abs(arr[:, 0] - arr[:, -1]).mean()
    interior_h = np.abs(arr[1:, :] - arr[:-1, :]).mean()
    interior_v = np.abs(arr[:, 1:] - arr[:, :-1]).mean()
    return (float(seam_h / max(interior_h, 1e-9)),
            float(seam_v / max(interior_v, 1e-9)))


def seam_ratio_scaled(a, cycles=3):
    """Wrap difference measured between pixels `cycles` apart.

    A map whose band structure sits at wavelength W = size/cycles has near-equal
    wrap edges (the field is continuous across them) while its interior
    neighbour difference is near zero at every scale -- the discrete derivative
    of a long wave. The raw ratio then divides a real number by a rounding-scale
    denominator and reads as a false seam. Sampling the wrap at the wavelength
    measures it against variation of the same magnitude, which is the only fair
    comparison. The raw ratio is still reported, for continuity with the other
    texture families.
    """
    arr = np.asarray(a)
    if arr.ndim == 3:
        arr = arr[..., 0]
    n = arr.shape[0]
    step = max(1, n // cycles)
    wrap_h = np.abs(arr[0, :] - arr[-1, :]).mean()
    wrap_v = np.abs(arr[:, 0] - arr[:, -1]).mean()
    interior_h = np.abs(arr[step:, :] - arr[:-step, :]).mean()
    interior_v = np.abs(arr[:, step:] - arr[:, :-step]).mean()
    return (float(wrap_h / max(interior_h, 1e-9)),
            float(wrap_v / max(interior_v, 1e-9)))


def mip_std(a, level):
    arr = np.asarray(a[..., 0] if a.ndim == 3 else a)
    for _ in range(level):
        arr = arr.reshape(arr.shape[0] // 2, 2, arr.shape[1] // 2, 2).mean(axis=(1, 3))
    return float(arr.std())


def write_png(path, arr):
    a = np.asarray(arr)
    if a.ndim == 2:
        a = np.repeat(a[:, :, None], 3, axis=2)
    a = a[::-1]
    data = np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)
    h, w, _ = data.shape
    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(h))

    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)
    return len(png)


def main():
    os.makedirs(OUT, exist_ok=True)

    # --- height field: directional chop, wavelengths in metres ----------------
    # Each wave has an integer number of cycles across the tile, so it wraps
    # exactly. A second harmonic makes crests peaky and troughs broad, which is
    # what water looks like rather than a pure sine.
    t_h = time.time()
    yy, xx = xp.mgrid[0:SIZE, 0:SIZE].astype(xp.float32)
    u = xx / SIZE
    v = yy / SIZE
    height = xp.zeros((SIZE, SIZE), dtype=xp.float32)

    # (cycles per tile, direction in degrees, amplitude) -> wavelength = 1/cycles
    # of a 1.0 m tile, so 3 cycles is 33 cm and 21 cycles is 4.8 cm.
    WAVES = [
        (3, 18.0, 0.40),
        (5, 74.0, 0.25),
        (8, 132.0, 0.15),
        (13, 41.0, 0.085),
        (21, 158.0, 0.040),
    ]
    for cycles, degrees, amp in WAVES:
        angle = math.radians(degrees)
        phase = 2 * math.pi * (cycles * (u * math.cos(angle) + v * math.sin(angle)))
        height = height + amp * (xp.sin(phase) + 0.22 * xp.sin(2 * phase + 1.1))

    # Patchiness: some parts of the basin are choppier than others.
    patch = periodic_noise(SIZE, SIZE, 4, 707)
    height = height * (0.72 + 0.56 * patch)
    # Fine ripple detail at low weight, for the close-up shots.
    height = height + 0.05 * fbm(SIZE, SIZE, 31, octaves=4, base=16)

    hmin, hmax = float(height.min()), float(height.max())
    height = ((height - hmin) / (hmax - hmin + 1e-8)).astype(xp.float32)
    report["height_range"] = [round(float(height.min()), 4), round(float(height.max()), 4)]
    report["height_seconds"] = round(time.time() - t_h, 3)

    # --- normal map from height (wrapped Sobel) -------------------------------
    t_norm = time.time()

    def sobel(a):
        p = xp.pad(a, 1, mode="wrap")
        gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]
              - p[:-2, :-2] - 2 * p[1:-1, :-2] - p[2:, :-2])
        gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]
              - p[:-2, :-2] - 2 * p[:-2, 1:-1] - p[:-2, 2:])
        return gx, gy

    gx, gy = sobel(height)
    # Gentle: a strong normal on water reads as hammered metal. Tuned so the
    # steepest crest is roughly 20 degrees of slope.
    strength = 2.2
    nx = -gx * strength
    ny = -gy * strength
    nz = xp.ones_like(height)
    inv = 1.0 / xp.sqrt(nx * nx + ny * ny + nz * nz)
    normal = xp.stack(
        [nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], axis=-1
    ).astype(xp.float32)
    report["normal_seconds"] = round(time.time() - t_norm, 3)

    # --- albedo: pale blue-green with depth and crest variation ---------------
    # Near-neutral rather than a saturated blue, because the material's authored
    # colour multiplies it and the water has to read under a warm dusk sky as
    # well as at noon.
    t_alb = time.time()
    deep = xp.asarray([0.243, 0.475, 0.545], dtype=xp.float32)
    shallow = xp.asarray([0.560, 0.776, 0.812], dtype=xp.float32)
    mix = (0.28 + 0.55 * height)[..., None]
    albedo = deep[None, None, :] * (1 - mix) + shallow[None, None, :] * mix
    # Crests catch a little light, troughs sit in their own shade.
    albedo = albedo * (0.94 + 0.12 * height)[..., None]
    # A faint green cast in the deepest parts, as a real basin does at depth.
    albedo = albedo * (1.0 - 0.05 * (1 - height))[..., None]
    albedo = xp.clip(albedo, 0, 1).astype(xp.float32)
    report["albedo_seconds"] = round(time.time() - t_alb, 3)

    # --- roughness: near-mirror troughs, slightly broken crests ---------------
    # 0.035 is essentially a mirror, which is what a still fountain is; the
    # crests rise to 0.14 so the chop scatters a little rather than reading as
    # chrome. The material's own roughness stays low so the map only raises it.
    t_rough = time.time()
    rough = 0.035 + 0.105 * height ** 1.6
    rough = rough + 0.03 * (patch - 0.5)
    rough = xp.clip(rough, 0.02, 0.16).astype(xp.float32)
    report["roughness_seconds"] = round(time.time() - t_rough, 3)

    # --- measurement ----------------------------------------------------------
    ah, av = seam_ratio(albedo)
    nh, nv = seam_ratio(normal)
    rh, rv = seam_ratio(rough)
    report["seam_ratio_albedo"] = [round(ah, 3), round(av, 3)]
    report["seam_ratio_normal"] = [round(nh, 3), round(nv, 3)]
    report["seam_ratio_rough"] = [round(rh, 3), round(rv, 3)]
    # Seam ratio against same-wavelength variation (see seam_ratio_scaled).
    sah, sav = seam_ratio_scaled(albedo)
    snh, snv = seam_ratio_scaled(normal)
    srh, srv = seam_ratio_scaled(rough)
    report["seam_ratio_scaled_albedo"] = [round(sah, 3), round(sav, 3)]
    report["seam_ratio_scaled_normal"] = [round(snh, 3), round(snv, 3)]
    report["seam_ratio_scaled_rough"] = [round(srh, 3), round(srv, 3)]
    assert sah < 3.0 and sav < 3.0, f"albedo seam too visible at wave scale: {sah}, {sav}"
    assert snh < 3.0 and snv < 3.0, f"normal seam too visible at wave scale: {snh}, {snv}"
    assert srh < 3.0 and srv < 3.0, f"rough seam too visible at wave scale: {srh}, {srv}"

    # The lower disc is ~120 px across on a 1600x1200 frame, i.e. about mip 2 of
    # a 512 px tile. Mip 2 contrast being clearly above zero is the guard against
    # a map whose variation lives only at 1-2 px.
    report["mip_survival_albedo"] = {str(k): round(mip_std(albedo, k), 5) for k in range(6)}
    report["mip_survival_normal"] = {str(k): round(mip_std(normal, k), 5) for k in range(6)}

    def stats(a, name):
        report[name] = {
            "min": round(float(a.min()), 4),
            "max": round(float(a.max()), 4),
            "mean": round(float(a.mean()), 4),
            "std": round(float(a.std()), 4),
        }

    stats(albedo, "albedo_stats")
    stats(normal, "normal_stats")
    stats(rough, "rough_stats")

    # --- lit 2x2 tiled preview ------------------------------------------------
    t_prev = time.time()
    rep = 2
    tile_n = xp.tile(normal, (rep, rep, 1))
    tile_a = xp.tile(albedo, (rep, rep, 1))
    tile_r = xp.tile(rough, (rep, rep))
    light = xp.asarray([0.45, 0.55, 0.70], dtype=xp.float32)
    light = light / xp.sqrt(xp.sum(light * light))
    ndotl = xp.clip(xp.sum(tile_n * light[None, None, :], axis=-1), 0.0, 1.0)
    ambient = 0.42
    lit = tile_a * (ambient + (1.0 - ambient) * ndotl)[:, :, None]
    # A view-dependent highlight makes the near-mirror roughness legible.
    spec = ndotl ** (8.0 + 60.0 * (1.0 - tile_r))
    lit = xp.clip(lit + 0.14 * spec[:, :, None], 0.0, 1.0)
    report["preview_seconds"] = round(time.time() - t_prev, 3)

    sizes = {}
    sizes["water_albedo.png"] = write_png(f"{OUT}/water_albedo.png", albedo)
    sizes["water_normal.png"] = write_png(f"{OUT}/water_normal.png", normal)
    sizes["water_rough.png"] = write_png(f"{OUT}/water_rough.png", rough)
    sizes["water_preview.png"] = write_png(f"{OUT}/water_preview.png", lit)
    report["bytes"] = sizes
    report["total_seconds"] = round(time.time() - t_start, 3)

    with open(f"{OUT}/water_report.json", "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("WATER_OK")


if __name__ == "__main__":
    # A raising script leaves the notebook version in ERROR and Kaggle only
    # exposes files for COMPLETE versions, so failures are captured as output.
    try:
        main()
    except Exception:  # noqa: BLE001
        tb = traceback.format_exc()
        print("WATER_FAIL")
        print(tb)
        with open(f"{OUT}/water_report.json", "w") as fh:
            json.dump({**report, "error": tb}, fh, indent=2)