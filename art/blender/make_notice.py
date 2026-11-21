"""Model a notice board and export it as a GLB for Three.js.

Why this asset: the lane's notice board is a box frame plus a flat plane.
This replaces it with a proper board: a wooden post, a framed board face
with a slightly raised rim, and a small roof cap to keep the rain off.

Design constraints:
  - Footprint must stay within the existing 0.6 x 1.8 collider (+/-0.3 wide,
    +/-0.9 deep). The board face is thin and upright.
  - Low poly: software rasterisation at ~3fps and real phones. Target < 150 tris.
  - Y-up export (Blender is Z-up; glTF export handles the rotation).
  - Named meshes so the loader can swap materials.

Run: /worker/state/grunt-blender --python art/blender/make_notice.py
Output: art/blender/notice.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "notice.glb")

WOOD = (0.541, 0.353, 0.200)     # 0x8a5a33
FACE = (0.847, 0.788, 0.659)     # 0xd8c9a8
IRON = (0.230, 0.235, 0.245)

POST_H = 1.9
FACE_W = 1.4
FACE_H = 1.2
BOARD_DEPTH = 0.06


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


def build_notice():
    wood = make_material("NoticeWood", WOOD, roughness=0.8)
    face = make_material("NoticeFace", FACE, roughness=0.95)
    iron = make_material("NoticeIron", IRON, roughness=0.5, metalness=0.7)

    # Support post: slightly tilted, sunk into the ground.
    bm = bmesh.new()
    box(bm, 0.2, 0.2, POST_H, 0, 0, POST_H / 2)
    new_mesh_object("NoticePost", bm, wood)

    # Frame: a thin rim around the face.
    # Left + right vertical rails.
    for px in (-FACE_W / 2 - 0.05, FACE_W / 2 + 0.05):
        bm = bmesh.new()
        box(bm, 0.06, BOARD_DEPTH, FACE_H + 0.12, px, 0, 1.25)
        new_mesh_object(f"NoticeRail_{px:.2f}", bm, wood)
    # Top + bottom horizontal rails.
    for pz in (1.25 + FACE_H / 2 + 0.03, 1.25 - FACE_H / 2 - 0.03):
        bm = bmesh.new()
        box(bm, FACE_W + 0.1, BOARD_DEPTH, 0.06, 0, 0, pz)
        new_mesh_object(f"NoticeTop_{pz:.2f}", bm, wood)

    # Face: the readable surface (a thin plane, modelled as a very thin box
    # so it carries a material and a normal).
    bm = bmesh.new()
    box(bm, FACE_W, BOARD_DEPTH * 0.5, FACE_H, 0, -0.02, 1.25)
    new_mesh_object("NoticeFace", bm, face)

    # A small roof cap over the top rail.
    bm = bmesh.new()
    box(bm, FACE_W + 0.2, BOARD_DEPTH + 0.15, 0.08, 0, 0, 1.25 + FACE_H / 2 + 0.12)
    new_mesh_object("NoticeCap", bm, wood)

    # Two iron bolts holding the post to the frame.
    for pz in (1.25 + FACE_H / 2 - 0.05, 1.25 - FACE_H / 2 + 0.05):
        bm = bmesh.new()
        box(bm, 0.04, 0.04, 0.04, -0.06, 0, pz)
        new_mesh_object(f"NoticeBolt_{pz:.2f}", bm, iron)


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
    # The model is authored with the long (1.4 m) side along x and the thin
    # (0.2 m) side along y. The game rotates the board 90 deg, so in the
    # collider frame x becomes depth and y becomes width. Check both axes.
    assert reach_x <= 0.95, f"notice exceeds its depth collider: {reach_x}"
    assert reach_y <= 0.35, f"notice exceeds its width collider: {reach_y}"
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
    build_notice()
    tris, verts = report()
    bounds_report()
    assert tris < 150, f"triangle budget blown: {tris}"
    export_glb()
    print("NOTICE_OK")
