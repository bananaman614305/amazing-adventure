"""Generate seamless FLAGSTONE (plaza paving) textures, on Kaggle's T4s.

Sixth bounded job in this pipeline (stone blocks, wood+brick, plaster, cobble,
bark, lamp metal). The market lane floor got worn rounded cobbles in
cobble_textures.py; the open plaza is still a flat colour. This job gives the
plaza its own surface so the two areas read differently underfoot: large worn
flagstones laid in rough courses, grit-filled joints, chipped corners and faint
soot/lichen staining.

Method: periodic Voronoi, but anisotropic. Slab centres sit on a jittered
lattice that is wide in x (COLS across the tile) and shallower in y (ROWS courses
down the tile); the jitter is read from lattices indexed modulo (ROWS, COLS) so
the centre pattern wraps exactly on the torus. Centres are placed on integer
cell coordinates rather than cell centres, which keeps the tile edge inside a
slab instead of along a joint -- see the note at the Voronoi loop. Each pixel finds its nearest and
second-nearest centre among the 3x3 neighbourhood of cells, using wrapped
distance; the joint is the narrow ridge where those two are nearly equidistant,
which is a property of the cell boundaries and therefore stays thin however the
centres jitter. (A fixed per-stone radius, as the cobble job uses, cannot: it has
to be small enough for the widest gap in the lattice, which turned the plaza into
40% grout on the first run.) A low-frequency periodic field darkens some slabs
(soot) and lifts others (lichen), which is what makes a stone plaza look walked
rather than printed.

Same conventions as the previous jobs:
  - 512x512 albedo / normal (tangent space) / rough PNGs, written bottom-up for
    Three.js, plus a lit 2x2 tiled preview.
  - seam_ratio_* in the report: wrap-around difference divided by typical
    interior neighbour difference; < 3 means no visible seam, ~1 is seamless.
  - everything procedural: no outside images, no datasets, no internet.
  - output is PNG; the game's WEBP conversion happens on this workstation, not
    in the notebook (no libwebp there).

Run: /worker/state/grunt-kaggle submit art/kaggle/plaza_floor_textures.py
Outputs under /kaggle/working/: plaza_floor_albedo.png
plaza_floor_normal.png plaza_floor_rough.png plaza_floor_preview.png
plaza_floor_report.json
"""

import json
import time

import numpy as np

SIZE = 512
COLS = 3          # flagstones across the tile (wide)
ROWS = 5          # courses down the tile (shallower, so stones read as slabs)
OUT = "/kaggle/working"

report = {"size": SIZE, "cols": COLS, "rows": ROWS,
          "generator": "procedural anisotropic periodic-voronoi flagstone",
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
    jx = lattice(ROWS, COLS, 311)
    jy = lattice(ROWS, COLS, 577)
    jr = lattice(ROWS, COLS, 833)      # per-stone radius variety
    jt = lattice(ROWS, COLS, 1201)     # per-stone tint variety

    ci = xp.floor(px).astype(xp.int32)
    cj = xp.floor(py).astype(xp.int32)

    best = xp.full((SIZE, SIZE), 1e9, dtype=xp.float32)
    second = xp.full((SIZE, SIZE), 1e9, dtype=xp.float32)
    best_r = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    best_id = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            jj = (cj + dj) % ROWS
            ii = (ci + di) % COLS
            # Centres sit on *integer* cell coordinates, not cell centres.
            # This matters: a joint is the ridge equidistant from two centres,
            # so with centres at half-cells the tile edge (x = 0 == x = COLS)
            # lands exactly on a joint and the wrap column reads as a bright
            # grout line against dark stone -- seam_ratio_albedo was 4.7.
            # With centres on integers the seam runs through slab interiors,
            # where the surface is flat, and the ratio drops below 0.2.
            cx = (ci + di) + 0.26 * (jx[jj, ii] - 0.5)
            cy = (cj + dj) + 0.26 * (jy[jj, ii] - 0.5)
            # Wrapped distance on the (COLS, ROWS) torus.
            dx = px - cx
            dy = py - cy
            dx = dx - COLS * xp.round(dx / COLS)
            dy = dy - ROWS * xp.round(dy / ROWS)
            dist = xp.sqrt(dx * dx + dy * dy)
            closer = dist < best
            # Keep the runner-up too: paving joints are where two slabs are
            # equidistant, which is a property of the cell boundaries and stays
            # narrow no matter how the centres jitter. Deriving the joint from a
            # fixed per-stone radius instead made the grout ~40% of the tile
            # (albedo mean 0.34, too dark and too sandy) because the radius has
            # to be small enough for the widest gap in the jittered lattice.
            second = xp.where(closer, best, xp.minimum(second, dist))
            best = xp.where(closer, dist, best)
            best_r = xp.where(closer, 0.40 + 0.10 * jr[jj, ii], best_r)
            best_id = xp.where(closer, jt[jj, ii], best_id)
    report["voronoi_seconds"] = round(time.time() - t0, 3)

    # Slab face: 1 across the whole slab, falling to 0 within a narrow band of
    # the cell boundary. JOINT_W is in cell units, so ~0.05 of a 0.25-cell-wide
    # slab puts the grit line at roughly 4-5% of the surface -- tight paving,
    # not mortar. The smoothstep keeps the bevel rounded rather than a hard step.
    JOINT_W = 0.055
    edge = second - best
    face = xp.clip(edge / JOINT_W, 0.0, 1.0)
    face = face * face * (3 - 2 * face)
    joint = 1.0 - face

    # --- grain, staining and wear --------------------------------------------
    t1 = time.time()
    grain = value_noise(16, 5, octaves=3)
    soot = value_noise(3, 91, octaves=2)        # broad dark patches
    lichen = value_noise(7, 733, octaves=2)     # finer pale speckle
    wear = value_noise(32, 149, octaves=2)      # scuffed walking line
    report["noise_seconds"] = round(time.time() - t1, 3)

    # --- height: flagstones nearly flush, joints recessed ---------------------
    # Each slab is dished very slightly (dome) from centuries of feet; the real
    # relief is the joint, which drops away over the bevel.
    dome = xp.clip(1.0 - xp.square(best / xp.maximum(best_r, 1e-6)), 0.0, 1.0)
    height = face * (0.80 + 0.12 * dome) + grain * 0.06 + wear * 0.03
    height = height - joint * 0.10
    height = height / xp.max(height)

    # --- albedo: warm grey flags, dark grit joints, soot and lichen ----------
    # Slightly cooler and greyer than the lane cobbles (0x9d9182) so the open
    # plaza reads as dressed stone rather than rounded setts.
    base = xp.asarray([0.588, 0.573, 0.549], dtype=xp.float32)   # ~0x96928c
    per_stone = 0.90 + 0.20 * best_id
    shade = (0.72 + 0.28 * face) * (0.90 + 0.20 * grain) * per_stone
    albedo = xp.zeros((SIZE, SIZE, 3), dtype=xp.float32)
    for c in range(3):
        albedo[:, :, c] = base[c] * shade
    joint_rgb = xp.asarray([0.318, 0.294, 0.259], dtype=xp.float32)
    for c in range(3):
        albedo[:, :, c] = albedo[:, :, c] * (1.0 - joint) + joint_rgb[c] * joint
    soot_dark = xp.clip((soot - 0.5) * 0.7, 0.0, 0.35)
    for c in range(3):
        albedo[:, :, c] = albedo[:, :, c] * (1.0 - soot_dark)
    lichen_mask = xp.clip((lichen - 0.62) * 1.6, 0.0, 1.0) * face
    lichen_rgb = xp.asarray([0.62, 0.635, 0.545], dtype=xp.float32)
    for c in range(3):
        albedo[:, :, c] = (albedo[:, :, c] * (1.0 - 0.35 * lichen_mask)
                           + lichen_rgb[c] * 0.35 * lichen_mask)
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
    # Plaza stone is walked smooth, so relief stays gentle: no cobble craters.
    strength = 0.9
    nx = -gx * strength
    ny = -gy * strength
    nz = xp.ones_like(height)
    length = xp.sqrt(nx * nx + ny * ny + nz * nz)
    normal = xp.stack([nx / length, ny / length, nz / length], axis=-1)
    normal_rgb = xp.clip(normal * 0.5 + 0.5, 0.0, 1.0)
    report["normal_seconds"] = round(time.time() - t2, 3)

    # --- roughness: polished walking wear on the faces, grit in the joints ----
    rough = xp.clip(0.78 - 0.20 * face * (0.4 + 0.6 * wear) + 0.16 * joint
                    + 0.06 * grain, 0.35, 1.0)

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
    sizes["plaza_floor_albedo.png"] = write_png(f"{OUT}/plaza_floor_albedo.png", albedo)
    sizes["plaza_floor_normal.png"] = write_png(f"{OUT}/plaza_floor_normal.png", normal_rgb)
    sizes["plaza_floor_rough.png"] = write_png(f"{OUT}/plaza_floor_rough.png", rough)

    # --- lit 2x2 tiled preview ------------------------------------------------
    t3 = time.time()
    rep = 2
    tile_n = xp.tile(normal, (rep, rep, 1))
    tile_a = xp.tile(albedo, (rep, rep, 1))
    tile_r = xp.tile(rough, (rep, rep))
    light = xp.asarray([0.45, 0.55, 0.70], dtype=xp.float32)
    light = light / xp.sqrt(xp.sum(light * light))
    ndotl = xp.clip(xp.sum(tile_n * light[None, None, :], axis=-1), 0.0, 1.0)
    ambient = 0.34
    lit = tile_a * (ambient + (1.0 - ambient) * ndotl)[:, :, None]
    spec = ndotl ** (8.0 + 40.0 * (1.0 - tile_r))
    lit = xp.clip(lit + 0.10 * spec[:, :, None], 0.0, 1.0)
    sizes["plaza_floor_preview.png"] = write_png(f"{OUT}/plaza_floor_preview.png", lit)
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

    with open(f"{OUT}/plaza_floor_report.json", "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("PLAZA_FLOOR_OK")


if __name__ == "__main__":
    import traceback

    # A raising script leaves the notebook version in ERROR, and Kaggle only
    # exposes files for COMPLETE versions -- so any failure has to be captured
    # as an output file instead of propagated.
    try:
        main()
    except Exception:  # noqa: BLE001
        tb = traceback.format_exc()
        print("PLAZA_FLOOR_FAIL")
        print(tb)
        with open(f"{OUT}/plaza_floor_error.txt", "w") as fh:
            fh.write(tb)
        with open(f"{OUT}/plaza_floor_report.json", "w") as fh:
            json.dump({"status": "failed", "traceback": tb}, fh, indent=2)
        print("PLAZA_FLOOR_FAIL")
