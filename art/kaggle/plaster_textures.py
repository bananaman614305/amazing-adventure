"""Generate seamless PLASTER textures for the market lane walls, on Kaggle's T4 GPUs.

Third bounded job in this pipeline (stone, then wood+brick). The lane walls are
still flat colour (0x6a6053); this gives them a worn lime-plaster surface: a warm
off-white render with subtle trowel sweeps, faint staining near the base of the
tile, and small chips where the substrate shows through.

Tiles at 512x512 with the same conventions as the previous jobs:
  - albedo PNG (colour), normal PNG (tangent space), rough PNG (grey)
  - seam_ratio_* in the report: wrap-around difference divided by typical
    interior neighbour difference; < 3 means no visible seam, ~1 means the wrap
    looks like any other neighbourhood.
  - a lit 2x2 tiled preview, shaded with the normal map.

Design notes carried from the earlier jobs:
  - value noise is tileable when the lattice period divides the grid and the
    bilinear gather indexes rows by y and columns by x (take() per axis).
  - all variation comes from smooth periodic fields, never a hash: hashes jump
    at boundaries and put unrelated values on tile edges.
  - chips are drawn with smooth radial falloffs at periodic positions so a chip
    near an edge wraps to the opposite edge identically.

Run: /worker/state/grunt-kaggle submit art/kaggle/plaster_textures.py
Outputs under /kaggle/working/: plaster_albedo.png plaster_normal.png
plaster_rough.png plaster_preview.png plaster_report.json
"""

import json
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural plaster", "gpu": None}
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
    """Tileable multi-octave value noise on the SIZE grid.

    Rows indexed by the y lattice coordinate, columns by x (take per axis).
    """
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
    """Wrap difference / typical interior neighbour difference, per axis."""
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
    a = a[::-1]  # glTF/Three.js textures are bottom-up
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


def make_plaster():
    """Worn lime plaster: trowel sweeps, gentle staining, small chips.

    Everything is periodic on the tile: noise octaves divide SIZE, and chip
    centres wrap with modulo, so a chip near an edge continues on the far edge.
    """
    # Base: warm off-white lime, with large soft mottling (trowel passes).
    sweeps = value_noise(4, seed=71, octaves=3)
    fine = value_noise(32, seed=72, octaves=2)
    grain = value_noise(128, seed=73, octaves=1)

    height = 0.55 * sweeps + 0.30 * fine + 0.15 * grain

    # Chips: smooth radial dents at periodic centres. Draw on wrapped offsets so
    # a chip crossing an edge appears on the opposite edge too.
    chip = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    rng = np.random.default_rng(77)
    gy, gx = xp.meshgrid(xp.arange(SIZE, dtype=xp.float32),
                         xp.arange(SIZE, dtype=xp.float32), indexing="ij")
    for _ in range(9):
        cx = float(rng.random()) * SIZE
        cy = float(rng.random()) * SIZE
        radius = float(rng.uniform(10.0, 26.0))
        depth = float(rng.uniform(0.35, 0.6))
        # wrapped torus distance: min over the 9 neighbouring copies
        best = None
        for oy in (-SIZE, 0.0, SIZE):
            for ox in (-SIZE, 0.0, SIZE):
                dx = gx - (cx + ox)
                dy = gy - (cy + oy)
                d = xp.sqrt(dx * dx + dy * dy)
                best = d if best is None else xp.minimum(best, d)
        falloff = xp.clip(1.0 - best / radius, 0.0, 1.0)
        falloff = falloff * falloff * (3.0 - 2.0 * falloff)  # smoothstep
        chip = xp.maximum(chip, depth * falloff)

    height = height - chip

    # Albedo: lime white tinted by sweeps; chips expose a darker substrate;
    # a faint periodic stain field adds age without breaking tileability.
    stain = value_noise(8, seed=74, octaves=2)
    lime = xp.asarray([0.86, 0.83, 0.76], dtype=xp.float32)
    substrate = xp.asarray([0.45, 0.42, 0.38], dtype=xp.float32)
    shade = 0.82 + 0.30 * sweeps + 0.10 * fine
    shade = shade - 0.18 * stain
    base = lime[None, None, :] * shade[:, :, None]
    chip_mask = xp.clip(chip / 0.35, 0.0, 1.0)[:, :, None]
    albedo = base * (1.0 - chip_mask) + substrate[None, None, :] * chip_mask
    albedo = xp.clip(albedo, 0.0, 1.0)

    # Roughness: plaster is matte; chips are rougher, trowel-polished sweeps smoother.
    rough = xp.clip(0.86 + 0.10 * chip - 0.12 * (sweeps - 0.5), 0.0, 1.0)

    normal = normal_from_height(height, strength=1.4)
    return albedo, normal, rough, height


def main():
    t0 = time.time()
    albedo, normal, rough, height = make_plaster()
    ah, av = seam_ratio(albedo)
    nh, nv = seam_ratio(normal)
    report["seam_ratio_plaster_albedo"] = [round(ah, 3), round(av, 3)]
    report["seam_ratio_plaster_normal"] = [round(nh, 3), round(nv, 3)]
    assert ah < 3.0 and av < 3.0, "plaster albedo seam too visible: %s %s" % (ah, av)
    assert nh < 3.0 and nv < 3.0, "plaster normal seam too visible: %s %s" % (nh, nv)
    sizes = {}
    sizes["plaster_albedo.png"] = write_png("%s/plaster_albedo.png" % OUT, albedo)
    sizes["plaster_normal.png"] = write_png("%s/plaster_normal.png" % OUT, normal)
    sizes["plaster_rough.png"] = write_png("%s/plaster_rough.png" % OUT, rough)
    sizes["plaster_preview.png"] = write_png(
        "%s/plaster_preview.png" % OUT, lit_preview(albedo, normal, rough))
    stats(albedo, "plaster_albedo_stats")
    stats(normal, "plaster_normal_stats")
    stats(rough, "plaster_rough_stats")
    report["plaster_seconds"] = round(time.time() - t0, 3)
    report["bytes"] = sizes
    report["total_seconds"] = round(time.time() - t_start, 3)
    with open("%s/plaster_report.json" % OUT, "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("PLASTER_OK")


if __name__ == "__main__":
    main()
