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
  pip    Child     green tunic, shorts, messy hair, wooden hoop (scaled 0.72
                   by buildModelled in src/npcs.js -- never in Blender).
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
    # dir is the authored FACE direction along Blender's local y axis.
    #
    # The game walks an NPC with rotation.y = atan2(dx, dz), whose local forward
    # is +Z. Under export_yup Blender (x, y, z) becomes glTF (x, z, -y), so
    # game-forward +Z is Blender -y, NOT +y. Round 59 proved this twice: a Blender
    # +y cube exports to glTF z = [-1.10, -0.90], and every NPC built with
    # dir=+1 had its nose in glTF z = [-0.20, -0.14] (behind its own heading),
    # i.e. noseAlongFacing = -1 in a real browser. So -1 is the correct value and
    # the whole cast used to walk backwards.
    "mara":   {"kind": "robe",   "coat": 0x2F5D8A, "skin": 0xD9A983, "hair": 0x3A2A1E, "accent": 0xFFD479, "dir": -1},
    "oswin":  {"kind": "trader", "coat": 0x7A4B2A, "skin": 0xC98F68, "hair": 0x1F1A16, "accent": 0xC94F3A, "dir": -1},
    "pip":    {"kind": "child",  "coat": 0x4A7A4A, "skin": 0xE0B892, "hair": 0x8A5A2A, "accent": 0x8FD49A, "dir": -1},
    "halden": {"kind": "guard",  "coat": 0x5A5A62, "skin": 0xD2A07C, "hair": 0x221C18, "accent": 0x8F97A8, "dir": -1},
    "sable":  {"kind": "cloak",  "coat": 0x4B3A63, "skin": 0xA87B5A, "hair": 0x6B4B2A, "accent": 0xC9A6F0, "dir": -1},
    "wren":   {"kind": "clerk",  "coat": 0x3F5A4A, "skin": 0xB98A63, "hair": 0x2A2118, "accent": 0xF0C46B, "dir": -1},
}


def hex_to_rgb(h):
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


def reset_scene():
    # Fully clear bpy.data so meshes from the previous character do not persist
    # as .001 duplicates. read_factory_settings(use_empty=True) alone is not
    # enough in Blender 5.0.1.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)


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


def head_group(mats, hair_style, head_z=1.52, head_r=0.155, face_dir=1):
    # The head assembly is authored around the NECK pivot at the origin, like
    # the limbs: the game hangs it under a neck pivot at the shoulders and can
    # turn it toward the player. head_z is measured from the ground in body
    # space; subtract the neck height (shoulders) to get pivot-space offsets.
    neck_z = 1.32
    hz = head_z - neck_z
    bm = bmesh.new()
    prism(bm, head_r, 0.26, 0, 0, hz, sides=10, taper_top=0.92)
    emit("Head", bm, mats["skin"])
    bm = bmesh.new()
    box(bm, 0.05, 0.06, 0.06, 0, face_dir * (head_r + 0.015), hz - 0.01)
    emit("Nose", bm, mats["skin"])
    # Eyes: a white sclera slab with a dark iris, sunk into the face plane so
    # they read at phone distance without a texture. Offset in x for L/R.
    for side, ex in (("L", -0.055), ("R", 0.055)):
        bm = bmesh.new()
        box(bm, 0.052, 0.025, 0.062, ex, face_dir * (head_r - 0.005), hz + 0.025)
        emit(f"EyeWhite{side}", bm, mats["eye"])
        bm = bmesh.new()
        box(bm, 0.026, 0.012, 0.032, ex, face_dir * (head_r + 0.012), hz + 0.022)
        emit(f"EyeIris{side}", bm, mats["iris"])
    bm = bmesh.new()
    box(bm, 0.09, 0.02, 0.02, 0, face_dir * (head_r + 0.005), hz - 0.075)
    emit("Mouth", bm, mats["mouth"])
    bm = bmesh.new()
    r = head_r + (0.03 if hair_style == "messy" else 0.02)
    prism(bm, r, 0.1, 0, -0.012, hz + 0.12, sides=10,
          taper_top=0.7 if hair_style == "messy" else 0.85)
    emit("Hair", bm, mats["hair"])
    if hair_style == "bun":
        bm = bmesh.new()
        prism(bm, 0.07, 0.09, 0, -face_dir * (head_r + 0.03), hz + 0.1, sides=8)
        emit("HairBun", bm, mats["hair"])
    elif hair_style == "tied":
        bm = bmesh.new()
        box(bm, 0.07, 0.16, 0.07, 0, -face_dir * (head_r - 0.07), hz - 0.02)
        emit("HairTail", bm, mats["hair"])


def arm(mats, side, sleeve):
    """Arm + hand relative to the shoulder joint at origin, hanging down."""
    bm = bmesh.new()
    box(bm, 0.11, 0.12, 0.36, 0, 0, -0.18)
    emit(f"LimbArm{side}", bm, sleeve)
    bm = bmesh.new()
    box(bm, 0.085, 0.095, 0.13, 0, 0, -0.435)
    emit(f"Hand{side}", bm, mats["skin"])
    # Mitten thumb on the inner side of the hand (toward the body midline).
    thumb_x = 0.055 if side == "L" else -0.055
    bm = bmesh.new()
    box(bm, 0.045, 0.05, 0.07, thumb_x, 0.01, -0.41)
    emit(f"Thumb{side}", bm, mats["skin"])


def leg(mats, side, trouser, face_dir=1):
    """Leg + boot relative to the hip joint at origin, hanging down.

    The game hangs this pivot at JOINTS.hip.y = 0.78, so the sole has to reach
    z = -0.78 in leg space or the character walks 18 cm above the cobbles.
    Round 59 measured exactly that float (0.18 m on every non-robed NPC) and
    this is the fix. The boot toe points the same way as the face.
    """
    bm = bmesh.new()
    # Upper leg from hip (z=0) down to knee (z=-0.58 in leg space).
    box(bm, 0.135, 0.155, 0.58, 0, 0, -0.29)
    emit(f"LimbLeg{side}", bm, trouser)
    bm = bmesh.new()
    # Boot from ankle (z=-0.59 in leg space) to sole (z=-0.78 in leg space).
    # Center z=-0.685, height 0.19 → top at -0.59, bottom at -0.78.
    # The 0.255 depth is the foot; pushing its centre to face_dir * 0.045 puts
    # the toe forward of the ankle and the heel just behind it.
    box(bm, 0.145, 0.255, 0.19, 0, face_dir * 0.045, -0.685)
    emit(f"Boot{side}", bm, mats["boot"])


def build_character(spec):
    kind = spec["kind"]
    fdir = spec["dir"]
    coat = make_material("Cloth", hex_to_rgb(spec["coat"]))
    skin = make_material("Skin", hex_to_rgb(spec["skin"]), roughness=0.7)
    hair = make_material("HairC", hex_to_rgb(spec["hair"]), roughness=0.9)
    accent = make_material("Accent", hex_to_rgb(spec["accent"]), roughness=0.6)
    boot = make_material("Boot", BOOT, roughness=0.9)
    steel = make_material("Steel", STEEL, roughness=0.4, metalness=0.7)
    wood = make_material("WoodP", WOOD)
    paper = make_material("Paper", PAPER)
    eye = make_material("EyeWhite", (0.93, 0.92, 0.88), roughness=0.35)
    iris = make_material("EyeIris", (0.13, 0.11, 0.10), roughness=0.35)
    mouth = make_material("Mouth", (0.45, 0.25, 0.22), roughness=0.8)
    mats = {"skin": skin, "hair": hair, "boot": boot,
            "eye": eye, "iris": iris, "mouth": mouth}

    if kind == "robe":
        bm = bmesh.new()
        prism(bm, 0.34, 1.32, 0, 0, 0.68, sides=10, taper_top=0.62)
        emit("Torso", bm, coat)
        bm = bmesh.new()
        box(bm, 0.5, 0.34, 0.09, 0, 0, 1.06)
        emit("Sash", bm, accent)
        head_group(mats, "bun", face_dir=fdir)
        for side in ("L", "R"):
            arm(mats, side, coat)
            # Stub legs inside the robe keep the pivot contract uniform.
            bm = bmesh.new()
            box(bm, 0.1, 0.12, 0.4, 0, 0, -0.2)
            emit(f"LimbLeg{side}", bm, coat)
        bm = bmesh.new()
        box(bm, 0.04, 0.04, 0.8, 0, 0, 0)
        emit("PropPole", bm, wood)
        # Lantern hangs beside the pole top, authored in pole hand-space. The
        # game mounts both on the R hand and never moves one relative to the
        # other, so the offset has to be baked into the vertices here: a node
        # translation would be dropped by src/glb.js (see the export assert).
        # Pole spans z -0.4..+0.4; lantern is 0.18 tall, so a top-hung lantern
        # centres at 0.4-0.09 = 0.31 and sits 0.1 out to the side of the shaft.
        bm = bmesh.new()
        box(bm, 0.14, 0.14, 0.18, 0.1, 0, 0.31)
        emit("PropLantern", bm, accent)
    elif kind == "trader":
        bm = bmesh.new()
        prism(bm, 0.30, 0.62, 0, 0, 1.05, sides=10, taper_top=0.88)
        emit("Torso", bm, coat)
        bm = bmesh.new()
        box(bm, 0.42, 0.08, 0.56, 0, fdir * 0.24, 0.95)
        emit("Apron", bm, paper)
        bm = bmesh.new()
        box(bm, 0.4, 0.32, 0.09, 0, 0, 1.3)
        emit("Scarf", bm, accent)
        head_group(mats, "short", face_dir=fdir)
        bm = bmesh.new()
        prism(bm, 0.19, 0.07, 0, 0, 1.72, sides=10, taper_top=0.9)
        emit("HatCap", bm, coat)
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, boot, face_dir=fdir)
        bm = bmesh.new()
        box(bm, 0.14, 0.1, 0.16, 0.2, fdir * 0.16, 0.8)
        emit("PropPouch", bm, accent)
    elif kind == "child":
        bm = bmesh.new()
        prism(bm, 0.24, 0.5, 0, 0, 0.95, sides=10, taper_top=0.85)
        emit("Torso", bm, coat)
        head_group(mats, "messy", head_z=1.4, head_r=0.17, face_dir=fdir)
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, accent, face_dir=fdir)
        bm = bmesh.new()
        prism(bm, 0.22, 0.04, 0, 0, 0, sides=8)
        emit("PropHoop", bm, wood)
    elif kind == "guard":
        bm = bmesh.new()
        prism(bm, 0.31, 0.66, 0, 0, 1.06, sides=10, taper_top=0.95)
        emit("Torso", bm, coat)
        bm = bmesh.new()
        box(bm, 0.36, 0.1, 0.6, 0, fdir * 0.25, 1.0)
        emit("Tabard", bm, accent)
        head_group(mats, "short", face_dir=fdir)
        bm = bmesh.new()
        prism(bm, 0.19, 0.16, 0, 0, 1.68, sides=10, taper_top=0.6)
        emit("Helmet", bm, steel)
        bm = bmesh.new()
        box(bm, 0.04, 0.05, 0.14, 0, fdir * 0.18, 1.56)
        emit("HelmetNasal", bm, steel)
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, boot, face_dir=fdir)
            bm = bmesh.new()
            box(bm, 0.16, 0.18, 0.08, 0, 0, 0.02)
            emit(f"Pauldron{side}", bm, steel)
        bm = bmesh.new()
        box(bm, 0.04, 0.04, 1.7, 0, 0, 0)
        emit("PropSpear", bm, wood)
        # Spear shaft spans z -0.85..+0.85 in hand space. The 0.22 tall tip must
        # sit ON the shaft top, not inside it: centred at 0.85+0.11 = 0.96, it
        # covers 0.85..1.07. (An earlier pass centred it at 0.74, which buried
        # the point inside the shaft -- the misoffset prop bug of round 59.)
        bm = bmesh.new()
        prism(bm, 0.05, 0.22, 0, 0, 0.96, sides=6, taper_top=0.05)
        emit("PropSpearTip", bm, steel)
    elif kind == "cloak":
        bm = bmesh.new()
        prism(bm, 0.28, 0.62, 0, 0, 1.04, sides=10, taper_top=0.9)
        emit("Torso", bm, coat)
        # Cloak: a wider, shorter cone behind the shoulders down to the knees.
        bm = bmesh.new()
        prism(bm, 0.36, 1.0, 0, fdir * 0.06, 0.85, sides=10, taper_top=0.55)
        emit("Cloak", bm, accent)
        head_group(mats, "short", face_dir=fdir)
        # Wide-brim hat: brim disc + crown.
        bm = bmesh.new()
        prism(bm, 0.30, 0.03, 0, 0, 1.66, sides=10)
        emit("HatBrim", bm, coat)
        bm = bmesh.new()
        prism(bm, 0.16, 0.14, 0, 0, 1.74, sides=10, taper_top=0.8)
        emit("HatCrown", bm, coat)
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, boot, face_dir=fdir)
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
        head_group(mats, "tied", face_dir=fdir)
        for side in ("L", "R"):
            arm(mats, side, coat)
            leg(mats, side, boot, face_dir=fdir)
        # Ledger board, held in the left hand.
        bm = bmesh.new()
        box(bm, 0.26, 0.05, 0.34, 0, 0, 0)
        emit("PropLedger", bm, wood)
        # Pages sit proud of the board's front face: the board is 0.05 thick so
        # its face is at fdir*0.025, and the 0.02 thick pages centre 0.01
        # further forward. Baked in vertices, not a node translation.
        bm = bmesh.new()
        box(bm, 0.22, 0.02, 0.3, 0, fdir * 0.035, 0)
        emit("PropLedgerPages", bm, paper)
    else:
        raise ValueError(f"unknown kind {kind}")

    # NOTE: nothing here may set obj.location / rotation / scale. Blender's
    # export_apply=True applies modifiers only -- an object transform is written
    # as a glTF node transform, and src/glb.js maps accessor data straight into
    # geometry without ever reading node.translation/scale. Anything authored as
    # a transform would therefore silently vanish at load time. pip's 0.72 child
    # scale in particular is applied by buildModelled() in src/npcs.js, so it must
    # NOT be baked here as well (that would double-scale to 0.518).



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


# Meshes authored in joint space (around a limb pivot) rather than body space.
# The bounds check must exclude them or it measures hands hanging below the feet.
JOINT_SPACE = set()
for _side in ("L", "R"):
    for _name in ("Hand", "Thumb", "Boot", "Pauldron", "Sleeve"):
        JOINT_SPACE.add(f"{_name}{_side}")
JOINT_SPACE.update({"LimbArmL", "LimbArmR", "LimbLegL", "LimbLegR"})
# The head assembly is authored around the neck pivot (origin at the shoulders).
JOINT_SPACE.update({"Head", "Nose", "Mouth", "Hair", "HairBun", "HairTail",
                    "EyeWhiteL", "EyeWhiteR", "EyeIrisL", "EyeIrisR"})


def bounds_report():
    # Body-space bounds check. Joint-space meshes (limbs, hands, head) are
    # authored around their pivot and then placed by the game rig, so their
    # local coordinates do not represent their final position.
    xs, ys, zs = [], [], []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        # Skip joint-space and prop meshes; they hang below their pivots or
        # are carried, and belong in the joint's local frame, not body space.
        if obj.name in JOINT_SPACE or obj.name.startswith("Prop"):
            continue
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


def transform_check():
    """Every object must be exported transform-free.

    src/glb.js reads POSITION/NORMAL accessors directly and ignores glTF node
    transforms, so a non-identity object transform in Blender does not move the
    mesh in game -- it silently disappears. Round 59's prop offsets and pip's
    child scale were both authored that way and were lost; this assert makes the
    contract enforced at build time instead of discovered in a browser.
    """
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        assert obj.location.length < 1e-6, \
            f"{obj.name} has a location offset; bake it into the vertices"
        assert all(abs(a) < 1e-6 for a in obj.rotation_euler), \
            f"{obj.name} is rotated; bake the rotation into the vertices"
        assert all(abs(s - 1.0) < 1e-6 for s in obj.scale), \
            f"{obj.name} is scaled; bake the scale into the vertices"


if __name__ == "__main__":
    for cid, spec in CAST.items():
        reset_scene()
        build_character(spec)
        tris = report()
        limb_contract_check()
        bounds_report()
        transform_check()
        assert tris < 460, f"{cid} triangle budget blown: {tris}"
        export_glb(os.path.join(OUT_DIR, f"npc_{cid}.glb"))
        print(f"{cid.upper()}_OK")
    print("CAST_OK")
