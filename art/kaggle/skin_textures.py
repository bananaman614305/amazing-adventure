"""Generate seamless skin and hair textures, on Kaggle's T4 GPUs.

Round 76 dresses the modelled cast's faces and hands (Skin) and hair (HairC).
A live materials audit found those two families were the largest flat mass left
on screen once the coats, props, roofs and lane bunting had been dressed: Skin
1.31 m2 over 36 meshes (six heads, noses, hands, thumbs) and HairC 0.67 m2 over
8 meshes. They are also the surfaces the player looks at most directly -- a head
is 0.31 m wide and the Talk prompt puts the camera about 2 m away -- so flat
colour on them is the most conspicuous untextured detail left.

Two families, one job:

  skin_*  pores, fine creases and broad soft undulation at a 0.35 m tile.
          Albedo is NEUTRAL (a light grey micro-shade) because every NPC has an
          authored skin colour from 0xA87B5A to 0xE0B892; the map supplies the
          relief and self-shadowing, the material colour supplies the skin tone.
  hair_*  combed strands at a 0.22 m tile: long ridges along one axis, lighter
          strand crowns, dark gaps. Albedo is neutral for the same reason (hair
          ranges from 0x1F1A16 near-black to 0x8A5A2A).

Everything is procedural. No outside images, no datasets, no licensed inputs, so
the output carries no third-party licence obligations.

Outputs under /kaggle/working/:
  skin_albedo.png / skin_normal.png / skin_rough.png
  hair_albedo.png / hair_normal.png / hair_rough.png
  skin_preview.png / hair_preview.png   lit strips for eyeballing the scale
  skin_report.json                      measurements (seams, ranges, mip survival)
"""

import json
import math
import os
import time

import numpy as np

SIZE = 512
OUT = "/kaggle/working"

report = {"size": SIZE, "generator": "procedural skin + hair", "gpu": None}
t_start = time.time()

xp = np
try:
    import cupy

    xp = cupy
    report["backend"] = "cupy"
    try:
        device = xp.cuda.runtime.getDeviceProperties(0)
        report["gpu"] = device.get(b"name", b"cuda device").decode()
    except Exception as exc:  # device query is best-effort
        report["gpu"] = "cuda (%s)" % exc
except Exception:
    report["backend"] = "numpy"


def periodic_noise(h, w, period, seed):
    """Value noise whose lattice period divides the grid: seam-free by design."""
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


def seam_ratio(a):
    """Wrap-edge difference over the mean interior neighbour difference.

    Under ~3 reads as no visible seam; this is the gate every family in this
    project has passed.
    """
    # xp, not np: on the T4 these are CuPy arrays and np.asarray would raise.
    arr = xp.asarray(a[..., 0] if a.ndim == 3 else a)
    seam_h = xp.abs(arr[0, :] - arr[-1, :]).mean()
    seam_v = xp.abs(arr[:, 0] - arr[:, -1]).mean()
    interior_h = xp.abs(arr[1:, :] - arr[:-1, :]).mean()
    interior_v = xp.abs(arr[:, 1:] - arr[:, :-1]).mean()
    return (float(seam_h / max(interior_h, 1e-9)),
            float(seam_v / max(interior_v, 1e-9)))


def mip_std(a, level):
    arr = xp.asarray(a[..., 0] if a.ndim == 3 else a)
    for _ in range(level):
        arr = arr.reshape(arr.shape[0] // 2, 2, arr.shape[1] // 2, 2).mean(axis=(1, 3))
    return float(arr.std())


# ---------------------------------------------------------------------------
# SKIN: pores, creases and a soft broad undulation.
#
# On a live frame the head is ~0.31 m across and the player talks from about
# 2 m; at 1600 px wide that is roughly 60-90 px of head, i.e. about mip 3 of
# this 512 px tile at the 0.35 m projection. Detail written only at 1-2 px
# would vanish exactly where the face is looked at, which is the mistake the
# felt round measured and documented. So the height field puts most of its
# contrast in the 8-32 px band (2.5-10 mm of skin) and uses pores as a light
# finishing texture.
# ---------------------------------------------------------------------------
t_sk = time.time()

skin_broad = fbm(SIZE, SIZE, 211, octaves=4, base=8)     # 16-64 px soft undulation
skin_mid = fbm(SIZE, SIZE, 223, octaves=4, base=16)      # 8-32 px crease lattice
skin_pores = fbm(SIZE, SIZE, 227, octaves=3, base=32)    # 4-16 px pore clusters

# Crease network: thin valleys where two ridged fields cross. Skin creases are
# not noise -- they are a connected net -- so the crease term is the product of
# two ridged fields, which makes a sparse web of lines rather than evenly
# spread speckle.
ridge_a = 1.0 - xp.abs(skin_mid * 2.0 - 1.0)
ridge_b = 1.0 - xp.abs(fbm(SIZE, SIZE, 229, octaves=3, base=8) * 2.0 - 1.0)
creases = (ridge_a * ridge_b) ** 3.0

skin_height = normalise(
    0.42 * skin_broad
    + 0.30 * skin_mid
    + 0.16 * skin_pores
    + 0.22 * creases
)
skin_normal = sobel_normal(skin_height, 1.7)

# Neutral albedo: the skin tone is the material's authored colour. The map adds
# only self-shadowing in the creases and a faint pore speckle. Range is narrow
# (0.84-1.0) on purpose -- skin is a soft material, and the relief is what a
# player reads, not a painted pattern.
grey = xp.asarray([1.0, 0.985, 0.965], dtype=xp.float32)
skin_albedo = xp.clip((0.84 + 0.16 * skin_height)[..., None] * grey, 0.0, 1.0)
# A faint warmth in the creases only: skin creases are slightly darker AND
# slightly redder, and at this amplitude the tint survives any NPC's base
# colour without shifting it.
warm = xp.asarray([0.4, 1.0, 1.6], dtype=xp.float32)
skin_albedo = xp.clip(skin_albedo * (1.0 - 0.06 * creases[..., None] * warm), 0.0, 1.0)
skin_albedo = skin_albedo.astype(xp.float32)

# Skin is matte but not chalky: 0.5-0.82. The material base is 0.7 (the
# authored cast roughness), so the map can only pull it a little each way.
skin_rough = xp.clip(0.74 - 0.22 * skin_height + 0.08 * creases, 0.5, 0.82)
skin_rough = skin_rough.astype(xp.float32)

report["skin_seconds"] = round(time.time() - t_sk, 3)
report["skin_seam_ratio"] = {
    "albedo": seam_ratio(skin_albedo),
    "normal": seam_ratio(skin_normal),
    "rough": seam_ratio(skin_rough),
}
report["skin_stats"] = {
    "albedo": [float(skin_albedo.min()), float(skin_albedo.max()), float(skin_albedo.mean())],
    "normal": [float(skin_normal.min()), float(skin_normal.max())],
    "rough": [float(skin_rough.min()), float(skin_rough.max())],
}
report["skin_mip_survival"] = {
    "albedo": {str(k): round(mip_std(skin_albedo, k), 5) for k in range(7)},
    "normal": {str(k): round(mip_std(skin_normal, k), 5) for k in range(7)},
}

# ---------------------------------------------------------------------------
# HAIR: combed strands running one way.
#
# The hair meshes are caps, a bun and a tail on the head (0.35 m wide), with the
# camera about 2 m away at Talk range. Strands run along one axis so the head
# reads as combed rather than speckled. Corners are rounded on the GPU by the
# normal map, so the lock pattern is the normal map's job; the albedo adds
# strand crowns and dark partings.
# ---------------------------------------------------------------------------
t_hr = time.time()

yy, xx = xp.mgrid[0:SIZE, 0:SIZE].astype(xp.float32)
# A stretched domain warp gives locks that wander slightly instead of ruling
# every hair into a perfect comb. Period 64 divides the grid, so it stays
# tileable.
warp = (periodic_noise(SIZE, SIZE, 64, 307) - 0.5) * 10.0

# Comb frequency: 24 strands per tile at a 0.22 m tile is one lock per ~9 mm.
# On a 0.35 m head that is ~38 locks across the visible width, which reads as
# hair at talk distance and averages softly (near mip 4 of the tile) at range
# instead of shimmering.
phase = (xx + warp) * (2.0 * math.pi * 24.0 / SIZE)
strand = (xp.sin(phase) * 0.5 + 0.5).astype(xp.float32)

# Along-strand variation: locks are not identical end to end.
lock_noise = fbm(SIZE, SIZE, 313, octaves=4, base=8)
lock_breaks = fbm(SIZE, SIZE, 317, octaves=3, base=16)

hair_height = normalise(
    0.55 * (strand ** 0.8)
    + 0.25 * lock_noise
    + 0.12 * lock_breaks
)
hair_normal = sobel_normal(hair_height, 2.4)

# Albedo: crowns light, gaps dark. Narrow and neutral so any authored hair
# colour from 0x1F1A16 to 0x8A5A2A survives as the material tint.
hair_albedo = xp.clip((0.70 + 0.30 * hair_height)[..., None], 0.0, 1.0).astype(xp.float32)
hair_rough = xp.clip(0.62 - 0.20 * hair_height + 0.06 * lock_breaks, 0.4, 0.78)
hair_rough = hair_rough.astype(xp.float32)

report["hair_seconds"] = round(time.time() - t_hr, 3)
report["hair_seam_ratio"] = {
    "albedo": seam_ratio(hair_albedo),
    "normal": seam_ratio(hair_normal),
    "rough": seam_ratio(hair_rough),
}
report["hair_stats"] = {
    "albedo": [float(hair_albedo.min()), float(hair_albedo.max()), float(hair_albedo.mean())],
    "normal": [float(hair_normal.min()), float(hair_normal.max())],
    "rough": [float(hair_rough.min()), float(hair_rough.max())],
}
report["hair_mip_survival"] = {
    "albedo": {str(k): round(mip_std(hair_albedo, k), 5) for k in range(7)},
    "normal": {str(k): round(mip_std(hair_normal, k), 5) for k in range(7)},
}


# ---------------------------------------------------------------------------
# Previews and save
# ---------------------------------------------------------------------------
def preview_of(albedo):
    shade = 0.5 + 0.5 * xp.sin(xp.linspace(0, math.pi, SIZE))[:, None]
    return xp.clip(albedo * (0.6 + 0.4 * shade[..., None]), 0, 1)


skin_preview = preview_of(skin_albedo)
hair_preview = preview_of(hair_albedo)

os.makedirs(OUT, exist_ok=True)


def to_u8(a):
    a = xp.asarray(a)
    if a.ndim == 2:
        a = xp.stack([a, a, a], axis=-1)
    elif a.shape[-1] == 1:
        # PIL cannot take an (H, W, 1) array; repeat the single channel.
        a = xp.concatenate([a, a, a], axis=-1)
    else:
        a = a[..., :3]
    return (xp.clip(a, 0, 1) * 255 + 0.5).astype(xp.uint8)


def host(a):
    """Bring a CuPy array back to host memory. np.asarray(cupy) raises, which is
    how the first submission of this job died on the T4s."""
    if xp is not np:
        return xp.asnumpy(a)
    return np.asarray(a)


def save(name, arr):
    path = os.path.join(OUT, name)
    data = host(to_u8(arr))
    from PIL import Image

    Image.fromarray(data).save(path)
    report[name] = {"bytes": os.path.getsize(path)}


save("skin_albedo.png", skin_albedo)
save("skin_normal.png", skin_normal)
save("skin_rough.png", skin_rough)
save("skin_preview.png", skin_preview)
save("hair_albedo.png", hair_albedo)
save("hair_normal.png", hair_normal)
save("hair_rough.png", hair_rough)
save("hair_preview.png", hair_preview)

# Lossless WebP, the form the game ships: the normal maps' value is in their
# small per-texel deltas and the albedo's contrast is the detail this round
# exists to deliver, so a lossy encode would undo part of the work.
from PIL import Image

for src_name in (
    "skin_albedo.png", "skin_normal.png", "skin_rough.png",
    "hair_albedo.png", "hair_normal.png", "hair_rough.png",
):
    out_name = src_name.replace(".png", ".webp")
    img = Image.open(os.path.join(OUT, src_name)).convert("RGB")
    img.save(os.path.join(OUT, out_name), "WEBP", lossless=True, quality=100, method=6)
    report[out_name] = {"bytes": os.path.getsize(os.path.join(OUT, out_name))}

report["total_seconds"] = round(time.time() - t_start, 3)
with open(os.path.join(OUT, "skin_report.json"), "w") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report, indent=2))