"""Model a lantern post (street lamp) and export it as a GLB for Three.js.

Why this asset: the plaza has four lantern posts built from a cylinder + sphere.
They read as pipes with a ball on top. This replaces them with a proper lamp post:
a tapered iron post, a bracket arm, and a glass lantern housing with an emissive
bulb visible inside.

Design constraints:
  - Footprint must stay within the existing 0.4 x 0.4 collider (+/-0.2).
  - Low poly: software rasterisation at ~3fps and real phones. Target < 300 tris.
  - Y-up export (Blender is Z-up; glTF export handles the rotation).
  - Named meshes so the game can find the bulb and animate its emissive intensity
    with the day/night cycle (the game already drives lamp emissiveIntensity).

Run: /worker/state/grunt-blender --python art/blender/make_lamp.py
Output: art/blender/lamp.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "lamp.glb")

# --- palette, matched to the game's existing materials -----------------------
IRON = (0.230, 0.235, 0.245)
GLASS = (0.95, 0.88, 0.62)
BULB = (1.0, 0.85, 0.45)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, colour, roughness=0.8, metalness=0.0, emissive=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metalness
        if emissive is not None:
            bsdf.inputs["Emission Color"].default_value = (*emissive, 1.0)
            bsdf.inputs["Emission Strength"].default_value = 1.6
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


def cylinder(bm, sides, r_bottom, r_top, h, cx, cy, cz_bottom):
    """A (possibly tapered) cylinder along Z, base at cz_bottom."""
    bottom, top = [], []
    for i in range(sides):
        a = (2 * math.pi * i) / sides
        co, so = math.cos(a), math.sin(a)
        bottom.append(bm.verts.new((cx + r_bottom * co, cy + r_bottom * so, cz_bottom)))
        top.append(bm.verts.new((cx + r_top * co, cy + r_top * so, cz_bottom + h)))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    # caps
    if r_bottom > 0:
        bm.faces.new(tuple(bottom[i] for i in range(sides)))
    if r_top > 0:
        bm.faces.new(tuple(top[sides - 1 - i] for i in range(sides)))


def build_lamp():
    iron = make_material("LampIron", IRON, roughness=0.5, metalness=0.7)
    glass = make_material("LampGlass", GLASS, roughness=0.15, metalness=0.0)
    bulb = make_material("LampBulb", BULB, roughness=0.4, metalness=0.0, emissive=BULB)

    POST_H = 3.0
    # Tapered post: wider at base, narrower at top.
    bm = bmesh.new()
    cylinder(bm, 10, 0.16, 0.10, POST_H, 0, 0, 0)
    new_mesh_object("LampPost", bm, iron)

    # Base plate.
    bm = bmesh.new()
    box(bm, 0.4, 0.4, 0.12, 0, 0, 0.06)
    new_mesh_object("LampBase", bm, iron)

    # Bracket arm: horizontal, reaching out to hold the lantern.
    bm = bmesh.new()
    box(bm, 0.6, 0.12, 0.12, 0.3, 0, POST_H - 0.15)
    new_mesh_object("LampArm", bm, iron)

    # Lantern housing: a small box of glass.
    LANTERN_H = 0.55
    LANTERN_Z = POST_H - 0.15 - LANTERN_H / 2 + 0.05
    bm = bmesh.new()
    box(bm, 0.32, 0.32, LANTERN_H, 0.6, 0, LANTERN_Z)
    new_mesh_object("LampHousing", bm, glass)

    # Top cap of the lantern.
    bm = bmesh.new()
    box(bm, 0.36, 0.36, 0.08, 0.6, 0, LANTERN_Z + LANTERN_H / 2 + 0.04)
    new_mesh_object("LampCap", bm, iron)

    # Bulb inside the lantern (emissive).
    bm = bmesh.new()
    # approximate sphere with a small box for low poly
    box(bm, 0.14, 0.14, 0.14, 0.6, 0, LANTERN_Z)
    new_mesh_object("LampBulb", bm, bulb)


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
        print(f"  {obj.name:16s} verts={len(obj.data.vertices):5d} tris={tris:5d}")
    print(f"TOTAL verts={total_verts} tris={total_tris}")
    return total_tris, total_verts


def bounds_report():
    # Only the post base must fit the collider; the arm and lantern overhang
    # are expected to extend beyond it (the light hangs over the path).
    xs, ys, zs = [], [], []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name not in ("LampPost", "LampBase"):
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
    assert reach_x <= 0.21, f"lamp base exceeds its width collider: {reach_x}"
    assert reach_y <= 0.21, f"lamp base exceeds its depth collider: {reach_y}"
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
    build_lamp()
    tris, verts = report()
    bounds_report()
    assert tris < 300, f"triangle budget blown: {tris}"
    export_glb()
    print("LAMP_OK")
