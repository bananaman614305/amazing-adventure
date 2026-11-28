"""Generate seamless ground textures for the house doormat and planter soil, on Kaggle's T4 GPUs.

Round 111-ish: two surfaces the player walks right up to are still flat untextured
colour -- `HouseDoormat` (a 1.0 x 0.6 x 0.02 m coir mat, flat tan) and `TerraceSoil`
(the soil tops of two raised planters, 0.8 x 0.4 x 0.06 m, flat dark brown). This
generator produces two bespoke tileable families (albedo + normal + roughness each):
coarse coir matting and damp garden earth.

Why bespoke and not a reused family: coir is bristly and irregular where the cast's
cloth weave is regular, and damp soil's hollows are smoother (moisture) while its
crumbs are rougher -- neither maps onto an existing family's height model. Authored
scales: doormat tile = 0.35 m (so the mat shows ~2.9 x 1.7 tiles), soil tile =
0.25 m (so a planter top shows ~3.2 x 1.6 tiles).

Everything is procedural. No outside images, no datasets, no licensed inputs, so the
output carries no third-party licence obligations.

Outputs under /kaggle/working/:
  doormat_albedo.webp doormat_normal.webp doormat_rough.webp
  soil_albedo.webp    soil_normal.webp    soil_rough.webp
  ground_report.json
"""

import json
import math
import os
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural ground (coir + soil)", "gpu": None}
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
        report["gpu"] = "cuda (%s)" % exc
except Exception:
    report["backend"] = "numpy"


def periodic_noise(h, w, period, seed):
    """Value noise whose lattice period divides the grid: seam-free by construction."""
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
        out = out + (periodic_noise(h, w, p, seed + i * 97) * amp).astype(xp.float32)
        total += amp
        amp *= 0.5
    return (out / (total + 1e-8)).astype(xp.float32)


def normalise(a):
    lo = float(a.min())
    hi = float(a.max())
    return ((a - lo) / (hi - lo + 1e-8)).astype(xp.float32)


def sobel_normal(height, strength):
    p = xp.pad(height, 1, mode="wrap")
    gx_raw = (
        p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]
        - p[:-2, :-2] - 2 * p[1:-1, :-2] - p[2:, :-2]
    )
    gy_raw = (
        p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]
        - p[:-2, :-2] - 2 * p[:-2, 1:-1] - p[:-2, 2:]
    )
    nx = -gx_raw * strength
    ny = -gy_raw * strength
    nz = xp.ones_like(height)
    inv = 1.0 / xp.sqrt(nx * nx + ny * ny + nz * nz + 1e-12)
    return xp.stack(
        [nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], axis=-1
    ).astype(xp.float32)


def host(a):
    if xp is not np:
        return xp.asnumpy(a)
    return np.asarray(a)


def to_u8(a):
    a = xp.asarray(a)
    if a.ndim == 2:
        a = xp.stack([a, a, a], axis=-1)
    elif a.shape[-1] == 1:
        a = xp.concatenate([a, a, a], axis=-1)
    else:
        a = a[..., :3]
    return (xp.clip(a, 0, 1) * 255 + 0.5).astype(xp.uint8)


def save_png(name, arr):
    path = os.path.join(OUT, name)
    data = host(to_u8(arr))
    from PIL import Image

    Image.fromarray(data).save(path)
    report[name] = {"bytes": os.path.getsize(path)}
    return path


def save_webp(src_png, out_name):
    from PIL import Image

    img = Image.open(os.path.join(OUT, src_png)).convert("RGB")
    img.save(os.path.join(OUT, out_name), "WEBP", lossless=True, quality=100, method=6)
    report[out_name] = {"bytes": os.path.getsize(os.path.join(OUT, out_name))}


def seam_ratio_albedo(arr):
    """mean |col0 - col511| / mean |adjacent columns| for an (H,W,3) array."""
    d_wrap = float(np.abs(host(arr)[:, 0, :] - host(arr)[:, -1, :]).mean())
    d_adj = float(np.abs(host(arr)[:, 1:, :] - host(arr)[:, :-1, :]).mean())
    return d_wrap / (d_adj + 1e-12), d_wrap, d_adj


# ===========================================================================
# Family 1 -- doormat (coarse coir)
# ===========================================================================
t0 = time.time()

# Rows ~32 px tall, 16 rows across the 512 tile (integer, seam-free vertically).
ROW_H = 32
NROWS = SIZE // ROW_H
yy, xx = xp.mgrid[0:SIZE, 0:SIZE].astype(xp.float32)
t_row = (yy % ROW_H) / (ROW_H - 1.0)  # 0..1 across a row
# A rounded ridge per row: high in the middle, low in the gaps.
row_profile = xp.exp(-((t_row - 0.5) / 0.18) ** 2).astype(xp.float32)

# Per-fibre modulation along x (short fibres ~8 px).
fibre_mod = periodic_noise(SIZE, SIZE, 8, seed=5)
# Slower row-to-row variation so rows don't look identical.
row_var = periodic_noise(SIZE, SIZE, 32, seed=7)
# Occasional tuft poking out.
tuft_field = periodic_noise(SIZE, SIZE, 64, seed=9)
tuft = ((tuft_field > 0.82).astype(xp.float32)) * periodic_noise(SIZE, SIZE, 4, seed=11)

height_dm = (
    row_profile * (0.55 + 0.45 * fibre_mod) * (0.85 + 0.15 * row_var)
    + 0.22 * tuft * row_profile
).astype(xp.float32)
height_dm = normalise(height_dm)
report["doormat_height_range"] = [float(height_dm.min()), float(height_dm.max())]

# Albedo: muted coir tan, darkened in gaps and at fibre ends, slight hue variation.
base_r, base_g, base_b = 0.62, 0.52, 0.38
gap_darken = (0.80 + 0.20 * height_dm).astype(xp.float32)
hue_r = 0.96 + 0.08 * periodic_noise(SIZE, SIZE, 8, seed=21)
hue_g = 0.98 + 0.05 * periodic_noise(SIZE, SIZE, 8, seed=23)
hue_b = 0.97 + 0.07 * periodic_noise(SIZE, SIZE, 8, seed=29)
r_dm = (base_r * gap_darken * hue_r).astype(xp.float32)
g_dm = (base_g * gap_darken * hue_g).astype(xp.float32)
b_dm = (base_b * gap_darken * hue_b).astype(xp.float32)
albedo_dm = xp.stack([r_dm, g_dm, b_dm], axis=-1).astype(xp.float32)
albedo_dm = xp.clip(albedo_dm, 0.0, 1.0)

# Normal: wrapped Sobel, modest strength.
normal_dm = sobel_normal(height_dm, strength=2.0)

# Roughness: high, gaps rougher than crowns.
rough_dm = (0.95 - 0.10 * height_dm).astype(xp.float32)
rough_dm = xp.clip(rough_dm, 0.85, 0.95)

report["doormat_seconds"] = round(time.time() - t0, 3)

# ===========================================================================
# Family 2 -- soil (damp garden earth)
# ===========================================================================
t1 = time.time()

# Clumps 5-15 px: fbm with base 8 (8,16,32 px octaves).
clumps = fbm(SIZE, SIZE, seed=51, octaves=4, base=8)

# Pebbles: 5 larger bumps, kept away from tile edges.
rng = np.random.default_rng(7)
pebble_count = 5
pebble_field = xp.zeros((SIZE, SIZE), dtype=xp.float32)
for i in range(pebble_count):
    cy = int(rng.integers(80, SIZE - 80))
    cx = int(rng.integers(80, SIZE - 80))
    radius = float(rng.uniform(6.0, 10.0))
    amp = float(rng.uniform(0.6, 1.0))
    ys = xp.arange(SIZE, dtype=xp.float32)[:, None]
    xs = xp.arange(SIZE, dtype=xp.float32)[None, :]
    d2 = (ys - cy) ** 2 + (xs - cx) ** 2
    pebble_field = pebble_field + (amp * xp.exp(-d2 / (2.0 * radius * radius))).astype(xp.float32)

# Fine grain in hollows.
fine_grain = periodic_noise(SIZE, SIZE, 4, seed=61)

height_soil_raw = (0.55 * clumps + 0.30 * pebble_field + 0.15 * fine_grain * (1.0 - clumps)).astype(xp.float32)
height_soil = normalise(height_soil_raw)

# pebble mask (soft) for albedo blending
pebble_mask = xp.clip(pebble_field / (pebble_field.max() + 1e-8), 0.0, 1.0).astype(xp.float32)
pebble_mask = xp.clip((pebble_mask - 0.15) / 0.85, 0.0, 1.0).astype(xp.float32)

report["soil_height_range"] = [float(height_soil.min()), float(height_soil.max())]

# Albedo: dark damp earth, brown, hollows darker/cooler, crumbs lighter, pebbles greyer.
lum_factor = (0.55 + 0.45 * height_soil).astype(xp.float32)
r_base, g_base, b_base = 0.36, 0.26, 0.18
r_s = (r_base * lum_factor).astype(xp.float32)
g_s = (g_base * lum_factor).astype(xp.float32)
b_s = (b_base * lum_factor).astype(xp.float32)
# cooler, darker hollows (moisture)
moisture = (1.0 - height_soil)
r_s = (r_s - 0.02 * moisture).astype(xp.float32)
g_s = (g_s - 0.01 * moisture).astype(xp.float32)
b_s = (b_s + 0.04 * moisture).astype(xp.float32)
# raised crumbs catch a little more light / warmth
r_s = (r_s + 0.03 * height_soil).astype(xp.float32)
# per-crumb variation
var = periodic_noise(SIZE, SIZE, 8, seed=33)
r_s = (r_s * (0.9 + 0.2 * var)).astype(xp.float32)
g_s = (g_s * (0.9 + 0.2 * var)).astype(xp.float32)
b_s = (b_s * (0.9 + 0.2 * var)).astype(xp.float32)
# pebbles lighter / greyer
peb_grey = 0.45
r_s = (r_s * (1 - pebble_mask) + peb_grey * pebble_mask).astype(xp.float32)
g_s = (g_s * (1 - pebble_mask) + (peb_grey * 0.95) * pebble_mask).astype(xp.float32)
b_s = (b_s * (1 - pebble_mask) + (peb_grey * 0.9) * pebble_mask).astype(xp.float32)

albedo_soil = xp.stack([r_s, g_s, b_s], axis=-1).astype(xp.float32)
albedo_soil = xp.clip(albedo_soil, 0.0, 1.0)

normal_soil = sobel_normal(height_soil, strength=2.0)

# Roughness: hollows damp/smoother, raised crumbs rougher.
rough_soil = (0.60 + 0.35 * height_soil).astype(xp.float32)
rough_soil = xp.clip(rough_soil, 0.55, 0.95)

report["soil_seconds"] = round(time.time() - t1, 3)

# ===========================================================================
# Reports
# ===========================================================================
def stats(a):
    h = host(a)
    return {"min": float(h.min()), "max": float(h.max()), "mean": float(h.mean())}

# seam ratios
sr_dm, w_dm, a_dm = seam_ratio_albedo(albedo_dm)
sr_soil, w_soil, a_soil = seam_ratio_albedo(albedo_soil)

report["doormat_seam_ratio_albedo"] = sr_dm
report["doormat_seam_wrap_abs"] = w_dm
report["doormat_seam_adj_abs"] = a_dm
report["soil_seam_ratio_albedo"] = sr_soil
report["soil_seam_wrap_abs"] = w_soil
report["soil_seam_adj_abs"] = a_soil

report["doormat_albedo_mean_rgb"] = [float(host(albedo_dm)[..., 0].mean()),
                                     float(host(albedo_dm)[..., 1].mean()),
                                     float(host(albedo_dm)[..., 2].mean())]
report["soil_albedo_mean_rgb"] = [float(host(albedo_soil)[..., 0].mean()),
                                  float(host(albedo_soil)[..., 1].mean()),
                                  float(host(albedo_soil)[..., 2].mean())]

report["doormat_albedo_stats"] = stats(albedo_dm)
report["doormat_normal_stats"] = stats(normal_dm)
report["doormat_rough_stats"] = stats(rough_dm)
report["soil_albedo_stats"] = stats(albedo_soil)
report["soil_normal_stats"] = stats(normal_soil)
report["soil_rough_stats"] = stats(rough_soil)

# ===========================================================================
# Save
# ===========================================================================
os.makedirs(OUT, exist_ok=True)

# doormat
save_png("doormat_albedo.png", albedo_dm)
save_png("doormat_normal.png", normal_dm)
save_png("doormat_rough.png", rough_dm)
for src, out in (("doormat_albedo.png", "doormat_albedo.webp"),
                 ("doormat_normal.png", "doormat_normal.webp"),
                 ("doormat_rough.png", "doormat_rough.webp")):
    save_webp(src, out)

# soil
save_png("soil_albedo.png", albedo_soil)
save_png("soil_normal.png", normal_soil)
save_png("soil_rough.png", rough_soil)
for src, out in (("soil_albedo.png", "soil_albedo.webp"),
                 ("soil_normal.png", "soil_normal.webp"),
                 ("soil_rough.png", "soil_rough.webp")):
    save_webp(src, out)

report["total_seconds"] = round(time.time() - t_start, 3)
with open(os.path.join(OUT, "ground_report.json"), "w") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report, indent=2))
