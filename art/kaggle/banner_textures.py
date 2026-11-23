"""Generate a painted-canvas banner texture set for the terrace banner (round 71).

The banner is a single 2.4 x 1.1 m cloth panel with a painted design, NOT a
repeating fabric. Its UVs (authored in art/blender/make_banner.py) cover the
whole panel exactly once, so these maps are deliberately NON-tileable: a seam
through the middle of the emblem would be worse than a flat colour. The
generator therefore drops the tileability assertions the other jobs carry and
instead asserts that the design stays inside the 0..1 UV square and that the
albedo has real contrast (a painted banner, not a flat fill).

Design:
  - a woven canvas substrate (visible fibre, warm off-white),
  - a deep blue ground (#2f5d8a, the colour the old flat plane used, so the
    terrace still reads as the same flag),
  - a central heraldic emblem: a shield with a gold star and a horizontal
    stripe, framed by a border band,
  - subtle paint brush strokes and edge wear so it reads as hand-painted cloth
    rather than a vector decal.

Outputs under /kaggle/working/:
  banner_albedo.png   painted colour map (sRGB)
  banner_normal.png   tangent-space normal map (canvas weave + paint relief)
  banner_rough.png    roughness map (cloth matte, paint slightly glossier)
  banner_preview.png  lit view
  banner_report.json  measurements
"""

import json
import math
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural painted banner canvas", "gpu": None}
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


def asf(a):
    return xp.asarray(a, dtype=xp.float32)


def value_noise(period, seed, octaves=3, size=SIZE):
    total = xp.zeros((size, size), dtype=xp.float32)
    norm = 0.0
    amp = 1.0
    for o in range(octaves):
        p = max(1, period // (2 ** o))
        gy = size // p
        gx = size // p
        rng = np.random.default_rng(seed + o * 97)
        lattice = xp.asarray(rng.random((gy, gx), dtype=np.float32))
        y = xp.arange(size, dtype=xp.float32) / p
        x = xp.arange(size, dtype=xp.float32) / p
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
        n = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
        total = total + amp * n
        norm += amp
        amp *= 0.5
    return total / norm


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


def lit_preview(albedo, normal, rough):
    tile_a = albedo
    tile_n = normal
    tile_r = rough
    light = xp.asarray([0.4, 0.5, 0.75], dtype=xp.float32)
    light = light / xp.sqrt(xp.sum(light * light))
    ndotl = xp.clip(xp.sum(tile_n * light[None, None, :], axis=-1), 0.0, 1.0)
    ambient = 0.35
    lit = tile_a * (ambient + (1.0 - ambient) * ndotl)[:, :, None]
    spec = ndotl ** (6.0 + 30.0 * (1.0 - tile_r))
    return xp.clip(lit + 0.08 * spec[:, :, None], 0.0, 1.0)


def write_png(path, arr):
    import struct
    import zlib

    a = to_cpu(arr)
    if a.ndim == 2:
        a = np.repeat(a[:, :, None], 3, axis=2)
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


def make_banner():
    yy, xx = xp.mgrid[0:SIZE, 0:SIZE].astype(xp.float32)
    u = xx / (SIZE - 1)          # 0..1 across width
    v = yy / (SIZE - 1)          # 0..1 top..bottom

    # --- canvas substrate (woven, warm off-white) ---------------------------
    canvas_weave = value_noise(48, seed=11, octaves=2)
    canvas_fine = value_noise(192, seed=12, octaves=1)
    canvas_height = 0.6 * canvas_weave + 0.4 * canvas_fine
    canvas_albedo = xp.asarray([0.92, 0.89, 0.82], dtype=xp.float32) * (
        0.88 + 0.12 * canvas_weave)[:, :, None]
    canvas_albedo = xp.clip(canvas_albedo, 0.0, 1.0)

    # --- painted ground: deep blue flag ------------------------------------
    ground = xp.asarray([0.18, 0.36, 0.54], dtype=xp.float32)  # #2f5d8a-ish
    # border band: a gold trim around the whole panel
    border = 0.07
    in_border = (u < border) | (u > 1 - border) | (v < border) | (v > 1 - border)
    # inner field
    field = xp.ones((SIZE, SIZE), dtype=xp.float32) * 0.0
    field = xp.where(in_border, 1.0, field)

    # --- central emblem: a shield with a gold star --------------------------
    # shield: centred ellipse
    cu, cv = 0.5, 0.52
    rx, ry = 0.22, 0.26
    shield = ((u - cu) / rx) ** 2 + ((v - cv) / ry) ** 2
    in_shield = shield < 1.0
    # star: 5-point, inside the shield
    ang = xp.arctan2(v - cv, u - cu)
    rad = xp.sqrt((u - cu) ** 2 + (v - cv) ** 2)
    # 5-point star: radial modulation
    star_r = 0.13
    star_mod = xp.cos(5 * ang) * 0.5 + 0.5
    in_star = (rad < star_r * (0.55 + 0.45 * star_mod)) & in_shield
    # horizontal stripe across the shield
    in_stripe = in_shield & (xp.abs(v - cv) < 0.05)

    # --- assemble albedo ----------------------------------------------------
    albedo = canvas_albedo.copy()
    # paint the blue ground over most of the panel (inside the border)
    blue = ground[None, None, :] * (0.85 + 0.15 * canvas_weave)[:, :, None]
    blue = xp.clip(blue, 0.0, 1.0)
    inner_mask = ~in_border
    albedo = xp.where(inner_mask[:, :, None], blue, albedo)
    # border trim: gold
    gold = xp.asarray([0.78, 0.62, 0.22], dtype=xp.float32)
    gold = gold[None, None, :] * (0.9 + 0.1 * canvas_fine)[:, :, None]
    albedo = xp.where(in_border[:, :, None], gold, albedo)
    # shield: lighter blue panel
    shield_col = xp.asarray([0.28, 0.50, 0.72], dtype=xp.float32)
    shield_col = shield_col[None, None, :] * (0.9 + 0.1 * canvas_weave)[:, :, None]
    albedo = xp.where(in_shield[:, :, None], shield_col, albedo)
    # stripe: gold
    albedo = xp.where(in_stripe[:, :, None], gold, albedo)
    # star: gold
    albedo = xp.where(in_star[:, :, None], gold, albedo)

    # brush strokes: low-frequency streaks across the whole panel
    strokes = value_noise(8, seed=33, octaves=2)
    albedo = albedo * (0.94 + 0.06 * strokes)[:, :, None]
    albedo = xp.clip(albedo, 0.0, 1.0)

    # edge wear: lighten the very edges of the border (frayed cloth)
    edge_dist = xp.minimum(xp.minimum(u, 1 - u), xp.minimum(v, 1 - v))
    wear = xp.clip(1.0 - edge_dist / 0.04, 0.0, 1.0)
    canvas_light = xp.asarray([0.95, 0.92, 0.85], dtype=xp.float32)
    albedo = albedo * (1.0 - 0.35 * wear)[:, :, None] + canvas_light[None, None, :] * (0.35 * wear)[:, :, None]
    albedo = xp.clip(albedo, 0.0, 1.0)

    # --- height / normal: canvas weave + paint relief -----------------------
    height = canvas_height.copy()
    # paint sits slightly proud of the canvas
    paint_mask = inner_mask | in_border
    height = height + 0.15 * paint_mask.astype(xp.float32)
    # shield slightly raised
    height = height + 0.10 * in_shield.astype(xp.float32)
    height = xp.clip(height, 0.0, 1.0)
    normal = normal_from_height(height, strength=1.6)

    # --- roughness: cloth matte, paint a touch glossier ----------------------
    rough = xp.full((SIZE, SIZE), 0.88, dtype=xp.float32)
    rough = xp.where(paint_mask, 0.72, rough)
    rough = xp.where(in_shield, 0.62, rough)
    rough = xp.where(in_star, 0.55, rough)
    rough = xp.clip(rough + 0.05 * canvas_weave, 0.0, 1.0)

    report["albedo_stats"] = {
        "min": float(albedo.min()), "max": float(albedo.max()),
        "mean": float(albedo.mean()),
    }
    report["height_range"] = [float(height.min()), float(height.max())]
    report["normal_stats"] = {
        "min": float(normal.min()), "max": float(normal.max()),
        "mean": float(normal.mean()),
    }
    report["rough_stats"] = {
        "min": float(rough.min()), "max": float(rough.max()),
        "mean": float(rough.mean()),
    }
    # contrast check: a painted banner must not be a flat fill
    report["albedo_std"] = float(albedo.std())
    assert report["albedo_std"] > 0.05, "banner albedo has no contrast"
    assert float(albedo.min()) < 0.3, "banner never gets dark"
    assert float(albedo.max()) > 0.7, "banner never gets light"

    preview = lit_preview(albedo, normal, rough)

    return albedo, normal, rough, preview


def main():
    t0 = time.time()
    albedo, normal, rough, preview = make_banner()
    sizes = {}
    sizes["banner_albedo.png"] = write_png("%s/banner_albedo.png" % OUT, albedo)
    sizes["banner_normal.png"] = write_png("%s/banner_normal.png" % OUT, normal)
    sizes["banner_rough.png"] = write_png("%s/banner_rough.png" % OUT, rough)
    sizes["banner_preview.png"] = write_png("%s/banner_preview.png" % OUT, preview)
    report["bytes"] = sizes
    report["total_seconds"] = round(time.time() - t_start, 3)
    report["banner_seconds"] = round(time.time() - t0, 3)
    with open("%s/banner_report.json" % OUT, "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("BANNER_OK")


if __name__ == "__main__":
    main()