"""Generate seamless WOODEN-SHINGLE and FOLIAGE textures on Kaggle's T4 GPUs.

Third bounded job in this pipeline, and the first driven by a measurement rather
than a guess. scripts/audit-materials.mjs walks the live Three.js scene graph and
reports the visible flat (map-less) surface area per material. At the round-62
head the two largest remaining flat masses were:

  Canopy     271 m2  #95bf81   tree.glb, 12 meshes   -> no foliage family exists
  HouseRoof  190 m2  #ad8b7c   house.glb, 3 meshes   \
  MarketRoof  18 m2  #ba8877   market_stall.glb       > 219 m2 of roofing,
  StallRoof   10 m2  #ba8877   stall.glb             /  no roof family exists

No amount of remapping inside world.js can dress those: the families do not
exist in src/assets.js, so the maps have to be authored. That is this job.

  roof_*  overlapping timber shingles, kept in the game's warm 0xad8b7c tan so
          the generated maps still match the palette the art was directed to
  leaf_*  dense leaf-cluster foliage in the 0x95bf81 green family; a low-poly
          canopy reads as a flat blob without a normal map to break it up, so
          this one leans harder on surface relief than the other families

Conventions are copied from the stone / wood / brick jobs that shipped:
  - 512x512, albedo + tangent normal + roughness, seam ratios MEASURED not
    assumed (wrap difference / typical interior neighbour difference)
  - value noise is tileable when the lattice period divides the grid and the
    bilinear gather indexes rows by y and columns by x (take() per axis)
  - block patterns are sampled at cell CENTRES (grid + 0.5)
  - per-cell variety comes from a smooth periodic field, never a hash: a hash
    jumps at cell boundaries and puts unrelated values on the tile edges (that
    mistake measured as a 50x diagonal seam ratio on the first brick attempt)
  - a per-row scalar offset must be broadcast against the COLUMN grid, never
    added element-wise (element-wise paired row r's offset with column r)
  - a lit 2x2 tiled preview per material, shaded with the normal map

Run: /worker/state/grunt-kaggle submit art/kaggle/roof_foliage_textures.py
Outputs under /kaggle/working/: roof_albedo.png roof_normal.png roof_rough.png
roof_preview.png leaf_albedo.png leaf_normal.png leaf_rough.png
leaf_preview.png roof_foliage_report.json
"""

import json
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural roof shingle + leaf foliage", "gpu": None}
t_start = time.time()

xp = np
try:
    import cupy as cp

    _probe = cp.arange(8, dtype=cp.float32).sum()
    float(_probe)
    xp = cp
    report["gpu"] = cp.cuda.runtime.getDeviceProperties(0)["name"].decode()
    report["backend"] = "cupy"
except Exception as exc:  # noqa: BLE001 - numpy fallback is intentional and recorded
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


def smoothstep(x, edge0, edge1):
    t = xp.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


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


def make_roof():
    """Overlapping timber shingles for the house, market stall and lane stall.

    Rows of shingles overlap the row below, with a per-row side offset so butt
    joints never line up into vertical cracks. Kept in the game's 0xad8b7c tan
    family so the mapped roofs still match the art direction.
    """
    grid = xp.arange(SIZE, dtype=xp.float32)
    rows = 6.0
    row_f = ((grid + 0.5) / SIZE) * rows
    in_row = row_f - xp.floor(row_f)   # 0 at the row boundary, 0.5 mid-shingle

    # Per-row side offset, broadcast against the COLUMN grid. Adding a scalar
    # per row (not element-wise) is what keeps the joints staggered.
    row = xp.floor(row_f)
    col_grid = ((grid + 0.5) / SIZE) * 3.0
    side_offset = (row % 3.0) * (1.0 / 3.0)
    col_f = (col_grid[None, :] + side_offset[:, None]) % 1.0

    # The overlap groove must be CENTRED on the row boundary, not at the end of
    # the row: a groove at in_row->1 leaves a groove on one side of the tile
    # wrap and bare shingle on the other, which is a height discontinuity at the
    # seam. min(in_row, 1-in_row) is 0 at the boundary and 0.5 mid-shingle, so
    # it is symmetric about the wrap.
    edge = xp.minimum(in_row, 1.0 - in_row)
    face_row = smoothstep(edge, 0.02, 0.07)          # 0 in the groove, 1 on the face
    in_col = xp.minimum(col_f, 1.0 - col_f)
    face_side = smoothstep(in_col, 0.015, 0.045)     # narrow gap along long edges
    face = face_row[:, None] * face_side

    grain = value_noise(12, 421, octaves=3)
    weather = value_noise(4, 907, octaves=2)
    per_shingle = value_noise(6, 3311, octaves=1)
    # Slight cup across each shingle, symmetric about the row boundary (1 at the
    # overlap, 0 at mid-face). Kept as a COLUMN vector so it broadcasts over x
    # only -- as a bare 1-D array it would have broadcast along the wrong axis
    # and produced a 3-D height field.
    cup = (0.5 + 0.5 * xp.cos(in_row * 2.0 * 3.14159265))[:, None]

    height = face * (0.62 + 0.10 * cup) + grain * 0.22 + weather * 0.06
    height = height / xp.max(height)

    base = xp.asarray([0.678, 0.545, 0.486], dtype=xp.float32)  # 0xad8b7c
    tint = 0.80 + 0.40 * per_shingle
    shade = 0.58 + 0.42 * face
    shade = shade * (0.74 + 0.40 * grain) * (0.88 + 0.22 * weather)
    albedo = base[None, None, :] * (shade * tint)[:, :, None]
    albedo = xp.clip(albedo, 0.0, 1.0)

    normal = normal_from_height(height, 2.6)
    rough = xp.clip(0.90 - 0.16 * face + 0.12 * grain, 0.45, 1.0)
    return albedo, normal, rough, height


def make_leaf():
    """Dense leaf clusters for the tree canopy.

    Leaves are the hard case: a low-poly canopy has almost no silhouette
    variation, so the normal map has to carry most of the read. One leaf per
    cell of a 12x12 lattice (12 divides SIZE, so the wrap closes).

    Every pixel is evaluated against the nine nearest cell centres, with cell
    indices taken mod 12. That is what makes the pattern genuinely tileable: a
    leaf whose centre sits in the last column still spills its tip over the
    right edge, and the matching leaf from cell 0 spills the same tip over the
    left edge, so the two halves line up. Evaluating only the pixel's OWN cell
    (the obvious version) clips those overhanging tips and puts a hard seam down
    the wrap -- exactly the failure the seam assertion below is there to catch.
    """
    cells = 12
    grid = xp.arange(SIZE, dtype=xp.float32)
    X = (grid + 0.5) * (cells / SIZE)                 # pixel position, cell units
    ci = xp.floor(X).astype(xp.int32)
    ci2 = xp.broadcast_to(ci[None, :], (SIZE, SIZE))  # varies along x
    cj2 = xp.broadcast_to(ci[:, None], (SIZE, SIZE))  # varies along y
    X2 = xp.broadcast_to(X[None, :], (SIZE, SIZE))
    Y2 = xp.broadcast_to(X[:, None], (SIZE, SIZE))

    # Per-CELL jitter and angle, as 12x12 lattices indexed [cell_row, cell_col].
    # A per-pixel smooth field would wobble one leaf's shape; a per-cell constant
    # keeps each leaf a coherent rotated ellipse.
    jx_lat = (lattice(cells, 5501) - 0.5) * 0.70
    jy_lat = (lattice(cells, 6607) - 0.5) * 0.70
    ang_lat = lattice(cells, 8833) * 3.14159265

    best_d = xp.full((SIZE, SIZE), 1e9, dtype=xp.float32)
    best_ry = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    best_cell = xp.zeros((SIZE, SIZE), dtype=xp.int32)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            wc = (ci2 + di) % cells
            wr = (cj2 + dj) % cells
            # Centre of the (wrapped) neighbour in UNWRAPPED cell units, so a
            # pixel can measure its distance to a leaf that lies off-tile.
            cx = (ci2 + di) + 0.5 + jx_lat[wr, wc]
            cy = (cj2 + dj) + 0.5 + jy_lat[wr, wc]
            dx = X2 - cx
            dy = Y2 - cy
            ang = ang_lat[wr, wc]
            ca = xp.cos(ang)
            sa = xp.sin(ang)
            rx = dx * ca - dy * sa
            ry = dx * sa + dy * ca
            # Elongated leaf: long axis ~0.46 of a cell, short axis ~0.20.
            d = xp.sqrt((rx / 0.46) ** 2 + (ry / 0.20) ** 2)
            nearer = d < best_d
            best_d = xp.where(nearer, d, best_d)
            best_ry = xp.where(nearer, ry, best_ry)
            best_cell = xp.where(nearer, wr * cells + wc, best_cell)

    d = best_d
    ry = best_ry
    leaf = smoothstep(d, 1.0, 0.72)          # 1 inside a leaf, 0 outside
    vein = xp.exp(-((ry / 0.045) ** 2)) * leaf
    curl = smoothstep(d, 0.72, 1.0) * leaf

    depth = value_noise(4, 991, octaves=2)
    grain = value_noise(24, 1201, octaves=2)
    height = leaf * 0.62 + vein * 0.18 + depth * 0.12 + grain * 0.08
    height = height / xp.max(height)

    base = xp.asarray([0.584, 0.749, 0.506], dtype=xp.float32)  # 0x95bf81
    # Per-leaf tint keyed off the nearest leaf's cell, so two leaves meeting at
    # a border read as two leaves rather than one smeared blob. Direct fancy
    # indexing: xp.take() with a 2-D index would return an outer product rather
    # than the pointwise gather (and is pathologically slow here).
    tint_lat = lattice(cells, 7717)
    tint = tint_lat[best_cell // cells, best_cell % cells]
    shade = (0.50 + 0.50 * leaf) * (0.78 + 0.34 * tint)
    shade = shade * (0.84 + 0.30 * depth) * (0.90 + 0.20 * grain)
    warm = 0.10 * leaf
    albedo = xp.zeros((SIZE, SIZE, 3), dtype=xp.float32)
    albedo[:, :, 0] = base[0] * shade * (1.0 + warm)
    albedo[:, :, 1] = base[1] * shade * (1.0 + warm * 0.6)
    albedo[:, :, 2] = base[2] * shade * (1.0 - curl * 0.30)
    albedo = xp.clip(albedo, 0.0, 1.0)

    normal = normal_from_height(height, 3.2)
    rough = xp.clip(0.86 - 0.22 * leaf + 0.14 * depth, 0.40, 1.0)
    return albedo, normal, rough, height


def main():
    sizes = {}
    for name, maker in [("roof", make_roof), ("leaf", make_leaf)]:
        t0 = time.time()
        albedo, normal, rough, height = maker()
        ah, av = seam_ratio(albedo)
        nh, nv = seam_ratio(normal)
        report["seam_ratio_%s_albedo" % name] = [round(ah, 3), round(av, 3)]
        report["seam_ratio_%s_normal" % name] = [round(nh, 3), round(nv, 3)]
        assert ah < 3.0 and av < 3.0, "%s albedo seam too visible: %s %s" % (name, ah, av)
        assert nh < 3.0 and nv < 3.0, "%s normal seam too visible: %s %s" % (name, nh, nv)
        sizes["%s_albedo.png" % name] = write_png("%s/%s_albedo.png" % (OUT, name), albedo)
        sizes["%s_normal.png" % name] = write_png("%s/%s_normal.png" % (OUT, name), normal)
        sizes["%s_rough.png" % name] = write_png("%s/%s_rough.png" % (OUT, name), rough)
        sizes["%s_preview.png" % name] = write_png(
            "%s/%s_preview.png" % (OUT, name), lit_preview(albedo, normal, rough))
        stats(albedo, "%s_albedo_stats" % name)
        stats(normal, "%s_normal_stats" % name)
        stats(rough, "%s_rough_stats" % name)
        report["%s_seconds" % name] = round(time.time() - t0, 3)

    report["bytes"] = sizes
    report["total_seconds"] = round(time.time() - t_start, 3)
    with open("%s/roof_foliage_report.json" % OUT, "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("ROOF_FOLIAGE_OK")


if __name__ == "__main__":
    main()
