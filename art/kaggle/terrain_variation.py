"""Generate seamless TERRAIN-VARIATION textures for the plaza floor, on Kaggle's T4 GPUs.

Round 58 graphics pass: the plaza floor is currently a flat 0x8a8075 colour.
This adds a weathered flagstone albedo (warm grey stone with moss and wet
patches), a matching roughness map, and a subtle tangent-space normal map, all
tileable so they can be applied to the plaza mesh without visible seams.

Tiles at 1024x1024 with the same conventions as the earlier jobs:
  - albedo PNG (colour), normal PNG (tangent space), rough PNG (grey)
  - seam_ratio_* in the report: wrap-around difference divided by typical
    interior neighbour difference; < 3 means no visible seam.
  - a lit 2x2 tiled preview, shaded with the normal map.

Design notes carried from the earlier jobs:
  - value noise is tileable when the lattice period divides the grid and the
    bilinear gather indexes rows by y and columns by x (take() per axis).
  - all variation comes from smooth periodic fields, never a hash: hashes jump
    at boundaries and put unrelated values on tile edges.
  - moss/wet patches drawn with smooth periodic masks so they wrap identically.

Run: /worker/state/grunt-kaggle submit art/kaggle/terrain_variation.py
Outputs under /kaggle/working/: terrain_albedo.png terrain_normal.png
terrain_rough.png terrain_preview.png terrain_report.json
"""

import json
import time

import numpy as np

SIZE = 1024
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural terrain variation", "gpu": None}
t_start = time.time()

xp = np
try:
    import cupy as cp

    _probe = cp.arange(8, dtype=cp.float32).sum()
    float(_probe)
    xp = cp
    report["gpu"] = cp.cuda.runtime.getDeviceProperties(0)["name"].decode()
    report["backend"] = "cupy"
except Exception as exc:  # noqa: BLE001 - fallback is intentional and recorded
    report["backend"] = "numpy"
    report["gpu_error"] = str(exc)[:200]


def to_cpu(a):
    if xp is np:
        return np.asarray(a)
    return cp.asnumpy(a)


def asarray(a):
    return xp.asarray(a, dtype=xp.float32)


def lattice(period, seed):
    rng = np.random.default_rng(seed)
    return asarray(rng.random((period, period)))


def value_noise(period, seed, octaves=1):
    grid = xp.arange(SIZE, dtype=xp.float32)
    total = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    amplitude = 1.0
    norm = 0.0
    for o in range(octaves):
        p = period * (2 ** o)
        lat = lattice(p, seed + 1000 * o)
        u = grid * (p / SIZE)
        i0 = xp.floor(u).astype(xp.int32) % p
        i1 = (i0 + 1) % p
        f = u - xp.floor(u)
        w = f * f * (3.0 - 2.0 * f)
        wx = w[None, :]
        wy = w[:, None]
        rows0 = xp.take(lat, i0, axis=0)
        rows1 = xp.take(lat, i1, axis=0)
        a = xp.take(rows0, i0, axis=1)
        b = xp.take(rows0, i1, axis=1)
        c = xp.take(rows1, i0, axis=1)
        d = xp.take(rows1, i1, axis=1)
        top = a + (b - a) * wx
        bottom = c + (d - c) * wx
        total += amplitude * (top + (bottom - top) * wy)
        norm += amplitude
        amplitude *= 0.5
    return total / norm


def seam_ratio(a):
    arr = to_cpu(a)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    seam_h = np.abs(arr[:, 0, :] - arr[:, -1, :]).mean()
    seam_v = np.abs(arr[0, :, :] - arr[-1, :, :]).mean()
    interior_h = np.abs(arr[:, 1:, :] - arr[:, :-1, :]).mean()
    interior_v = np.abs(arr[1:, :, :] - arr[:-1, :, :]).mean()
    return (float(seam_h / max(interior_h, 1e-9)),
            float(seam_v / max(interior_v, 1e-9)))


def normal_from_height(height, strength):
    def shift(a, dy, dx):
        return xp.roll(xp.roll(a, dy, axis=0), dx, axis=1)

    gx = (shift(height, -1, 1) + 2 * shift(height, 0, 1) + shift(height, 1, 1)
          - shift(height, -1, -1) - 2 * shift(height, 0, -1) - shift(height, 1, -1))
    gy = (shift(height, 1, -1) + 2 * shift(height, 1, 0) + shift(height, 1, 1)
          - shift(height, -1, -1) - 2 * shift(height, -1, 0) - shift(height, -1, 1))
    nx = -gx * strength
    ny = -gy * strength
    nz = xp.ones_like(height)
    length = xp.sqrt(nx * nx + ny * ny + nz * nz)
    normal = xp.stack([nx / length, ny / length, nz / length], axis=-1)
    return xp.clip(normal * 0.5 + 0.5, 0.0, 1.0)


def lit_preview(albedo, normal, rough, rep=2):
    tile_n = xp.tile(normal, (rep, rep, 1))
    tile_a = xp.tile(albedo, (rep, rep, 1))
    tile_r = xp.tile(rough, (rep, rep))
    light = xp.asarray([0.45, 0.55, 0.70], dtype=xp.float32)
    light = light / xp.sqrt(xp.sum(light * light))
    ndotl = xp.clip(xp.sum(tile_n * light[None, None, :], axis=-1), 0.0, 1.0)
    ambient = 0.30
    lit = tile_a * (ambient + (1.0 - ambient) * ndotl)[:, :, None]
    spec = ndotl ** (8.0 + 40.0 * (1.0 - tile_r))
    return xp.clip(lit + 0.12 * spec[:, :, None], 0.0, 1.0)


def write_png(path, arr):
    import struct
    import zlib

    a = to_cpu(arr)
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


def stats(a, name):
    arr = to_cpu(a)
    report[name] = {
        "min": round(float(arr.min()), 4),
        "max": round(float(arr.max()), 4),
        "mean": round(float(arr.mean()), 4),
    }


def make_terrain():
    # Height field: large flagstone slabs with worn edges and mortar grooves.
    slabs = value_noise(8, seed=11, octaves=2)
    detail = value_noise(32, seed=12, octaves=2)
    micro = value_noise(128, seed=13, octaves=1)
    height = 0.50 * slabs + 0.30 * detail + 0.20 * micro

    # Mortar lines: a thresholded mid-frequency band, softened.
    mortar_band = value_noise(16, seed=14, octaves=1)
    mortar = xp.clip((mortar_band - 0.55) * 4.0, 0.0, 1.0)
    mortar = mortar * mortar * (3.0 - 2.0 * mortar)
    height = height * (1.0 - 0.35 * mortar)

    # Moss patches: smooth low-frequency mask, concentrated in low areas.
    moss_mask = value_noise(6, seed=21, octaves=2)
    moss_mask = xp.clip((moss_mask - 0.45) * 2.2, 0.0, 1.0)
    moss_mask = moss_mask * moss_mask * (3.0 - 2.0 * moss_mask)
    # moss prefers low spots
    low = xp.clip(0.5 - height, 0.0, 1.0)
    moss = moss_mask * (0.4 + 0.6 * low)

    # Wet patches: a few broad darkened areas.
    wet = value_noise(4, seed=22, octaves=1)
    wet = xp.clip((wet - 0.6) * 3.0, 0.0, 1.0)

    # Albedo: warm grey stone, darkened in mortar, greened where moss, darkened where wet.
    stone = xp.asarray([0.52, 0.49, 0.44], dtype=xp.float32)
    mortar_col = xp.asarray([0.30, 0.28, 0.25], dtype=xp.float32)
    moss_col = xp.asarray([0.28, 0.34, 0.22], dtype=xp.float32)

    shade = 0.78 + 0.34 * slabs + 0.12 * detail
    base = stone[None, None, :] * shade[:, :, None]
    # mortar recolour
    mm = mortar[:, :, None]
    base = base * (1.0 - mm) + mortar_col[None, None, :] * mm
    # moss blend
    moss3 = moss[:, :, None]
    base = base * (1.0 - 0.65 * moss3) + moss_col[None, None, :] * (0.65 * moss3)
    # wet darken
    wet3 = wet[:, :, None]
    base = base * (1.0 - 0.22 * wet3)
    albedo = xp.clip(base, 0.0, 1.0)

    # Roughness: stone moderate, mortar rougher, moss slightly smoother, wet smoother.
    rough = xp.clip(0.62 + 0.18 * detail - 0.10 * moss + 0.12 * mortar - 0.15 * wet, 0.0, 1.0)

    normal = normal_from_height(height, strength=1.1)
    return albedo, normal, rough, height


def main():
    t0 = time.time()
    albedo, normal, rough, height = make_terrain()
    ah, av = seam_ratio(albedo)
    nh, nv = seam_ratio(normal)
    rh, rv = seam_ratio(rough)
    report["seam_ratio_terrain_albedo"] = [round(ah, 3), round(av, 3)]
    report["seam_ratio_terrain_normal"] = [round(nh, 3), round(nv, 3)]
    report["seam_ratio_terrain_rough"] = [round(rh, 3), round(rv, 3)]
    assert ah < 3.0 and av < 3.0, "terrain albedo seam too visible"
    assert nh < 3.0 and nv < 3.0, "terrain normal seam too visible"
    assert rh < 3.0 and rv < 3.0, "terrain rough seam too visible"

    sizes = {}
    sizes["terrain_albedo.png"] = write_png("%s/terrain_albedo.png" % OUT, albedo)
    sizes["terrain_normal.png"] = write_png("%s/terrain_normal.png" % OUT, normal)
    sizes["terrain_rough.png"] = write_png("%s/terrain_rough.png" % OUT, rough)
    sizes["terrain_preview.png"] = write_png(
        "%s/terrain_preview.png" % OUT, lit_preview(albedo, normal, rough))
    stats(albedo, "terrain_albedo_stats")
    stats(normal, "terrain_normal_stats")
    stats(rough, "terrain_rough_stats")
    report["terrain_seconds"] = round(time.time() - t0, 3)
    report["bytes"] = sizes
    report["total_seconds"] = round(time.time() - t_start, 3)
    with open("%s/terrain_report.json" % OUT, "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("TERRAIN_OK")


if __name__ == "__main__":
    main()
