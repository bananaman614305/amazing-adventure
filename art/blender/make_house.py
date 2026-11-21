"""Model the merchant house trim (gable roof, chimney, windows, door surround).

Why this asset: the north-west house is a brick box with a flat roof slab and a
stone door box. The brick walls already wear the Kaggle brick texture and stay;
this models everything on top of them: a proper gable roof with brick gable
infill, a chimney, two framed windows and a stone door surround with a plank
door. The game hides the roof slab and door box stand-ins and overlays this.

Coordinates: house centre at origin, ground z=0 (Blender z-up). House body is
7 wide (x) x 5 deep (z) x 3 high; roof overhangs to 8 x 6. Front face is +y
(the game's +z after export rotation), where the door sits.

Budget < 220 tris. Run:
  /worker/state/grunt-blender --python art/blender/make_house.py
Output: art/blender/house.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "house.glb")

ROOF = (0.42, 0.26, 0.20)
BRICK = (0.545, 0.290, 0.227)    # 0x8b4a3a
STONE = (0.561, 0.522, 0.467)
GLASS = (0.12, 0.15, 0.18)
WOOD = (0.369, 0.290, 0.200)

EAVE_Z = 3.0
RIDGE_Z = 4.6
HALF_DEPTH = 3.0     # roof half-depth (6 m span)
ROOF_W = 8.0


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


def box(bm, w, d, h, cx, cy, cz, rot_x=0.0):
    """Axis-aligned box, optionally rotated about the x axis before translate."""
    hx, hy, hz = w / 2, d / 2, h / 2
    cosr, sinr = math.cos(rot_x), math.sin(rot_x)
    verts = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                y, z = dy * hy, dz * hz
                ry = y * cosr - z * sinr
                rz = y * sinr + z * cosr
                verts.append(bm.verts.new((cx + dx * hx, cy + ry, cz + rz)))
    faces = [
        (0, 2, 6, 4), (1, 5, 7, 3),
        (0, 1, 3, 2), (4, 6, 7, 5),
        (0, 4, 5, 1), (2, 3, 7, 6),
    ]
    for f in faces:
        bm.faces.new(tuple(verts[i] for i in f))


def gable_prism(bm, x, half_depth, base_z, ridge_z, thickness):
    """Triangular gable infill: triangle in the y-z plane, extruded along x."""
    vs = []
    for dx in (-thickness / 2, thickness / 2):
        vs.append(bm.verts.new((x + dx, -half_depth, base_z)))
        vs.append(bm.verts.new((x + dx, half_depth, base_z)))
        vs.append(bm.verts.new((x + dx, 0.0, ridge_z)))
    # two triangle faces + three quad sides
    bm.faces.new((vs[0], vs[1], vs[2]))
    bm.faces.new((vs[5], vs[4], vs[3]))
    bm.faces.new((vs[0], vs[3], vs[4], vs[1]))
    bm.faces.new((vs[1], vs[4], vs[5], vs[2]))
    bm.faces.new((vs[2], vs[5], vs[3], vs[0]))


def build_house():
    roof = make_material("HouseRoof", ROOF, roughness=0.9)
    brick = make_material("HouseBrick", BRICK, roughness=0.9)
    stone = make_material("HouseStone", STONE, roughness=0.85)
    glass = make_material("HouseGlass", GLASS, roughness=0.25, metalness=0.2)
    wood = make_material("HouseDoorWood", WOOD, roughness=0.7)

    # Two roof slopes. Rise 1.6 over run 3.0; slope length sqrt(3^2+1.6^2).
    rise = RIDGE_Z - EAVE_Z
    angle = math.atan2(rise, HALF_DEPTH)
    slope_len = math.hypot(HALF_DEPTH, rise) + 0.15
    mid_z = (EAVE_Z + RIDGE_Z) / 2
    for side in (-1, 1):
        bm = bmesh.new()
        # slope centred at y = side*1.5, tilted so it climbs toward the ridge
        box(bm, ROOF_W, slope_len, 0.14, 0, side * HALF_DEPTH / 2, mid_z,
            rot_x=-side * angle)
        new_mesh_object(f"HouseRoofSlope_{side}", bm, roof)

    # Ridge cap.
    bm = bmesh.new()
    box(bm, ROOF_W + 0.1, 0.3, 0.16, 0, 0, RIDGE_Z + 0.05)
    new_mesh_object("HouseRidge", bm, roof)

    # Brick gable infills at both x ends (house body is 7 wide).
    for x in (-3.4, 3.4):
        bm = bmesh.new()
        gable_prism(bm, x, 2.5, 3.0, RIDGE_Z - 0.1, 0.2)
        new_mesh_object(f"HouseGable_{x}", bm, brick)

    # Chimney on the right slope.
    bm = bmesh.new()
    box(bm, 0.7, 0.7, 1.6, 2.2, 1.0, 4.4)
    new_mesh_object("HouseChimney", bm, brick)
    bm = bmesh.new()
    box(bm, 0.9, 0.9, 0.15, 2.2, 1.0, 5.25)
    new_mesh_object("HouseChimneyCap", bm, stone)

    # Two windows on the front face (+y at 2.5): frame + dark pane.
    for wx in (-2.0, 2.0):
        bm = bmesh.new()
        box(bm, 1.1, 0.12, 1.3, wx, 2.52, 1.7)
        new_mesh_object(f"HouseWindowFrame_{wx}", bm, stone)
        bm = bmesh.new()
        box(bm, 0.85, 0.14, 1.05, wx, 2.53, 1.7)
        new_mesh_object(f"HouseWindowPane_{wx}", bm, glass)

    # Door surround on the front face: two jambs + lintel + plank door.
    for jx in (-0.85, 0.85):
        bm = bmesh.new()
        box(bm, 0.3, 0.34, 2.3, jx, 2.5, 1.15)
        new_mesh_object(f"HouseDoorJamb_{jx}", bm, stone)
    bm = bmesh.new()
    box(bm, 2.0, 0.34, 0.3, 0, 2.5, 2.35)
    new_mesh_object("HouseDoorLintel", bm, stone)
    bm = bmesh.new()
    box(bm, 1.4, 0.16, 2.2, 0, 2.52, 1.1)
    new_mesh_object("HouseDoor", bm, wood)


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
        print(f"  {obj.name:26s} verts={len(obj.data.vertices):5d} tris={tris:5d}")
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
    assert max(abs(min(xs)), abs(max(xs))) <= 4.15, "roof wider than 8 m span"
    assert max(abs(min(ys)), abs(max(ys))) <= 3.15, "roof deeper than 6 m span"
    assert min(zs) >= -0.001, f"geometry sinks below ground: {min(zs)}"
    assert max(zs) <= 5.4, f"chimney too tall: {max(zs)}"


def export_glb():
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
    build_house()
    tris, verts = report()
    bounds_report()
    assert tris < 220, f"triangle budget blown: {tris}"
    export_glb()
    print("HOUSE_OK")
