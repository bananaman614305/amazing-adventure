"""Model a market stall and export it as a GLB for Three.js.

Why this asset: the market lane has two stalls built from boxes (counter + flat
roof slab). They read as crates with lids. This replaces them with a proper
market stall: a counter, a pitched awning roof, four support posts and a shelf.

Design constraints:
  - Authored at the larger stall size (1.2 wide x 3.2 deep x 1.0 high counter)
    so one asset serves both lane stalls (they are identical).
  - Low poly: software rasterisation at ~3fps and real phones. Target < 400 tris.
  - Footprint must fit the existing 1.2 x 3.2 collider (+/-0.6 wide, +/-1.6 deep).
  - Y-up export (Blender is Z-up; glTF export handles the rotation).
  - Named meshes so the loader can swap materials.

Run: /worker/state/grunt-blender --python art/blender/make_stall.py
Output: art/blender/stall.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "stall.glb")

# --- palette, matched to the game's existing materials -----------------------
WOOD = (0.541, 0.353, 0.200)     # 0x8a5a33, the game's wood
ROOF = (0.490, 0.247, 0.184)     # 0x7d3f2f, the game's roof
IRON = (0.230, 0.235, 0.245)

# Stall dimensions (the larger of the two lane stalls).
W = 1.2
D = 3.2
COUNTER_H = 1.0
AWNING_OVERHANG = 0.0
ROOF_PITCH = 0.35   # how much the roof rises from front to back


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
    """Axis-aligned box in Blender coords: x=width, y=depth, z=height (up)."""
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
    """Pitched roof slab. Heights along Z (Blender up)."""
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
    wood = make_material("StallWood", WOOD, roughness=0.8)
    roof = make_material("StallRoof", ROOF, roughness=0.7)
    iron = make_material("StallIron", IRON, roughness=0.5, metalness=0.7)

    # Counter: a solid block the trader leans on.
    bm = bmesh.new()
    box(bm, W, D, COUNTER_H, 0, 0, COUNTER_H / 2)
    new_mesh_object("StallCounter", bm, wood)

    # Shelf inside the counter, at waist height.
    bm = bmesh.new()
    box(bm, W - 0.15, D - 0.3, 0.06, 0, 0, COUNTER_H * 0.6)
    new_mesh_object("StallShelf", bm, wood)

    # Four support posts at the corners, rising to the awning.
    for (px, py) in ((-W / 2 + 0.08, -D / 2 + 0.08),
                     (W / 2 - 0.08, -D / 2 + 0.08),
                     (-W / 2 + 0.08, D / 2 - 0.08),
                     (W / 2 - 0.08, D / 2 - 0.08)):
        bm = bmesh.new()
        box(bm, 0.08, 0.08, COUNTER_H + AWNING_OVERHANG + ROOF_PITCH,
            px, py, (COUNTER_H + AWNING_OVERHANG + ROOF_PITCH) / 2)
        new_mesh_object(f"StallPost_{px:.2f}_{py:.2f}", bm, wood)

    # Awning roof: pitched, overhanging front and back.
    bm = bmesh.new()
    pitched_roof(bm,
                 W + AWNING_OVERHANG * 2,
                 D + AWNING_OVERHANG * 1.2,
                 0, 0,
                 COUNTER_H + AWNING_OVERHANG,
                 COUNTER_H + AWNING_OVERHANG + ROOF_PITCH,
                 0.08)
    new_mesh_object("StallAwning", bm, roof)

    # A small sign hanging from the front of the awning.
    bm = bmesh.new()
    box(bm, W * 0.7, 0.04, 0.18, 0, -D / 2 + 0.06, COUNTER_H + 0.25)
    new_mesh_object("StallSign", bm, wood)


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
        print(f"  {obj.name:24s} verts={len(obj.data.vertices):5d} tris={tris:5d}")
    print(f"TOTAL verts={total_verts} tris={total_tris}")
    return total_tris, total_verts


def bounds_report():
    """Check the mesh fits the game's stall collider (Blender Z-up)."""
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
    assert reach_x <= 0.6 + 1e-6, f"stall exceeds its width collider: {reach_x}"
    assert reach_y <= 1.6 + 1e-6, f"stall exceeds its depth collider: {reach_y}"
    assert min(zs) >= -0.001, f"geometry sinks below the ground plane: {min(zs)}"
    assert max(zs) > COUNTER_H, "stall is not taller than its counter"

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
    assert tris < 400, f"triangle budget blown: {tris}"
    export_glb()
    print("STALL_OK")
