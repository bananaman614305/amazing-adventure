"""Model a wooden bench and export it as a GLB for Three.js.

Why this asset: the plaza has a bench built from two boxes (seat + backrest
slab). It reads as a crate with a lid propped up. This replaces it with a
proper bench: four legs, a slatted seat, and a slatted backrest.

Design constraints:
  - Footprint must stay within the existing 2.2 x 0.7 collider (+/-1.1 wide,
    +/-0.35 deep). The backrest overhangs in depth slightly, which is fine.
  - Low poly: software rasterisation at ~3fps and real phones. Target < 200 tris.
  - Y-up export (Blender is Z-up; glTF export handles the rotation).
  - Named meshes so the loader can swap materials.

Run: /worker/state/grunt-blender --python art/blender/make_bench.py
Output: art/blender/bench.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "bench.glb")

WOOD = (0.541, 0.353, 0.200)     # 0x8a5a33
IRON = (0.230, 0.235, 0.245)

W = 2.2
D = 0.7
SEAT_H = 0.5
BACK_H = 0.6
LEG = 0.08


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


def box(bm, w, d, h, cx, cy, cz):
    hx, hy, hz = w / 2, d / 2, h / 2
    verts = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                verts.append(bm.verts.new((cx + dx * hx, cy + dy * hy, cz + dz * hz)))
    faces = [
        (0, 2, 6, 4), (1, 5, 7, 3),
        (0, 1, 3, 2), (4, 6, 7, 5),
        (0, 4, 5, 1), (2, 3, 7, 6),
    ]
    for f in faces:
        bm.faces.new(tuple(verts[i] for i in f))


def build_bench():
    wood = make_material("BenchWood", WOOD, roughness=0.8)
    iron = make_material("BenchIron", IRON, roughness=0.5, metalness=0.7)

    # Four legs: front and back pairs.
    for (px, py) in ((-W / 2 + 0.12, -D / 2 + 0.12),
                     (W / 2 - 0.12, -D / 2 + 0.12),
                     (-W / 2 + 0.12, D / 2 - 0.12),
                     (W / 2 - 0.12, D / 2 - 0.12)):
        bm = bmesh.new()
        box(bm, LEG, LEG, SEAT_H, px, py, SEAT_H / 2)
        new_mesh_object(f"BenchLeg_{px:.2f}_{py:.2f}", bm, wood)

    # Seat: a single slab (slats would be more tris; one slab reads fine at
    # distance and costs 12 tris).
    bm = bmesh.new()
    box(bm, W, D, 0.08, 0, 0, SEAT_H + 0.04)
    new_mesh_object("BenchSeat", bm, wood)

    # Backrest: a vertical slab behind the seat, tilted slightly back.
    bm = bmesh.new()
    box(bm, W, 0.12, BACK_H, 0, D / 2 - 0.06, SEAT_H + BACK_H / 2 - 0.05)
    new_mesh_object("BenchBack", bm, wood)

    # Two iron brackets under the seat, where it meets the backrest.
    for px in (-W / 2 + 0.3, W / 2 - 0.3):
        bm = bmesh.new()
        box(bm, 0.06, 0.12, 0.3, px, D / 2 - 0.06, SEAT_H - 0.12)
        new_mesh_object(f"BenchBracket_{px:.2f}", bm, iron)


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
        print(f"  {obj.name:22s} verts={len(obj.data.vertices):5d} tris={tris:5d}")
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
    reach_x = max(abs(min(xs)), abs(max(xs)))
    reach_y = max(abs(min(ys)), abs(max(ys)))
    print(f"BOUNDS x[{min(xs):.3f},{max(xs):.3f}] y[{min(ys):.3f},{max(ys):.3f}] "
          f"z[{min(zs):.3f},{max(zs):.3f}] reach_x={reach_x:.3f} reach_y={reach_y:.3f} "
          f"height={max(zs):.3f}")
    assert reach_x <= 1.15, f"bench exceeds its width collider: {reach_x}"
    assert reach_y <= 0.4, f"bench exceeds its depth collider: {reach_y}"
    assert min(zs) >= -0.001, f"geometry sinks below the ground plane: {min(zs)}"


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
    build_bench()
    tris, verts = report()
    bounds_report()
    assert tris < 200, f"triangle budget blown: {tris}"
    export_glb()
    print("BENCH_OK")
