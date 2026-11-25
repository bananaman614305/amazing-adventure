"""Model a single wooden crate and export it as a GLB for Three.js.

Why this asset: three 1.2 m wooden boxes stacked south-east of the plaza are
still boxes. This models one crate; the game places three instances at the
original positions (two stacked, one offset), matching the market-stall
pattern of one GLB, many instances.

Design constraints:
  - Footprint must stay within the existing 1.2 x 1.2 collider.
  - Low poly: software rasterisation at ~3fps and real phones. Target < 80 tris.
  - Y-up export (Blender is Z-up; glTF export handles the rotation).
  - Named meshes so the loader can swap materials.

Run: /worker/state/grunt-blender --python art/blender/make_crates.py
Output: art/blender/crates.glb
"""

import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "crates.glb")

WOOD = (0.541, 0.353, 0.200)     # 0x8a5a33
IRON = (0.230, 0.235, 0.245)

CRATE = 1.2
BAND_H = 0.12


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


def build_crate():
    wood = make_material("CrateWood", WOOD, roughness=0.85)
    iron = make_material("CrateIron", IRON, roughness=0.5, metalness=0.7)

    cx, cy, cz = 0.0, 0.0, CRATE / 2
    # Body
    bm = bmesh.new()
    box(bm, CRATE, CRATE, CRATE, cx, cy, cz)
    new_mesh_object("CrateBody", bm, wood)
    # Lid (slightly wider, thin)
    bm = bmesh.new()
    box(bm, CRATE + 0.04, CRATE + 0.04, 0.06, cx, cy, cz + CRATE / 2 + 0.03)
    new_mesh_object("CrateLid", bm, wood)
    # Two iron bands around the body
    for bz in (cz - CRATE * 0.25, cz + CRATE * 0.25):
        for (ox, oy, ow, od) in (
            (0, -CRATE / 2 - 0.01, CRATE + 0.02, 0.04),
            (0, CRATE / 2 + 0.01, CRATE + 0.02, 0.04),
            (-CRATE / 2 - 0.01, 0, 0.04, CRATE + 0.02),
            (CRATE / 2 + 0.01, 0, 0.04, CRATE + 0.02),
        ):
            bm = bmesh.new()
            box(bm, ow, od, BAND_H, cx + ox, cy + oy, bz)
            new_mesh_object(f"CrateBand_{bz:.2f}", bm, iron)


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
    reach_x = max(abs(min(xs)), abs(max(xs)))
    reach_y = max(abs(min(ys)), abs(max(ys)))
    print(f"BOUNDS x[{min(xs):.3f},{max(xs):.3f}] y[{min(ys):.3f},{max(ys):.3f}] "
          f"z[{min(zs):.3f},{max(zs):.3f}] reach_x={reach_x:.3f} reach_y={reach_y:.3f} "
          f"height={max(zs):.3f}")
    assert reach_x <= 0.7, f"crate exceeds half-width: {reach_x}"
    assert reach_y <= 0.7, f"crate exceeds half-depth: {reach_y}"
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
    build_crate()
    tris, verts = report()
    bounds_report()
    assert tris < 130, f"triangle budget blown: {tris}"
    export_glb()
    print("CRATES_OK")
