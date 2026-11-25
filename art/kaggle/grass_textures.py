"""Generate seamless GRASS textures for the courtyard ground, on Kaggle's T4s.

The owner played the preview and said much of the scene looks unfinished. The
largest single surface the player sees first is the courtyard ground: a flat
green plane at 34 x 34 m. This job gives it a worn meadow surface -- clumpy
blades, dry patches, and subtle mowing-scale variation -- so the plaza's paving
and the grass read as different materials.

Method (all tileable by construction, same conventions as the earlier jobs):
  - periodic value noise for clumps and patches, take() gathers per axis;
  - blade strokes are short, slightly curved runs of brightness along a warped
    direction field, drawn with smooth falloffs at periodic positions;
  - height = clump base + blades; normal = wrapped Sobel of height;
  - roughness varies with dryness, so dry patches read slightly paler.

Tiles at 512x512. Outputs: grass_albedo.png grass_normal.png grass_rough.png
grass_preview.png grass_report.json, all under /kaggle/working/.

Everything is procedural: no images, no datasets, no internet, no training.
"""

import json
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural grass", "gpu": None}
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
    """Tileable multi-octave value noise; rows by y, columns by x."""
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

    # --- warped domain, as in the stone/plaster jobs -------------------------
    warp_x = value_noise(4, 11, octaves=2) - 0.5
    warp_y = value_noise(4, 23, octaves=2) - 0.5
    grid = xp.arange(SIZE, dtype=xp.float32)
    wx = (grid[None, :] + warp_x * 20.0) % SIZE
    wy = (grid[:, None] + warp_y * 20.0) % SIZE

    def sample_warped(lat_period, seed, octaves=3):
        total = xp.zeros((SIZE, SIZE), dtype=xp.float32)
        amp, norm = 1.0, 0.0
        for o in range(octaves):
            p = lat_period * (2 ** o)
            lat = lattice(p, seed + 77 * o)
            u = wx * (p / SIZE)
            v = wy * (p / SIZE)
            i0 = xp.floor(u).astype(xp.int32) % p
            j0 = xp.floor(v).astype(xp.int32) % p
            i1 = (i0 + 1) % p
            j1 = (j0 + 1) % p
            fu = u - xp.floor(u)
            fv = v - xp.floor(v)
            su = fu * fu * (3 - 2 * fu)
            sv = fv * fv * (3 - 2 * fv)
            a = lat[j0, i0]
            b = lat[j0, i1]
            c = lat[j1, i0]
            d = lat[j1, i1]
            top = a + (b - a) * su
            bot = c + (d - c) * su
            total += amp * (top + (bot - top) * sv)
            norm += amp
            amp *= 0.5
        return total / norm

    # Clumps (mowing scale), fine blade noise, and a dryness field.
    clumps = sample_warped(8, 5, octaves=3)
    blades = sample_warped(64, 17, octaves=2)
    dry = sample_warped(3, 91, octaves=2)
    report["noise_seconds"] = round(time.time() - t0, 3)

    # --- blade strokes: brighten along the blade direction -------------------
    # The blade noise is already streaky at high frequency; sharpen it so it
    # reads as blades rather than uniform grain.
    t1 = time.time()
    blade_sharp = xp.clip((blades - 0.5) * 3.0 + 0.5, 0.0, 1.0)
    blade_sharp = blade_sharp * blade_sharp * (3 - 2 * blade_sharp)
    report["blade_seconds"] = round(time.time() - t1, 3)

    # --- height: clump bases with blade tooth -------------------------------
    height = clumps * 0.55 + blade_sharp * 0.35 + dry * 0.10
    height = height / xp.max(height)

    # --- albedo: meadow green, paler and yellower where dry ------------------
    base = xp.asarray([0.36, 0.47, 0.26], dtype=xp.float32)   # ~0x5c7842
    dry_tint = xp.asarray([0.62, 0.60, 0.30], dtype=xp.float32)
    # Shade varies with clumps (darker in the dips) and blades (brighter tips).
    shade = 0.72 + 0.28 * clumps
    shade = shade * (0.88 + 0.24 * blade_sharp)
    albedo = xp.zeros((SIZE, SIZE, 3), dtype=xp.float32)
    for c in range(3):
        albedo[:, :, c] = base[c] * (1.0 - dry * 0.55) + dry_tint[c] * (dry * 0.55)
    albedo *= shade[:, :, None]
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
    strength = 1.9
    nx = -gx * strength
    ny = -gy * strength
    nz = xp.ones_like(height)
    length = xp.sqrt(nx * nx + ny * ny + nz * nz)
    normal = xp.stack([nx / length, ny / length, nz / length], axis=-1)
    normal_rgb = xp.clip(normal * 0.5 + 0.5, 0.0, 1.0)
    report["normal_seconds"] = round(time.time() - t2, 3)

    # --- roughness: dry grass is rougher, lush blades a touch glossier --------
    rough = xp.clip(0.88 - 0.16 * (1.0 - dry) + 0.08 * blade_sharp, 0.45, 1.0)

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
    sizes["grass_albedo.png"] = write_png(f"{OUT}/grass_albedo.png", albedo)
    sizes["grass_normal.png"] = write_png(f"{OUT}/grass_normal.png", normal_rgb)
    sizes["grass_rough.png"] = write_png(f"{OUT}/grass_rough.png", rough)

    # --- lit 2x2 tiled preview -------------------------------------------------
    t3 = time.time()
    rep = 2
    tile_n = xp.tile(normal, (rep, rep, 1))
    tile_a = xp.tile(albedo, (rep, rep, 1))
    tile_r = xp.tile(rough, (rep, rep))
    light = xp.asarray([0.45, 0.55, 0.70], dtype=xp.float32)
    light = light / xp.sqrt(xp.sum(light * light))
    ndotl = xp.clip(xp.sum(tile_n * light[None, None, :], axis=-1), 0.0, 1.0)
    ambient = 0.35
    lit = tile_a * (ambient + (1.0 - ambient) * ndotl)[:, :, None]
    spec = ndotl ** (8.0 + 40.0 * (1.0 - tile_r))
    lit = xp.clip(lit + 0.10 * spec[:, :, None], 0.0, 1.0)
    sizes["grass_preview.png"] = write_png(f"{OUT}/grass_preview.png", lit)
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

    with open(f"{OUT}/grass_report.json", "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("GRASS_OK")


if __name__ == "__main__":
    main()
