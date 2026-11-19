"""Generate seamless COBBLESTONE textures for the market lane floor, on Kaggle's T4s.

Fourth bounded job in this pipeline (stone blocks, wood+brick, plaster). The lane
floor is still flat colour (0x9d9182); this gives it worn rounded cobbles set in
a grit mortar bed -- deliberately different from the plaza's running-bond blocks
so the two areas read as different surfaces underfoot.

Method: periodic Voronoi. Stone centres sit on a 6x6 lattice (one per cell) and
are jittered by a value drawn from a periodic lattice indexed modulo the period,
so the centre pattern wraps exactly. Each pixel finds its nearest centre among
the 3x3 neighbourhood of cells (with wrapped distance); the stone face is a
smooth radial falloff of that distance, mortar fills the gaps. Multi-octave
tileable grain adds tooth, a low-frequency field varies stone tint, and the
normal map is a wrapped Sobel of the height field.

Tiles at 512x512 with the same conventions as the previous jobs:
  - albedo PNG (colour), normal PNG (tangent space), rough PNG (grey)
  - seam_ratio_* in the report: wrap-around difference divided by typical
    interior neighbour difference; < 3 means no visible seam, ~1 is seamless.
  - a lit 2x2 tiled preview, shaded with the normal map.

Everything is procedural: no outside images, no datasets, no internet, no
training. Runs in seconds and writes small PNGs.

Run: /worker/state/grunt-kaggle submit art/kaggle/cobble_textures.py
Outputs under /kaggle/working/: cobble_albedo.png cobble_normal.png
cobble_rough.png cobble_preview.png cobble_report.json
"""

import json
import time

import numpy as np

SIZE = 512
CELLS = 6           # stones per tile edge
OUT = "/kaggle/working"

report = {"size": SIZE, "cells": CELLS, "generator": "procedural periodic-voronoi cobble",
          "gpu": None}
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
    """Tileable multi-octave value noise; rows by y, columns by x (take per axis)."""
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


def main():
    t0 = time.time()
    grid = xp.arange(SIZE, dtype=xp.float32)
    px = (grid[None, :] + 0.5) * (CELLS / SIZE)   # cell-space x, cols
    py = (grid[:, None] + 0.5) * (CELLS / SIZE)   # cell-space y, rows

    # --- stone centres: periodic lattice + periodic jitter ------------------
    # Jitter comes from lattices indexed modulo CELLS, so the centre pattern is
    # exactly periodic. Amplitude 0.28 cell keeps stones from crossing cells.
    jx = lattice(CELLS, 31) - 0.5
    jy = lattice(CELLS, 57) - 0.5
    jr = lattice(CELLS, 83)          # per-stone radius variety

    ci = xp.floor(px).astype(xp.int32)
    cj = xp.floor(py).astype(xp.int32)

    best = xp.full((SIZE, SIZE), 1e9, dtype=xp.float32)
    best_r = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            jj = (cj + dj) % CELLS
            ii = (ci + di) % CELLS
            cx = (ci + di) + 0.5 + 0.28 * jx[jj, ii]
            cy = (cj + dj) + 0.5 + 0.28 * jy[jj, ii]
            # Wrapped distance in cell space (torus of period CELLS).
            dx = px - cx
            dy = py - cy
            dx = dx - CELLS * xp.round(dx / CELLS)
            dy = dy - CELLS * xp.round(dy / CELLS)
            dist = xp.sqrt(dx * dx + dy * dy)
            closer = dist < best
            best = xp.where(closer, dist, best)
            best_r = xp.where(closer, 0.30 + 0.14 * jr[jj, ii], best_r)

    # Stone face: 1 at the centre, falling to 0 at the stone rim; mortar beyond.
    # Normalised distance keeps every stone the same softness regardless of size.
    nd = best / xp.maximum(best_r, 1e-6)
    face = xp.clip((1.0 - nd) / 0.35, 0.0, 1.0)
    face = face * face * (3 - 2 * face)
    report["voronoi_seconds"] = round(time.time() - t0, 3)

    # --- grain and tint ------------------------------------------------------
    t1 = time.time()
    grain = value_noise(16, 5, octaves=3)
    blotch = value_noise(3, 91, octaves=2)
    tint = 0.86 + 0.28 * value_noise(CELLS, 4242, octaves=2)
    report["noise_seconds"] = round(time.time() - t1, 3)

    # --- height: cobbles domed, mortar recessed ------------------------------
    dome = xp.clip(1.0 - nd * nd, 0.0, 1.0)
    height = face * (0.45 + 0.4 * dome) + grain * 0.12 + blotch * 0.05
    height = height / xp.max(height)

    # --- albedo: warm grey cobbles, dark grit mortar -------------------------
    base = xp.asarray([0.616, 0.569, 0.510], dtype=xp.float32)   # ~0x9d9182
    shade = 0.55 + 0.45 * face
    shade = shade * (0.84 + 0.32 * grain)
    albedo = xp.zeros((SIZE, SIZE, 3), dtype=xp.float32)
    for c in range(3):
        albedo[:, :, c] = base[c] * shade * tint
    albedo = xp.clip(albedo, 0.0, 1.0)

    # --- normal from height (wrapped Sobel) ----------------------------------
    def shift(a, dy, dx):
        return xp.roll(xp.roll(a, dy, axis=0), dx, axis=1)

    t2 = time.time()
    gx = (
        shift(height, -1, 1) + 2 * shift(height, 0, 1) + shift(height, 1, 1)
        - shift(height, -1, -1) - 2 * shift(height, 0, -1) - shift(height, 1, -1)
    )
    gy = (
        shift(height, 1, -1) + 2 * shift(height, 1, 0) + shift(height, 1, 1)
        - shift(height, -1, -1) - 2 * shift(height, -1, 0) - shift(height, -1, 1)
    )
    strength = 2.2
    nx = -gx * strength
    ny = -gy * strength
    nz = xp.ones_like(height)
    length = xp.sqrt(nx * nx + ny * ny + nz * nz)
    normal = xp.stack([nx / length, ny / length, nz / length], axis=-1)
    normal_rgb = xp.clip(normal * 0.5 + 0.5, 0.0, 1.0)
    report["normal_seconds"] = round(time.time() - t2, 3)

    # --- roughness: mortar gritty, worn cobble tops smoother ------------------
    rough = xp.clip(0.95 - 0.25 * face * dome + 0.10 * grain, 0.4, 1.0)

    # --- tiling verification --------------------------------------------------
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

    ah, av = seam_ratio(albedo)
    nh, nv = seam_ratio(normal_rgb)
    rh, rv = seam_ratio(rough)
    report["seam_ratio_albedo"] = [round(ah, 3), round(av, 3)]
    report["seam_ratio_normal"] = [round(nh, 3), round(nv, 3)]
    report["seam_ratio_rough"] = [round(rh, 3), round(rv, 3)]
    assert ah < 3.0 and av < 3.0, f"albedo seam too visible: {ah}, {av}"
    assert nh < 3.0 and nv < 3.0, f"normal seam too visible: {nh}, {nv}"
    assert rh < 3.0 and rv < 3.0, f"rough seam too visible: {rh}, {rv}"

    # --- write PNGs (stdlib zlib + struct, bottom-up for Three.js) ------------
    import struct
    import zlib

    def write_png(path, arr):
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

    sizes = {}
    sizes["cobble_albedo.png"] = write_png(f"{OUT}/cobble_albedo.png", albedo)
    sizes["cobble_normal.png"] = write_png(f"{OUT}/cobble_normal.png", normal_rgb)
    sizes["cobble_rough.png"] = write_png(f"{OUT}/cobble_rough.png", rough)

    # --- lit 2x2 tiled preview ------------------------------------------------
    t3 = time.time()
    rep = 2
    tile_n = xp.tile(normal, (rep, rep, 1))
    tile_a = xp.tile(albedo, (rep, rep, 1))
    tile_r = xp.tile(rough, (rep, rep))
    light = xp.asarray([0.45, 0.55, 0.70], dtype=xp.float32)
    light = light / xp.sqrt(xp.sum(light * light))
    ndotl = xp.clip(xp.sum(tile_n * light[None, None, :], axis=-1), 0.0, 1.0)
    ambient = 0.30
    lit = tile_a * (ambient + (1.0 - ambient) * ndotl)[:, :, None]
    spec = ndotl ** (8.0 + 40.0 * (1.0 - tile_r))
    lit = xp.clip(lit + 0.12 * spec[:, :, None], 0.0, 1.0)
    sizes["cobble_preview.png"] = write_png(f"{OUT}/cobble_preview.png", lit)
    report["preview_seconds"] = round(time.time() - t3, 3)

    def stats(a, name):
        arr = to_cpu(a)
        report[name] = {
            "min": round(float(arr.min()), 4),
            "max": round(float(arr.max()), 4),
            "mean": round(float(arr.mean()), 4),
        }

    stats(albedo, "albedo_stats")
    stats(normal_rgb, "normal_stats")
    stats(rough, "rough_stats")
    report["bytes"] = sizes
    report["total_seconds"] = round(time.time() - t_start, 3)

    with open(f"{OUT}/cobble_report.json", "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("COBBLE_OK")


if __name__ == "__main__":
    main()
