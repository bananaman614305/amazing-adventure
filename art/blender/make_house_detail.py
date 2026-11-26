"""Model deeper detail for the merchant house: shutters, window boxes, a front
step and doormat, guttering with a downspout, and a chimney pot.

Why this asset: the house trim (make_house.py) stops at the gable, chimney,
windows and door. The house still reads as a modelled shell over a brick box
because nothing breaks its silhouette at human scale -- no shutters to catch
the eye, no step to stand on, no gutter to read as a real roof. This adds the
small cues that make it a building someone lives in, as one overlay GLB the
game places at the house origin on top of the brick body and the existing trim.

Coordinates: house centre at origin, ground z=0 (Blender z-up). House body is
7 wide (x) x 5 deep (z) x 3 high; roof overhangs to 8 x 6. Front face is +y
(the game's +z after export rotation), where the door sits at y = +2.5.

Budget < 260 tris. Run:
  /worker/state/grunt-blender --python art/blender/make_house_detail.py
Output: assets/house-detail.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(OUT_DIR))
ASSETS_DIR = os.path.join(REPO_ROOT, "assets")
OUT_PATH = os.path.join(ASSETS_DIR, "house-detail.glb")

WOOD = (0.369, 0.290, 0.200)
STONE = (0.561, 0.522, 0.467)
IRON = (0.40, 0.42, 0.44)
BRICK = (0.545, 0.290, 0.227)
CLOTH = (0.55, 0.45, 0.30)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, colour, roughness=0.85, metalness=0.0):
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


def cylinder(bm, r, h, cx, cy, cz, segs=8):
    base = []
    top = []
    for i in range(segs):
        a = i / segs * math.pi * 2
        base.append(bm.verts.new((cx + math.cos(a) * r, cy + math.sin(a) * r, cz)))
        top.append(bm.verts.new((cx + math.cos(a) * r, cy + math.sin(a) * r, cz + h)))
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((base[i], base[j], top[j], top[i]))
    # caps
    bc = bm.verts.new((cx, cy, cz))
    tc = bm.verts.new((cx, cy, cz + h))
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((bc, base[j], base[i]))
        bm.faces.new((tc, top[i], top[j]))


def build_detail():
    # Materials are named to line up with the existing house trim's families:
    # `HouseStone` and `HouseDoorWood` catch the stone and wood dressing passes,
    # `HouseBrick` catches the brick pass, and `HouseGutterIron` catches the
    # painted-iron family. That way the overlay is dressed identically to the
    # trim without a new texture family.
    wood = make_material("HouseDoorWood", WOOD, roughness=0.75)
    stone = make_material("HouseStone", STONE, roughness=0.9)
    step_stone = make_material("HouseStone", STONE, roughness=0.9)
    iron = make_material("HouseGutterIron", IRON, roughness=0.6, metalness=0.45)
    brick = make_material("HouseBrick", BRICK, roughness=0.9)
    cloth = make_material("HouseDoormat", CLOTH, roughness=0.95)

    # Shutters flanking the two front windows (windows at x = +/-2.0, front
    # face at Blender y = -2.5, which is the game's +z after export).
    for wx in (-2.0, 2.0):
        for side in (-1, 1):
            bm = bmesh.new()
            box(bm, 0.22, 0.06, 1.3, wx + side * 0.65, -2.52, 1.7)
            new_mesh_object(f"HouseShutter_{wx}_{side}", bm, wood)

    # Window boxes under each window.
    for wx in (-2.0, 2.0):
        bm = bmesh.new()
        box(bm, 0.9, 0.25, 0.18, wx, -2.4, 1.0)
        new_mesh_object(f"HouseWindowBox_{wx}", bm, stone)

    # Front step in front of the door.
    bm = bmesh.new()
    box(bm, 1.6, 0.8, 0.15, 0, -2.0, 0.075)
    new_mesh_object("HouseFrontStep", bm, step_stone)

    # Doormat on the step.
    bm = bmesh.new()
    box(bm, 1.0, 0.6, 0.02, 0, -2.0, 0.16)
    new_mesh_object("HouseDoormat", bm, cloth)

    # Guttering along front and back eaves. The back (+y) gutter stays behind
    # the ridge; the front (-y) gutter hangs just outside the wall face.
    for y in (-2.9, 2.9):
        bm = bmesh.new()
        box(bm, 8.2, 0.12, 0.12, 0, y, 3.05)
        new_mesh_object(f"HouseGutter_{'front' if y < 0 else 'back'}", bm, iron)

    # Downspout on the front-right corner (front = -y).
    bm = bmesh.new()
    box(bm, 0.1, 0.1, 3.0, 3.9, -2.9, 1.5)
    new_mesh_object("HouseDownspout", bm, iron)

    # Chimney pot on the existing chimney (x=2.2, y=1.0 -> game x=2.2, z=-1.0).
    bm = bmesh.new()
    cylinder(bm, 0.32, 0.45, 2.2, 1.0, 5.25)
    new_mesh_object("HouseChimneyPot", bm, brick)


def report():
    total_tris = 0
    total_verts = 0
    names = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        tris = len(obj.data.loop_triangles)
        total_tris += tris
        total_verts += len(obj.data.vertices)
        names.append(obj.name)
        print(f"  {obj.name:24s} verts={len(obj.data.vertices):4d} tris={tris:4d}")
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
    assert max(abs(min(xs)), abs(max(xs))) <= 4.1, "wider than 8.2 m"
    assert max(abs(min(ys)), abs(max(ys))) <= 3.1, "deeper than 6.2 m"
    assert min(zs) >= -0.001, f"geometry sinks below ground: {min(zs)}"
    assert max(zs) <= 5.8, f"too tall: {max(zs)}"


if __name__ == "__main__":
    reset_scene()
    build_detail()
    tris, verts = report()
    bounds_report()
    assert tris < 260, f"triangle budget blown: {tris}"
    os.makedirs(ASSETS_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_animations=False,
        export_draco_mesh_compression_enable=False,
    )
    size = os.path.getsize(OUT_PATH)
    print(f"WROTE {OUT_PATH} ({size} bytes, {size / 1024:.1f} KB)")
    print("HOUSE_DETAIL_OK")
