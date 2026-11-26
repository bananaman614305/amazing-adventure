"""Round 100: a second-generation FLAGSTONE (plaza paving) texture set.

Why a v2: the round-61 job gave the plaza its own surface, but the plaza is the
largest flat thing the player looks at and it still reads as a printed pattern.
Three things give it away, and this job fixes each one:

  1. Slabs too regular. COLS x ROWS jittered lattice means every stone is the
     same size and the joints form continuous lines across the tile. Real
     paving is laid in courses of *different* stones, with some split in half.
     This job keeps the slab-and-joint idea but varies the stone height inside a
     course (per-stone inset), so joints stagger and break like real paving.
  2. Colour too uniform. The old per-stone tint is one scalar; a real plaza has
     warm and cool stones, iron staining, and a damp channel along the joints.
     This job tints each stone in 3D and adds a broad damp/soot field.
  3. Relief too gentle. Joints were 0.10 of a normalised height; under a low
     sun that reads as a flat print. This job deepens the joint, adds a chipped
     arris (the bevel between face and joint is irregular), and lets each slab
     dish by a different amount, so grazing light catches the paving.

Everything else is held from the round-61 job on purpose: 512x512, tangent-space
normal written bottom-up for Three.js, a lit 2x2 tiled preview, seam_ratio_*
wrap checks asserted < 3, and no outside images or datasets. The game's
PNG -> WebP conversion happens on the workstation (no libwebp on the notebook).

Run: /worker/state/grunt-kaggle submit art/kaggle/plaza_floor_v2_textures.py
Outputs under /kaggle/working/: plaza_floor_v2_albedo.png
plaza_floor_v2_normal.png plaza_floor_v2_rough.png plaza_floor_v2_preview.png
plaza_floor_v2_report.json
"""

import json
import time

import numpy as np

SIZE = 512
COLS = 3          # flagstones across the tile (wide)
ROWS = 5          # courses down the tile (shallower, so stones read as slabs)
OUT = "/kaggle/working"

report = {"size": SIZE, "cols": COLS, "rows": ROWS,
          "generator": "procedural anisotropic periodic-voronoi flagstone v2",
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


def lattice(rows, cols, seed):
    rng = np.random.default_rng(seed)
    return asarray(rng.random((rows, cols)))


def value_noise(period, seed, octaves=1):
    """Tileable multi-octave value noise; lattice is period x period."""
    grid = xp.arange(SIZE, dtype=xp.float32)
    total = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    amplitude = 1.0
    norm = 0.0
    for o in range(octaves):
        p = period * (2 ** o)
        lat = lattice(p, p, seed + 1000 * o)
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
    # Cell space: x spans COLS cells, y spans ROWS cells, so a cell is wider
    # than it is tall and the Voronoi stones come out as slabs, not pebbles.
    px = (grid[None, :] + 0.5) * (COLS / SIZE)
    py = (grid[:, None] + 0.5) * (ROWS / SIZE)

    # --- flagstone centres: periodic lattice + periodic jitter ---------------
    # Same construction as round 61, but the jitter is stronger (0.40 of a cell
    # against 0.26) and per-stone *inset* is new: each stone is shrunk toward
    # its own centre by up to 10% before the joint is measured, which staggers
    # the joints so they no longer line up across the tile.
    jx = lattice(ROWS, COLS, 311)
    jy = lattice(ROWS, COLS, 577)
    jr = lattice(ROWS, COLS, 833)      # per-stone radius / dish variety
    jt = lattice(ROWS, COLS, 1201)     # per-stone tint variety
    js = lattice(ROWS, COLS, 1777)     # per-stone inset (joint stagger)
    jw = lattice(ROWS, COLS, 2099)     # per-stone warmth (cool vs warm stone)
    jc = lattice(ROWS, COLS, 2311)     # per-stone chip amount

    ci = xp.floor(px).astype(xp.int32)
    cj = xp.floor(py).astype(xp.int32)

    best = xp.full((SIZE, SIZE), 1e9, dtype=xp.float32)
    second = xp.full((SIZE, SIZE), 1e9, dtype=xp.float32)
    best_r = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    best_id = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    best_inset = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    best_warm = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    best_chip = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            jj = (cj + dj) % ROWS
            ii = (ci + di) % COLS
            # Centres sit on *integer* cell coordinates, not cell centres, so the
            # tile edge (x = 0 == x = COLS) lands inside a slab rather than on a
            # joint. With half-cell centres the wrap column read as a bright
            # grout line against dark stone (seam_ratio_albedo 4.7 on round 61).
            cx = (ci + di) + 0.40 * (jx[jj, ii] - 0.5)
            cy = (cj + dj) + 0.40 * (jy[jj, ii] - 0.5)
            dx = px - cx
            dy = py - cy
            dx = dx - COLS * xp.round(dx / COLS)
            dy = dy - ROWS * xp.round(dy / ROWS)
            dist = xp.sqrt(dx * dx + dy * dy)
            closer = dist < best
            second = xp.where(closer, best, xp.minimum(second, dist))
            best = xp.where(closer, dist, best)
            best_r = xp.where(closer, 0.40 + 0.12 * jr[jj, ii], best_r)
            best_id = xp.where(closer, jt[jj, ii], best_id)
            best_inset = xp.where(closer, 0.03 + 0.09 * js[jj, ii], best_inset)
            best_warm = xp.where(closer, jw[jj, ii], best_warm)
            best_chip = xp.where(closer, jc[jj, ii], best_chip)
    report["voronoi_seconds"] = round(time.time() - t0, 3)

    # Joint measured from the *inset* distance field: subtract a per-stone inset
    # in cell units, so a stone with a big inset has a wider joint on every side
    # and the courses break instead of forming continuous lines.
    edge = second - best - best_inset * 0.5
    # JOINT_W is in cell units; ~0.05 of a slab puts the grit line at a few
    # percent of the surface -- tight paving, not mortar.
    JOINT_W = 0.050
    face = xp.clip(edge / JOINT_W, 0.0, 1.0)
    face = face * face * (3 - 2 * face)
    joint = 1.0 - face

    # Chipped arris: the bevel between face and joint is irregular, so nibble the
    # face edge with a fine noise keyed to each stone. This is what stops the
    # paving reading as a printed grid under a low sun.
    chip_noise = value_noise(64, 4242, octaves=2)
    chip = xp.clip((chip_noise - 0.55) * 2.2, 0.0, 1.0) * best_chip
    face = xp.clip(face - chip * (1.0 - face) * 0.6, 0.0, 1.0)
    joint = 1.0 - face

    # --- grain, staining and wear --------------------------------------------
    t1 = time.time()
    grain = value_noise(16, 5, octaves=3)
    soot = value_noise(3, 91, octaves=2)        # broad dark patches
    lichen = value_noise(7, 733, octaves=2)     # finer pale speckle
    wear = value_noise(32, 149, octaves=2)      # scuffed walking line
    damp = value_noise(5, 6151, octaves=2)      # broad damp channel
    report["noise_seconds"] = round(time.time() - t1, 3)

    # --- height: flagstones nearly flush, joints recessed ---------------------
    # Each slab dishes by its own amount (0.06..0.18 of the face) and the joint
    # drops further, so grazing light finds relief without craters.
    dome = xp.clip(1.0 - xp.square(best / xp.maximum(best_r, 1e-6)), 0.0, 1.0)
    # Per-stone dish: best_id is a fresh random scalar for each stone (it is
    # written only where that stone is nearest), so it is already the stable
    # per-stone variety the height wants -- no second pass over the 9 cells.
    dish_here = 0.06 + 0.12 * best_id
    height = face * (0.92 - dish_here * dome) + grain * 0.05 + wear * 0.03
    height = height - joint * 0.16
    height = height / xp.max(height)

    # --- albedo: warm/cool grey flags, dark grit joints, soot, lichen, damp ---
    base = xp.asarray([0.590, 0.575, 0.550], dtype=xp.float32)   # ~0x96928c
    # Per-stone colour: a scalar tint plus a warm/cool axis, so the plaza has
    # both honey and slate stones rather than one grey stamped repeatedly.
    per_stone = 0.90 + 0.18 * best_id
    warm = (best_warm - 0.5) * 0.10
    shade = (0.70 + 0.30 * face) * (0.90 + 0.20 * grain) * per_stone
    albedo = xp.zeros((SIZE, SIZE, 3), dtype=xp.float32)
    tint = xp.stack([
        base[0] * (1.0 + warm),
        base[1] * (1.0 + warm * 0.15),
        base[2] * (1.0 - warm),
    ], axis=-1)
    for c in range(3):
        albedo[:, :, c] = tint[:, :, c] * shade
    joint_rgb = xp.asarray([0.300, 0.278, 0.246], dtype=xp.float32)
    for c in range(3):
        albedo[:, :, c] = albedo[:, :, c] * (1.0 - joint) + joint_rgb[c] * joint
    soot_dark = xp.clip((soot - 0.5) * 0.8, 0.0, 0.40)
    for c in range(3):
        albedo[:, :, c] = albedo[:, :, c] * (1.0 - soot_dark)
    # Damp channel: broad low areas go darker and slightly cooler, as if water
    # lingers in the worn hollows of a real plaza.
    damp_mask = xp.clip((damp - 0.55) * 1.8, 0.0, 1.0) * (1.0 - 0.5 * face)
    damp_rgb = xp.asarray([0.360, 0.372, 0.380], dtype=xp.float32)
    for c in range(3):
        albedo[:, :, c] = (albedo[:, :, c] * (1.0 - 0.30 * damp_mask)
                           + damp_rgb[c] * 0.30 * damp_mask)
    lichen_mask = xp.clip((lichen - 0.60) * 1.6, 0.0, 1.0) * face
    lichen_rgb = xp.asarray([0.615, 0.630, 0.540], dtype=xp.float32)
    for c in range(3):
        albedo[:, :, c] = (albedo[:, :, c] * (1.0 - 0.38 * lichen_mask)
                           + lichen_rgb[c] * 0.38 * lichen_mask)
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
    # Deeper joints than round 61, but still walked-smooth stone.
    strength = 1.25
    nx = -gx * strength
    ny = -gy * strength
    nz = xp.ones_like(height)
    length = xp.sqrt(nx * nx + ny * ny + nz * nz)
    normal = xp.stack([nx / length, ny / length, nz / length], axis=-1)
    normal_rgb = xp.clip(normal * 0.5 + 0.5, 0.0, 1.0)
    report["normal_seconds"] = round(time.time() - t2, 3)

    # --- roughness: polished walking wear on the faces, grit in the joints ----
    rough = xp.clip(0.80 - 0.22 * face * (0.4 + 0.6 * wear) + 0.14 * joint
                    + 0.06 * grain + 0.05 * damp_mask, 0.35, 1.0)

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
    sizes["plaza_floor_v2_albedo.png"] = write_png(f"{OUT}/plaza_floor_v2_albedo.png", albedo)
    sizes["plaza_floor_v2_normal.png"] = write_png(f"{OUT}/plaza_floor_v2_normal.png", normal_rgb)
    sizes["plaza_floor_v2_rough.png"] = write_png(f"{OUT}/plaza_floor_v2_rough.png", rough)

    # --- lit 2x2 tiled preview ------------------------------------------------
    t3 = time.time()
    rep = 2
    tile_n = xp.tile(normal, (rep, rep, 1))
    tile_a = xp.tile(albedo, (rep, rep, 1))
    tile_r = xp.tile(rough, (rep, rep))
    light = xp.asarray([0.45, 0.55, 0.70], dtype=xp.float32)
    light = light / xp.sqrt(xp.sum(light * light))
    ndotl = xp.clip(xp.sum(tile_n * light[None, None, :], axis=-1), 0.0, 1.0)
    ambient = 0.32
    lit = tile_a * (ambient + (1.0 - ambient) * ndotl)[:, :, None]
    spec = ndotl ** (8.0 + 40.0 * (1.0 - tile_r))
    lit = xp.clip(lit + 0.12 * spec[:, :, None], 0.0, 1.0)
    sizes["plaza_floor_v2_preview.png"] = write_png(f"{OUT}/plaza_floor_v2_preview.png", lit)
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

    with open(f"{OUT}/plaza_floor_v2_report.json", "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("PLAZA_FLOOR_V2_OK")


if __name__ == "__main__":
    import traceback

    # A raising script leaves the notebook version in ERROR, and Kaggle only
    # exposes files for COMPLETE versions -- so any failure has to be captured
    # as an output file instead of propagated.
    try:
        main()
    except Exception:  # noqa: BLE001
        tb = traceback.format_exc()
        print("PLAZA_FLOOR_V2_FAIL")
        print(tb)
        with open(f"{OUT}/plaza_floor_v2_error.txt", "w") as fh:
            fh.write(tb)
        with open(f"{OUT}/plaza_floor_v2_report.json", "w") as fh:
            json.dump({"status": "failed", "traceback": tb}, fh, indent=2)
        print("PLAZA_FLOOR_V2_FAIL")