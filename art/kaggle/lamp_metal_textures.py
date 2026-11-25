"""Generate seamless PAINTED-IRON textures for the lantern posts, from the same
runner as the stone / wood+brick / plaster jobs.

Fourth bounded job in this pipeline. The plaza and lane lamp posts are a modelled
GLB with a flat `LampIron` material; this gives the ironwork a worn painted
finish: dark blue-grey paint, mottled rust breaking through, fine hammered grain
and a few chipped edges. The glass housing keeps its flat warm tint (a painted
metal map on glass would read wrong), so this family is iron only.

Tiles at 512x512 with the same conventions as the previous jobs:
  - albedo PNG (colour), normal PNG (tangent space), rough PNG (grey)
  - seam_ratio_* in the report: wrap-around difference divided by typical
    interior neighbour difference; < 3 means no visible seam, ~1 means the wrap
    looks like any other neighbourhood.
  - a lit 2x2 tiled preview, shaded with the normal map.

Design notes carried from the earlier jobs:
  - value noise is tileable when the lattice period divides the grid and the
    bilinear gather indexes rows by y and columns by x (take() per axis).
  - all variation comes from smooth periodic fields, never a hash: hashes jump
    at boundaries and put unrelated values on tile edges.
  - rust patches are radial falloffs at periodic centres, so a patch near an
    edge wraps to the opposite edge identically.

Run: /worker/state/grunt-kaggle submit art/kaggle/lamp_metal_textures.py
Outputs under /kaggle/working/: lamp_albedo.png lamp_normal.png lamp_rough.png
lamp_preview.png lamp_report.json

Set LAMP_TEXTURE_OUT to write somewhere else (the fallback run in a sandbox
without Kaggle uses this; the report records numpy as the backend then).
"""

import json
import os
import time

import numpy as np

SIZE = 512
OUT = os.environ.get("LAMP_TEXTURE_OUT", "/kaggle/working")

report = {"size": SIZE, "generator": "procedural painted iron", "gpu": None}
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


def lattice(period, seed):
    rng = np.random.default_rng(seed)
    return asarray(rng.random((period, period)))


def value_noise(period, seed, octaves=1):
    """Tileable multi-octave value noise on the SIZE grid.

    Rows indexed by the y lattice coordinate, columns by x (take per axis).
    """
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
        top = a + (b - a) * wx
        bottom = c + (d - c) * wx
        total += amplitude * (top + (bottom - top) * wy)
        norm += amplitude
        amplitude *= 0.5
    return total / norm


def seam_ratio(a):
    """Wrap difference / typical interior neighbour difference, per axis."""
    arr = to_cpu(a)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    seam_h = np.abs(arr[:, 0, :] - arr[:, -1, :]).mean()
    seam_v = np.abs(arr[0, :, :] - arr[-1, :, :]).mean()
    interior_h = np.abs(arr[:, 1:, :] - arr[:, :-1, :]).mean()
    interior_v = np.abs(arr[1:, :, :] - arr[:-1, :, :]).mean()
    return (float(seam_h / max(interior_h, 1e-9)),
            float(seam_v / max(interior_v, 1e-9)))


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


def lit_preview(albedo, normal, rough, rep=2):
    tile_n = xp.tile(normal, (rep, rep, 1))
    tile_a = xp.tile(albedo, (rep, rep, 1))
    tile_r = xp.tile(rough, (rep, rep))
    light = xp.asarray([0.45, 0.55, 0.70], dtype=xp.float32)
    light = light / xp.sqrt(xp.sum(light * light))
    ndotl = xp.clip(xp.sum(tile_n * light[None, None, :], axis=-1), 0.0, 1.0)
    ambient = 0.30
    lit = tile_a * (ambient + (1.0 - ambient) * ndotl)[:, :, None]
    spec = ndotl ** (8.0 + 40.0 * (1.0 - tile_r))
    return xp.clip(lit + 0.12 * spec[:, :, None], 0.0, 1.0)


def write_png(path, arr):
    import struct
    import zlib

    a = to_cpu(arr)
    if a.ndim == 2:
        a = np.repeat(a[:, :, None], 3, axis=2)
    a = a[::-1]  # glTF/Three.js textures are bottom-up
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


def stats(a, name):
    arr = to_cpu(a)
    report[name] = {
        "min": round(float(arr.min()), 4),
        "max": round(float(arr.max()), 4),
        "mean": round(float(arr.mean()), 4),
    }


def periodic_disc(cx, cy, radius, softness=1.0):
    """Smooth radial mask centred at a wrapping point, so edge patches wrap."""
    gy, gx = xp.meshgrid(xp.arange(SIZE, dtype=xp.float32),
                         xp.arange(SIZE, dtype=xp.float32), indexing="ij")
    best = None
    for oy in (-SIZE, 0.0, SIZE):
        for ox in (-SIZE, 0.0, SIZE):
            dx = gx - (cx + ox)
            dy = gy - (cy + oy)
            d = xp.sqrt(dx * dx + dy * dy)
            best = d if best is None else xp.minimum(best, d)
    falloff = xp.clip(1.0 - best / radius, 0.0, 1.0)
    return falloff * falloff * (3.0 - 2.0 * falloff) ** softness


def make_painted_iron():
    """Painted iron with rust breaking through and a hammered surface.

    Fields: coarse paint mottling, medium hammer dents, fine grain. Rust is a
    few large periodic discs plus a fine threshold field so the edge is broken
    up rather than circular.
    """
    coarse = value_noise(4, seed=91, octaves=3)
    hammer = value_noise(16, seed=92, octaves=2)
    grain = value_noise(128, seed=93, octaves=1)

    # Hammered dents: a gentle high-frequency height field, plus the paint
    # mottling as a slow undulation.
    height = 0.45 * hammer + 0.20 * grain + 0.35 * coarse

    rng = np.random.default_rng(97)
    rust = xp.zeros((SIZE, SIZE), dtype=xp.float32)
    for _ in range(7):
        cx = float(rng.random()) * SIZE
        cy = float(rng.random()) * SIZE
        radius = float(rng.uniform(28.0, 74.0))
        rust = xp.maximum(rust, periodic_disc(cx, cy, radius, softness=0.7))

    # Break up the disc edges: threshold a fine noise field against the disc
    # mask so rust creeps along scratches rather than forming clean circles.
    break_up = value_noise(48, seed=94, octaves=2)
    rust_mask = xp.clip((rust * 0.85 + (break_up - 0.5) * 0.5) * 1.8, 0.0, 1.0)

    # Paint: dark blue-grey, with a lighter worn highlight on raised spots.
    paint = xp.asarray([0.215, 0.235, 0.262], dtype=xp.float32)
    paint_worn = xp.asarray([0.34, 0.35, 0.37], dtype=xp.float32)
    rust_dark = xp.asarray([0.36, 0.185, 0.095], dtype=xp.float32)
    rust_light = xp.asarray([0.52, 0.30, 0.14], dtype=xp.float32)

    wear = xp.clip((coarse - 0.45) * 2.2, 0.0, 1.0)
    paint_col = (paint[None, None, :] * (1.0 - wear[:, :, None])
                 + paint_worn[None, None, :] * wear[:, :, None])
    rust_tint = xp.clip(0.35 + 0.9 * break_up, 0.0, 1.0)
    rust_col = (rust_dark[None, None, :] * (1.0 - rust_tint[:, :, None])
                + rust_light[None, None, :] * rust_tint[:, :, None])

    m = rust_mask[:, :, None]
    albedo = paint_col * (1.0 - m) + rust_col * m
    # Fine speckle so a close-up does not read as flat vector shapes.
    albedo = albedo * (0.90 + 0.20 * grain[:, :, None])
    albedo = xp.clip(albedo, 0.0, 1.0)

    # Roughness: paint is satin (0.55), rust is matte and rougher (0.85), and
    # the worn highlights are slightly polished.
    rough = 0.55 + 0.28 * rust_mask - 0.10 * wear
    rough = xp.clip(rough + 0.06 * (grain - 0.5), 0.0, 1.0)

    # Rust sits a little proud and pitted; the dents add fine relief.
    height = height - 0.35 * rust_mask + 0.15 * grain * rust_mask
    normal = normal_from_height(height, strength=1.1)
    return albedo, normal, rough, height


def main():
    t0 = time.time()
    albedo, normal, rough, height = make_painted_iron()
    ah, av = seam_ratio(albedo)
    nh, nv = seam_ratio(normal)
    rh, rv = seam_ratio(rough)
    report["seam_ratio_lamp_albedo"] = [round(ah, 3), round(av, 3)]
    report["seam_ratio_lamp_normal"] = [round(nh, 3), round(nv, 3)]
    report["seam_ratio_lamp_rough"] = [round(rh, 3), round(rv, 3)]
    assert ah < 3.0 and av < 3.0, "lamp albedo seam too visible: %s %s" % (ah, av)
    assert nh < 3.0 and nv < 3.0, "lamp normal seam too visible: %s %s" % (nh, nv)
    assert rh < 3.0 and rv < 3.0, "lamp rough seam too visible: %s %s" % (rh, rv)
    sizes = {}
    sizes["lamp_albedo.png"] = write_png("%s/lamp_albedo.png" % OUT, albedo)
    sizes["lamp_normal.png"] = write_png("%s/lamp_normal.png" % OUT, normal)
    sizes["lamp_rough.png"] = write_png("%s/lamp_rough.png" % OUT, rough)
    sizes["lamp_preview.png"] = write_png(
        "%s/lamp_preview.png" % OUT, lit_preview(albedo, normal, rough))
    stats(albedo, "lamp_albedo_stats")
    stats(normal, "lamp_normal_stats")
    stats(rough, "lamp_rough_stats")
    report["lamp_seconds"] = round(time.time() - t0, 3)
    report["bytes"] = sizes
    report["total_seconds"] = round(time.time() - t_start, 3)
    with open("%s/lamp_report.json" % OUT, "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("LAMP_OK")


if __name__ == "__main__":
    main()
