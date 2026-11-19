"""Model a market counter (plaza stall) and export it as a GLB for Three.js.

Why this asset: the plaza has two market stalls built from boxes -- a thin
counter (4 x 1 x 0.4 or 3 x 0.9 x 0.4) with a flat roof slab. They read as
pallets. This replaces them with a proper market counter: a wide shallow
counter with a pitched awning canopy, support posts at the ends, and a shelf.

Design constraints:
  - Authored at the larger stall size (4.0 wide x 0.4 deep x 1.0 high counter)
    so the smaller one (3.0 x 0.4 x 0.9) is a uniform scale-down.
  - Low poly: software rasterisation at ~3fps and real phones. Target < 200 tris.
  - Footprint must fit the existing collider (+/-2.0 wide, +/-0.2 deep for the
    large; +/-1.5, +/-0.2 for the small). The awning may overhang in depth.
  - Y-up export (Blender is Z-up; glTF export handles the rotation).
  - Named meshes so the loader can swap materials.

Run: /worker/state/grunt-blender --python art/blender/make_market_stall.py
Output: art/blender/market_stall.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "market_stall.glb")

# --- palette, matched to the game's existing materials -----------------------
WOOD = (0.541, 0.353, 0.200)     # 0x8a5a33
ROOF = (0.490, 0.247, 0.184)     # 0x7d3f2f
IRON = (0.230, 0.235, 0.245)

W = 4.0
D = 0.4
COUNTER_H = 1.0
AWNING_DEPTH = 1.0   # how far back the canopy reaches
AWNING_PITCH = 0.25


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


def pitched_roof(bm, w, d, cx, cy, front_h, back_h, thickness):
    hw, hd = w / 2, d / 2
    fl, bl = front_h, back_h
    bottom, bbottom = front_h - thickness, back_h - thickness
    verts = []
    verts.append(bm.verts.new((cx - hw, cy - hd, bottom)))
    verts.append(bm.verts.new((cx + hw, cy - hd, bottom)))
    verts.append(bm.verts.new((cx + hw, cy + hd, bbottom)))
    verts.append(bm.verts.new((cx - hw, cy + hd, bbottom)))
    verts.append(bm.verts.new((cx - hw, cy - hd, fl)))
    verts.append(bm.verts.new((cx + hw, cy - hd, fl)))
    verts.append(bm.verts.new((cx + hw, cy + hd, bl)))
    verts.append(bm.verts.new((cx - hw, cy + hd, bl)))
    faces = [
        (0, 1, 5, 4), (2, 3, 7, 6),
        (0, 4, 7, 3), (1, 2, 6, 5),
        (4, 5, 6, 7), (0, 3, 2, 1),
    ]
    for f in faces:
        bm.faces.new(tuple(verts[i] for i in f))


def build_stall():
    wood = make_material("MarketWood", WOOD, roughness=0.8)
    roof = make_material("MarketRoof", ROOF, roughness=0.7)
    iron = make_material("MarketIron", IRON, roughness=0.5, metalness=0.7)

    # Counter: a shallow block the trader leans on.
    bm = bmesh.new()
    box(bm, W, D, COUNTER_H, 0, 0, COUNTER_H / 2)
    new_mesh_object("MarketCounter", bm, wood)

    # Shelf inside the counter.
    bm = bmesh.new()
    box(bm, W - 0.2, D - 0.08, 0.06, 0, 0, COUNTER_H * 0.55)
    new_mesh_object("MarketShelf", bm, wood)

    # Support posts at the ends, rising to the awning.
    for px in (-W / 2 + 0.12, W / 2 - 0.12):
        bm = bmesh.new()
        box(bm, 0.10, 0.10, COUNTER_H + AWNING_PITCH, px, 0, (COUNTER_H + AWNING_PITCH) / 2)
        new_mesh_object(f"MarketPost_{px:.2f}", bm, wood)

    # Awning canopy: pitched, overhangs front and back.
    bm = bmesh.new()
    pitched_roof(bm, W + 0.3, AWNING_DEPTH, 0, D / 2 - 0.1, COUNTER_H + 0.05,
                 COUNTER_H + 0.05 + AWNING_PITCH, 0.08)
    new_mesh_object("MarketAwning", bm, roof)

    # A small sign hanging from the front of the awning.
    bm = bmesh.new()
    box(bm, W * 0.6, 0.04, 0.18, 0, -0.15, COUNTER_H + 0.15)
    new_mesh_object("MarketSign", bm, wood)


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
    # Base (counter + posts) must fit the larger collider (+/-2.0 wide, +/-0.2 deep).
    xs, ys, zs = [], [], []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name not in ("MarketCounter", "MarketShelf",
                                                   "MarketPost_-1.88", "MarketPost_1.88"):
            continue
        for v in obj.data.vertices:
            xs.append(v.co.x)
            ys.append(v.co.y)
            zs.append(v.co.z)
    reach_x = max(abs(min(xs)), abs(max(xs)))
    reach_y = max(abs(min(ys)), abs(max(ys)))
    print(f"BASE BOUNDS x[{min(xs):.3f},{max(xs):.3f}] y[{min(ys):.3f},{max(ys):.3f}] "
          f"z[{min(zs):.3f},{max(zs):.3f}] reach_x={reach_x:.3f} reach_y={reach_y:.3f} "
          f"height={max(zs):.3f}")
    assert reach_x <= 2.05, f"market stall exceeds its width collider: {reach_x}"
    assert reach_y <= 0.22, f"market stall exceeds its depth collider: {reach_y}"
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
    build_stall()
    tris, verts = report()
    bounds_report()
    assert tris < 200, f"triangle budget blown: {tris}"
    export_glb()
    print("MARKET_STALL_OK")
