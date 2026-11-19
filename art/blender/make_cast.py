"""Model the six plaza NPCs as low-poly humanoids, one GLB per character.

Why this asset: the owner played the published preview and said the people
still look like plain cylinders. Each character gets a recognizable body:
head with hair and a nose (so faces have a direction), torso in role clothing,
two separate legs and two separate arms, plus a role prop.

Animation contract (read by src/npcs.js):
  - Limb meshes are named LimbArmL / LimbArmR / LimbLegL / LimbLegR and their
    geometry is authored RELATIVE TO ITS JOINT (shoulder / hip), hanging down
    -z in Blender space. The game hangs each under a pivot Group at the joint
    and rotates it, so walking is real limb movement, not a body bob.
  - HandL / HandR are authored in the same arm-joint space and ride the arm.
  - BootL / BootR ride the leg. PauldronL / PauldronR ride the arm at the
    shoulder. Everything else is body space with feet at z=0.
  - Prop meshes are body space; the game attaches the carried ones to a hand.
  - Materials are named (Cloth, Skin, HairC, Accent, Boot, Steel, WoodP, Paper).

Cast (palette comes from NPC_DATA in src/npcs.js, mirrored here):
  mara   Keeper    long blue robe, gold sash, hair bun, lantern pole.
  oswin  Trader    brown tunic + pale apron, red scarf, flat cap, coin pouch.
  pip    Child     0.72 scale, green tunic, shorts, messy hair, wooden hoop.
  halden Guard     grey tabard, steel pauldrons + nasal helmet, spear.
  sable  Mapmaker  purple cloak, wide-brim hat, rolled map.
  wren   Clerk     green coat, hair tied back, ledger board.

Budget: < 460 tris per character; six on screen at once on weak phones.

Run: /worker/state/grunt-blender --python art/blender/make_cast.py
Outputs: art/blender/npc_<id>.glb
"""

import math
import os

import bpy
import bmesh

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

BOOT = (0.169, 0.149, 0.133)
STEEL = (0.56, 0.59, 0.66)
WOOD = (0.541, 0.353, 0.200)
PAPER = (0.87, 0.82, 0.68)

CAST = {
    "mara":   {"kind": "robe",   "coat": 0x2F5D8A, "skin": 0xD9A983, "hair": 0x3A2A1E, "accent": 0xFFD479},
    "oswin":  {"kind": "trader", "coat": 0x7A4B2A, "skin": 0xC98F68, "hair": 0x1F1A16, "accent": 0xC94F3A},
    "pip":    {"kind": "child",  "coat": 0x4A7A4A, "skin": 0xE0B892, "hair": 0x8A5A2A, "accent": 0x8FD49A},
    "halden": {"kind": "guard",  "coat": 0x5A5A62, "skin": 0xD2A07C, "hair": 0x221C18, "accent": 0x8F97A8},
    "sable":  {"kind": "cloak",  "coat": 0x4B3A63, "skin": 0xA87B5A, "hair": 0x6B4B2A, "accent": 0xC9A6F0},
    "wren":   {"kind": "clerk",  "coat": 0x3F5A4A, "skin": 0xB98A63, "hair": 0x2A2118, "accent": 0xF0C46B},
}


def hex_to_rgb(h):
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


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


def emit(name, bm, material):
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
    for dz in (-1, 1):
        for dy in (-1, 1):
            for dx in (-1, 1):
                verts.append(bm.verts.new((cx + dx * hx, cy + dy * hy, cz + dz * hz)))
    # bottom 0-3 (z-), top 4-7 (z+); order x-,x+ per y row
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4),
             (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    for f in faces:
        bm.faces.new(tuple(verts[i] for i in f))


def prism(bm, radius, height, cx, cy, cz, sides=8, taper_top=1.0):
    verts_b, verts_t = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        verts_b.append(bm.verts.new((cx + radius * math.cos(a),
                                     cy + radius * math.sin(a), cz - height / 2)))
        verts_t.append(bm.verts.new((cx + radius * taper_top * math.cos(a),
                                     cy + radius * taper_top * math.sin(a),
                                     cz + height / 2)))
    bm.faces.new(tuple(reversed(verts_b)))
    bm.faces.new(tuple(verts_t))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((verts_b[i], verts_b[j], verts_t[j], verts_t[i]))


def head_group(mats, hair_style, head_z=1.52, head_r=0.155):
    bm = bmesh.new()
    prism(bm, head_r, 0.26, 0, 0, head_z, sides=10, taper_top=0.92)
    emit("Head", bm, mats["skin"])
    bm = bmesh.new()
    box(bm, 0.05, 0.06, 0.06, 0, head_r + 0.015, head_z - 0.01)
    emit("Nose", bm, mats["skin"])
    bm = bmesh.new()
    r = head_r + (0.03 if hair_style == "messy" else 0.02)
    prism(bm, r, 0.1, 0, -0.012, head_z + 0.12, sides=10,
          taper_top=0.7 if hair_style == "messy" else 0.85)
    emit("Hair", bm, mats["hair"])
    if hair_style == "bun":
        bm = bmesh.new()
        prism(bm, 0.07, 0.09, 0, -head_r - 0.03, head_z + 0.1, sides=8)
        emit("HairBun", bm, mats["hair"])
    elif hair_style == "tied":
        bm = bmesh.new()
        box(bm, 0.07, 0.16, 0.07, 0, -head_r - 0.07, head_z - 0.02)
        emit("HairTail", bm, mats["hair"])


def arm(mats, side, sleeve):
    """Arm + hand relative to the shoulder joint at origin, hanging down."""
    bm = bmesh.new()
    box(bm, 0.11, 0.12, 0.36, 0, 0, -0.18)
    emit(f"LimbArm{side}", bm, sleeve)
    bm = bmesh.new()
    box(bm, 0.09, 0.1, 0.16, 0, 0, -0.44)
    emit(f"Hand{side}", bm, mats["skin"])


def leg(mats, side, trouser):
    """Leg + boot relative to the hip joint at origin, hanging down."""
    bm = bmesh.new()
    box(bm, 0.13, 0.15, 0.5, 0, 0, -0.25)
    emit(f"LimbLeg{side}", bm, trouser)
    bm = bmesh.new()
    box(bm, 0.14, 0.22, 0.1, 0, 0.03, -0.55)
    emit(f"Boot{side}", bm, mats["boot"])


def build_character(spec):
    kind = spec["kind"]
    coat = make_material("Cloth", hex_to_rgb(spec["coat"]))
    skin = make_material("Skin", hex_to_rgb(spec["skin"]), roughness=0.7)
    hair = make_material("HairC", hex_to_rgb(spec["hair"]), roughness=0.9)
    accent = make_material("Accent", hex_to_rgb(spec["accent"]), roughness=0.6)
    boot = make_material("Boot", BOOT, roughness=0.9)
    steel = make_material("Steel", STEEL, roughness=0.4, metalness=0.7)
    wood = make_material("WoodP", WOOD)
    paper = make_material("Paper", PAPER)
    mats = {"skin": skin, "hair": hair, "boot": boot}

    if kind == "robe":
        bm = bmesh.new()
        prism(bm, 0.34, 1.32, 0, 0, 0.68, sides=10, taper_top=0.62)
        emit("Torso", bm, coat)
        bm = bmesh.new()
        box(bm, 0.5, 0.34, 0.09, 0, 0, 1.06)
        emit("Sash", bm, accent)
        head_group(mats, "bun")
        for side in ("L", "R"):
            arm(mats, side, coat)
            # Stub legs inside the robe keep the pivot contract uniform.
            bm = bmesh.new()
            box(bm, 0.1, 0.12, 0.4, 0, 0, -0.2)
            emit(f"LimbLeg{side}", bm, coat)
        bm = bmesh.new()
        box(bm, 0.04, 0.04, 0.8, 0, 0, 0)
        emit("PropPole", bm, wood)
        bm = bmesh.new()
        box(bm, 0.14, 0.14, 0.18, 0, 0, 0)
        emit("PropLantern", bm, accent)
    elif kind == "trader":
        bm = bmesh.new()
        prism(bm, 0.30, 0.62, 0, 0, 1.05, sides=10, taper_top=0.88)
        emit("Torso", bm, coat)
        bm = bmesh.new()
        box(bm, 0.42, 0.08, 0.56, 0, 0.24, 0.95)
        emit("Apron", bm, paper)
        bm = bmesh.new()
        box(bm, 0.4, 0.32, 0.09, 0, 0, 1.3)
        emit("Scarf", bm, accent)
        head_group(mats, "short")
        bm = bmesh.new()
        prism(bm, 0.19, 0.07, 0, 0, 1.72, sides=10, taper_top=0.9)
        emit("HatCap", bm, coat)
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, boot)
        bm = bmesh.new()
        box(bm, 0.14, 0.1, 0.16, 0.2, 0.16, 0.8)
        emit("PropPouch", bm, accent)
    elif kind == "child":
        bm = bmesh.new()
        prism(bm, 0.24, 0.5, 0, 0, 0.95, sides=10, taper_top=0.85)
        emit("Torso", bm, coat)
        head_group(mats, "messy", head_z=1.4, head_r=0.17)
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, accent)
        bm = bmesh.new()
        prism(bm, 0.22, 0.04, 0, 0, 0, sides=8)
        emit("PropHoop", bm, wood)
    elif kind == "guard":
        bm = bmesh.new()
        prism(bm, 0.31, 0.66, 0, 0, 1.06, sides=10, taper_top=0.95)
        emit("Torso", bm, coat)
        bm = bmesh.new()
        box(bm, 0.36, 0.1, 0.6, 0, 0.25, 1.0)
        emit("Tabard", bm, accent)
        head_group(mats, "short")
        bm = bmesh.new()
        prism(bm, 0.19, 0.16, 0, 0, 1.68, sides=10, taper_top=0.6)
        emit("Helmet", bm, steel)
        bm = bmesh.new()
        box(bm, 0.04, 0.05, 0.14, 0, 0.18, 1.56)
        emit("HelmetNasal", bm, steel)
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, boot)
            bm = bmesh.new()
            box(bm, 0.16, 0.18, 0.08, 0, 0, 0.02)
            emit(f"Pauldron{side}", bm, steel)
        bm = bmesh.new()
        box(bm, 0.04, 0.04, 1.7, 0, 0, 0)
        emit("PropSpear", bm, wood)
        bm = bmesh.new()
        prism(bm, 0.05, 0.22, 0, 0, 0.95, sides=6, taper_top=0.05)
        emit("PropSpearTip", bm, steel)
    elif kind == "cloak":
        bm = bmesh.new()
        prism(bm, 0.28, 0.62, 0, 0, 1.04, sides=10, taper_top=0.9)
        emit("Torso", bm, coat)
        # Cloak: a wider, shorter cone behind the shoulders down to the knees.
        bm = bmesh.new()
        prism(bm, 0.36, 1.0, 0, -0.06, 0.85, sides=10, taper_top=0.55)
        emit("Cloak", bm, accent)
        head_group(mats, "short")
        # Wide-brim hat: brim disc + crown.
        bm = bmesh.new()
        prism(bm, 0.30, 0.03, 0, 0, 1.66, sides=10)
        emit("HatBrim", bm, coat)
        bm = bmesh.new()
        prism(bm, 0.16, 0.14, 0, 0, 1.74, sides=10, taper_top=0.8)
        emit("HatCrown", bm, coat)
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, boot)
        # Rolled map, held in the left hand (game attaches it).
        bm = bmesh.new()
        prism(bm, 0.05, 0.4, 0, 0, 0, sides=8)
        emit("PropMap", bm, paper)
    elif kind == "clerk":
        bm = bmesh.new()
        prism(bm, 0.27, 0.64, 0, 0, 1.04, sides=10, taper_top=0.9)
        emit("Torso", bm, coat)
        bm = bmesh.new()
        box(bm, 0.34, 0.3, 0.08, 0, 0, 1.3)
        emit("Collar", bm, accent)
        head_group(mats, "tied")
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, boot)
        # Ledger board, held in the left hand.
        bm = bmesh.new()
        box(bm, 0.26, 0.05, 0.34, 0, 0, 0)
        emit("PropLedger", bm, wood)
        bm = bmesh.new()
        box(bm, 0.22, 0.02, 0.3, 0, 0.035, 0)
        emit("PropLedgerPages", bm, paper)
    else:
        raise ValueError(f"unknown kind {kind}")

    # Child proportions: uniformly shrink the whole character at export time
    # via object scale, so joint-space limb geometry stays consistent.
    if kind == "child":
        for obj in bpy.data.objects:
            if obj.type == "MESH":
                obj.scale = (0.72, 0.72, 0.72)


def report():
    total_tris = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        tris = len(obj.data.loop_triangles)
        total_tris += tris
        print(f"  {obj.name:20s} tris={tris:4d}")
    print(f"TOTAL tris={total_tris}")
    return total_tris


def limb_contract_check():
    names = {o.name for o in bpy.data.objects if o.type == "MESH"}
    for required in ("LimbArmL", "LimbArmR", "LimbLegL", "LimbLegR",
                     "HandL", "HandR", "Torso", "Head"):
        assert required in names, f"missing contract mesh {required}"
    # Limb geometry must be authored around its joint: x/y near 0, z <= 0.05.
    for name in ("LimbArmL", "LimbArmR", "LimbLegL", "LimbLegR"):
        obj = bpy.data.objects[name]
        for v in obj.data.vertices:
            assert abs(v.co.x) < 0.12, f"{name} not joint-centred in x: {v.co.x}"
            assert abs(v.co.y) < 0.14, f"{name} not joint-centred in y: {v.co.y}"
            assert v.co.z <= 0.05, f"{name} extends above its joint: {v.co.z}"


def bounds_report():
    xs, ys, zs = [], [], []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if obj.name.startswith(("Limb", "Hand", "Boot", "Pauldron", "Prop")):
            continue  # joint-space or carried; body bounds exclude them
        for v in obj.data.vertices:
            co = obj.matrix_world @ v.co
            xs.append(co.x); ys.append(co.y); zs.append(co.z)
    print(f"BODY BOUNDS x[{min(xs):.3f},{max(xs):.3f}] y[{min(ys):.3f},{max(ys):.3f}] "
          f"z[{min(zs):.3f},{max(zs):.3f}]")
    assert min(zs) >= -0.02, f"body sinks below ground: {min(zs)}"
    assert max(zs) <= 2.0, f"body too tall: {max(zs)}"
    assert max(abs(min(xs)), abs(max(xs))) <= 0.5, "body too wide"


def export_glb(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_animations=False,
        export_draco_mesh_compression_enable=False,
    )
    size = os.path.getsize(path)
    print(f"WROTE {path} ({size} bytes, {size / 1024:.1f} KB)")


if __name__ == "__main__":
    for cid, spec in CAST.items():
        reset_scene()
        build_character(spec)
        tris = report()
        limb_contract_check()
        bounds_report()
        assert tris < 460, f"{cid} triangle budget blown: {tris}"
        export_glb(os.path.join(OUT_DIR, f"npc_{cid}.glb"))
        print(f"{cid.upper()}_OK")
    print("CAST_OK")
