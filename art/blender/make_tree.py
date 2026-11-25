"""Model a low-poly tree and export it as a GLB for Three.js.

Why this asset: the plaza has no vegetation at all. A courtyard with trees reads
as a courtyard; without them the stone-and-grass plane reads as a car park. This
replaces the absence with a simple tree: a tapered trunk and a rounded canopy
built from a handful of flat-shaded facets, so it stays cheap on software
rasterisation and phones.

Design constraints, chosen to match the game rather than fight it:
  - Footprint ~1.6 m radius (collider 1.8 m half-extent), so it never blocks
    the main walking paths but still reads as a real tree.
  - Trunk and canopy are separate named meshes so the loader can dress the
    trunk in the bark texture family and the canopy in a flat green.
  - Low poly: target well under 400 triangles.
  - Y-up export (Blender is Z-up; glTF export handles the rotation).
  - Authored at ground level (y=0), like the other props.

Run: /worker/state/grunt-blender --python art/blender/make_tree.py
Output: art/blender/tree.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "tree.glb")

TRUNK_COLOR = (0.42, 0.28, 0.16)   # warm brown, matches the wood family
CANOPY_COLOR = (0.30, 0.52, 0.22)  # mid green

TRUNK_R = 0.22
TRUNK_H = 2.6
CANOPY_R = 1.35
CANOPY_SEGMENTS = 8
CANOPY_LAYERS = 3


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


def cylinder(bm, r_bottom, r_top, height, sides, cx, cy, cz):
    # bmesh cylinder along Z.
    bmesh.ops.create_cone(
        bm,
        segments=sides,
        radius1=r_bottom,
        radius2=r_top,
        depth=height,
    )
    # create_cone places it at origin along Z; translate.
    for v in bm.verts:
        v.co.z += cz
        v.co.x += cx
        v.co.y += cy


def sphere_lumps(bm, cx, cy, cz, r, sides=8, rings=5):
    bmesh.ops.create_uvsphere(bm, u_segments=sides, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co.x += cx
        v.co.y += cy
        v.co.z += cz


def build_tree():
    trunk_mat = make_material("Trunk", TRUNK_COLOR)
    canopy_mat = make_material("Canopy", CANOPY_COLOR)

    # Trunk: tapered cylinder, slightly wider at the base.
    bm = bmesh.new()
    cylinder(bm, TRUNK_R * 1.15, TRUNK_R * 0.7, TRUNK_H, 8, 0, 0, TRUNK_H / 2)
    new_mesh_object("TreeTrunk", bm, trunk_mat)

    # Canopy: three overlapping spheres at slightly different heights/offsets
    # to read as a rounded crown rather than a single ball.
    offsets = [(0, 0, TRUNK_H + 0.4), (0.35, 0.2, TRUNK_H + 0.9),
               (-0.3, -0.25, TRUNK_H + 1.0), (0.1, -0.3, TRUNK_H + 0.6)]
    radii = [CANOPY_R, CANOPY_R * 0.78, CANOPY_R * 0.72, CANOPY_R * 0.7]
    for (ox, oy, oz), r in zip(offsets, radii):
        bm = bmesh.new()
        sphere_lumps(bm, ox, oy, oz, r, sides=8, rings=5)
        new_mesh_object("TreeCanopy", bm, canopy_mat)


def export_glb():
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
    )


def main():
    reset_scene()
    build_tree()
    export_glb()
    # Report tri count.
    tris = 0
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            tris += len(obj.data.polygons)
    print(f"TREE_OK tris={tris} path={OUT_PATH}")


if __name__ == "__main__":
    main()
