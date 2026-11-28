"""Model the terrace furniture beside the merchant house: a timber pergola and
two stone planters.

Why this asset: the terrace west of the house is an empty slab. This adds a
readable silhouette — four square posts, a pair of top beams and cross slats,
plus two low stone planters with an inset soil top — so the terrace reads as a
place someone uses rather than bare ground. It is a single small GLB the game
places with one world offset; the planters sit under the pergola.

Coordinates: footprint centred at origin, ground z=0 (Blender z-up). Front is
+y (the game's +z after the export rotation). Pergola footprint is 3.4 (x) x
2.6 (y) x 2.7 tall; each planter is 0.9 x 0.5 x 0.5.

Budget < 400 tris. Run:
  /worker/state/grunt-blender --python art/blender/make_terrace_detail.py
Output: assets/terrace-detail.glb
"""

import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))                # art/blender
REPO_ROOT = os.path.dirname(os.path.dirname(OUT_DIR))              # repo root
ASSETS_DIR = os.path.join(REPO_ROOT, "assets")                     # repo/assets
OUT_PATH = os.path.join(ASSETS_DIR, "terrace-detail.glb")

TIMBER = (0.369, 0.290, 0.200)
DARK_TIMBER = (0.25, 0.18, 0.12)
STONE = (0.561, 0.522, 0.467)
SOIL = (0.20, 0.15, 0.11)

# Pergola dimensions. Posts are 0.12 square and sit at the corners so their
# outer faces land exactly on the 3.4 x 2.6 footprint.
POST = 0.12
POST_H = 2.44
BEAM_H = 0.14
BEAM_D = 0.12
SLAT_H = 0.12
SLAT_W = 0.12
PERGOLA_W = 3.4
PERGOLA_D = 2.6
HALF_W = PERGOLA_W / 2       # 1.70
HALF_D = PERGOLA_D / 2       # 1.30

PLANTER_W = 0.9
PLANTER_D = 0.5
PLANTER_BODY_H = 0.44
SOIL_H = 0.06


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


def new_mesh_object(name, bm, materials):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    for mat in materials:
        obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def box(bm, w, d, h, cx, cy, cz, mat_index=0):
    """Axis-aligned box centred at (cx, cy, cz); tags its faces with a material."""
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
        face = bm.faces.new(tuple(verts[i] for i in f))
        face.material_index = mat_index


def build_pergola(timber, dark_timber):
    # Timber members: posts and top beams. One material, one mesh, so the GLB
    # loader (one primitive per mesh) can read it without splitting.
    bm = bmesh.new()
    px = HALF_W - POST / 2
    py = HALF_D - POST / 2
    for x in (-px, px):
        for y in (-py, py):
            box(bm, POST, POST, POST_H, x, y, POST_H / 2, mat_index=0)
    beam_z = POST_H + BEAM_H / 2
    for y in (-py, py):
        box(bm, PERGOLA_W, BEAM_D, BEAM_H, 0, y, beam_z, mat_index=0)
    new_mesh_object("TerracePergola", bm, [timber])

    # Dark-timber slats are a separate mesh so the material stays single.
    bm2 = bmesh.new()
    slat_z = POST_H + BEAM_H + SLAT_H / 2
    for x in (-1.2, -0.4, 0.4, 1.2):
        box(bm2, SLAT_W, PERGOLA_D, SLAT_H, x, 0, slat_z, mat_index=0)
    new_mesh_object("TerracePergolaSlats", bm2, [dark_timber])


def build_planter(name, cx, stone, soil):
    # Stone body and soil top are separate meshes so each carries one material.
    bm = bmesh.new()
    box(bm, PLANTER_W, PLANTER_D, PLANTER_BODY_H, cx, 0.9,
        PLANTER_BODY_H / 2, mat_index=0)
    new_mesh_object(name, bm, [stone])

    bm2 = bmesh.new()
    box(bm2, PLANTER_W - 0.1, PLANTER_D - 0.1, SOIL_H, cx, 0.9,
        PLANTER_BODY_H + SOIL_H / 2, mat_index=0)
    new_mesh_object(name + "Soil", bm2, [soil])


def build_terrace():
    timber = make_material("TerraceTimber", TIMBER, roughness=0.8)
    dark = make_material("TerraceTimberDark", DARK_TIMBER, roughness=0.8)
    stone = make_material("TerraceStone", STONE, roughness=0.9)
    soil = make_material("TerraceSoil", SOIL, roughness=1.0)

    build_pergola(timber, dark)
    build_planter("TerracePlanterA", -1.0, stone, soil)
    build_planter("TerracePlanterB", 1.0, stone, soil)


def report():
    total_tris = 0
    names = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        tris = len(obj.data.loop_triangles)
        total_tris += tris
        names.append(obj.name)
        print(f"  {obj.name:18s} verts={len(obj.data.vertices):4d} tris={tris:4d}")
    print(f"TERRACE_DETAIL_OK objects={','.join(sorted(names))} tris={total_tris}")
    return total_tris


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
    assert max(abs(min(xs)), abs(max(xs))) <= HALF_W + 0.001, "wider than 3.4 m"
    assert max(abs(min(ys)), abs(max(ys))) <= HALF_D + 0.001, "deeper than 2.6 m"
    assert min(zs) >= -0.001, f"geometry sinks below ground: {min(zs)}"
    assert max(zs) <= 2.7 + 0.001, f"taller than 2.7 m: {max(zs)}"


def export_glb():
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


if __name__ == "__main__":
    reset_scene()
    build_terrace()
    tris = report()
    bounds_report()
    assert tris < 400, f"triangle budget blown: {tris}"
    export_glb()
