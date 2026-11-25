"""Generate seamless felt / bunting-flag textures, on Kaggle's T4 GPUs.

Round 72 dresses the lane bunting pennants (`BuntingRed` / `BuntingGold`,
src/world.js): 28 small triangular felt flags (0.16 x 0.22 m) that were
deliberately left flat in rounds 67-71 because a 1.2 m weave projects to a
single smeared texel on them. This generator produces a flag-scale tileable
felt set: short matted fibres, no weave grid, neutral-white albedo so the
authored red/gold dyes survive tinting.

Everything is procedural. No outside images, no datasets, no licensed inputs, so
the output carries no third-party licence obligations.

Outputs under /kaggle/working/:
  felt_albedo.png   tileable colour map (neutral white)
  felt_normal.png   tileable tangent-space normal map
  felt_rough.png    tileable roughness map
  felt_preview.png  lit strip for eyeballing the fibre scale
  felt_report.json  measurements (seam ratio, ranges, timings)
"""

import json
import math
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural felt", "gpu": None}
t_start = time.time()

xp = np
try:
    import cupy

    xp = cupy
    report["backend"] = "cupy"
    try:
        device = xp.cuda.runtime.getDeviceProperties(0)
        report["gpu"] = device.get(b"name", b"cuda device").decode()
    except Exception as exc:
        report["gpu"] = f"cuda ({exc})"
except Exception:
    report["backend"] = "numpy"


def periodic_noise(h, w, period, seed):
    gy = h // period
    gx = w // period
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


def fbm(h, w, seed, octaves=5, base=8):
    out = xp.zeros((h, w), dtype=xp.float32)
    amp = 1.0
    total = 0.0
    for i in range(octaves):
        p = base * (2 ** i)
        if p > min(h, w):
            break
        n = periodic_noise(h, w, p, seed + i * 97)
        out = out + (n * amp).astype(xp.float32)
        total += amp
        amp *= 0.5
    return (out / total).astype(xp.float32)


# --- height field: matted short fibres ---------------------------------------
t_h = time.time()
# Felt is a tangle of short fibres pressed into a mat: no grid, no threads.
#
# The band structure here is dictated by where the flag is actually SEEN, and
# this is the measurement that drives it. On a live 1600x1200 frame a pennant is
# 0.18 m wide and covers ~4.6 px, so the GPU samples about MIP 7 of this 512 px
# tile (mip 7 is 4x4). Earlier revisions of this generator spent their contrast
# at 2-4 px and even at 16-64 px -- mip 7 averages all of that into one constant,
# which is exactly why the A/B measured a ~1/255 luminance shift and *zero* change
# in high-frequency energy across three separate attempts.
#
# So the top band is written at 64 px (a ~3 px patch once mip 7 reduces it), so
# the part of the mat a player can actually resolve still carries signal. The
# finer bands are kept at low weight for the close-up shots, where the flag fills
# more of the frame and mip 2-4 is what gets sampled.
broad = periodic_noise(SIZE, SIZE, 64, 101)   # 8x8 patches -> survives mip 6-7
coarse = fbm(SIZE, SIZE, 7, octaves=4, base=8)  # 16-64 px mat body
fibre = fbm(SIZE, SIZE, 31, octaves=5, base=16)  # 4-16 px clumps
nap = fbm(SIZE, SIZE, 13, octaves=3, base=4)   # fine nap, close-ups only

warp_x = (periodic_noise(SIZE, SIZE, 64, 11) * 2 - 1) * 6.0
warp_y = (periodic_noise(SIZE, SIZE, 64, 23) * 2 - 1) * 6.0

yy, xx = xp.mgrid[0:SIZE, 0:SIZE].astype(xp.float32)
sx = (xx + warp_x)
sy = (yy + warp_y)
# sample nap at warped coords via nearest (cheap, keeps tileability since warp
# period divides the grid)
ix = xp.clip(sx.astype(xp.int32) % SIZE, 0, SIZE - 1)
iy = xp.clip(sy.astype(xp.int32) % SIZE, 0, SIZE - 1)
height = (
    0.46 * broad
    + 0.28 * coarse
    + 0.16 * fibre[iy, ix]
    + 0.10 * nap[iy, ix]
).astype(xp.float32)
# Stretch to the full 0..1 range: a normalised octave mix only ever occupies the
# middle of the range, so without this every derived map comes out low-contrast.
hmin, hmax = float(height.min()), float(height.max())
height = ((height - hmin) / (hmax - hmin + 1e-8)).astype(xp.float32)
report["height_range"] = [float(height.min()), float(height.max())]
report["height_seconds"] = round(time.time() - t_h, 3)

# --- normal map from height (Sobel, wrapped) ---------------------------------
t_norm = time.time()


def sobel(a):
    p = xp.pad(a, 1, mode="wrap")
    gx = (
        p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]
        - p[:-2, :-2] - 2 * p[1:-1, :-2] - p[2:, :-2]
    )
    gy = (
        p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]
        - p[:-2, :-2] - 2 * p[:-2, 1:-1] - p[:-2, 2:]
    )
    return gx, gy


gx, gy = sobel(height)
strength = 3.0
nx = -gx * strength
ny = -gy * strength
nz = xp.ones_like(height)
inv = 1.0 / xp.sqrt(nx * nx + ny * ny + nz * nz)
normal = xp.stack(
    [nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], axis=-1
).astype(xp.float32)
report["normal_seconds"] = round(time.time() - t_norm, 3)

# --- albedo: neutral white, felt nap darkens valleys --------------------------
#
# Still neutral so each flag keeps its authored dye: `keepTint` multiplies this
# map by 0xc9553f / 0xe0b552, and any colour here would shift both dyes.
#
# The swing is wide (0.55..1.0) because a tinted flat material has no other way
# to show that felt nap self-shadows. The per-texel noise is only +-4%: at mip 7
# it is the band structure below that survives, and cranking the noise instead
# just adds shimmer with no visible gain (measured, v1->v2).
t_alb = time.time()
base = xp.asarray([1.0, 1.0, 1.0], dtype=xp.float32)
occ = 0.55 + 0.45 * height
# Fine per-texel noise, kept low so the wide mip-filtered band is what reads.
fibre = 0.96 + 0.04 * periodic_noise(SIZE, SIZE, 8, 37)
shade = (occ * fibre)[..., None]
albedo = xp.clip(base[None, None, :] * shade, 0, 1).astype(xp.float32)
report["albedo_seconds"] = round(time.time() - t_alb, 3)

# --- roughness: matte felt, slightly smoother on the nap tips -----------------
#
# Widened from 0.85..0.95 to 0.72..0.95. The old band was narrower than one
# 8-bit step after the sRGB/linear round trip, which is why the isolation probe
# measured the roughness map as inert (max delta 2.86/255 on 3 pixels). Felt
# still never reads as glossy: 0.72 is brushed suede, and the material's base
# roughness stays 0.95 so the map can only ever pull it down slightly.
t_rough = time.time()
rough = (0.95 - 0.27 * height).astype(xp.float32)
rough = xp.clip(rough, 0.68, 0.95)
report["roughness_seconds"] = round(time.time() - t_rough, 3)


def seam_ratio(a):
    a = a[..., 0] if a.ndim == 3 else a
    return [
        float(xp.abs(a[0, :] - a[1, :]).mean() / (xp.abs(a).mean() + 1e-8)),
        float(xp.abs(a[:, 0] - a[:, 1]).mean() / (xp.abs(a).mean() + 1e-8)),
    ]


def mip_std(a, level):
    """Standard deviation of `a` after box-reducing `level` times (2^level)."""
    arr = xp.asarray(a[..., 0] if a.ndim == 3 else a)
    for _ in range(level):
        arr = arr.reshape(arr.shape[0] // 2, 2, arr.shape[1] // 2, 2).mean(axis=(1, 3))
    return float(arr.std())


# How much contrast survives the mip levels the flags are actually viewed at.
# The pennants cover ~20-45 px on screen, i.e. mip 3-4 of this 512 px tile, so a
# map whose variance lives only at 1-2 px is invisible in game no matter how high
# its 1:1 standard deviation looks. v1 scored ~0.004 here and the live A/B
# confirmed it changed nothing; these numbers are the guard against repeating it.
# Levels 0..8; the flags are viewed at mip ~7 (4x4 of this 512 px tile) on a
# 1600x1200 frame, so "std at 7" being clearly above zero is the whole point.
report["mip_survival_albedo"] = {str(k): round(mip_std(albedo, k), 5) for k in range(9)}
report["mip_survival_normal"] = {str(k): round(mip_std(normal, k), 5) for k in range(9)}

report["seam_ratio_albedo"] = seam_ratio(albedo[..., 0])
report["seam_ratio_normal"] = seam_ratio(normal[..., 0])
report["seam_ratio_rough"] = seam_ratio(rough)
report["albedo_stats"] = {
    "min": float(albedo.min()), "max": float(albedo.max()), "mean": float(albedo.mean())
}
report["normal_stats"] = {
    "min": float(normal.min()), "max": float(normal.max()), "mean": float(normal.mean())
}
report["rough_stats"] = {
    "min": float(rough.min()), "max": float(rough.max()), "mean": float(rough.mean())
}


# --- preview strip -----------------------------------------------------------
t_prev = time.time()
preview = xp.zeros((SIZE, SIZE, 3), dtype=xp.float32)
crop = albedo[:SIZE, :SIZE]
shade_curve = 0.5 + 0.5 * xp.sin(xp.linspace(0, math.pi, SIZE))[:, None]
preview[:] = crop * (0.6 + 0.4 * shade_curve)
preview = xp.clip(preview, 0, 1)
report["preview_seconds"] = round(time.time() - t_prev, 3)

# --- save --------------------------------------------------------------------
import os

os.makedirs(OUT, exist_ok=True)


def to_u8(a):
    a = xp.asarray(a)
    if a.ndim == 3:
        a = a[..., :3]
    return (xp.clip(a, 0, 1) * 255).astype(xp.uint8)


def save(name, arr):
    path = os.path.join(OUT, name)
    data = np.asarray(to_u8(arr))
    from PIL import Image

    Image.fromarray(data).save(path)
    report[name] = {"bytes": os.path.getsize(path)}


save("felt_albedo.png", albedo)
save("felt_normal.png", normal)
save("felt_rough.png", rough)
save("felt_preview.png", preview)

# --- WebP encode (the form the game ships) -----------------------------------
#
# Rounds 55-71 shipped every texture family as WebP, and the earlier felt
# attempt had a gap where the PNG->WebP step was done outside the generator.
# Doing it here with Pillow (which is on the Kaggle image and builds with WebP
# support) keeps one reproducible script for the whole asset.
#
# Lossless for all three: the normal map's value is entirely in its small
# per-texel deltas, and the albedo's mid-frequency contrast is the detail this
# round exists to deliver -- lossy WebP would partly undo it.
from PIL import Image

for src_name, out_name in (
    ("felt_albedo.png", "felt_albedo.webp"),
    ("felt_normal.png", "felt_normal.webp"),
    ("felt_rough.png", "felt_rough.webp"),
):
    img = Image.open(os.path.join(OUT, src_name)).convert("RGB")
    img.save(os.path.join(OUT, out_name), "WEBP", lossless=True, quality=100, method=6)
    report[out_name] = {"bytes": os.path.getsize(os.path.join(OUT, out_name))}

report["total_seconds"] = round(time.time() - t_start, 3)
with open(os.path.join(OUT, "felt_report.json"), "w") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report, indent=2))
