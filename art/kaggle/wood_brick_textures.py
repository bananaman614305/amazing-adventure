"""Generate seamless WOOD and BRICK textures for the plaza, on Kaggle's T4 GPUs.

Second bounded job in this pipeline. The first (stone) proved the shape: fully
procedural, no downloads, seam ratios measured not assumed, small PNG outputs.
This one adds the two surfaces the round-29 assets need:

  wood_*   for the modelled barrels and the stalls/crates/bench material
  brick_*  for the house walls

Both tile at 512x512 with the same conventions as the stone job:
  - albedo PNG (colour), normal PNG (tangent space), rough PNG (grey)
  - seam_ratio_* in the report: wrap-around difference divided by typical
    interior neighbour difference; < 3 means no visible seam, ~1 means the wrap
    looks like any other neighbourhood.
  - a lit 2x2 tiled preview per material, shaded with the normal map.

Design notes (learned from five seam-debugging rounds on the stone job):
  - value noise is tileable when the lattice period divides the grid and the
    bilinear gather indexes rows by y and columns by x (take() per axis).
  - block patterns must be sampled at cell CENTRES (grid + 0.5), not left edges.
  - per-block colour variety comes from a smooth periodic field, never a hash:
    hashes jump at block boundaries and put unrelated values on tile edges.

Run: /worker/state/grunt-kaggle submit art/kaggle/wood_brick_textures.py
Outputs under /kaggle/working/: wood_albedo.png wood_normal.png wood_rough.png
wood_preview.png brick_albedo.png brick_normal.png brick_rough.png
brick_preview.png wood_brick_report.json
"""

import json
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural wood + brick", "gpu": None}
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


def make_wood():
    """Vertical planks with grain and recessed seams between planks.

    4 planks per tile (period divides SIZE). Tile edges cross plain plank
    interior, not a seam line, so the wrap has nothing abrupt to show.
    """
    grid = xp.arange(SIZE, dtype=xp.float32)
    planks = 4.0
    col_f = ((grid + 0.5) / SIZE) * planks
    plank = xp.floor(col_f)
    in_plank = col_f - plank

    # Grain: stretched along y (vertical planks), warped slightly so the lines
    # wander. The warp field is tileable, so the warped sample stays tileable.
    warp = value_noise(4, 311, octaves=2) - 0.5
    u = ((grid[None, :] + warp * 9.0) % SIZE)
    period = 16
    lat = lattice(period, 777)
    gu = u * (period / SIZE)
    gv = (grid[:, None] * (2.0 / SIZE)) * period  # stretched 8x along y
    gi0 = xp.floor(gu).astype(xp.int32) % period
    gj0 = xp.floor(gv).astype(xp.int32) % period
    gi1 = (gi0 + 1) % period
    gj1 = (gj0 + 1) % period
    fu = gu - xp.floor(gu)
    fv = gv - xp.floor(gv)
    su = fu * fu * (3 - 2 * fu)
    sv = fv * fv * (3 - 2 * fv)
    a = lat[gj0, gi0]
    b = lat[gj0, gi1]
    c = lat[gj1, gi0]
    d = lat[gj1, gi1]
    top = a + (b - a) * su
    bot = c + (d - c) * su
    grain = top + (bot - top) * sv

    # Growth-ring stripes riding on the grain. sin of a tileable field is
    # tileable; the extra noise makes ring spacing irregular.
    rings = 0.5 + 0.5 * xp.sin((grain * 6.0 + value_noise(8, 913, 2) * 1.5) * 6.2831853)
    rings = rings ** 2.0

    # Plank seam groove near each plank boundary.
    du = xp.minimum(in_plank, 1.0 - in_plank)
    face = xp.clip((du - 0.030) / 0.025, 0.0, 1.0)
    face = face * face * (3 - 2 * face)
    face2 = xp.broadcast_to(face[None, :], (SIZE, SIZE))

    height = face2 * 0.55 + grain * 0.30 + rings * 0.15
    height = height / xp.max(height)

    # Colour: the game's wood is 0x8a5a33. Per-plank tint from a smooth periodic
    # field sampled at plank centres (never a hash -- see module docstring).
    base = xp.asarray([0.541, 0.353, 0.200], dtype=xp.float32)
    centre_u = (plank + 0.5) * (SIZE / planks)
    tu = (centre_u / SIZE * 4.0) + 0.0137
    ti0 = xp.floor(tu).astype(xp.int32) % 4
    ti1 = (ti0 + 1) % 4
    fu2 = tu - xp.floor(tu)
    su2 = fu2 * fu2 * (3 - 2 * fu2)
    tint_lat = lattice(4, 5150)
    ta = xp.take(tint_lat[1], ti0, axis=0)
    tb = xp.take(tint_lat[1], ti1, axis=0)
    tint = 0.86 + 0.28 * (ta + (tb - ta) * su2)[None, :]

    shade = 0.55 + 0.45 * face2
    shade = shade * (0.72 + 0.42 * grain) * (0.88 + 0.24 * rings)
    albedo = xp.zeros((SIZE, SIZE, 3), dtype=xp.float32)
    for ch in range(3):
        albedo[:, :, ch] = base[ch] * shade * tint
    albedo = xp.clip(albedo, 0.0, 1.0)

    normal = normal_from_height(height, 2.2)
    rough = xp.clip(0.88 - 0.18 * face2 + 0.10 * grain, 0.45, 1.0)
    return albedo, normal, rough, height


def make_brick():
    """Running-bond brick, 4 courses x 2 bricks per tile.

    Same conventions as the stone job that shipped: cell-centre sampling,
    quarter-phase course offset (keeps tile edges mid-brick), per-brick tint
    from a continuous tileable field.
    """
    grid = xp.arange(SIZE, dtype=xp.float32)
    courses = 4.0
    row_f = ((grid + 0.5) / SIZE) * courses
    row = xp.floor(row_f)
    in_row = row_f - row
    offset = (row % 2.0) * 0.25
    # offset is per-ROW, so it must be broadcast against the column grid, not
    # added element-wise (which paired row r's offset with column r and produced
    # a diagonal seam measured at ratio 50.9).
    col_grid = ((xp.arange(SIZE, dtype=xp.float32) + 0.5) / SIZE) * 2.0
    col_f = (col_grid[None, :] + offset[:, None]) % 1.0
    joint_w = 0.045
    dv = xp.minimum(in_row, 1.0 - in_row)              # (SIZE,)  per course row
    du = xp.minimum(col_f, 1.0 - col_f)                # (SIZE, SIZE) per-pixel
    # du is already 2D (each row's offset shifts its columns), so it must not be
    # re-broadcast with [None, :]: that produced a 3D array and a NaN seam metric.
    dist = xp.minimum(dv[:, None], du)
    face = xp.clip((dist - joint_w) / 0.035, 0.0, 1.0)
    face = face * face * (3 - 2 * face)

    grain = value_noise(8, 61, octaves=4)
    blotch = value_noise(3, 163, octaves=2)
    height = face * 0.72 + grain * 0.20 + blotch * 0.08
    height = height / xp.max(height)

    # Fired-clay red-brown, distinct from the plaza stone but in the same warm
    # family so the house does not look pasted in.
    base = xp.asarray([0.545, 0.300, 0.235], dtype=xp.float32)
    tint = 0.84 + 0.32 * value_noise(4, 8282, octaves=2)
    shade = 0.60 + 0.40 * face
    shade = shade * (0.80 + 0.40 * grain)
    albedo = xp.zeros((SIZE, SIZE, 3), dtype=xp.float32)
    for ch in range(3):
        albedo[:, :, ch] = base[ch] * shade * tint
    albedo = xp.clip(albedo, 0.0, 1.0)

    normal = normal_from_height(height, 2.8)
    rough = xp.clip(0.94 - 0.20 * face + 0.12 * grain, 0.40, 1.0)
    return albedo, normal, rough, height


def main():
    sizes = {}
    for name, maker in [("wood", make_wood), ("brick", make_brick)]:
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
    with open("%s/wood_brick_report.json" % OUT, "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("WOOD_BRICK_OK")


if __name__ == "__main__":
    main()
