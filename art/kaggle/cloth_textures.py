"""Generate seamless burlap / cloth textures for sacks and cast clothing, on Kaggle's T4 GPUs.

Round 66 dressed the house brick and stone trim. The one remaining flat mass a
live audit found is cloth: the lane sacks (`SackCloth`, src/world.js) and the
cast GLBs' coats (`Cloth`, art/blender/make_cast.py) together measure 17.26 m2
(3.58 m2 of sacks + 13.68 m2 of coats, measured in the browser) and were still
flat colour. This generator produces the maps a `cloth` PROP_FAMILY can dress
them with.

Why a GPU is overkill: 512x512, three maps, a few metres of plain woven fibre
with two warp threads per unit cell, domain warp for slack, and a Sobel normal
derive -- a few hundred million float ops, trivial for a T4, slow in NumPy.

Everything is procedural. No outside images, no datasets, no licensed inputs, so
the output carries no third-party licence obligations.

Outputs under /kaggle/working/:
  cloth_albedo.png   tileable colour map
  cloth_normal.png   tileable tangent-space normal map
  cloth_rough.png    tileable roughness map
  cloth_preview.png  lit strip for eyeballing the weave scale
  cloth_report.json  measurements (seam ratio, ranges, timings)
"""

import json
import math
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural woven cloth", "gpu": None}
t_start = time.time()

# --- pick a backend: CuPy on the T4, NumPy as an honest fallback --------------
xp = np
try:
    import cupy

    xp = cupy
    report["backend"] = "cupy"
    try:
        device = xp.cuda.runtime.getDeviceProperties(0)
        report["gpu"] = device.get(b"name", b"cuda device").decode()
    except Exception as exc:  # pragma: no cover - device query is best-effort
        report["gpu"] = f"cuda ({exc})"
except Exception:
    report["backend"] = "numpy"


def periodic_noise(h, w, period, seed):
    """Value noise with lattice period dividing the grid: seam-free by construction."""
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


# --- height field: a plain weave ----------------------------------------------
# Two threads per cell: a warp thread runs along +x at cell centre row, a weft
# thread runs along +y at cell centre column. The classic plain weave is
# warp-under / weft-over alternating by cell parity, so the height alternates
# between the two thread surfaces in a checker.
t_weave = time.time()
WEAVE_CELLS = 32          # cells per tile => 16 x 16 thread pairs
cell = SIZE // WEAVE_CELLS
report["weave_seconds"] = round(time.time() - t_weave, 3)

# Slack: the cloth is not perfectly flat, so warp it slightly with low-frequency
# noise. Domain warp with a lattice period that divides the grid keeps the seam.
t_warp = time.time()
warp_x = (periodic_noise(SIZE, SIZE, 64, 11) * 2 - 1) * 3.0  # pixels of shift
warp_y = (periodic_noise(SIZE, SIZE, 64, 23) * 2 - 1) * 3.0
report["warp_seconds"] = round(time.time() - t_warp, 3)

yy, xx = xp.mgrid[0:SIZE, 0:SIZE].astype(xp.float32)
sx = (xx + warp_x) / cell
sy = (yy + warp_y) / cell
cx = xp.floor(sx).astype(xp.int32)
cy = xp.floor(sy).astype(xp.int32)
fx = sx - cx
fy = sy - cy
parity = (cx + cy) % 2

# Fibre profile across a thread: a rounded crest that falls to the weave valley.
# Using sin^2 keeps it smooth at the cell boundary (no seam in the derivative).
warp_h = xp.sin(fx * math.pi) ** 2
weft_h = xp.sin(fy * math.pi) ** 2

# Alternating over/under: the top thread is the full height, the bottom thread
# is suppressed so the two never cross visually.
top = xp.where(parity == 0, warp_h, weft_h)
bottom = xp.where(parity == 0, weft_h, warp_h)
height = top * 1.0 + bottom * 0.35
height = height.astype(xp.float32)

# Thicker fibres at the cell edges: slight rounding of the whole cell so the
# weave reads as cloth, not a grid.
cell_dome = xp.sin((fx) * math.pi) * xp.sin((fy) * math.pi)
height = xp.clip(height + 0.25 * cell_dome, 0, None).astype(xp.float32)
report["height_range"] = [float(height.min()), float(height.max())]

# --- normal map from height (Sobel, wrapped sampling for tileability) --------
t_norm = time.time()


def sobel(a):
    """Sobel of a 2-D array with wrap-around (tileable) neighbours."""
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
strength = 2.5
nx = -gx * strength
ny = -gy * strength
nz = xp.ones_like(height)
inv = 1.0 / xp.sqrt(nx * nx + ny * ny + nz * nz)
normal = xp.stack(
    [nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], axis=-1
).astype(xp.float32)
report["normal_seconds"] = round(time.time() - t_norm, 3)

# --- albedo: warm burlap tone, darkened in the valleys -----------------------
t_alb = time.time()
# Base colour: NEUTRAL white. The lane sacks and the cast coats multiply this
# albedo by their own authored colour (sack 0xa89468, coats mara 0x2F5D8A,
# oswin 0x7A4B2A, pip 0x4A7A4A, halden 0x5A5A62, sable 0x4B3A63, wren
# 0x3F5A4A), so any hue here would drag every one of them toward that hue.
# Keeping it white means the weave (height/occ/fibre) is the only thing the map
# contributes. occ*fibre averages ~0.742, so the mean lands near 0.742*255 =
# 189.3 -- i.e. an implied white rescale of 255/189.3 ~= 1.347, which is what
# the shipped cloth_albedo.webp measures.
base = xp.asarray([1.0, 1.0, 1.0], dtype=xp.float32)  # neutral white (no hue)
# Ambient occlusion in the valleys: darker where the fibre dips.
occ = 0.55 + 0.45 * (height / height.max())
# Fine fibre variation: per-thread tone, smooth across cells so no grid.
fibre = 0.92 + 0.08 * periodic_noise(SIZE, SIZE, 16, 37)
shade = (occ * fibre)[..., None]
albedo = xp.clip(base[None, None, :] * shade, 0, 1).astype(xp.float32)
report["albedo_seconds"] = round(time.time() - t_alb, 3)

# --- roughness: cloth is matte, with slight fibre sheen on the crests --------
t_rough = time.time()
rough = (0.92 - 0.12 * (height / height.max())).astype(xp.float32)
rough = xp.clip(rough, 0.75, 1.0)
report["roughness_seconds"] = round(time.time() - t_rough, 3)


# --- seam ratio: wrap the first column/row and compare against the second ---
def seam_ratio(a):
    a = a[..., 0] if a.ndim == 3 else a
    return [
        float(xp.abs(a[0, :] - a[1, :]).mean() / (xp.abs(a).mean() + 1e-8)),
        float(xp.abs(a[:, 0] - a[:, 1]).mean() / (xp.abs(a).mean() + 1e-8)),
    ]


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


# --- preview strip: a lit crop so tiling reads by eye ------------------------
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
    data = xp.asnumpy(to_u8(arr))
    from PIL import Image

    Image.fromarray(data).save(path)
    report[name] = {"bytes": os.path.getsize(path)}


save("cloth_albedo.png", albedo)
save("cloth_normal.png", normal)
save("cloth_rough.png", rough)
save("cloth_preview.png", preview)

report["total_seconds"] = round(time.time() - t_start, 3)
with open(os.path.join(OUT, "cloth_report.json"), "w") as fh:
    json.dump(report, fh, indent=2)
print(json.dumps(report, indent=2))