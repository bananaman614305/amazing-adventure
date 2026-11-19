"""Generate seamless stone textures for the plaza fountain, on Kaggle's T4 GPUs.

Independent of the Blender asset: Blender produces geometry, this produces surface.
The game currently has zero textures -- every material is a flat colour -- so even a
modest tileable stone map is a real visual step.

Why GPU: the useful part is not one noise lookup but a *stack* of them (multi-octave
value noise, warped domain, per-pixel mortar mask, then a Sobel normal derive) over
512x512, evaluated for several variants. That is a few hundred million float ops,
which is trivial for a T4 and slow in pure Python. CuPy does it in one kernel each.

Bounded on purpose: 512x512, three maps, a handful of variants, no training, no
downloads, no internet. Runs in seconds and writes small PNGs.

Everything is procedural. No outside images, no datasets, no licensed inputs, so the
output carries no third-party licence obligations.

Outputs under /kaggle/working/:
  stone_albedo.png   tileable colour map
  stone_normal.png   tileable tangent-space normal map
  stone_rough.png    tileable roughness map
  stone_preview.png  a lit sphere-ish preview strip for eyeballing tiling
  stone_report.json  measurements (tiling error, ranges, timings)
"""

import json
import math
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural value-noise stone", "gpu": None}
t_start = time.time()

# --- pick a backend: CuPy on the T4, NumPy as an honest fallback --------------
xp = np
try:
    import cupy as cp

    # Touch the device so a present-but-broken install falls back rather than
    # failing halfway through and producing nothing.
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


# --- tileable value noise ----------------------------------------------------
# Tileability comes from wrapping the lattice indices, not from blending edges:
# a lattice of period P sampled on a SIZE grid with SIZE % P == 0 wraps exactly.
def lattice(period, seed):
    rng = np.random.default_rng(seed)
    return asarray(rng.random((period, period)))


def value_noise(period, seed, octaves=1):
    """Sum of tileable value-noise octaves, each with an integer lattice period."""
    grid = xp.arange(SIZE, dtype=xp.float32)
    total = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    amplitude = 1.0
    norm = 0.0
    for o in range(octaves):
        p = period * (2 ** o)
        lat = lattice(p, seed + 1000 * o)
        # Position in lattice cells.
        u = grid * (p / SIZE)
        i0 = xp.floor(u).astype(xp.int32) % p
        i1 = (i0 + 1) % p
        f = u - xp.floor(u)
        # Smoothstep interpolation weights.
        w = f * f * (3.0 - 2.0 * f)
        wx = w[None, :]
        wy = w[:, None]
        # Proper bilinear gather via take(): rows by the y index, columns by the
        # x index. Chained fancy indexing lat[i0][:, i0] indexes BOTH axes by x
        # (field constant along y, broken tiling -- measured); explicit broadcast
        # lat[i0[:,None], i0[None,:]] is correct but materialises huge index
        # arrays on some backends. take() along each axis is exact and cheap.
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

    # Domain warp so the grain is not obviously grid-aligned. The warp itself is
    # tileable, so the result stays tileable.
    warp_x = value_noise(4, 11, octaves=2) - 0.5
    warp_y = value_noise(4, 23, octaves=2) - 0.5
    grid = xp.arange(SIZE, dtype=xp.float32)
    # Warped coordinates, wrapped back into [0, SIZE).
    wx = (grid[None, :] + warp_x * 26.0) % SIZE
    wy = (grid[:, None] + warp_y * 26.0) % SIZE

    def sample_warped(lat_period, seed, octaves=3):
        """Value noise sampled at warped, wrapped coordinates (still tileable)."""
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
            # j0 varies along y (rows), i0 along x (cols). Here both are full
            # SIZE x SIZE fields (warped coords), so gather elementwise.
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

    grain = sample_warped(8, 5, octaves=4)
    blotch = sample_warped(3, 91, octaves=2)
    report["noise_seconds"] = round(time.time() - t0, 3)

    # --- mortar mask: an octagon-friendly running-bond block pattern ----------
    # Four courses of blocks, offset every other course, with a recessed joint.
    t1 = time.time()
    courses = 4.0
    row_f = ((grid + 0.5) / SIZE) * courses
    row = xp.floor(row_f)
    in_row = row_f - row
    # A half-BLOCK offset (0.25 in phase units), not 0.5: two blocks per tile means
    # phase 0.5 is exactly one block, so an offset of 0.5 just permutes the blocks
    # and puts a joint at the tile edge on alternating courses -- a measured seam
    # ratio of 73. A quarter-phase offset gives a true running bond AND keeps every
    # tile edge mid-block, so the pattern wraps cleanly.
    offset = (row % 2.0) * 0.25
    # Sample-cell convention: pixel i covers cell [i/N, (i+1)/N). Using the cell
    # CENTRE keeps the pattern exactly periodic -- with left-edge sampling, the
    # left edge lands exactly on a joint while the right edge sits 1/N short of
    # one, which measured as seam ratio 73 on the face mask before this fix.
    col_f = (((grid + 0.5) / SIZE) * 2.0 + offset) % 1.0
    joint_w = 0.045
    # Distance to the nearest joint in either direction, in [0, 0.5].
    dv = xp.minimum(in_row, 1.0 - in_row)
    du = xp.minimum(col_f, 1.0 - col_f)
    dist = xp.minimum(dv, du)
    # 0 in the joint, 1 on the block face, with a soft bevel.
    face = xp.clip((dist - joint_w) / 0.035, 0.0, 1.0)
    face = face * face * (3 - 2 * face)
    report["mask_seconds"] = round(time.time() - t1, 3)

    # --- height field --------------------------------------------------------
    # Blocks stand proud of the joints; grain adds surface tooth.
    height = face * 0.75 + grain * 0.22 + blotch * 0.08
    height = height / xp.max(height)

    # --- albedo --------------------------------------------------------------
    # Warm grey stone, matching the game's 0x8f8577, darker in the joints and
    # varied per block so the wall does not look printed.
    base = xp.asarray([0.561, 0.522, 0.467], dtype=xp.float32)
    # Per-block tint from a CONTINUOUS tileable noise field (not block-centre
    # sampling). Five debugging rounds showed every block-indexed scheme puts a
    # discontinuity on some tile edge: block indices jump at the wrap, and course
    # rows differ top-to-bottom (measured seam ratios 27-206). A continuous
    # periodic field has no such edges by construction -- the wrap is just another
    # neighbourhood. Block-scale variety comes from the low-frequency octave.
    tint = 0.88 + 0.24 * value_noise(4, 4242, octaves=2)
    shade = 0.62 + 0.38 * face          # joints darker
    shade = shade * (0.82 + 0.36 * grain)
    albedo = xp.zeros((SIZE, SIZE, 3), dtype=xp.float32)
    for c in range(3):
        albedo[:, :, c] = base[c] * shade * tint
    albedo = xp.clip(albedo, 0.0, 1.0)

    # --- normal map from the height field (Sobel, wrapped) -------------------
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
    strength = 2.6
    nx = -gx * strength
    ny = -gy * strength
    nz = xp.ones_like(height)
    length = xp.sqrt(nx * nx + ny * ny + nz * nz)
    normal = xp.stack([nx / length, ny / length, nz / length], axis=-1)
    normal_rgb = xp.clip(normal * 0.5 + 0.5, 0.0, 1.0)
    report["normal_seconds"] = round(time.time() - t2, 3)

    # --- roughness -----------------------------------------------------------
    # Joints hold grit and are rougher; worn block faces are slightly smoother.
    rough = xp.clip(0.92 - 0.22 * face + 0.14 * grain, 0.35, 1.0)

    # --- tiling verification -------------------------------------------------
    # Careful: for a periodic map sampled on N pixels, column N-1 and column 0 are
    # *adjacent samples*, not duplicates -- they legitimately differ, just like any
    # interior pair. The honest test is that the wrap-around difference is no larger
    # than a typical interior neighbour difference. A ratio near 1 means seamless;
    # a ratio >> 1 means a visible seam.
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
    report["seam_ratio_albedo"] = [round(ah, 3), round(av, 3)]
    report["seam_ratio_normal"] = [round(nh, 3), round(nv, 3)]
    assert ah < 3.0 and av < 3.0, f"albedo seam too visible: {ah}, {av}"
    assert nh < 3.0 and nv < 3.0, f"normal seam too visible: {nh}, {nv}"

    # --- write PNGs without Pillow (stdlib zlib + struct) --------------------
    import struct
    import zlib

    def write_png(path, arr):
        a = to_cpu(arr)
        if a.ndim == 2:
            a = np.repeat(a[:, :, None], 3, axis=2)
        # Flip vertically: glTF/Three.js textures are bottom-up.
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
    sizes["stone_albedo.png"] = write_png(f"{OUT}/stone_albedo.png", albedo)
    sizes["stone_normal.png"] = write_png(f"{OUT}/stone_normal.png", normal_rgb)
    sizes["stone_rough.png"] = write_png(f"{OUT}/stone_rough.png", rough)

    # --- a lit preview, so tiling and the normal map can be judged -----------
    # Render a 2x2 tiled patch lit by a fixed directional light using the normal
    # map. This is a real shading calculation, not a swatch.
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
    # Roughness dulls the highlight; approximate a broad specular term.
    spec = ndotl ** (8.0 + 40.0 * (1.0 - tile_r))
    lit = xp.clip(lit + 0.12 * spec[:, :, None], 0.0, 1.0)
    sizes["stone_preview.png"] = write_png(f"{OUT}/stone_preview.png", lit)
    report["preview_seconds"] = round(time.time() - t3, 3)
    report["preview_size"] = SIZE * rep

    # --- numeric ranges, so the game can trust the maps ----------------------
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

    with open(f"{OUT}/stone_report.json", "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("STONE_OK")


if __name__ == "__main__":
    main()
