# Gera o avatar AutoLibras (VRM 1.0, CC0) com MPFB + VRM Add-on, em Blender headless.
#
# Uso:
#   blender -b --factory-startup --python build_avatar.py -- \
#       --assets <dir> --out <arquivo.vrm> [--work <dir>] [--blend <arquivo.blend>]
#
# <dir> de assets deve conter (ver build_avatar.sh):
#   system/     pacote "makehuman_system_assets" (CC0) descompactado
#   faceunits/  pacote "faceunits01" (CC0) descompactado
#   visemes/    pacote "visemes01" (CC0) descompactado
#
# Convenções do resultado (o renderizador e o retargeting dependem delas):
#   - VRM 1.0, modelo olhando para +Z no glTF (-Y no Blender);
#   - pose de repouso em T: braços em ±X, palmas para baixo, dedos retos em ±X,
#     polegares a 45° entre ±X e a frente, pernas retas para baixo;
#   - expressões por shape keys: presets VRM + "browUp" e "browDown".

import argparse
import json
import math
import os
import struct
import sys

import addon_utils
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

# ---------------------------------------------------------------- argumentos

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--assets", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--work", default=None)
ap.add_argument("--blend", default=None, help="salva também o .blend final (depuração)")
ap.add_argument("--hair", default=None, help="troca o cabelo (pasta em system/hair/), para testar outros")
ARGS = ap.parse_args(argv)

ASSETS = os.path.abspath(ARGS.assets)
SYS = os.path.join(ASSETS, "system")
FACEUNITS = os.path.join(ASSETS, "faceunits", "targets", "faceunits")
VISEMES = os.path.join(ASSETS, "visemes", "targets", "visemes")
OUT = os.path.abspath(ARGS.out)
WORK = os.path.abspath(ARGS.work or os.path.join(os.path.dirname(OUT), "_avatar_work"))
TEX_DIR = os.path.join(WORK, "textures")
os.makedirs(TEX_DIR, exist_ok=True)

for mod in ("bl_ext.user_default.mpfb", "bl_ext.user_default.vrm"):
    addon_utils.enable(mod, default_set=True, persistent=True)

from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo  # noqa: E402
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402


def log(*a):
    print("[avatar]", *a, flush=True)


# ---------------------------------------------------------------- configuração

# Adulto neutro, ascendência mista.
MACRO = {
    "gender": 0.7, "age": 0.54, "muscle": 0.5, "weight": 0.5,
    "proportions": 0.6, "height": 0.5, "cupsize": 0.5, "firmness": 0.5,
    "race": {"african": 0.45, "caucasian": 0.35, "asian": 0.2},
}

# (tipo MPFB, mhclo relativo a system/, material: (textura, modo alfa, tamanho máx, rugosidade))
PROXIES = {
    # olhos: a córnea usa a região transparente da textura -> recorte por alfa
    "eyes": ("Eyes", "eyes/low-poly/low-poly.mhclo", ("eyes/materials/brown_eye.png", "CLIP", 512, 0.15)),
    "eyebrows": ("Eyebrows", "eyebrows/eyebrow001/eyebrow001.mhclo", ("eyebrows/eyebrow001/eyebrow001.png", "BLEND", 512, 0.9)),
    "eyelashes": ("Eyelashes", "eyelashes/eyelashes01/eyelashes01.mhclo", ("eyelashes/eyelashes01/eyelashes01.png", "BLEND", 256, 0.9)),
    "teeth": ("Teeth", "teeth/teeth_base/teeth_base.mhclo", ("teeth/teeth_base/teeth.png", "OPAQUE", 512, 0.4)),
    "tongue": ("Tongue", "tongue/tongue01/tongue01.mhclo", ("tongue/tongue01/tongue01_diffuse.png", "OPAQUE", 256, 0.5)),
    # short01 deixa a testa livre: as sobrancelhas (gramaticais em Libras) ficam sempre visíveis.
    "hair": ("Hair", "hair/short01/short01.mhclo", ("hair/short01/short01_diffuse.png", "CLIP", 1024, 0.75)),
    "clothes": ("Clothes", "clothes/male_casualsuit01/male_casualsuit01.mhclo", ("clothes/male_casualsuit01/male_casualsuit01_diffuse.png", "OPAQUE", 1024, 0.9)),
    "shoes": ("Clothes", "clothes/shoes06/shoes06.mhclo", ("clothes/shoes06/shoes06_diffuse.png", "OPAQUE", 512, 0.8)),
}
if ARGS.hair:
    _tex = next(f for f in os.listdir(os.path.join(SYS, "hair", ARGS.hair)) if f.endswith(".png"))
    PROXIES["hair"] = ("Hair", f"hair/{ARGS.hair}/{ARGS.hair}.mhclo", (f"hair/{ARGS.hair}/{_tex}", "CLIP", 1024, 0.75))

# Pele: média de duas texturas CC0 do sistema (tom de pele intermediário).
SKIN_TEXTURES = [
    ("skins/young_african_male/young_darkskinned_male_diffuse.png", 0.5),
    ("skins/young_caucasian_male/young_lightskinned_male_diffuse.png", 0.5),
]
SKIN_SIZE = 2048

# Ajustes de cor das texturas: tint (multiplica RGB), alpha_gamma (<1 engrossa o alfa),
# mix (matriz 3x3 de canais; aqui deixa a íris "brown" menos avermelhada).
TEX_ADJUST = {
    "eyes": {"mix": ((0.70, 0.20, 0.10), (0.35, 0.60, 0.05), (0.15, 0.15, 0.70))},
    "eyebrows": {"tint": (0.55, 0.45, 0.40), "alpha_gamma": 0.55},
    "eyelashes": {"tint": (0.6, 0.6, 0.6)},
    "hair": {"tint": (0.30, 0.25, 0.22)},
}

# Malha "Body" (com shape keys) e "Outfit" (sem shape keys).
BODY_PARTS = ["eyes", "eyebrows", "eyelashes", "teeth", "tongue"]
OUTFIT_PARTS = ["hair", "clothes", "shoes"]

# Expressões = combinações das "faceunits" ARKit (CC0) e visemas (CC0).
EXPRESSIONS = {
    "happy": {"mouthSmileLeft": 1.0, "mouthSmileRight": 1.0, "cheekSquintLeft": 0.6,
              "cheekSquintRight": 0.6, "eyeSquintLeft": 0.3, "eyeSquintRight": 0.3},
    "angry": {"browDownLeft": 1.0, "browDownRight": 1.0, "eyeSquintLeft": 0.5, "eyeSquintRight": 0.5,
              "noseSneerLeft": 0.5, "noseSneerRight": 0.5, "mouthFrownLeft": 0.6,
              "mouthFrownRight": 0.6, "mouthPressLeft": 0.4, "mouthPressRight": 0.4},
    "sad": {"browInnerUp": 1.0, "mouthFrownLeft": 0.9, "mouthFrownRight": 0.9,
            "mouthShrugLower": 0.4, "eyeSquintLeft": 0.15, "eyeSquintRight": 0.15},
    "surprised": {"browInnerUp": 1.0, "browOuterUpLeft": 1.0, "browOuterUpRight": 1.0,
                  "eyeWideLeft": 1.0, "eyeWideRight": 1.0, "jawOpen": 0.3, "mouthFunnel": 0.25},
    "relaxed": {"mouthSmileLeft": 0.45, "mouthSmileRight": 0.45, "cheekSquintLeft": 0.2,
                "cheekSquintRight": 0.2, "eyeBlinkLeft": 0.25, "eyeBlinkRight": 0.25},
    "blink": {"eyeBlinkLeft": 1.0, "eyeBlinkRight": 1.0},
    "blinkLeft": {"eyeBlinkLeft": 1.0},
    "blinkRight": {"eyeBlinkRight": 1.0},
    "aa": {"v:aa_02": 1.0},
    "ih": {"v:y_iy_ih_ix_06": 1.0},
    "ou": {"v:w_uw_07": 1.0, "mouthPucker": 0.3},
    "ee": {"v:ey_eh_uh_04": 1.0},
    "oh": {"v:ow_08": 1.0},
    # Sobrancelhas para a gramática da Libras.
    "browUp": {"browInnerUp": 1.4, "browOuterUpLeft": 1.4, "browOuterUpRight": 1.4,
               "eyeWideLeft": 0.5, "eyeWideRight": 0.5},
    "browDown": {"browDownLeft": 1.0, "browDownRight": 1.0, "eyeSquintLeft": 0.5,
                 "eyeSquintRight": 0.5, "noseSneerLeft": 0.2, "noseSneerRight": 0.2},
}
PRESETS = {"happy": "happy", "angry": "angry", "sad": "sad", "surprised": "surprised",
           "relaxed": "relaxed", "blink": "blink", "blinkLeft": "blink_left",
           "blinkRight": "blink_right", "aa": "aa", "ih": "ih", "ou": "ou", "ee": "ee", "oh": "oh"}
CUSTOM = ["browUp", "browDown"]

# Ossos mantidos do rig "default" do MPFB; o resto (face, dedos dos pés, seios)
# tem os pesos somados ao ancestral mantido mais próximo.
KEEP_BONES = {"root", "spine05", "spine04", "spine03", "spine02", "spine01",
              "neck01", "neck02", "neck03", "head", "jaw", "eye.L", "eye.R"}
for s in ("L", "R"):
    KEEP_BONES |= {f"{b}.{s}" for b in (
        "clavicle", "shoulder01", "upperarm01", "upperarm02", "lowerarm01", "lowerarm02",
        "wrist", "metacarpal1", "metacarpal2", "metacarpal3", "metacarpal4",
        "pelvis", "upperleg01", "upperleg02", "lowerleg01", "lowerleg02", "foot")}
    KEEP_BONES |= {f"finger{f}-{j}.{s}" for f in range(1, 6) for j in range(1, 4)}

HUMANOID = {
    "hips": "root", "spine": "spine05", "chest": "spine03", "upper_chest": "spine01",
    "neck": "neck01", "head": "head", "jaw": "jaw", "left_eye": "eye.L", "right_eye": "eye.R",
}
for side, s in (("left", "L"), ("right", "R")):
    HUMANOID.update({
        f"{side}_shoulder": f"clavicle.{s}", f"{side}_upper_arm": f"upperarm01.{s}",
        f"{side}_lower_arm": f"lowerarm01.{s}", f"{side}_hand": f"wrist.{s}",
        f"{side}_upper_leg": f"upperleg01.{s}", f"{side}_lower_leg": f"lowerleg01.{s}",
        f"{side}_foot": f"foot.{s}",
    })
    for f, name in enumerate(("thumb", "index", "middle", "ring", "little"), start=1):
        parts = ("metacarpal", "proximal", "distal") if name == "thumb" else ("proximal", "intermediate", "distal")
        for j, part in enumerate(parts, start=1):
            HUMANOID[f"{side}_{name}_{part}"] = f"finger{f}-{j}.{s}"


# ---------------------------------------------------------------- utilidades

def sys_path(rel):
    p = os.path.join(SYS, rel)
    if not os.path.exists(p):
        raise FileNotFoundError(p)
    return p


def deselect_all():
    for o in bpy.context.selected_objects:
        o.select_set(False)


def activate(obj):
    deselect_all()
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def set_mode(mode):
    if bpy.context.object and bpy.context.object.mode != mode:
        bpy.ops.object.mode_set(mode=mode)


def get_coords(mesh):
    a = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


# ---------------------------------------------------------------- 1. humano

def create_human():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    macro = TargetService.get_default_macro_info_dict()
    macro.update({k: v for k, v in MACRO.items() if k != "race"})
    macro["race"] = dict(MACRO["race"])
    basemesh = HumanService.create_human(macro_detail_dict=macro)
    # Congela os alvos de modelagem (as shape keys de expressão vêm depois).
    TargetService.bake_targets(basemesh)
    rig = HumanService.add_builtin_rig(basemesh, "default")
    proxies = {}
    for key, (atype, rel, _mat) in PROXIES.items():
        obj = HumanService.add_mhclo_asset(sys_path(rel), basemesh, asset_type=atype,
                                           subdiv_levels=0, material_type="NONE")
        obj.name = key
        proxies[key] = obj
        log("proxy", key, len(obj.data.vertices), "vértices")
    return basemesh, rig, proxies


# ---------------------------------------------------------------- 2. pose T

def _apply_world_rot(pb, rot3):
    m = pb.matrix.copy()
    head = m.to_translation()
    new = (rot3 @ m.to_3x3()).to_4x4()
    new.translation = head
    pb.matrix = new
    bpy.context.view_layer.update()


def _align(pb, target):
    cur = (pb.tail - pb.head).normalized()
    _apply_world_rot(pb, cur.rotation_difference(target.normalized()).to_matrix())


def _frame(d, lat):
    d = d.normalized()
    lat = (lat - d * lat.dot(d)).normalized()
    return Matrix((d, lat, d.cross(lat))).transposed()


def pose_t(rig):
    """Coloca o rig em pose T ideal (modelo olhando para -Y no Blender)."""
    activate(rig)
    set_mode("POSE")
    pbs = rig.pose.bones
    down = Vector((0, 0, -1))
    report = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        out = Vector((sx, 0, 0))
        # Pernas retas para baixo.
        for b in ("upperleg01", "upperleg02", "lowerleg01", "lowerleg02"):
            _align(pbs[f"{b}.{s}"], down)
        # Braços horizontais.
        for b in ("upperarm01", "upperarm02", "lowerarm01", "lowerarm02"):
            _align(pbs[f"{b}.{s}"], out)
        # Mão: direção punho->dedo médio em ±X e mínimo->indicador para frente (-Y),
        # o que deixa a palma virada para baixo. A torção é dividida com o antebraço.
        wrist = pbs[f"wrist.{s}"]
        d = pbs[f"finger3-1.{s}"].head - wrist.head
        lat = pbs[f"finger5-1.{s}"].head - pbs[f"finger2-1.{s}"].head
        rot = _frame(out, Vector((0, 1, 0))) @ _frame(d, lat).inverted()
        q = rot.to_quaternion()
        axis = out
        tw = axis * Vector((q.x, q.y, q.z)).dot(axis)
        twist = Quaternion((q.w, tw.x, tw.y, tw.z)).normalized()
        ang = twist.angle if tw.dot(axis) >= 0 else -twist.angle
        report[s] = math.degrees(ang)
        # metade da torção no osso de torção do antebraço (lowerarm02)
        _apply_world_rot(pbs[f"lowerarm02.{s}"], Quaternion(axis, ang * 0.5).to_matrix())
        d = pbs[f"finger3-1.{s}"].head - wrist.head
        lat = pbs[f"finger5-1.{s}"].head - pbs[f"finger2-1.{s}"].head
        _apply_world_rot(wrist, _frame(out, Vector((0, 1, 0))) @ _frame(d, lat).inverted())
        # Dedos retos em ±X.
        for f in range(2, 6):
            for j in range(1, 4):
                _align(pbs[f"finger{f}-{j}.{s}"], out)
        # Polegar a 45° entre ±X e a frente (-Y).
        thumb = Vector((sx, -1.0, 0.0)).normalized()
        for j in range(1, 4):
            _align(pbs[f"finger1-{j}.{s}"], thumb)
    log("torção do punho (graus):", report)
    set_mode("OBJECT")


def apply_pose_as_rest(rig, meshes):
    """Aplica a pose atual na geometria (sem shape keys ainda) e a define como repouso."""
    for obj in meshes:
        for m in list(obj.modifiers):
            if m.type == "MASK":
                obj.modifiers.remove(m)
        arm = [m for m in obj.modifiers if m.type == "ARMATURE"]
        if not arm:
            continue
        activate(obj)
        bpy.ops.object.modifier_move_to_index(modifier=arm[0].name, index=0)
        bpy.ops.object.modifier_apply(modifier=arm[0].name)
    activate(rig)
    set_mode("POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    set_mode("OBJECT")
    for obj in meshes:
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = rig


# ---------------------------------------------------------------- 3. poda de ossos

def prune_bones(rig, meshes):
    bones = rig.data.bones
    target = {}
    for b in bones:
        if b.name in KEEP_BONES:
            continue
        p = b.parent
        while p is not None and p.name not in KEEP_BONES:
            p = p.parent
        target[b.name] = p.name if p else "root"
    for obj in meshes:
        vgs = obj.vertex_groups
        idx_to_dst = {}
        for src, dst in target.items():
            g = vgs.get(src)
            if g is not None:
                idx_to_dst[g.index] = vgs.get(dst) or vgs.new(name=dst)
        adds = []
        for v in obj.data.vertices:
            for ge in v.groups:
                dg = idx_to_dst.get(ge.group)
                if dg is not None and ge.weight > 0:
                    adds.append((dg, v.index, ge.weight))
        for dg, vi, w in adds:
            dg.add([vi], w, "ADD")
        for src in target:
            g = vgs.get(src)
            if g is not None:
                vgs.remove(g)
        # só grupos de ossos
        for g in list(vgs):
            if g.name not in KEEP_BONES and g.name != "body" and not g.name.startswith("Delete."):
                vgs.remove(g)
    activate(rig)
    set_mode("EDIT")
    eb = rig.data.edit_bones
    for name in ("eye.L", "eye.R"):
        eb[name].parent = eb["head"]
    for name in target:
        eb.remove(eb[name])
    set_mode("OBJECT")
    log("ossos após poda:", len(rig.data.bones))


# ---------------------------------------------------------------- 4. expressões

def _read_target(path):
    idx, off = [], []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            w = line.split()
            if len(w) == 4 and not w[0].startswith("#"):
                idx.append(int(w[0]))
                off.append((float(w[1]), float(w[2]), float(w[3])))
    return np.array(idx, dtype=np.int64), np.array(off, dtype=np.float64).reshape(-1, 3)


def unit_delta(name, nverts, scale):
    if name.startswith("v:"):
        path = os.path.join(VISEMES, name[2:] + ".target")
    else:
        path = os.path.join(FACEUNITS, name + ".target")
    idx, off = _read_target(path)
    d = np.zeros((nverts, 3))
    if len(idx):
        # MakeHuman (Y para cima, frente +Z) -> Blender (Z para cima, frente -Y)
        d[idx, 0] = off[:, 0] * scale
        d[idx, 1] = -off[:, 2] * scale
        d[idx, 2] = off[:, 1] * scale
    return d


def proxy_delta(mhclo, base_delta, nverts):
    out = np.zeros((nverts, 3))
    for i in range(nverts):
        info = mhclo.verts[i]
        v = info["verts"]
        w = info["weights"]
        out[i] = w[0] * base_delta[v[0]] + w[1] * base_delta[v[1]] + w[2] * base_delta[v[2]]
    return out


def add_shape_key(obj, name, delta):
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis", from_mix=False)
    base = get_coords(obj.data)
    sk = obj.shape_key_add(name=name, from_mix=False)
    sk.data.foreach_set("co", (base + delta).astype(np.float32).ravel())
    sk.value = 0.0
    return sk


def build_expressions(basemesh, proxies):
    nb = len(basemesh.data.vertices)
    scale = 0.1  # escala padrão do MPFB (decímetros -> metros)
    cache = {}
    deltas = {}
    for expr, recipe in EXPRESSIONS.items():
        d = np.zeros((nb, 3))
        for unit, w in recipe.items():
            if unit not in cache:
                cache[unit] = unit_delta(unit, nb, scale)
            d += w * cache[unit]
        deltas[expr] = d
    mhclos = {}
    for key in proxies:
        m = Mhclo()
        m.load(sys_path(PROXIES[key][1]))
        mhclos[key] = m
    for expr, d in deltas.items():
        add_shape_key(basemesh, expr, d)
        for key, obj in proxies.items():
            n = len(obj.data.vertices)
            pd = proxy_delta(mhclos[key], d, n)
            if np.abs(pd).max() > 2e-4:  # ignora deslocamentos < 0,2 mm
                add_shape_key(obj, expr, pd)
    for key, obj in proxies.items():
        ks = obj.data.shape_keys
        log("shape keys", key, [k.name for k in ks.key_blocks[1:]] if ks else [])


# ---------------------------------------------------------------- 5. limpeza da malha base

def trim_shoes(shoes, clothes):
    """Remove a parte da meia/sapato que fica escondida dentro da barra da calça
    (evita que ela atravesse o jeans depois de esticar as pernas)."""
    hem = get_coords(clothes.data)[:, 2].min()
    cut = hem + 0.025
    bm = bmesh.new()
    bm.from_mesh(shoes.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > cut], context="VERTS")
    bm.to_mesh(shoes.data)
    bm.free()
    log("sapatos: corte acima de z=%.3f, restam %d vértices" % (cut, len(shoes.data.vertices)))


def shrink_covered_skin(basemesh, covers, depth=0.007, reach=0.045):
    """Afunda um pouco a pele coberta pela roupa (evita que ela atravesse o tecido
    quando os braços se movem). Vale só para vértices cuja normal encontra a roupa."""
    deps = bpy.context.evaluated_depsgraph_get()
    trees = [BVHTree.FromObject(o, deps) for o in covers]
    me = basemesh.data
    body = basemesh.vertex_groups["body"].index
    moved = 0
    for v in me.vertices:
        if not any(g.group == body for g in v.groups):
            continue
        n = v.normal
        origin = v.co - n * 0.001
        for t in trees:
            hit, hn, _i, dist = t.ray_cast(origin, n, reach)
            if hit is not None and hn.dot(n) > 0.0:
                v.co = v.co - n * depth
                moved += 1
                break
    me.update()
    log("pele sob a roupa afundada em %d vértices" % moved)


def delete_helpers(basemesh):
    """Remove geometria auxiliar do MakeHuman e a pele escondida pelas roupas."""
    vgs = basemesh.vertex_groups
    body = vgs["body"].index
    delete_groups = {g.index for g in vgs if g.name.startswith("Delete.")}
    bm = bmesh.new()
    bm.from_mesh(basemesh.data)
    dl = bm.verts.layers.deform.verify()
    kill = []
    for v in bm.verts:
        groups = v[dl]
        if body not in groups or any(g in groups and groups[g] > 0.5 for g in delete_groups):
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(basemesh.data)
    bm.free()
    basemesh.data.update()
    # Só os grupos de ossos ficam.
    bone_names = set(KEEP_BONES)
    for g in list(vgs):
        if g.name not in bone_names:
            vgs.remove(g)
    log("malha base:", len(basemesh.data.vertices), "vértices após limpeza")


# ---------------------------------------------------------------- 6. materiais

def prepare_image(rel_paths, size, name, keep_alpha, adjust=None):
    """Redimensiona (e mistura) texturas e salva em JPEG (opaco) ou PNG (alfa)."""
    if isinstance(rel_paths, str):
        rel_paths = [(rel_paths, 1.0)]
    acc = None
    for rel, w in rel_paths:
        img = bpy.data.images.load(sys_path(rel))
        if img.size[0] > size:
            img.scale(size, size)
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        acc = px * w if acc is None else acc + px * w
        dims = tuple(img.size)
        bpy.data.images.remove(img)
    adjust = adjust or {}
    px = acc.reshape(-1, 4)
    if "mix" in adjust:
        px[:, :3] = px[:, :3] @ np.array(adjust["mix"], dtype=np.float32).T
    if "tint" in adjust:
        px[:, :3] *= np.array(adjust["tint"], dtype=np.float32)
    if "alpha_gamma" in adjust:
        px[:, 3] = np.power(np.clip(px[:, 3], 0, 1), adjust["alpha_gamma"])
    acc = np.clip(px, 0, 1).ravel()
    out = bpy.data.images.new(name, dims[0], dims[1], alpha=keep_alpha)
    out.pixels.foreach_set(acc)
    ext = "png" if keep_alpha else "jpg"
    path = os.path.join(TEX_DIR, f"{name}.{ext}")
    out.filepath_raw = path
    out.file_format = "PNG" if keep_alpha else "JPEG"
    out.save(filepath=path, quality=88)
    bpy.data.images.remove(out)
    return bpy.data.images.load(path)


def make_material(name, image, alpha_mode, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if alpha_mode == "BLEND":
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        mat.surface_render_method = "BLENDED"
        mat.use_backface_culling = False
    elif alpha_mode == "CLIP":
        gt = nt.nodes.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = 0.4
        nt.links.new(tex.outputs["Alpha"], gt.inputs[0])
        nt.links.new(gt.outputs[0], bsdf.inputs["Alpha"])
        mat.use_backface_culling = False
    else:
        mat.use_backface_culling = True
    return mat


def setup_materials(basemesh, proxies):
    skin = prepare_image(SKIN_TEXTURES, SKIN_SIZE, "skin", False)
    for o in [basemesh]:
        o.data.materials.clear()
        o.data.materials.append(make_material("Skin", skin, "OPAQUE", 0.6))
        for p in o.data.polygons:
            p.material_index = 0
    for key, obj in proxies.items():
        rel, mode, size, rough = PROXIES[key][2]
        img = prepare_image(rel, size, key, mode != "OPAQUE", TEX_ADJUST.get(key))
        obj.data.materials.clear()
        obj.data.materials.append(make_material(key.capitalize(), img, mode, rough))
        for p in obj.data.polygons:
            p.material_index = 0


# ---------------------------------------------------------------- 7. junção

def join(name, objs):
    objs = [o for o in objs if o is not None]
    # garante o mesmo conjunto de shape keys em todos (exigido pela junção)
    names = []
    for o in objs:
        if o.data.shape_keys:
            for k in o.data.shape_keys.key_blocks[1:]:
                if k.name not in names:
                    names.append(k.name)
    for o in objs:
        for n in names:
            if not o.data.shape_keys or n not in o.data.shape_keys.key_blocks:
                add_shape_key(o, n, np.zeros((len(o.data.vertices), 3)))
    deselect_all()
    for o in objs:
        o.select_set(True)
        for m in list(o.modifiers):
            if m.type != "ARMATURE":
                o.modifiers.remove(m)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = name
    # ordem das shape keys estável
    return obj


# ---------------------------------------------------------------- 8. VRM

def setup_vrm(rig, body):
    ext = rig.data.vrm_addon_extension
    ext.spec_version = "1.0"
    vrm1 = ext.vrm1
    meta = vrm1.meta
    meta.vrm_name = "AutoLibras"
    meta.version = "0.1"
    meta.authors.clear()
    meta.authors.add().value = "AutoLibras Tradutor"
    meta.copyright_information = "CC0 1.0 (domínio público). Baseado em assets CC0 do MakeHuman/MPFB."
    meta.references.clear()
    meta.references.add().value = "https://static.makehumancommunity.org/assets/assetpacks.html"
    meta.avatar_permission = "everyone"
    meta.commercial_usage = "corporation"
    meta.credit_notation = "unnecessary"
    meta.modification = "allowModificationRedistribution"
    meta.allow_redistribution = True
    meta.allow_excessively_violent_usage = True
    meta.allow_excessively_sexual_usage = True
    meta.allow_political_or_religious_usage = True
    meta.allow_antisocial_or_hate_usage = True
    meta.other_license_url = "https://creativecommons.org/publicdomain/zero/1.0/"

    hb = vrm1.humanoid.human_bones
    for vrm_name, bone in HUMANOID.items():
        getattr(hb, vrm_name).node.bone_name = bone

    vrm1.look_at.type = "bone"
    # origem do olhar: ponto médio dos olhos relativo ao osso head (em coordenadas glTF)
    bones = rig.data.bones
    mid = (bones["eye.L"].head_local + bones["eye.R"].head_local) / 2 - bones["head"].head_local
    vrm1.look_at.offset_from_head_bone = (mid.x, mid.z, -mid.y)

    expr = vrm1.expressions
    for name, preset in PRESETS.items():
        e = getattr(expr.preset, preset)
        e.morph_target_binds.clear()
        b = e.morph_target_binds.add()
        b.node.mesh_object_name = body.name
        b.index = name
        b.weight = 1.0
    for name in CUSTOM:
        e = expr.custom.add()
        e.custom_name = name
        b = e.morph_target_binds.add()
        b.node.mesh_object_name = body.name
        b.index = name
        b.weight = 1.0
    # Expressões que já mexem nas pálpebras bloqueiam o piscar.
    for name in ("happy", "angry", "sad", "surprised", "relaxed"):
        getattr(expr.preset, name).override_blink = "blend"


def check_license(path):
    """licenseUrl fica na VPL 1.0 (o @pixiv/three-vrm recusa outras URLs por padrão);
    a licença real, CC0, vai em otherLicenseUrl com todas as permissões liberadas."""
    with open(path, "rb") as fh:
        data = fh.read()
    clen, _ = struct.unpack_from("<II", data, 12)
    meta = json.loads(data[20:20 + clen].decode("utf-8"))["extensions"]["VRMC_vrm"]["meta"]
    assert meta["licenseUrl"] == "https://vrm.dev/licenses/1.0/", meta["licenseUrl"]
    assert meta["otherLicenseUrl"] == "https://creativecommons.org/publicdomain/zero/1.0/"


# ---------------------------------------------------------------- principal

def main():
    basemesh, rig, proxies = create_human()
    meshes = [basemesh] + list(proxies.values())
    pose_t(rig)
    apply_pose_as_rest(rig, meshes)
    prune_bones(rig, meshes)
    trim_shoes(proxies["shoes"], proxies["clothes"])
    shrink_covered_skin(basemesh, [proxies["clothes"], proxies["shoes"]])
    build_expressions(basemesh, {k: proxies[k] for k in BODY_PARTS + ["hair"]})
    delete_helpers(basemesh)
    setup_materials(basemesh, proxies)

    hair_keys = proxies["hair"].data.shape_keys
    if hair_keys is not None:
        log("cabelo recebeu shape keys; vai para a malha Body")
        BODY_PARTS.append("hair")
        OUTFIT_PARTS.remove("hair")
    body = join("Body", [basemesh] + [proxies[k] for k in BODY_PARTS])
    for k in list(proxies):
        if k in BODY_PARTS:
            del proxies[k]
    outfit = join("Outfit", [proxies[k] for k in OUTFIT_PARTS])
    for o in (body, outfit):
        o.parent = rig
        o.matrix_parent_inverse.identity()
        for m in o.modifiers:
            if m.type == "ARMATURE":
                m.object = rig
    rig.name = rig.data.name = "Armature"
    # remove objetos que sobraram (proxies já unidos)
    for o in list(bpy.data.objects):
        if o not in (rig, body, outfit):
            bpy.data.objects.remove(o)

    setup_vrm(rig, body)
    if ARGS.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(ARGS.blend))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    activate(rig)
    res = bpy.ops.export_scene.vrm(filepath=OUT, ignore_warning=True, armature_object_name=rig.name)
    log("export:", res)
    check_license(OUT)
    log("ok:", OUT, os.path.getsize(OUT), "bytes")


main()
