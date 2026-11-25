"""Model the plaza fountain and export it as a GLB for Three.js.

Why this asset: the fountain sits at the plaza centre and is the first thing a
player sees -- spawn is at (0, 13) looking north straight at it. In the game it was a
4m box with two cylinders on top, which read as a crate with a pipe through it. This
replaces it with a real tiered stone fountain.

Design constraints, chosen to match the existing game rather than fight it:
  - Footprint must stay within the current 4x4 collider so no gameplay changes and
    no pathfinding grid is invalidated.
  - Low poly: this runs on software rasterisation at ~3fps and on phones. Target a
    few thousand triangles, not a sculpt.
  - Y-up in the export. Blender is Z-up, so glTF export handles the rotation; the
    mesh is authored with Z as height here.
  - Named meshes so the game can find the water surface and animate it.

Run: /worker/state/grunt-blender --python art/blender/make_fountain.py
Output: art/blender/fountain.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(OUT_DIR, "fountain.glb")

# --- palette, matched to the game's existing materials -----------------------
STONE = (0.561, 0.522, 0.467)   # 0x8f8577, the game's stone
STONE_DARK = (0.44, 0.41, 0.37)
WATER = (0.310, 0.576, 0.769)   # 0x4f93c4, the game's water


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
    # Flat-ish shading keeps facets readable at low poly and costs no normals work.
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def ring_solid(bm, sides, radius_outer, radius_inner, z_bottom, z_top):
    """A hollow polygonal ring (basin wall) built as an explicit quad shell.

    Hand-built rather than boolean: booleans on a 5.0 kernel are slower and can
    leave non-manifold junk, and this shape is trivial to emit directly.
    """
    outer_bottom, outer_top, inner_bottom, inner_top = [], [], [], []
    for i in range(sides):
        a = (2 * math.pi * i) / sides + math.pi / sides
        co, so = math.cos(a), math.sin(a)
        outer_bottom.append(bm.verts.new((radius_outer * co, radius_outer * so, z_bottom)))
        outer_top.append(bm.verts.new((radius_outer * co, radius_outer * so, z_top)))
        inner_bottom.append(bm.verts.new((radius_inner * co, radius_inner * so, z_bottom)))
        inner_top.append(bm.verts.new((radius_inner * co, radius_inner * so, z_top)))
    for i in range(sides):
        j = (i + 1) % sides
        # outer wall, inner wall, top rim, bottom
        bm.faces.new((outer_bottom[i], outer_bottom[j], outer_top[j], outer_top[i]))
        bm.faces.new((inner_top[i], inner_top[j], inner_bottom[j], inner_bottom[i]))
        bm.faces.new((outer_top[i], outer_top[j], inner_top[j], inner_top[i]))
        bm.faces.new((inner_bottom[i], inner_bottom[j], outer_bottom[j], outer_bottom[i]))


def disc(bm, sides, radius, z, phase=0.0, flip=False):
    verts = []
    for i in range(sides):
        a = (2 * math.pi * i) / sides + phase
        verts.append(bm.verts.new((radius * math.cos(a), radius * math.sin(a), z)))
    face = bm.faces.new(tuple(verts) if not flip else tuple(reversed(verts)))
    return face


def tapered_column(bm, sides, r_bottom, r_top, z_bottom, z_top, phase=0.0):
    bottom, top = [], []
    for i in range(sides):
        a = (2 * math.pi * i) / sides + phase
        c, s = math.cos(a), math.sin(a)
        bottom.append(bm.verts.new((r_bottom * c, r_bottom * s, z_bottom)))
        top.append(bm.verts.new((r_top * c, r_top * s, z_top)))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bm.faces.new(tuple(reversed(bottom)))
    bm.faces.new(tuple(top))


def build_fountain():
    stone = make_material("Stone", STONE, roughness=0.85)
    stone_dark = make_material("StoneDark", STONE_DARK, roughness=0.9)
    water = make_material("Water", WATER, roughness=0.15, metalness=0.1)

    SIDES = 8  # octagonal, reads as cut stone rather than a smooth cylinder

    # 1. Stepped plinth. Two octagonal slabs, widest at the base.
    #    Outer radius 1.95 keeps the footprint inside the existing 4x4 collider.
    bm = bmesh.new()
    tapered_column(bm, SIDES, 1.95, 1.95, 0.0, 0.18)
    new_mesh_object("FountainPlinthLower", bm, stone_dark)

    bm = bmesh.new()
    tapered_column(bm, SIDES, 1.72, 1.72, 0.18, 0.36)
    new_mesh_object("FountainPlinthUpper", bm, stone)

    # 2. Lower basin: a hollow octagonal wall with a floor.
    bm = bmesh.new()
    ring_solid(bm, SIDES, 1.62, 1.40, 0.36, 0.86)
    disc(bm, SIDES, 1.40, 0.40, phase=math.pi / SIDES, flip=True)  # basin floor
    new_mesh_object("FountainBasin", bm, stone)

    # 3. Water in the lower basin, slightly below the rim so the rim casts a line.
    bm = bmesh.new()
    disc(bm, SIDES, 1.40, 0.74, phase=math.pi / SIDES)
    new_mesh_object("FountainWaterLower", bm, water)

    # 4. Central column rising from the basin floor, tapered and faceted.
    bm = bmesh.new()
    tapered_column(bm, SIDES, 0.30, 0.20, 0.40, 1.55, phase=math.pi / SIDES)
    new_mesh_object("FountainColumn", bm, stone)

    # 5. Upper bowl: a shallow dish, wider than the column, on a short neck.
    bm = bmesh.new()
    tapered_column(bm, SIDES, 0.22, 0.30, 1.55, 1.70, phase=math.pi / SIDES)
    ring_solid(bm, SIDES, 0.80, 0.66, 1.70, 1.92)
    disc(bm, SIDES, 0.66, 1.74, phase=math.pi / SIDES, flip=True)
    new_mesh_object("FountainUpperBowl", bm, stone)

    bm = bmesh.new()
    disc(bm, SIDES, 0.66, 1.86, phase=math.pi / SIDES)
    new_mesh_object("FountainWaterUpper", bm, water)

    # 6. Finial: a small tapered spout the water would come from.
    bm = bmesh.new()
    tapered_column(bm, SIDES, 0.13, 0.06, 1.92, 2.24, phase=math.pi / SIDES)
    new_mesh_object("FountainFinial", bm, stone_dark)

    # 7. Four carved corner blocks on the plinth, so the base is not a plain slab.
    #    Kept inside radius 1.95 so the collider still contains everything.
    for i in range(4):
        a = (2 * math.pi * i) / 4 + math.pi / 4
        cx, cy = 1.55 * math.cos(a), 1.55 * math.sin(a)
        bm = bmesh.new()
        half = 0.20
        verts_bottom = [
            bm.verts.new((cx - half, cy - half, 0.36)),
            bm.verts.new((cx + half, cy - half, 0.36)),
            bm.verts.new((cx + half, cy + half, 0.36)),
            bm.verts.new((cx - half, cy + half, 0.36)),
        ]
        verts_top = [
            bm.verts.new((cx - half * 0.7, cy - half * 0.7, 0.62)),
            bm.verts.new((cx + half * 0.7, cy - half * 0.7, 0.62)),
            bm.verts.new((cx + half * 0.7, cy + half * 0.7, 0.62)),
            bm.verts.new((cx - half * 0.7, cy + half * 0.7, 0.62)),
        ]
        for k in range(4):
            j = (k + 1) % 4
            bm.faces.new((verts_bottom[k], verts_bottom[j], verts_top[j], verts_top[k]))
        bm.faces.new(tuple(verts_top))
        new_mesh_object(f"FountainCornerBlock{i}", bm, stone_dark)


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
        print(f"  {obj.name:28s} verts={len(obj.data.vertices):5d} tris={tris:5d}")
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
    # The game's existing collider is 4x4 centred on the origin, i.e. +/-2.
    assert max(abs(min(xs)), abs(max(xs))) <= 2.0, "footprint exceeds the existing collider"
    assert max(abs(min(ys)), abs(max(ys))) <= 2.0, "footprint exceeds the existing collider"
    assert min(zs) >= -0.001, "geometry sinks below the ground plane"


def export_glb():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format="GLB",
        use_selection=True,
        export_yup=True,          # Three.js is Y-up
        export_apply=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_draco_mesh_compression_enable=False,  # no decoder dependency in the game
    )
    size = os.path.getsize(OUT_PATH)
    print(f"WROTE {OUT_PATH} ({size} bytes, {size / 1024:.1f} KB)")


if __name__ == "__main__":
    reset_scene()
    build_fountain()
    tris, verts = report()
    bounds_report()
    # A hard budget: this must stay cheap enough for a phone and for software GL.
    assert tris < 4000, f"triangle budget blown: {tris}"
    export_glb()
    print("FOUNTAIN_OK")
