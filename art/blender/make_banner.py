"""Model the terrace banner (hanging cloth + rod) and export it as a GLB.

Round 71 replaces the last big flat colour in the plaza: the terrace banner was
a 2.4 x 1.1 PlaneGeometry (5.28 m2) with a solid #2f5d8a fill. A plane has no
thickness, no rod, no folds and no cast shadow -- at the terrace lip, which is
the first thing the player sees when they crest the ramp, it read as a sticker.

What this asset actually models:
  - a real rod (with finials) the cloth hangs from,
  - a cloth panel with authored folds: a subdivided grid whose depth is a wave
    across the width that only ever pushes outward (the cloth hangs free of
    the wall), fading to flat where the rod grips the top edge,
  - a hem that sags gently at the centre and lifts toward the rod ends, so the
    bottom edge is not the dead-straight line that made the old plane read as
    a decal,
  - four hanging tabs joining rod to cloth,
  - authored UVs covering the whole panel exactly once (0..1), because the
    banner maps are painted as one non-repeating design: any tiling here would
    smear a seam through the middle of the emblem.

Design constraints:
  - Sits against the terrace back wall (world.js places the group ~0.08 m in
    front of the wall face). The GLB is authored around the cloth centre, so
    world.js only sets a position. Nothing may extend more than ~0.075 m
    behind the origin (+Y here) or it would meet the wall.
  - The cloth's front faces glTF +Z (toward the plaza): the quad winding is
    chosen for that, so the banner is visible from where the player stands.
  - Low poly: ~540 tris total. The lamp's 300-tri target was for a prop
    repeated five times; the banner is a single instance, and the fold grid is
    the whole point of the asset.
  - Y-up export (Blender is Z-up; glTF export handles the rotation).
  - Named meshes: BannerCanvas carries the painted maps; BannerRod,
    BannerFinial and BannerStrap stay painted iron. The canvas material is
    deliberately NOT named with "cloth" -- the round-67 weave family matches
    /cloth/i by material name, and a sack weave must never be smeared over a
    painted design.

Run: /worker/state/grunt-blender --python art/blender/make_banner.py
Output: art/blender/banner.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(OUT_DIR, "banner.glb")

# --- palette ----------------------------------------------------------------
# The cloth's base colour is the paint the Kaggle maps already carry, so the GLB
# keeps it white-ish and the world leaves the material tint alone.
CLOTH = (0.86, 0.86, 0.86)
# The rod is painted iron, matching the round-70 `iron` PROP_FAMILY's source.
IRON = (0.28, 0.28, 0.30)

W = 2.4            # cloth width (matches the old PlaneGeometry)
H = 1.1            # cloth height at the panel's centre
COLS = 24          # grid columns: enough for smooth folds, cheap enough for phones
ROWS = 8           # grid rows: folds only vary across the width
FOLD_COUNT = 3     # number of sine folds across the width
FOLD_DEPTH = 0.028  # metres of depth at each fold's crest
ROD_R = 0.018


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


def new_mesh_object(name, bm, material, smooth=False):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = smooth
    return obj


def cylinder(bm, sides, r, length, cx, cy, cz, axis="X"):
    """A cylinder along `axis`, centred at (cx, cy, cz)."""
    ring_a, ring_b = [], []
    for i in range(sides):
        a = (2 * math.pi * i) / sides
        co, so = math.cos(a), math.sin(a)
        if axis == "X":
            p0 = (cx - length / 2, cy + r * co, cz + r * so)
            p1 = (cx + length / 2, cy + r * co, cz + r * so)
        else:  # Z
            p0 = (cx + r * co, cy + r * so, cz - length / 2)
            p1 = (cx + r * co, cy + r * so, cz + length / 2)
        ring_a.append(bm.verts.new(p0))
        ring_b.append(bm.verts.new(p1))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((ring_a[i], ring_a[j], ring_b[j], ring_b[i]))
    bm.faces.new(tuple(reversed(ring_a)))
    bm.faces.new(tuple(ring_b))


def hem_drop(u):
    """How much shorter the cloth is at column u (the hem rises by this much).

    A straight hem is what made the old plane read as a decal. The cloth sags
    to its lowest at the centre and lifts toward the rod ends, like fabric
    hung from a rod rather than ironed flat.
    """
    return 0.11 * (abs(u) ** 0.7)


def fold_depth(u, v):
    """Outward depth of a point on the cloth (Blender -Y = glTF +Z, player side).

    The cloth hangs free of the wall, so folds only ever push outward: a wave
    across the width (never negative) whose amplitude fades to zero at the
    top, where the rod grips the cloth flat, and softens toward the hem.
    """
    taper = min(1.0, max(0.0, v * 1.8)) * (0.45 + 0.55 * min(1.0, max(0.0, (1.0 - v) * 1.6)))
    wave = 0.55 + 0.45 * math.sin(u * math.pi * FOLD_COUNT * 2)
    return FOLD_DEPTH * taper * wave


def build_banner():
    cloth = make_material("BannerCanvas", CLOTH, roughness=0.92, metalness=0.0)
    iron = make_material("BannerRod", IRON, roughness=0.55, metalness=0.55)

    # --- cloth panel: a UV-mapped grid, no sides needed ---------------------
    # Authored in Blender's XZ plane facing -Y (toward the player), which is how
    # the game will place it: world.js sets position only, no rotation.
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    grid = []
    for row in range(ROWS + 1):
        v = row / ROWS
        row_verts = []
        for col in range(COLS + 1):
            u = col / COLS
            uu = u * 2 - 1                      # -1..1 across the width
            x = uu * (W / 2)
            drop = hem_drop(uu) * (1 - v)       # hem only at the bottom row
            z = H / 2 - v * (H - drop)
            y = -fold_depth(uu, v)              # folds push away from the wall
            row_verts.append(bm.verts.new((x, y, z)))
        grid.append(row_verts)

    for row in range(ROWS):
        for col in range(COLS):
            a = grid[row][col]
            b = grid[row][col + 1]
            c = grid[row + 1][col + 1]
            d = grid[row + 1][col]
            # Winding (a, d, c, b) puts the front normal at Blender -Y, which
            # the Y-up export turns into glTF +Z -- toward the player. The
            # naive (a, b, c, d) order faces the wall and the banner would be
            # invisible from the plaza.
            face = bm.faces.new((a, d, c, b))
            # One UV tile over the whole panel: the banner maps are a single
            # painted design, so any tiling would cut a seam through it. Loop
            # order must match the vertex order above, u growing with +X and
            # v=1 at the top edge so the painted design reads upright.
            uvs = [(col / COLS, 1 - row / ROWS),
                   (col / COLS, 1 - (row + 1) / ROWS),
                   ((col + 1) / COLS, 1 - (row + 1) / ROWS),
                   ((col + 1) / COLS, 1 - row / ROWS)]
            for loop, co in zip(face.loops, uvs):
                loop[uv_layer].uv = co
    obj = new_mesh_object("BannerCanvas", bm, cloth, smooth=True)

    # --- rod above the panel ----------------------------------------------
    rod_y = 0.0
    rod_z = H / 2 + 0.03
    bm = bmesh.new()
    cylinder(bm, 10, ROD_R, W + 0.34, 0, rod_y, rod_z, axis="X")
    new_mesh_object("BannerRod", bm, iron, smooth=True)

    # Finials: slightly larger caps at each rod end.
    bm = bmesh.new()
    for sx in (-1, 1):
        cylinder(bm, 10, ROD_R * 1.9, 0.05, sx * (W / 2 + 0.175), rod_y, rod_z, axis="X")
    new_mesh_object("BannerFinial", bm, iron, smooth=True)

    # --- hanging tabs from the rod down over the cloth's top edge -----------
    # Four thin straps: without them the cloth floats off the rod. The top
    # edge is flat (folds taper to zero there), so each tab meets it flush.
    bm = bmesh.new()
    for x in (-0.9, -0.3, 0.3, 0.9):
        bx0, bx1 = x - 0.016, x + 0.016
        by0, by1 = -0.006, 0.006
        bz0, bz1 = H / 2 - 0.04, rod_z
        v = {}
        for xi, xv in enumerate((bx0, bx1)):
            for yi, yv in enumerate((by0, by1)):
                for zi, zv in enumerate((bz0, bz1)):
                    v[(xi, yi, zi)] = bm.verts.new((xv, yv, zv))
        faces = [
            ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)),
            ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),
            ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),
            ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)),
            ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)),
            ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),
        ]
        for f in faces:
            bm.faces.new(tuple(v[k] for k in f))
    new_mesh_object("BannerStrap", bm, iron)


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
        uv = obj.data.uv_layers.active
        print(f"  {obj.name:16s} verts={len(obj.data.vertices):5d} "
              f"tris={tris:5d} uv_layers={len(obj.data.uv_layers)}")
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
    # The panel's authored box: about +/-1.2 m of cloth plus the rod overhang,
    # no lower than the hem, and nothing extending toward the wall past the
    # 0.08 m standoff world.js places the group at (Blender +Y maps to glTF -Z,
    # i.e. toward the wall; the rod and finial radii dominate at 0.034 m, the
    # folds only ever push the other way).
    assert max(xs) <= W / 2 + 0.21, f"rod overhangs the cloth: {max(xs):.3f}"
    assert min(zs) >= -H / 2 - 0.001, f"cloth hangs below its hem: {min(zs):.3f}"
    assert max(ys) <= 0.075, f"banner would meet the wall face: {max(ys):.3f}"
    assert min(ys) >= -0.05, f"folds deeper than authored: {min(ys):.3f}"


def uv_report():
    """Every loop must carry a finite UV inside 0..1 -- the maps are non-tiling."""
    worst_out = 0.0
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not obj.data.uv_layers.active:
            continue
        uv_data = obj.data.uv_layers.active.data
        for i, loop in enumerate(obj.data.loops):
            u, v = uv_data[i].uv
            worst_out = max(worst_out, abs(u - 0.5) - 0.5, abs(v - 0.5) - 0.5)
    print(f"UV worst out-of-range = {worst_out:.6f}")
    assert worst_out <= 1e-6, f"authored UVs leave 0..1: {worst_out}"


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
    build_banner()
    tris, verts = report()
    bounds_report()
    uv_report()
    # Single instance in the scene (the lamp's 300-tri target was for a prop
    # repeated five times). The fold grid is the point of this asset; ~540
    # tris is far inside any phone's frame budget.
    assert tris < 600, f"triangle budget blown: {tris}"
    export_glb()
    print("BANNER_OK")