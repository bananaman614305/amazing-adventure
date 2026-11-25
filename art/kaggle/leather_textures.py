"""Generate seamless leather textures for the cast's boots, on Kaggle's T4 GPUs.

Round 82 dresses the modelled cast's boots (Boot, 18 meshes, 1.49 m2). They
were the largest still-flat cast surface after the accent bands: dark grey-brown
leather at 0.15 x 0.25 x 0.19 m, with no UVs, so they box-project like the
other cast families.

Leather at boot scale wants a subtle pore field and soft creasing rather than a
weave or a fibre nap: pores ~1-2 mm, gentle undulation across the toe, and a
slightly smoother highlight on the raised grain. Albedo stays neutral so the
authored Boot colour (#726c66) survives tinting; the map supplies relief and
self-shadowing only.

Everything is procedural. No outside images, no datasets, no licensed inputs.

Outputs under /kaggle/working/:
  leather_albedo.png leather_normal.png leather_rough.png
  leather_preview.png leather_report.json
  (plus lossless WebP of the three maps)
"""

import json
import math
import os
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural leather", "gpu": None}
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


# --- Leather height field ----------------------------------------------------
# Broad undulation (large creases across the toe) plus a mid-frequency pore
# field. Kept subtle: leather grain is small, so the normal carries most of the
# read and the albedo stays nearly flat.
broad = fbm(SIZE, SIZE, seed=11, octaves=4, base=4)
pores = fbm(SIZE, SIZE, seed=47, octaves=5, base=16)
height = (broad * 0.55 + pores * 0.45).astype(xp.float32)
height = normalise(height)

# Albedo: neutral light grey with a faint warm tint in the lows (the creases
# darken slightly, as real leather does). Keep it light so tint survives.
albedo = (0.82 + 0.06 * (1.0 - height)).astype(xp.float32)
albedo = xp.clip(albedo, 0.0, 1.0)
albedo3 = xp.stack([albedo, albedo * 0.985, albedo * 0.97], axis=-1).astype(xp.float32)

# Normal: pores give the leather its grain.
normal = sobel_normal(height, strength=2.2)

# Roughness: smoother on raised grain, rougher in creases/pores.
rough = (0.86 - 0.12 * height + 0.06 * pores).astype(xp.float32)
rough = xp.clip(rough, 0.78, 0.94)

# --- Preview ----------------------------------------------------------------
def preview_of(alb, nrm, rgh):
    # A simple lit strip: not exact, just for eyeballing.
    return alb

preview = albedo3.copy()

# --- Save -------------------------------------------------------------------
os.makedirs(OUT, exist_ok=True)


def to_u8(a):
    a = xp.asarray(a)
    if a.ndim == 2:
        a = xp.stack([a, a, a], axis=-1)
    elif a.shape[-1] == 1:
        a = xp.concatenate([a, a, a], axis=-1)
    else:
        a = a[..., :3]
    return (xp.clip(a, 0, 1) * 255 + 0.5).astype(xp.uint8)


def host(a):
    if xp is not np:
        return xp.asnumpy(a)
    return np.asarray(a)


def save(name, arr):
    path = os.path.join(OUT, name)
    data = host(to_u8(arr))
    from PIL import Image

    Image.fromarray(data).save(path)
    report[name] = {"bytes": os.path.getsize(path)}


save("leather_albedo.png", albedo3)
save("leather_normal.png", normal)
save("leather_rough.png", rough)
save("leather_preview.png", preview)

from PIL import Image

for src_name, out_name in (
    ("leather_albedo.png", "leather_albedo.webp"),
    ("leather_normal.png", "leather_normal.webp"),
    ("leather_rough.png", "leather_rough.webp"),
):
    img = Image.open(os.path.join(OUT, src_name)).convert("RGB")
    img.save(os.path.join(OUT, out_name), "WEBP", lossless=True, quality=100, method=6)
    report[out_name] = {"bytes": os.path.getsize(os.path.join(OUT, out_name))}

report["total_seconds"] = round(time.time() - t_start, 3)
with open(os.path.join(OUT, "leather_report.json"), "w") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report, indent=2))
