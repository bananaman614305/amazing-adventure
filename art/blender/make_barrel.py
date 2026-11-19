"""Model a wooden barrel and export it as a GLB for Three.js.

Why this asset: barrels appear in the plaza (three of them, hiding the brass key)
and in the market lane (one, hiding the toll ledger). Right now every barrel is a
plain CylinderGeometry with a flat brown material -- it reads as a pipe standing on
end. This replaces them with a coopered barrel: staved body, bulged middle, two
iron hoops.

Design constraints, chosen to match the game rather than fight it:
  - The current barrels are r=0.55 h=1.3 (plaza) and r=0.5 h=1.2 (lane). This model
    is authored at the LARGER size and the loader scales it per instance, so one
    asset serves both without a second export.
  - Low poly: software rasterisation at ~3fps and real phones. Target well under
    1000 triangles.
  - Y-up in the export (Blender is Z-up; glTF export handles the rotation).
  - Named meshes so the loader can swap materials if a wood texture is available.
  - Footprint must not exceed the existing 1.1 x 1.1 collider.

Run: /worker/state/grunt-blender --python art/blender/make_barrel.py
Output: art/blender/barrel.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "barrel.glb")

# --- palette, matched to the game's existing materials -----------------------
WOOD = (0.541, 0.353, 0.200)     # 0x8a5a33, the game's wood
IRON = (0.230, 0.235, 0.245)     # dark iron for the hoops

# Barrel dimensions, authored at the plaza (larger) size.
RADIUS = 0.46
BULGE = 1.10          # middle is 10% wider than the ends
HEIGHT = 1.30
STAVES = 12           # low-poly coopered look
HOOP_THICKNESS = 0.035


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, colour, roughness=0.8, metalness=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metalness
    return mat


def new_mesh_object(name, bm, material):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def staved_body(bm, sides, radius, height, bulge, staves):
    """The barrel wall: a closed tube whose radius varies with height.

    The radius follows a circular arc profile (classic barrel shape), and each
    stave is a flat quad strip so the facets read as separate boards rather than
    a smooth cylinder.
    """
    levels = 5  # bottom, lower-shoulder, middle, upper-shoulder, top
    zs = [0.0, height * 0.28, height * 0.5, height * 0.72, height]
    # Arc profile: 1.0 at the ends, `bulge` in the middle.
    prof = [1.0, 1.0 + (bulge - 1.0) * 0.62, bulge, 1.0 + (bulge - 1.0) * 0.62, 1.0]

    rings = []
    for z, p in zip(zs, prof):
        r = radius * p
        ring = []
        for i in range(sides):
            a = (2 * math.pi * i) / sides
            # Alternate a tiny angular offset per stave so the seams are not a
            # perfect polygon -- reads as separate boards.
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)

    for k in range(len(rings) - 1):
        lower, upper = rings[k], rings[k + 1]
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((lower[i], lower[j], upper[j], upper[i]))
    # Caps
    bm.faces.new(tuple(reversed(rings[0])))
    bm.faces.new(tuple(rings[-1]))


def hoop(bm, sides, radius_at, z, thickness):
    """An iron band: a thin tube slightly proud of the staves."""
    inner = radius_at
    outer = radius_at + thickness
    lo, hi = z - thickness, z + thickness
    inner_lo, inner_hi, outer_lo, outer_hi = [], [], [], []
    for i in range(sides):
        a = (2 * math.pi * i) / sides
        c, s = math.cos(a), math.sin(a)
        inner_lo.append(bm.verts.new((inner * c, inner * s, lo)))
        inner_hi.append(bm.verts.new((inner * c, inner * s, hi)))
        outer_lo.append(bm.verts.new((outer * c, outer * s, lo)))
        outer_hi.append(bm.verts.new((outer * c, outer * s, hi)))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((outer_lo[i], outer_lo[j], outer_hi[j], outer_hi[i]))       # outer wall
        bm.faces.new((inner_hi[i], inner_hi[j], inner_lo[j], inner_lo[i]))       # inner wall
        bm.faces.new((outer_hi[i], outer_hi[j], inner_hi[j], inner_hi[i]))       # top rim
        bm.faces.new((inner_lo[i], inner_lo[j], outer_lo[j], outer_lo[i]))       # bottom rim


def build_barrel():
    wood = make_material("BarrelWood", WOOD, roughness=0.85)
    iron = make_material("BarrelIron", IRON, roughness=0.55, metalness=0.85)

    bm = bmesh.new()
    staved_body(bm, STAVES, RADIUS, HEIGHT, BULGE, STAVES)
    new_mesh_object("BarrelBody", bm, wood)

    # Two hoops, at the upper and lower shoulder where a real cooper would put
    # them (they hold the staves in compression).
    for idx, zf in enumerate([0.28, 0.72]):
        bm = bmesh.new()
        hoop(bm, STAVES, RADIUS * (1.0 + (BULGE - 1.0) * 0.62), HEIGHT * zf, HOOP_THICKNESS)
        new_mesh_object(f"BarrelHoop{idx}", bm, iron)


def report():
    total_tris = 0
    total_verts = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        tris = len(obj.data.loop_triangles)
        total_tris += tris
        total_verts += len(obj.data.vertices)
        print(f"  {obj.name:20s} verts={len(obj.data.vertices):5d} tris={tris:5d}")
    print(f"TOTAL verts={total_verts} tris={total_tris}")
    return total_tris, total_verts


def bounds_report():
    xs, ys, zs = [], [], []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for v in obj.data.vertices:
            xs.append(v.co.x)
            ys.append(v.co.y)
            zs.append(v.co.z)
    reach = max(abs(min(xs)), abs(max(xs)), abs(min(ys)), abs(max(ys)))
    print(f"BOUNDS x[{min(xs):.3f},{max(xs):.3f}] y[{min(ys):.3f},{max(ys):.3f}] "
          f"z[{min(zs):.3f},{max(zs):.3f}] reach={reach:.3f}")
    # The game's existing barrel colliders are 1.1 x 1.1, i.e. +/-0.55.
    assert reach <= 0.55 + 1e-6, f"barrel exceeds its collider: reach {reach}"
    assert min(zs) >= -0.001, "geometry sinks below the ground plane"


def export_glb():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_draco_mesh_compression_enable=False,
    )
    size = os.path.getsize(OUT_PATH)
    print(f"WROTE {OUT_PATH} ({size} bytes, {size / 1024:.1f} KB)")


if __name__ == "__main__":
    reset_scene()
    build_barrel()
    tris, verts = report()
    bounds_report()
    # A hard budget: this must stay cheap enough for a phone and software GL.
    assert tris < 1000, f"triangle budget blown: {tris}"
    export_glb()
    print("BARREL_OK")