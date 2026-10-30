# Reimporta o .vrm no Blender (VRM Add-on), imprime um relatório e renderiza prévias.
#
# Uso:
#   blender -b --factory-startup --python verify_avatar.py -- --vrm <arquivo.vrm> --out-dir <dir>

import argparse
import json
import math
import os
import struct
import sys

import addon_utils
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--vrm", required=True)
ap.add_argument("--out-dir", required=True)
ap.add_argument("--sheet", action="store_true", help="renderiza também todas as expressões")
ARGS = ap.parse_args(argv)
VRM = os.path.abspath(ARGS.vrm)
OUT_DIR = os.path.abspath(ARGS.out_dir)
os.makedirs(OUT_DIR, exist_ok=True)

addon_utils.enable("bl_ext.user_default.vrm", default_set=True, persistent=True)


def read_gltf_json(path):
    with open(path, "rb") as fh:
        data = fh.read()
    clen, _ = struct.unpack_from("<II", data, 12)
    return json.loads(data[20:20 + clen].decode("utf-8"))


gltf = read_gltf_json(VRM)
vrmc = gltf["extensions"]["VRMC_vrm"]
print("== arquivo:", VRM)
print("== tamanho: %.2f MB" % (os.path.getsize(VRM) / 1024 / 1024))
print("== VRMC_vrm specVersion:", vrmc.get("specVersion"))
print("== meta:", json.dumps({k: v for k, v in vrmc["meta"].items() if k != "thumbnailImage"}, ensure_ascii=False))
hb = vrmc["humanoid"]["humanBones"]
nodes = gltf["nodes"]
print("== humanBones (%d):" % len(hb))
for k in sorted(hb):
    print("   %-24s -> %s" % (k, nodes[hb[k]["node"]]["name"]))
REQUIRED = ["hips", "spine", "chest", "upperChest", "neck", "head", "leftEye", "rightEye", "jaw"]
for s in ("left", "right"):
    REQUIRED += [s + p for p in ("Shoulder", "UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot")]
    for f in ("Index", "Middle", "Ring", "Little"):
        REQUIRED += [s + f + p for p in ("Proximal", "Intermediate", "Distal")]
    REQUIRED += [s + "Thumb" + p for p in ("Metacarpal", "Proximal", "Distal")]
missing = [b for b in REQUIRED if b not in hb]
print("== ossos exigidos ausentes:", missing or "nenhum")
ex = vrmc["expressions"]
print("== expressions preset:", sorted(ex.get("preset", {})))
print("== expressions custom:", sorted(ex.get("custom", {})))
tris = 0
for mesh in gltf["meshes"]:
    for prim in mesh["primitives"]:
        acc = gltf["accessors"][prim["indices"]]
        tris += acc["count"] // 3
print("== triângulos:", tris)
print("== materiais:", len(gltf.get("materials", [])), [m.get("name") for m in gltf.get("materials", [])])
print("== imagens:", [(i.get("name"), i.get("mimeType")) for i in gltf.get("images", [])])

# ------------------------------------------------------------------ direções (espaço do mundo glTF)
# Calculadas a partir das matrizes dos nós no glTF (sem depender do importador).
import numpy as np  # noqa: E402

parents = {}
for i, n in enumerate(nodes):
    for c in n.get("children", []):
        parents[c] = i


def local_matrix(n):
    if "matrix" in n:
        return np.array(n["matrix"]).reshape(4, 4).T
    t = n.get("translation", [0, 0, 0])
    r = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    x, y, z, w = r
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = rot * np.array(s)
    m[:3, 3] = t
    return m


def world_pos(i):
    m = np.eye(4)
    while i is not None:
        m = local_matrix(nodes[i]) @ m
        i = parents.get(i)
    return m[:3, 3]


def direction(a, b):
    d = world_pos(hb[b]["node"]) - world_pos(hb[a]["node"])
    return d / np.linalg.norm(d)


print("== direções no mundo glTF (+Y cima, +Z frente, +X esquerda do modelo):")
for s in ("left", "right"):
    for a, b in (("UpperArm", "LowerArm"), ("LowerArm", "Hand"),
                 ("IndexProximal", "IndexIntermediate"), ("IndexIntermediate", "IndexDistal"),
                 ("ThumbMetacarpal", "ThumbProximal"), ("ThumbProximal", "ThumbDistal"),
                 ("UpperLeg", "LowerLeg"), ("LowerLeg", "Foot")):
        d = direction(s + a, s + b)
        print("   %-5s %-18s -> %-18s (%+.3f, %+.3f, %+.3f)" % (s, a, b, d[0], d[1], d[2]))
hips = world_pos(hb["hips"]["node"])
head = world_pos(hb["head"]["node"])
print("== quadril y=%.3f  cabeça y=%.3f" % (hips[1], head[1]))

# ------------------------------------------------------------------ importa e renderiza
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.vrm(filepath=VRM)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("== importado: armature", arm.name, "malhas", [(m.name, len(m.data.vertices)) for m in meshes])

scene = bpy.context.scene
# Cycles na CPU (funciona sem GPU e respeita o recorte por alfa do cabelo).
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "Standard"
scene.render.resolution_percentage = 100
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.33, 0.35, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
scene.world = world
for name, loc, energy, size in (("key", (-1.5, -3.0, 2.6), 160, 2.0), ("fill", (2.0, -2.5, 1.6), 60, 2.5),
                                ("rim", (0.5, 3.0, 2.5), 80, 2.0)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = size
    lo = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(lo)
    lo.location = loc
    lo.rotation_euler = (Vector((0, 0, 1.2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def look(cam, pos, target):
    cam.location = pos
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def set_expr(names):
    for m in meshes:
        if m.data.shape_keys:
            for k in m.data.shape_keys.key_blocks[1:]:
                k.value = 1.0 if k.name in names else 0.0


def shape_key_names():
    out = set()
    for m in meshes:
        if m.data.shape_keys:
            out |= {k.name for k in m.data.shape_keys.key_blocks[1:]}
    return out


print("== shape keys:", sorted(shape_key_names()))
# Os binds das expressões apontam para shape keys de mesmo nome (ver build_avatar.py).

eye = (Vector(world_pos(hb["leftEye"]["node"])) + Vector(world_pos(hb["rightEye"]["node"]))) / 2
eye_b = Vector((eye[0], -eye[2], eye[1]))  # glTF -> Blender

# corpo inteiro (pose de repouso)
set_expr([])
scene.render.resolution_x, scene.render.resolution_y = 1200, 1050
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.05
look(cam, (0, -5, 0.86), (0, 0, 0.86))
scene.render.filepath = os.path.join(OUT_DIR, "preview_rest.png")
bpy.ops.render.render(write_still=True)

# rosto
cam_data.type = "PERSP"
cam_data.lens = 85
scene.render.resolution_x, scene.render.resolution_y = 800, 800


def face_shot(names, fname, side=0.0):
    set_expr(names)
    look(cam, (eye_b.x + side, eye_b.y - 0.75, eye_b.z + 0.02), (eye_b.x, eye_b.y, eye_b.z - 0.04))
    scene.render.filepath = os.path.join(OUT_DIR, fname)
    bpy.ops.render.render(write_still=True)


face_shot([], "preview_face_neutral.png")
face_shot(["browUp", "happy"], "preview_browUp_happy.png")
if ARGS.sheet:
    for n in sorted(shape_key_names()):
        face_shot([n], "expr_%s.png" % n)
    # mãos vistas de cima e de frente
    set_expr([])
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.5
    hand = Vector(world_pos(hb["leftHand"]["node"]))
    hb_ = Vector((hand[0], -hand[2], hand[1]))
    look(cam, (hb_.x + 0.08, hb_.y, hb_.z + 2), (hb_.x + 0.08, hb_.y, hb_.z))
    scene.render.filepath = os.path.join(OUT_DIR, "hand_left_top.png")
    bpy.ops.render.render(write_still=True)
    look(cam, (hb_.x + 0.08, hb_.y - 2, hb_.z), (hb_.x + 0.08, hb_.y, hb_.z))
    scene.render.filepath = os.path.join(OUT_DIR, "hand_left_front.png")
    bpy.ops.render.render(write_still=True)
    cam_data.ortho_scale = 2.05
    look(cam, (-5, 0, 0.86), (0, 0, 0.86))
    scene.render.filepath = os.path.join(OUT_DIR, "side.png")
    bpy.ops.render.render(write_still=True)
print("== prévias em", OUT_DIR)
