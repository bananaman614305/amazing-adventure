"""Generate seamless BARK textures for modelled tree trunks, on Kaggle's T4s.

Complements the Blender tree asset (art/blender/make_tree.py): the trunk GLB
is authored from untextured box/cylinder primitives and dressed at load time
with this family via upgradePropWood-style projection, the same way crates and
barrels are dressed in wood.

Method (tileable by construction):
  - periodic value noise for the ridge height field, with a strong vertical
    bias so the bark reads as vertical fissures rather than random bumps;
  - a second, finer noise modulates colour so the surface is not flat;
  - height = ridge base + fine grain; normal = wrapped Sobel of height;
  - roughness rises in the fissures (darker, more absorbent wood).

Tiles at 512x512. Outputs: bark_albedo.png bark_normal.png bark_rough.png
bark_preview.png bark_report.json, all under /kaggle/working/.

Everything is procedural: no images, no datasets, no internet, no training.
"""

import json
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural bark", "gpu": None}
t_start = time.time()

xp = np
try:
    import cupy as cp

    _probe = cp.arange(8, dtype=cp.float32).sum()
    float(_probe)
    xp = cp
    report["gpu"] = cp.cuda.runtime.getDeviceProperties(0)["name"].decode()
    report["backend"] = "cupy"
except Exception as exc:  # noqa: BLE001
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
        interp = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy
        total = total + interp * amplitude
        norm = norm + amplitude
        amplitude *= 0.5
    return total / max(norm, 1e-6)


# Vertical bias: stretch the horizontal coordinate so ridges run top-to-bottom.
yy = (xp.arange(SIZE, dtype=xp.float32)[:, None]) / SIZE
xx = (xp.arange(SIZE, dtype=xp.float32)[None, :]) / SIZE

# Ridge height field: low-frequency vertical ridges + finer grain.
ridge = value_noise(6, 42, octaves=3)
grain = value_noise(24, 7, octaves=2)
height = 0.62 * ridge + 0.38 * grain
height = height - height.min()
height = height / (height.max() + 1e-6)

# Colour modulation: darker in fissures (low height), lighter on ridges.
colour_var = value_noise(12, 99, octaves=2)
albedo_r = 0.34 + 0.18 * height + 0.06 * colour_var
albedo_g = 0.22 + 0.12 * height + 0.04 * colour_var
albedo_b = 0.12 + 0.07 * height + 0.03 * colour_var

# Normal from wrapped Sobel of height.
def sobel_wrapped(h):
    # h: (H, W). Wrap edges for tileability.
    up = xp.roll(h, -1, axis=0)
    down = xp.roll(h, 1, axis=0)
    left = xp.roll(h, 1, axis=1)
    right = xp.roll(h, -1, axis=1)
    gx = (right - left) * 0.5
    gy = (down - up) * 0.5
    return gx, gy

gx, gy = sobel_wrapped(height)
# Pack normal into 0..1 range, z dominant.
nz = xp.ones_like(height) * 0.6
norm_len = xp.sqrt(gx * gx + gy * gy + nz * nz) + 1e-6
nx = gx / norm_len
ny = gy / norm_len
nz = nz / norm_len
normal_r = (nx * 0.5 + 0.5)
normal_g = (ny * 0.5 + 0.5)
normal_b = (nz * 0.5 + 0.5)

# Roughness: higher in fissures.
roughness = 0.78 - 0.22 * height

def to_png(arr, name):
    from PIL import Image

    a = to_cpu(arr)
    a = np.clip(a * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(a, mode="RGB").save(f"{OUT}/{name}")

# Build RGB stacks properly:
albedo = np.stack([to_cpu(albedo_r), to_cpu(albedo_g), to_cpu(albedo_b)], axis=-1)
normal = np.stack([to_cpu(normal_r), to_cpu(normal_g), to_cpu(normal_b)], axis=-1)
rough = to_cpu(roughness)

from PIL import Image

Image.fromarray(np.clip(albedo * 255, 0, 255).astype(np.uint8), mode="RGB").save(f"{OUT}/bark_albedo.png")
Image.fromarray(np.clip(normal * 255, 0, 255).astype(np.uint8), mode="RGB").save(f"{OUT}/bark_normal.png")
Image.fromarray(np.clip(rough * 255, 0, 255).astype(np.uint8), mode="L").convert("RGB").save(f"{OUT}/bark_rough.png")

# Preview: side-by-side albedo | normal | roughness.
preview = np.zeros((SIZE, SIZE * 3, 3), dtype=np.uint8)
preview[:, :SIZE] = np.clip(albedo * 255, 0, 255).astype(np.uint8)
preview[:, SIZE:2 * SIZE] = np.clip(normal * 255, 0, 255).astype(np.uint8)
preview[:, 2 * SIZE:] = np.clip(rough * 255, 0, 255).astype(np.uint8)[:, :, None].repeat(3, axis=2)
Image.fromarray(preview, mode="RGB").save(f"{OUT}/bark_preview.png")

report["elapsed_s"] = round(time.time() - t_start, 2)
report["backend_final"] = report.get("backend")
json.dump(report, open(f"{OUT}/bark_report.json", "w"), indent=2)
print("BARK_OK", report["backend"], round(time.time() - t_start, 1), "s")
