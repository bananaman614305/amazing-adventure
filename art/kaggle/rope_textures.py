"""Generate seamless twisted-fibre rope textures for the lane bunting strand, on Kaggle's T4 GPUs.

Round 86 dresses the lane bunting's rope (`LaneRope`, 3 meshes, 1.92 m2,
authored brown 0x6b5236, src/world.js + src/rope.js). The strand is a 2 cm box
spanning the lane; at the family's 0.08 m tile (`ROPE_TILE_METERS`) it repeats
about two and a half times across the strand's width and many times along its
20+ m spans, so the lay has to read as twisted fibre rather than a smeared
stripe.

The pattern is a laid rope: N strands wound helically around a core. With the
tile's x axis taken as the angle around the core and y as the length, the strand
phase is `N * theta + turns * z`, both terms integer multiples of a full turn,
so the whole field is periodic in x and y and the tile is seamless. (The brief
wrote the angular coordinate as `atan2(y, x)`; a polar angle about the tile
centre would run a branch-cut seam through the middle of the tile and cannot
tile, so the angular coordinate here is the circumference angle -- the one that
is periodic, which is what the twist needs to stay seamless.)

The albedo stays light and near-neutral (a faint warm grey, not a strong brown)
because the family multiplies it by the authored 0x6b5236 with `keepTint: true`;
any real hue here would double the brown and darken the rope past the authored
colour. The map supplies the strand self-shadowing and fibre relief only.

Everything is procedural. No outside images, no datasets, no licensed inputs, so
the output carries no third-party licence obligations.

Outputs under /kaggle/working/:
  rope_albedo.png   tileable colour map (light neutral grey-brown)
  rope_normal.png   tileable tangent-space normal map (strand relief)
  rope_rough.png    tileable roughness map (matte, ~0.85-0.96)
  rope_preview.png  lit strip for eyeballing the lay
  rope_report.json  measurements (seam ratio, ranges, timings)
  (plus lossless WebP of the three maps)
"""

import json
import math
import os
import time

import numpy as np

SIZE = 512
OUT = os.environ.get("ROPE_TEXTURE_OUT", "/kaggle/working")

report = {"size": SIZE, "generator": "procedural laid rope", "gpu": None}
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
        report["gpu"] = "cuda (%s)" % exc
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


# --- height field: N strands laid helically around a core --------------------
#
# Tile coordinates run 0..1 in both axes. `u` is the angle around the core
# (x wraps), `v` is the length along the rope (y wraps). The strand phase is
# `STRANDS * u + TURNS * v`; keeping both coefficients integers makes the phase
# advance a whole number of turns across each tile edge, so the texture tiles.
t_h = time.time()
STRANDS = 3          # three strands laid around the core (classic rope)
TURNS = 2            # whole turns of the lay across one 0.08 m tile
FIBRE_SPLIT = 3      # sub-fibres carved into each strand

yy, xx = xp.mgrid[0:SIZE, 0:SIZE].astype(xp.float32)
u = (xx / SIZE).astype(xp.float32)
v = (yy / SIZE).astype(xp.float32)

# Domain warp: organic wobble of the lay. Both warps are periodic (lattice
# period divides the grid), so adding them to the phase keeps the seam.
warp_main = ((fbm(SIZE, SIZE, 11, octaves=3, base=8) * 2 - 1) * 0.055).astype(xp.float32)
warp_fine = ((fbm(SIZE, SIZE, 23, octaves=3, base=8) * 2 - 1) * 0.18).astype(xp.float32)

base_phase = (STRANDS * u + TURNS * v + warp_main)
strand_phase = xp.mod(base_phase, 1.0)
# Smooth rounded strand: sin^2(pi*phase) is 0 in the grooves, 1 at the crest,
# with a zero derivative at both, so adjacent strands meet in a soft valley.
strand_profile = xp.sin(math.pi * strand_phase) ** 2

# Sub-fibres run parallel to the strands (same slope, higher frequency), so they
# read as individual fibres within the lay rather than crossing it.
fibre_phase = xp.mod(FIBRE_SPLIT * base_phase + warp_fine, 1.0)
fibre_profile = xp.sin(math.pi * fibre_phase) ** 2

# Fine per-texel fibre noise for close-ups; low weight, mip-averaged away.
micro = fbm(SIZE, SIZE, 41, octaves=5, base=32)

# Per-strand height offset so the three strands are not identical.
rng = np.random.default_rng(7)
strand_offsets = xp.asarray(rng.uniform(-0.5, 0.5, STRANDS).astype(np.float32))
strand_id = xp.mod(xp.floor(base_phase), STRANDS).astype(xp.int32)
strand_offset = strand_offsets[strand_id]

# Broad core undulation, to break the mechanical regularity of the helix.
core = (fbm(SIZE, SIZE, 5, octaves=3, base=4) - 0.5).astype(xp.float32)

height = (
    strand_profile * (0.78 + 0.22 * fibre_profile)
    + 0.06 * strand_offset
    + 0.10 * (micro - 0.5)
    + 0.08 * core
).astype(xp.float32)
height = normalise(height)
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
strength = 2.2
nx = -gx * strength
ny = -gy * strength
nz = xp.ones_like(height)
inv = 1.0 / xp.sqrt(nx * nx + ny * ny + nz * nz)
normal = xp.stack(
    [nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], axis=-1
).astype(xp.float32)
report["normal_seconds"] = round(time.time() - t_norm, 3)

# --- albedo: light neutral grey-brown, strands self-shadow in the grooves ----
#
# Deliberately near-neutral: the family tints this by the authored 0x6b5236
# (keepTint true), so the hue lives in the material colour, not here. A faint
# warm lean (r > g > b) keeps the map from reading as cold grey under the brown,
# while the swing (0.6..1.0 of the base) is what makes the lay self-shadow.
t_alb = time.time()
base = xp.asarray([0.84, 0.80, 0.73], dtype=xp.float32)
occ = 0.60 + 0.40 * height
fibre_tone = 0.96 + 0.04 * periodic_noise(SIZE, SIZE, 16, 37)
shade = (occ * fibre_tone)[..., None]
albedo = xp.clip(base[None, None, :] * shade, 0, 1).astype(xp.float32)
report["albedo_seconds"] = round(time.time() - t_alb, 3)

# --- roughness: matte rope, the rubbed crests a touch smoother ---------------
t_rough = time.time()
rough = (0.95 - 0.07 * height + 0.03 * (fibre_profile - 0.5)).astype(xp.float32)
rough = xp.clip(rough, 0.85, 0.96)
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


# How much contrast survives the mip levels the rope is actually viewed at. The
# 2 cm strand covers only a few px on a live frame, so the coarse levels are what
# a player resolves; a map whose variance lives at 1-2 px is invisible in game.
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

# --- preview strip: a lit crop so the lay reads by eye -----------------------
t_prev = time.time()
# Cheap directional light against the tangent-space normal, just to show relief.
n = normal * 2.0 - 1.0
L = xp.asarray([-0.5, -0.6, 0.62], dtype=xp.float32)
L = L / xp.sqrt((L * L).sum())
lambert = xp.clip(n[..., 0] * L[0] + n[..., 1] * L[1] + n[..., 2] * L[2], 0, 1)
preview = xp.clip(albedo * (0.35 + 0.65 * lambert)[..., None], 0, 1).astype(xp.float32)
report["preview_seconds"] = round(time.time() - t_prev, 3)

# --- save --------------------------------------------------------------------
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


save("rope_albedo.png", albedo)
save("rope_normal.png", normal)
save("rope_rough.png", rough)
save("rope_preview.png", preview)

# --- WebP encode (the form the game ships) -----------------------------------
#
# Lossless for all three: the normal map's value is in its small per-texel
# deltas, and the albedo's mid-frequency strand contrast is the detail this
# round exists to deliver -- lossy WebP would partly undo it.
from PIL import Image

for src_name, out_name in (
    ("rope_albedo.png", "rope_albedo.webp"),
    ("rope_normal.png", "rope_normal.webp"),
    ("rope_rough.png", "rope_rough.webp"),
):
    img = Image.open(os.path.join(OUT, src_name)).convert("RGB")
    img.save(os.path.join(OUT, out_name), "WEBP", lossless=True, quality=100, method=6)
    report[out_name] = {"bytes": os.path.getsize(os.path.join(OUT, out_name))}

report["total_seconds"] = round(time.time() - t_start, 3)
with open(os.path.join(OUT, "rope_report.json"), "w") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report, indent=2))
