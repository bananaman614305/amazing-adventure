"""Generate seamless parchment / paper textures for the job-board face, on Kaggle T4 GPUs.

Round 83 dresses the plaza job board's face (BoardFace, 1 mesh, 2.16 m2) and
its three pinned slips (BoardPaper, 3 meshes, 0.4 m2). The board is a 1.2 x 0.9
m plane of paper/parchment carrying job slips, so a fibrous paper albedo with
gentle tooth and a soft normal is the right read, at a 0.3 m tile so the
texture repeats a few times across the board.

Everything is procedural. No outside images, no datasets, no licensed inputs.

Outputs under /kaggle/working/:
  paper_albedo.png paper_normal.png paper_rough.png
  paper_preview.png paper_report.json
  (plus lossless WebP of the three maps)
"""

import json
import math
import os
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural paper", "gpu": None}
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
    return (out / total).astype(xp.float32)


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
    inv = 1.0 / xp.sqrt(nx * nx + ny * ny + nz * nz)
    return xp.stack(
        [nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], axis=-1
    ).astype(xp.float32)


# --- Paper height field ------------------------------------------------------
# Fine fibre tooth (high frequency) over a gentle undulation. Parchment is
# slightly wavy, not flat printer paper.
tooth = fbm(SIZE, SIZE, seed=31, octaves=5, base=24)
undulation = fbm(SIZE, SIZE, seed=7, octaves=3, base=4)
height = (tooth * 0.65 + undulation * 0.35).astype(xp.float32)
height = normalise(height)

# Albedo: warm cream, slightly darker in the lows (ink-shadowed fibre).
albedo_base = 0.86
albedo = xp.full((SIZE, SIZE, 3), albedo_base, dtype=xp.float32)
albedo[:, :, 0] += 0.02
albedo[:, :, 1] -= 0.01
albedo[:, :, 2] -= 0.05
albedo = albedo * (0.92 + 0.08 * height[:, :, None])
albedo = np.clip(albedo, 0.0, 1.0)

# Roughness: paper is matte, slightly rougher in the lows.
rough = (0.78 + 0.14 * (1.0 - height)).astype(xp.float32)
rough = np.clip(rough, 0.0, 1.0)

normal = sobel_normal(height, strength=1.6)

# --- write images ------------------------------------------------------------
from PIL import Image

def to_uint8(a):
    return (np.clip(a, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)

os.makedirs(OUT, exist_ok=True)
Image.fromarray(to_uint8(albedo)).save(os.path.join(OUT, "paper_albedo.png"))
Image.fromarray(to_uint8(normal)).save(os.path.join(OUT, "paper_normal.png"))
Image.fromarray(to_uint8(rough[:, :, None].repeat(3, axis=2))).save(os.path.join(OUT, "paper_rough.png"))

# lossless WebP
for src_name, out_name in [
    ("paper_albedo.png", "paper_albedo.webp"),
    ("paper_normal.png", "paper_normal.webp"),
    ("paper_rough.png", "paper_rough.webp"),
]:
    img = Image.open(os.path.join(OUT, src_name)).convert("RGB")
    img.save(os.path.join(OUT, out_name), "WEBP", lossless=True, quality=100, method=6)

# preview
preview = np.zeros((SIZE, SIZE * 3, 3), dtype=np.uint8)
preview[:, :SIZE] = to_uint8(albedo)
preview[:, SIZE:2 * SIZE] = to_uint8(normal)
preview[:, 2 * SIZE:] = to_uint8(rough[:, :, None].repeat(3, axis=2))
Image.fromarray(preview).save(os.path.join(OUT, "paper_preview.png"))

report["total_seconds"] = round(time.time() - t_start, 3)
with open(os.path.join(OUT, "paper_report.json"), "w") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report, indent=2))
