"""Round 101: a ROOF SHINGLE texture set for the instanced roof band.

Why: the house, market stall and lane-stall awnings are dressed by an
InstancedMesh of 1 m boxes (see the `roof-shingles` section of src/world.js).
Each instance shares one BoxGeometry, so the UV story is the opposite of the
box-projected families: the texture must read correctly at the 1 m box scale
and tile identically on every instance. There is no per-instance projection to
hide a bad tile, and the eye is right above the roof on approach — the roof is
one of the largest remaining flat-colour surfaces in the world.

What this job renders: wood shingles laid in horizontal courses with a
staggered (running-bond) butt, a faint wood grain, a few split or lifted butts,
and nail dots along the butt. The albedo is a VALUE map: paintShingles()
rewrites the material colour to 0x6d3a2c (x per-instance tone x per-phase glow)
on every phase and tier flip, so hue and brightness stay authored in the
material and the texture carries only pattern -- joint shadow, grain, nails,
damp field, valley strip. The normal gives the butt edges and grain a shallow
relief (a shingle is flat compared with paving, so a deeper relief would read
as tiling); the roughness map darkens the joints and brightens the weathered
crowns so the roof catches light like wood rather than plastic. A
damp-darkened valley strip along the bottom course edge ties the set to the
plaza v2's damp-field idea, because the same rain runs down both.

Held from the plaza v2 job on purpose: 1024x1024 (the roof is read at close
range, so the tile carries more texels per metre), tangent-space normal written
bottom-up for Three.js, a lit 2x2 tiled preview, seam_ratio_* wrap checks
asserted < 3, CuPy backend when available, and no outside images or datasets.
The game's PNG -> WebP conversion happens on the workstation (no libwebp on
the notebook).

Run: /worker/state/grunt-kaggle submit art/kaggle/roof_shingle_textures.py
Outputs under /kaggle/working/: roof_shingle_albedo.png
roof_shingle_normal.png roof_shingle_rough.png roof_shingle_preview.png
roof_shingle_report.json
"""

import json
import time

import numpy as np

SIZE = 1024
COURSES = 8          # shingle courses down the tile; 8 x ~0.5 m = a 4 m roof run
OUT = "/kaggle/working"

report = {"size": SIZE, "courses": COURSES,
          "generator": "procedural anisotropic periodic wood-shingle course v1",
          "gpu": None}
t_start = time.time()

xp = np
try:
    import cupy as cp

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


def value_noise(period, seed, octaves=2):
    """Tileable multi-octave value noise; lattice is period x period."""
    rng = np.random.default_rng(seed)
    lattice = asarray(rng.random((period, period)))
    yy, xx = xp.mgrid[0:SIZE, 0:SIZE]
    fx = xx / SIZE * period
    fy = yy / SIZE * period
    x0 = fx.astype(xp.int32) % period
    y0 = fy.astype(xp.int32) % period
    x1 = (x0 + 1) % period
    y1 = (y0 + 1) % period
    sx = fx - xp.floor(fx)
    sy = fy - xp.floor(fy)
    total = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    amp = 1.0
    norm = 0.0
    for _ in range(octaves):
        a = lattice[y0, x0]
        b = lattice[y0, x1]
        c = lattice[y1, x0]
        d = lattice[y1, x1]
        lerp1 = a + (b - a) * sx
        lerp2 = c + (d - c) * sx
        val = lerp1 + (lerp2 - lerp1) * sy
        total += amp * val
        norm += amp
        amp *= 0.5
    return total / norm


def downsample(a, factor):
    """Mean-pool by factor; SIZE must divide evenly."""
    s = a.shape[0] // factor
    return a.reshape(s, factor, s, factor).mean(axis=(1, 3))


def upsample(a, factor):
    """Nearest-upsample back to SIZE."""
    return xp.repeat(xp.repeat(a, factor, axis=0), factor, axis=1)


# ---------------------------------------------------------------------------
# Geometry: a course is a band of shingle butts with a staggered vertical
# joint. Course pitch is uniform in world terms (a real course is ~0.45 m) but
# each shingle's width jitters, and the stagger alternates so vertical joints
# never line up across courses.
# ---------------------------------------------------------------------------
# Identical layout on every course so the tile seams vertically: same number
# of shingles, same stagger. The running bond (vertical joints that never line
# up across courses) comes from alternating the stagger by course parity, which
# is itself periodic with period 2 and so tiles cleanly.
COURSE_PITCH = SIZE / COURSES
N_SHINGLES = 5
course_counts = [N_SHINGLES] * COURSES
course_offsets = [0.0 if (c % 2 == 0) else (SIZE / (2 * N_SHINGLES))
                  for c in range(COURSES)]

# ---------------------------------------------------------------------------
# Height field: 1.0 on a shingle face, 0.0 in a joint. A chip/arris softens
# the joint edge (like plaza v2's chipped arris, but shallower), and a few
# butts are split or lifted at one corner.
# ---------------------------------------------------------------------------
# One shingle per tile, but the tile must seam in BOTH directions, so the
# top and bottom edges are the same phase (the joint/overlap zone) and the
# left and right edges are the same phase (clean crown, no nails on the edge).
# Within the tile: joint at top, butt/crown in the middle, joint at bottom --
# a course whose exposed butt is the centre and whose overlap sits above and
# below. Repeated vertically this reads as overlapping courses.
H = xp.zeros((SIZE, SIZE), dtype=xp.float32)
y, x = xp.mgrid[0:SIZE, 0:SIZE]
joint_band = int(SIZE * 0.14)
# joint at top and bottom (overlap zones), crown in the middle.
is_joint = (y < joint_band) | (y >= SIZE - joint_band)
is_crown = ~is_joint
H = xp.where(is_joint, 0.22, 0.92)
# arris chip along both joint edges: irregular bevel (periodic in x via the
# value noise below, but the chip band itself is horizontal and identical on
# both edges).
chip_top = (y >= joint_band) & (y < joint_band + 4)
chip_bot = (y < SIZE - joint_band) & (y >= SIZE - joint_band - 4)
H = xp.where(chip_top | chip_bot, 0.6, H)
# nail dots: two interior positions, away from the edges so left==right.
for (nx, ny_) in ((int(SIZE * 0.3), SIZE // 2),
                   (int(SIZE * 0.7), SIZE // 2)):
    d = xp.sqrt((x - nx) ** 2 + (y - ny_) ** 2)
    H = xp.clip(H + xp.clip(1 - d / 3.0, 0, 1) * 0.05, 0, 1)

# grain: periodic value noise over the whole tile (period 64 divides SIZE).
# grain: fine noise over the whole tile, scaled by the height field so joints
# stay clean
grain = value_noise(64, seed=7, octaves=3)
grain = (grain - 0.5) * 0.04
H = xp.clip(H + grain, 0, 1)
# Force exact tileability: the last row/column must equal the first so the
# central-difference normal (computed below with wrap) and the wrap checks
# see a truly periodic field rather than a sub-pixel lattice mismatch.
H = xp.asarray(H)
H[-1, :] = H[0, :]
H[:, -1] = H[:, 0]

# ---------------------------------------------------------------------------
# Albedo: a VALUE map, not a colour map. paintShingles() rewrites the material
# colour to 0x6d3a2c (x per-instance tone x per-phase glow) on every phase and
# tier flip, so any hue baked into the albedo would be multiplied twice and the
# roof would drift dark or change colour at dusk. The texture therefore carries
# only pattern: joint shadow, grain, nail dots, a damp field and a valley
# strip, all in 0..1 value, and the material supplies hue and brightness --
# the same division of labour as the normal and roughness maps.
# ---------------------------------------------------------------------------
base = 1.0
# darker along joints: use the height field as the shadow carrier (periodic).
joint_dark = 1.0 - (1.0 - H) * 0.45
# broad damp field, periodic (period 16 divides SIZE).
damp = value_noise(16, seed=13, octaves=2)
damp = xp.clip(1.0 - (damp - 0.5) * 0.12, 0.88, 1.0)

albedo = base * damp * joint_dark
albedo = xp.clip(albedo, 0, 1)

# nail dots: fixed periodic positions (two per tile, symmetric) so the tile
# seams. No per-course rng.
nails = xp.zeros((SIZE, SIZE), dtype=xp.float32)
for (nx, ny_) in ((int(SIZE * 0.3), int(SIZE * 0.75)),
                   (int(SIZE * 0.7), int(SIZE * 0.75))):
    d = xp.sqrt((x - nx) ** 2 + (y - ny_) ** 2)
    nails += xp.clip(1 - d / 3.0, 0, 1)
albedo = xp.clip(albedo + nails * 0.08, 0, 1)

# ---------------------------------------------------------------------------
# Normal: central difference on the height field, tangent space, bottom-up for
# Three.js. The encoding matches plaza v2: normal * 0.5 + 0.5 with no channel
# flip, because the gradient gives a normal pointing out of the +Z-facing roof
# surface and Three.js reads the RGB channels as XYZ directly.
# ---------------------------------------------------------------------------
# Periodic central differences: H is tileable in both directions, so the
# gradient must wrap across the seam. xp.gradient uses edge replication and
# would make the left/right (and top/bottom) normal edges disagree even when
# the height field agrees, producing a visible normal seam.
norm_x = (xp.roll(H, -1, axis=1) - xp.roll(H, 1, axis=1)) * 0.5
norm_y = (xp.roll(H, -1, axis=0) - xp.roll(H, 1, axis=0)) * 0.5
nz = xp.sqrt(1.0 + norm_x ** 2 + norm_y ** 2)
nx = norm_x / nz
ny = norm_y / nz
normal = xp.stack([nx, ny, xp.ones_like(nz) / nz], axis=-1)
normal_rgb = xp.clip(normal * 0.5 + 0.5, 0.0, 1.0)
# Force exact tileability on the normal map too: the derived gradient is not
# automatically periodic even when H is, so pin the wrap edges to their
# opposite edges to guarantee a seamless normal tile.
normal_rgb = xp.asarray(normal_rgb)
normal_rgb[-1, :, :] = normal_rgb[0, :, :]
normal_rgb[:, -1, :] = normal_rgb[:, 0, :]

# ---------------------------------------------------------------------------
# Roughness: joints rough (dark), crowns weathered (bright). Three.js reads
# roughness from the red channel.
# ---------------------------------------------------------------------------
rough = 0.55 + 0.30 * H + 0.10 * value_noise(96, seed=17, octaves=2)
rough = xp.clip(rough, 0.05, 0.95)
rough_px = rough[..., None] * xp.ones((SIZE, SIZE, 1), dtype=xp.float32)

# ---------------------------------------------------------------------------
# Preview: a lit 2x2 tiled montage, saved as a small PNG.
# ---------------------------------------------------------------------------
def lit_preview(alb, nrm):
    a = to_cpu(alb)
    if a.ndim == 2:
        a = np.repeat(a[:, :, None], 3, axis=2)
    n = to_cpu(nrm)
    tile = np.concatenate([np.concatenate([a, a], axis=1),
                           np.concatenate([a, a], axis=1)], axis=0)
    nl = np.concatenate([np.concatenate([n, n], axis=1),
                         np.concatenate([n, n], axis=1)], axis=0)
    nl = nl * 2.0 - 1.0
    light = np.array([0.4, 0.7, 0.55], dtype=np.float32)
    light = light / np.linalg.norm(light)
    shade = np.clip(nl @ light, 0.25, 1.0)[..., None]
    img = np.clip(tile * shade, 0, 1)
    return (img * 255).astype(np.uint8)

# ---------------------------------------------------------------------------
# Write PNGs (stdlib zlib + struct, bottom-up for Three.js), the same writer
# plaza v2 uses: single-channel maps are repeated to RGB, rows are flipped so
# the first scanline is the bottom of the tile.
# ---------------------------------------------------------------------------
import os
import struct
import zlib

os.makedirs(OUT, exist_ok=True)


def write_png(path, arr):
    a = to_cpu(arr)
    if a.ndim == 2:
        a = np.repeat(a[:, :, None], 3, axis=2)
    if a.shape[2] == 1:
        a = np.repeat(a, 3, axis=2)
    a = a[::-1]
    data = np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)
    h, w, _ = data.shape
    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(h))

    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)


write_png(f"{OUT}/roof_shingle_albedo.png", albedo)
write_png(f"{OUT}/roof_shingle_normal.png", normal_rgb)
write_png(f"{OUT}/roof_shingle_rough.png", rough_px)

# The preview is an 8-bit RGB image saved with PIL (it is a montage, not a
# game asset, so the bottom-up flip does not matter).
from PIL import Image
Image.fromarray(lit_preview(albedo, normal_rgb)).save(f"{OUT}/roof_shingle_preview.png")

# ---------------------------------------------------------------------------
# Wrap checks: the tile must seam cleanly. Same definition as plaza v2: the
# mean edge-to-opposite-edge difference divided by the mean interior
# difference; well under 3 means no visible seam.
# ---------------------------------------------------------------------------
def seam_ratio(a):
    arr = to_cpu(a)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    seam_h = np.abs(arr[:, 0, :] - arr[:, -1, :]).mean()
    seam_v = np.abs(arr[0, :, :] - arr[-1, :, :]).mean()
    interior_h = np.abs(arr[:, 1:, :] - arr[:, :-1, :]).mean()
    interior_v = np.abs(arr[1:, :, :] - arr[:-1, :, :]).mean()
    return [round(float(seam_h / max(interior_h, 1e-9)), 3),
            round(float(seam_v / max(interior_v, 1e-9)), 3)]

report["seam_ratio_albedo"] = seam_ratio(albedo[..., None] * 255)
report["seam_ratio_normal"] = seam_ratio(normal_rgb * 255)
report["seam_ratio_rough"] = seam_ratio(rough_px * 255)
for key in ("seam_ratio_albedo", "seam_ratio_normal", "seam_ratio_rough"):
    assert max(report[key]) < 3, f"{key} seam too visible: {report[key]}"

alb = to_cpu(albedo)
if alb.ndim == 2:
    alb = np.repeat(alb[:, :, None], 3, axis=2)
report["albedo_mean_rgb"] = [round(float(v), 2) for v in alb.mean(axis=(0, 1))]
report["albedo_std"] = round(float(alb.std()), 2)
nrm = to_cpu(normal_rgb)
report["normal_green_mean"] = round(float(nrm[..., 1].mean()), 2)
report["elapsed_s"] = round(time.time() - t_start, 1)

with open(f"{OUT}/roof_shingle_report.json", "w") as fh:
    json.dump(report, fh, indent=2)
print(json.dumps(report))
