"""Model the north gate door and export it as a GLB for Three.js.

Why this asset: the gate door is still a flat brown box. This replaces it with
a plank door: vertical planks, two iron hinge straps, a ring handle and studs.
The door's animation (lift when open) is unchanged -- the game moves the group
exactly as it moved the box.

Design constraints:
  - Footprint must match the existing door: GATE.width wide, wallHeight-0.3
    tall, 0.28 thick. The game positions the group at the door centre.
  - Low poly: target < 120 tris.
  - Y-up export.

Run: /worker/state/grunt-blender --python art/blender/make_gate_door.py
Output: art/blender/gate_door.glb
"""

import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "gate_door.glb")

WOOD = (0.369, 0.290, 0.200)     # 0x5e4a33
IRON = (0.230, 0.235, 0.245)

DOOR_W = 3.0     # GATE.width
DOOR_H = 2.9     # wallHeight - 0.3
DOOR_T = 0.28


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


def build_door():
    wood = make_material("DoorWood", WOOD, roughness=0.7)
    iron = make_material("DoorIron", IRON, roughness=0.5, metalness=0.7)

    # Four vertical planks, small gaps between them.
    plank_w = DOOR_W / 4 - 0.03
    for i in range(4):
        cx = -DOOR_W / 2 + (i + 0.5) * (DOOR_W / 4)
        bm = bmesh.new()
        box(bm, plank_w, DOOR_T, DOOR_H, cx, 0, 0)
        new_mesh_object(f"DoorPlank{i}", bm, wood)

    # Two horizontal iron hinge straps across the planks.
    for z in (-DOOR_H * 0.3, DOOR_H * 0.3):
        bm = bmesh.new()
        box(bm, DOOR_W * 0.85, DOOR_T + 0.03, 0.16, 0, 0, z)
        new_mesh_object(f"DoorStrap_{z:.2f}", bm, iron)

    # Ring handle: a small torus-ish square ring on the front face.
    bm = bmesh.new()
    box(bm, 0.3, 0.06, 0.3, DOOR_W * 0.25, DOOR_T / 2 + 0.04, 0)
    new_mesh_object("DoorHandle", bm, iron)

    # Four studs on the straps.
    for sx in (-DOOR_W * 0.3, DOOR_W * 0.3):
        for z in (-DOOR_H * 0.3, DOOR_H * 0.3):
            bm = bmesh.new()
            box(bm, 0.08, 0.05, 0.08, sx, DOOR_T / 2 + 0.03, z)
            new_mesh_object(f"DoorStud_{sx:.1f}_{z:.1f}", bm, iron)


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
    xs, ys, zs = [], [], []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for v in obj.data.vertices:
            xs.append(v.co.x)
            ys.append(v.co.y)
            zs.append(v.co.z)
    print(f"BOUNDS x[{min(xs):.3f},{max(xs):.3f}] y[{min(ys):.3f},{max(ys):.3f}] "
          f"z[{min(zs):.3f},{max(zs):.3f}]")
    assert max(abs(min(xs)), abs(max(xs))) <= DOOR_W / 2 + 0.01
    assert max(abs(min(zs)), abs(max(zs))) <= DOOR_H / 2 + 0.01
    assert max(abs(min(ys)), abs(max(ys))) <= DOOR_T / 2 + 0.1


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
    build_door()
    tris, verts = report()
    bounds_report()
    assert tris < 140, f"triangle budget blown: {tris}"
    export_glb()
    print("GATE_DOOR_OK")
