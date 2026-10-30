"""Converte sinais do VLibras (.blend) em clipes glTF para o esqueleto humanoide VRM.

Roda dentro do Blender, em modo headless:

    blender -b --factory-startup --disable-autoexec --python vlibras_to_vrm.py -- \
        --out DIR arquivo1.blend arquivo2.blend ...

Para cada arquivo, grava `DIR/<slug>.glb` (animação) e `DIR/<slug>.json` (metadados e
medidas de qualidade). O clipe não depende de nenhum avatar: os canais de rotação têm o
nome dos ossos humanoides do VRM e valem para os ossos normalizados do three-vrm, cuja
pose de descanso é a pose T com rotação identidade.

Os .blend do VLibras são GPL-3.0, e os clipes gerados também. Não os coloque no
repositório MIT; eles são publicados à parte e carregados por URL.
"""

import json
import math
import os
import struct
import sys
import unicodedata

import bpy
from mathutils import Matrix, Quaternion, Vector

# Blender (Z para cima, frente -Y) para glTF (Y para cima, frente +Z).
AXIS = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))
AXIS_Q = AXIS.to_quaternion()
AXIS_Q_INV = AXIS_Q.inverted()

UP = Vector((0, 1, 0))
LEFT = Vector((1, 0, 0))
RIGHT = Vector((-1, 0, 0))
THUMB_L = Vector((1, 0, 1)).normalized()
THUMB_R = Vector((-1, 0, 1)).normalized()

# Comprimento do braço (ombro ao punho) de uma pessoa de ~1,75 m, para medir erros em cm.
HUMAN_ARM_M = 0.56

# Dedos do esqueleto do VLibras: o primeiro osso de cada cadeia, do mínimo ao polegar.
FINGER_CHAINS = {
    "Little": ("BnDedo.1.{s}", "BnDedo.1.{s}.006", "BnDedo.1.{s}.005"),
    "Ring": ("BnDedo.1.{s}.001", "BnDedo.1.{s}.008", "BnDedo.1.{s}.007"),
    "Middle": ("BnDedo.1.{s}.002", "BnDedo.1.{s}.010", "BnDedo.1.{s}.009"),
    "Index": ("BnDedo.1.{s}.003", "BnDedo.1.{s}.012", "BnDedo.1.{s}.011"),
    "Thumb": ("BnDedo.1.{s}.004", "BnDedo.1.{s}.014", "BnDedo.1.{s}.013"),
}
FINGER_SEGMENTS = {
    "Thumb": ("Metacarpal", "Proximal", "Distal"),
    "Index": ("Proximal", "Intermediate", "Distal"),
    "Middle": ("Proximal", "Intermediate", "Distal"),
    "Ring": ("Proximal", "Intermediate", "Distal"),
    "Little": ("Proximal", "Intermediate", "Distal"),
}


def build_map():
    """Mapa osso VRM -> (pai VRM, fontes de rotação, segmento, direção ideal na pose T).

    Fontes de rotação: lista de (osso, peso) cujas rotações são misturadas (o antebraço
    do VLibras tem dois ossos e a torção fica dividida entre eles). O segmento (de, até)
    usa ("head"|"tail", osso) e corrige a direção final do osso VRM.
    """
    m = {
        "hips": (None, [("BnBacia.001", 1)], None, None),
        "spine": ("hips", [("BnCol-01", 1)], (("head", "BnCol-01"), ("head", "BnCol-02")), UP),
        "chest": ("spine", [("BnCol-02", 1)], (("head", "BnCol-02"), ("head", "BnCol-03")), UP),
        "upperChest": (
            "chest",
            [("BnCol-03", 1)],
            (("head", "BnCol-03"), ("head", "BnPescoco")),
            UP,
        ),
        "neck": (
            "upperChest",
            [("BnPescoco", 1)],
            (("head", "BnPescoco"), ("head", "BnCabeca")),
            UP,
        ),
        "head": ("neck", [("BnCabeca", 1)], (("head", "BnCabeca"), ("tail", "BnCabeca")), UP),
    }
    for side, s, axis, thumb in (("left", "L", LEFT, THUMB_L), ("right", "R", RIGHT, THUMB_R)):
        m[f"{side}Shoulder"] = (
            "upperChest",
            [(f"BnOmbro.{s}", 1)],
            (("head", f"BnOmbro.{s}"), ("head", f"BnBraco.{s}")),
            axis,
        )
        m[f"{side}UpperArm"] = (
            f"{side}Shoulder",
            [(f"BnBraco.{s}", 1)],
            (("head", f"BnBraco.{s}"), ("head", f"BnAntBraco.{s}")),
            axis,
        )
        m[f"{side}LowerArm"] = (
            f"{side}UpperArm",
            [(f"BnAntBraco.{s}", 0.5), (f"BnAntBraco.{s}.001", 0.5)],
            (("head", f"BnAntBraco.{s}"), ("head", f"BnMao.{s}")),
            axis,
        )
        m[f"{side}Hand"] = (
            f"{side}LowerArm",
            [(f"BnMao.{s}", 1)],
            (("head", f"BnMao.{s}"), ("tail", f"BnMao.{s}")),
            axis,
        )
        m[f"{side}UpperLeg"] = (
            "hips",
            [(f"BnPerna.{s}", 1)],
            (("head", f"BnPerna.{s}"), ("tail", f"BnPerna.{s}")),
            Vector((0, -1, 0)),
        )
        for finger, bones in FINGER_CHAINS.items():
            ideal = thumb if finger == "Thumb" else axis
            parent = f"{side}Hand"
            for i, (segment, bone) in enumerate(zip(FINGER_SEGMENTS[finger], bones)):
                bone = bone.format(s=s)
                nxt = bones[i + 1].format(s=s) if i + 1 < len(bones) else None
                to = ("head", nxt) if nxt else ("tail", bone)
                name = f"{side}{finger}{segment}"
                m[name] = (parent, [(bone, 1)], (("head", bone), to), ideal)
                parent = name
    return m


VRM_MAP = build_map()
EYES = ("BnOlho.L", "BnOlho.R")
SOURCE_BONES = sorted({b for _, srcs, _, _ in VRM_MAP.values() for b, _ in srcs} | set(EYES))

# Pontos da mão usados nos contatos. O avatar calcula os mesmos pontos (ver src/contacts.ts).
HAND_POINTS = {
    "wrist": (("head", "BnMao.{s}"),),
    "palm": (("head", "BnMao.{s}"), ("head", "BnDedo.1.{s}.002")),
    "indexTip": (("tail", "BnDedo.1.{s}.011"),),
    "middleTip": (("tail", "BnDedo.1.{s}.009"),),
    "thumbTip": (("tail", "BnDedo.1.{s}.013"),),
}
# Distâncias (na escala de cada âncora) em que o contato vale inteiro e em que some.
CONTACT_RANGES = {"face": (2.2, 3.0), "chest": (0.55, 0.8), "hand": (0.6, 1.2)}

# Expressões não manuais. No rig do VLibras, ossos do rosto movem shape keys por drivers
# lineares; cada canal do clipe junta as shape keys de um mesmo movimento ("mean" para os
# pares esquerdo/direito, "max" para alternativas) e vai de 0 a 1. O avatar traduz cada
# canal para as expressões que tiver (ver FACE_EXPRESSIONS em src/vrm-renderer.ts).
FACE_CHANNELS = {
    "browRaise": ("mean", ("LevantaSobrancelhaEsq", "LevantaSobrancelhaDir")),
    "browOuterUp": ("mean", ("SobrancelhaEsqAberta", "SobrancelhaDirAberta")),
    "browLower": ("mean", ("BaixaSobrancelhaEsq", "BaixaSobrancelhaDir")),
    "browFrown": ("max", ("FranzirSobrancelha",)),
    "browAngry": ("mean", ("SobrancelhaEsqRaiva", "SobrancelhaDirRaiva")),
    "smile": ("max", ("Sorriso",)),
    "frown": ("max", ("BaixaCantoBoca", "baixaBocaCanto_esq", "baixaBocaCanto_dir")),
    "pucker": ("max", ("Bico",)),
    "lipPress": ("max", ("LabioContraido",)),
    "upperLip": ("max", ("LabioSuperior",)),
    "cheekPuff": ("max", ("InflaBochecha", "BochechaInfladaEsq", "BochechaInfladaDir")),
    "cheekSuck": ("max", ("BochechaContraida",)),
    # O driver da boca aberta chega a 0,786 com a mandíbula a 20°.
    "jawOpen": ("max", ("correcaoAbreBoca",), 1 / 0.786),
}
FACE_KEYS = {name for spec in FACE_CHANNELS.values() for name in spec[1]}
# Canais mais fracos que isso no clipe todo não são gravados.
FACE_MIN_WEIGHT = 0.08
# Erro máximo (em peso) da redução de quadros-chave dos canais do rosto.
FACE_TOLERANCE = 0.02


def slug(name):
    """Nome de arquivo seguro para URL: mantém [A-Za-z0-9_-] e codifica o resto."""
    out = []
    for ch in unicodedata.normalize("NFC", name):
        out.append(ch if ch.isascii() and (ch.isalnum() or ch in "_-") else f"-{ord(ch):x}-")
    return "".join(out)


def to_gltf_vec(v):
    return AXIS @ v


def to_gltf_quat(q):
    return AXIS_Q @ q @ AXIS_Q_INV


def find_armature():
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE" and "BnMao.R" in obj.data.bones:
            return obj
    raise RuntimeError("armadura do VLibras não encontrada")


def find_action(stem):
    def score(action):
        return sum(1 for fc in action.fcurves if "BnMao" in fc.data_path or "BnDedo" in fc.data_path)

    actions = [a for a in bpy.data.actions if score(a) > 0]
    if not actions:
        raise RuntimeError("nenhuma ação com os ossos das mãos")
    for action in actions:
        if action.name == stem:
            return action
    return max(actions, key=score)


def find_face_keys():
    """Shape keys do rosto movidas por drivers (ausentes em arquivos sem rosto animável)."""
    for obj in bpy.data.objects:
        keys = obj.data.shape_keys if obj.type == "MESH" else None
        if keys and keys.animation_data and keys.animation_data.drivers:
            if FACE_KEYS & {kb.name for kb in keys.key_blocks}:
                return keys
    return None


def sample_source(arm, action):
    """Amostra, quadro a quadro, rotação e posição (cabeça/cauda) dos ossos usados.

    Também lê o valor das shape keys do rosto em cada quadro (os drivers já calculados).
    """
    arm.animation_data_create()
    arm.animation_data.action = action
    if action.slots:
        arm.animation_data.action_slot = action.slots[0]
    # Só a animação FK; restrições (IK, mira dos olhos) ficam de fora.
    for pb in arm.pose.bones:
        for c in pb.constraints:
            c.mute = True
    scene = bpy.context.scene
    start, end = (int(round(x)) for x in action.frame_range)
    world = arm.matrix_world
    frames = []
    face = []
    face_keys = find_face_keys()
    for f in range(start, end + 1):
        scene.frame_set(f)
        if face_keys is not None:
            evaluated = face_keys.evaluated_get(bpy.context.evaluated_depsgraph_get())
            face.append({kb.name: kb.value for kb in evaluated.key_blocks if kb.name in FACE_KEYS})
        data = {}
        for name in SOURCE_BONES:
            pb = arm.pose.bones[name]
            mat = world @ pb.matrix
            data[name] = (
                mat.to_quaternion().normalized(),
                world @ pb.head,
                world @ pb.tail,
            )
        frames.append(data)
    rest = {}
    for name in SOURCE_BONES:
        bone = arm.data.bones[name]
        mat = world @ bone.matrix_local
        rest[name] = (mat.to_quaternion().normalized(), world @ bone.head_local, world @ bone.tail_local)
    fps = scene.render.fps / scene.render.fps_base
    return frames, face, rest, fps, start


def joint(data, ref):
    which, bone = ref
    _, head, tail = data[bone]
    return head if which == "head" else tail


def mix_quats(quats):
    """Média ponderada de rotações por slerp sucessivo."""
    total = 0
    acc = None
    for q, w in quats:
        if acc is None:
            acc, total = q.copy(), w
            continue
        total += w
        acc = acc.slerp(q, w / total)
    return acc


def retarget(frames, rest):
    """Rotações locais (glTF) dos ossos VRM normalizados, quadro a quadro."""
    align = {}
    for name, (_, _, seg, ideal) in VRM_MAP.items():
        if seg is None:
            continue
        d_rest = to_gltf_vec(joint(rest, seg[1]) - joint(rest, seg[0])).normalized()
        align[name] = ideal.rotation_difference(d_rest)
    rest_inv = {name: q.inverted() for name, (q, _, _) in rest.items()}

    world_tracks = {name: [] for name in VRM_MAP}
    for data in frames:
        for name, (_, srcs, seg, ideal) in VRM_MAP.items():
            delta = mix_quats([(data[b][0] @ rest_inv[b], w) for b, w in srcs])
            delta = to_gltf_quat(delta)
            if seg is None:
                world = delta
            else:
                world = delta @ align[name]
                actual = to_gltf_vec(joint(data, seg[1]) - joint(data, seg[0]))
                if actual.length > 1e-6:
                    world = (world @ ideal).rotation_difference(actual.normalized()) @ world
            world_tracks[name].append(world.normalized())

    local_tracks = {}
    for name, (parent, _, _, _) in VRM_MAP.items():
        track = []
        prev = None
        for i, world in enumerate(world_tracks[name]):
            q = world if parent is None else world_tracks[parent][i].inverted() @ world
            q.normalize()
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            track.append(q)
            prev = q
        local_tracks[name] = track
    return world_tracks, local_tracks


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def proximity(d, anchor):
    near, far = CONTACT_RANGES[anchor]
    return 1 - smoothstep((d - near) / (far - near))


def hand_point(data, side, point):
    refs = HAND_POINTS[point]
    acc = Vector()
    for which, bone in refs:
        acc += joint(data, (which, bone.format(s=side)))
    return to_gltf_vec(acc / len(refs))


def extract_contacts(frames, rest, world_tracks):
    """Onde cada mão está em relação ao rosto, ao peito e à outra mão, quadro a quadro.

    O avatar tem proporções diferentes das do VLibras, então só copiar rotações tira a
    mão do lugar nos sinais com contato (mão na testa, no queixo, mãos que se tocam).
    Para cada mão e âncora próximas, grava o deslocamento do ponto de contato no
    referencial da âncora, dividido pela escala dela (distância entre os olhos, largura
    dos ombros ou comprimento da mão), e um peso que cai com a distância. No navegador,
    um IK de dois ossos leva a mão do avatar ao mesmo lugar relativo.
    """
    eye_l, eye_r = (rest[e][1] for e in EYES)
    scales = {
        "face": (eye_l - eye_r).length,
        "chest": (rest["BnBraco.L"][1] - rest["BnBraco.R"][1]).length,
        "hand": (rest["BnMao.L"][1] - rest["BnDedo.1.L.009"][2]).length,
    }
    sides = (("left", "L", "R"), ("right", "R", "L"))
    n = len(frames)
    raw = {}  # (lado, âncora, ponto, ponto da outra mão) -> [(peso, deslocamento)]
    for i, data in enumerate(frames):
        face_o = to_gltf_vec((data[EYES[0]][1] + data[EYES[1]][1]) / 2)
        chest_o = to_gltf_vec(data["BnPescoco"][1])
        r_face = world_tracks["head"][i].inverted()
        r_chest = world_tracks["upperChest"][i].inverted()
        points = {
            side: {p: hand_point(data, s, p) for p in HAND_POINTS} for side, s, _ in sides
        }
        for side, _, _ in sides:
            other = "right" if side == "left" else "left"
            own = points[side]
            for anchor, origin, rot in (("face", face_o, r_face), ("chest", chest_o, r_chest)):
                for p, pos in own.items():
                    d = (pos - origin).length / scales[anchor]
                    raw.setdefault((side, anchor, p, None), []).append(
                        (d, rot @ ((pos - origin) / scales[anchor]))
                    )
            for p, pos in own.items():
                for q, opos in points[other].items():
                    d = (pos - opos).length / scales["hand"]
                    raw.setdefault((side, "hand", p, q), []).append(
                        (d, r_chest @ ((pos - opos) / scales["hand"]))
                    )

    # Um ponto de contato fixo por mão e âncora: o que chega mais perto no clipe todo.
    best = {}
    for key, series in raw.items():
        side, anchor = key[0], key[1]
        closest = min(d for d, _ in series)
        if closest < best.get((side, anchor), (math.inf,))[0]:
            best[(side, anchor)] = (closest, key)

    def weights(side, anchor):
        key = best[(side, anchor)][1]
        return [proximity(d, anchor) for d, _ in raw[key]]

    channels = []
    for side, _, _ in sides:
        w_face = weights(side, "face")
        w_hand = weights(side, "hand")
        # O rosto tem prioridade sobre o peito (o queixo também fica perto do pescoço).
        w_chest = [w * (1 - f) for w, f in zip(weights(side, "chest"), w_face)]
        for anchor, w in (("face", w_face), ("chest", w_chest), ("hand", w_hand)):
            if max(w) < 0.05:
                continue
            key = best[(side, anchor)][1]
            active = [i for i in range(n) if w[i] > 1e-3]
            first, last = max(0, active[0] - 1), min(n - 1, active[-1] + 1)
            channels.append(
                {
                    "side": side,
                    "anchor": anchor,
                    "point": key[2],
                    "other": key[3],
                    "frames": list(range(first, last + 1)),
                    "weights": [w[i] if first < i < last or w[i] > 1e-3 else 0.0 for i in range(first, last + 1)],
                    "offsets": [raw[key][i][1] for i in range(first, last + 1)],
                }
            )
    return channels


def extract_face(face):
    """Canais de expressão (0 a 1) quadro a quadro, medidos a partir do primeiro quadro.

    O primeiro quadro é o rosto neutro do sinal: algumas shape keys já começam um pouco
    ligadas no repouso do rig (o sorriso, por exemplo) e isso não faz parte do sinal.
    """
    if not face:
        return {}
    channels = {}
    for channel, spec in FACE_CHANNELS.items():
        mode, names = spec[0], [n for n in spec[1] if n in face[0]]
        gain = spec[2] if len(spec) > 2 else 1.0
        if not names:
            continue
        raw = []
        for values in face:
            parts = [values[n] for n in names]
            raw.append(sum(parts) / len(parts) if mode == "mean" else max(parts))
        track = [min(1.0, max(0.0, (v - raw[0]) * gain)) for v in raw]
        if max(track) >= FACE_MIN_WEIGHT:
            channels[channel] = track
    return channels


def reduce_scalar(values, tol):
    """Índices mínimos para reproduzir a série com interpolação linear e erro <= tol."""
    n = len(values)
    if n <= 2:
        return list(range(n))
    keep = {0, n - 1}
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        worst, worst_i = 0.0, -1
        for i in range(a + 1, b):
            v = values[a] + (values[b] - values[a]) * (i - a) / (b - a)
            if abs(v - values[i]) > worst:
                worst, worst_i = abs(v - values[i]), i
        if worst > tol:
            keep.add(worst_i)
            stack += [(a, worst_i), (worst_i, b)]
    return sorted(keep)


def angle_deg(a, b):
    """Ângulo entre duas rotações, ignorando o sinal do quaternion."""
    return math.degrees(2 * math.acos(min(1.0, abs(a.dot(b)))))


def reduce_keys(track, tol_deg):
    """Índices de quadros-chave mínimos para reproduzir a trilha com erro <= tol (slerp)."""
    n = len(track)
    if n <= 2:
        return list(range(n))
    if all(angle_deg(track[0], q) <= tol_deg for q in track):
        return [0]
    keep = {0, n - 1}
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        worst, worst_i = 0.0, -1
        for i in range(a + 1, b):
            q = track[a].slerp(track[b], (i - a) / (b - a))
            err = angle_deg(q, track[i])
            if err > worst:
                worst, worst_i = err, i
        if worst > tol_deg:
            keep.add(worst_i)
            stack += [(a, worst_i), (worst_i, b)]
    return sorted(keep)


def quantize(q):
    """Quaternion glTF (x, y, z, w) em int16 normalizado."""
    return tuple(max(-32767, min(32767, round(c * 32767))) for c in (q.x, q.y, q.z, q.w))


def dequantize(values):
    x, y, z, w = (c / 32767 for c in values)
    return Quaternion((w, x, y, z)).normalized()


def decode_track(times, keys, frame_times):
    """Reconstrói a trilha amostrada nos quadros originais, como o player faria."""
    out = []
    j = 0
    for t in frame_times:
        if len(times) == 1:
            out.append(keys[0])
            continue
        while j < len(times) - 2 and times[j + 1] < t:
            j += 1
        span = times[j + 1] - times[j]
        u = min(1.0, max(0.0, (t - times[j]) / span)) if span > 0 else 0.0
        out.append(keys[j].slerp(keys[j + 1], u))
    return out


def detect_stroke(frames, fps, arm_len):
    """Trecho principal do sinal, sem a preparação (sair do repouso) e o retorno.

    Usa a distância dos punhos até a posição inicial: a preparação termina no primeiro
    mínimo de velocidade depois que a mão se afasta do repouso, e o retorno começa no
    último mínimo de velocidade antes de ela voltar.
    """
    hands = ("BnMao.L", "BnMao.R")
    pos = [[to_gltf_vec(data[h][1]) / arm_len for h in hands] for data in frames]
    n = len(pos)
    if n < 5:
        return 0, n - 1
    dist = [max((p[k] - pos[0][k]).length for k in range(2)) for p in pos]
    dist_end = [max((p[k] - pos[-1][k]).length for k in range(2)) for p in pos]
    speed = [0.0] * n
    for i in range(1, n - 1):
        speed[i] = max((pos[i + 1][k] - pos[i - 1][k]).length for k in range(2)) * fps / 2
    peak = max(dist)
    if peak < 0.1:
        # Sinal parado (como a letra E): o trecho principal é uma pausa curta no meio.
        on = int(0.3 * n)
        return on, min(n - 1, on + int(0.4 * fps))
    window = max(2, int(0.5 * fps))

    def first_min(start, step, stop):
        i = start
        best = i
        while 0 < i < n - 1 and abs(i - start) <= window and i != stop:
            if speed[i] < speed[best]:
                best = i
            if speed[i] <= 0.35 * max(speed[start], 1e-6) or (
                speed[i] <= speed[i - step] and speed[i] <= speed[i + step]
            ):
                return i
            i += step
        return best

    on = next(i for i, d in enumerate(dist) if d >= 0.4 * peak)
    peak_end = max(dist_end)
    off = next(i for i in range(n - 1, -1, -1) if dist_end[i] >= 0.4 * peak_end)
    on = first_min(on, 1, off)
    off = first_min(off, -1, on)
    if off - on < max(2, int(0.15 * fps)):
        return 0, n - 1
    return on, off


def contact_node_name(channel):
    """Nome do nó fictício de um contato, lido pelo SignClip (`contact_<lado>_<âncora>_...`)."""
    parts = ["contact", channel["side"], channel["anchor"], channel["point"]]
    if channel["other"]:
        parts.append(channel["other"])
    return "_".join(parts)


def write_glb(path, local_tracks, fps, meta, tol_deg, contacts=(), face=None):
    """Grava o glTF binário: um nó por osso VRM e uma animação de rotações.

    Cada contato vira um nó fictício fora do esqueleto: a translação é o deslocamento
    da mão no referencial da âncora e a escala (x = y = z) é o peso do contato. Cada
    canal de expressão vira um nó `face_<canal>`, com o peso na escala.
    """
    names = list(VRM_MAP)
    index = {name: i for i, name in enumerate(names)}
    nodes = []
    for name in names:
        nodes.append({"name": name})
    for name, (parent, _, _, _) in VRM_MAP.items():
        if parent:
            nodes[index[parent]].setdefault("children", []).append(index[name])

    blob = bytearray()
    buffer_views, accessors, samplers, channels = [], [], [], []
    decoded = {}
    n = len(next(iter(local_tracks.values())))
    frame_times = [i / fps for i in range(n)]

    def add_view(data):
        while len(blob) % 4:
            blob.append(0)
        buffer_views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob.extend(data)
        return len(buffer_views) - 1

    for name in names:
        track = local_tracks[name]
        keep = reduce_keys(track, tol_deg)
        times = [frame_times[i] for i in keep]
        keys = [quantize(track[i]) for i in keep]
        decoded[name] = decode_track(times, [dequantize(k) for k in keys], frame_times)
        t_view = add_view(struct.pack(f"<{len(times)}f", *times))
        accessors.append(
            {
                "bufferView": t_view,
                "componentType": 5126,
                "count": len(times),
                "type": "SCALAR",
                "min": [min(times)],
                "max": [max(times)],
            }
        )
        flat = [c for k in keys for c in k]
        q_view = add_view(struct.pack(f"<{len(flat)}h", *flat))
        accessors.append(
            {
                "bufferView": q_view,
                "componentType": 5122,
                "normalized": True,
                "count": len(keys),
                "type": "VEC4",
            }
        )
        samplers.append(
            {"input": len(accessors) - 2, "output": len(accessors) - 1, "interpolation": "LINEAR"}
        )
        channels.append(
            {"sampler": len(samplers) - 1, "target": {"node": index[name], "path": "rotation"}}
        )

    def add_vec3_channel(node, times, values, path):
        t_view = add_view(struct.pack(f"<{len(times)}f", *times))
        accessors.append(
            {
                "bufferView": t_view,
                "componentType": 5126,
                "count": len(times),
                "type": "SCALAR",
                "min": [min(times)],
                "max": [max(times)],
            }
        )
        flat = [c for v in values for c in v]
        v_view = add_view(struct.pack(f"<{len(flat)}f", *flat))
        accessors.append(
            {"bufferView": v_view, "componentType": 5126, "count": len(values), "type": "VEC3"}
        )
        samplers.append(
            {"input": len(accessors) - 2, "output": len(accessors) - 1, "interpolation": "LINEAR"}
        )
        channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})

    roots = [index["hips"]]
    for contact in contacts:
        nodes.append({"name": contact_node_name(contact)})
        node = len(nodes) - 1
        roots.append(node)
        times = [frame_times[i] for i in contact["frames"]]
        offsets = [tuple(round(c, 4) for c in o) for o in contact["offsets"]]
        add_vec3_channel(node, times, offsets, "translation")
        add_vec3_channel(node, times, [(round(w, 4),) * 3 for w in contact["weights"]], "scale")
    for channel, track in (face or {}).items():
        nodes.append({"name": f"face_{channel}"})
        node = len(nodes) - 1
        roots.append(node)
        keep = reduce_scalar(track, FACE_TOLERANCE)
        times = [frame_times[i] for i in keep]
        add_vec3_channel(node, times, [(round(track[i], 3),) * 3 for i in keep], "scale")

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "AutoLibras vlibras_to_vrm.py",
            "copyright": "VLibras dictionary sources (LAViD/UFPB), GPL-3.0-only",
            "extras": meta,
        },
        "scene": 0,
        "scenes": [{"nodes": roots}],
        "nodes": nodes,
        "animations": [
            {"name": meta["name"], "samplers": samplers, "channels": channels, "extras": meta}
        ],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }
    json_bytes = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    blob.extend(b"\0" * (-len(blob) % 4))
    with open(path, "wb") as fh:
        total = 12 + 8 + len(json_bytes) + 8 + len(blob)
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes)
        fh.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    return decoded


def measure(frames, rest, world_tracks, decoded_local, arm_len):
    """Erros do clipe exportado em relação ao .blend original.

    - compressão: ângulo entre a rotação exata e a reconstruída (quantização + redução);
    - posição: pontas dos dedos e punhos recalculados por cinemática direta a partir do
      clipe (com as proporções do esqueleto do VLibras) contra as posições originais, em
      cm para uma pessoa de ~1,75 m.
    """
    scale_cm = HUMAN_ARM_M * 100 / arm_len
    # Rotações de mundo reconstruídas a partir das locais decodificadas.
    n = len(frames)
    world_dec = {}
    for name, (parent, _, _, _) in VRM_MAP.items():
        if parent is None:
            world_dec[name] = decoded_local[name]
        else:
            world_dec[name] = [world_dec[parent][i] @ decoded_local[name][i] for i in range(n)]
    comp = [
        angle_deg(world_tracks[name][i], world_dec[name][i]) for name in VRM_MAP for i in range(n)
    ]

    # Comprimentos e direções ideais dos segmentos.
    seg_len = {}
    for name, (_, _, seg, _) in VRM_MAP.items():
        if seg:
            seg_len[name] = (joint(rest, seg[1]) - joint(rest, seg[0])).length
    pos_err = []
    tips = []
    for side, s in (("left", "L"), ("right", "R")):
        chain = [f"{side}UpperArm", f"{side}LowerArm"]
        tips.append((chain, ("head", f"BnMao.{s}"), None))
        for finger, bones in FINGER_CHAINS.items():
            segs = [f"{side}{finger}{seg}" for seg in FINGER_SEGMENTS[finger]]
            tips.append((chain, ("tail", bones[-1].format(s=s)), (f"{side}Hand", bones[0].format(s=s), segs)))
    for i, data in enumerate(frames):
        for chain, target, finger in tips:
            first = VRM_MAP[chain[0]][2][0]
            p = to_gltf_vec(joint(data, first))
            for name in chain:
                p = p + world_dec[name][i] @ (VRM_MAP[name][3] * seg_len[name])
            if finger:
                hand, base_bone, segs = finger
                # Base do dedo: deslocamento de repouso a partir do punho, girado com a mão.
                hand_seg = VRM_MAP[hand][2]
                offset = to_gltf_vec(rest[base_bone][1] - joint(rest, hand_seg[0]))
                d_rest = to_gltf_vec(joint(rest, hand_seg[1]) - joint(rest, hand_seg[0])).normalized()
                align_inv = VRM_MAP[hand][3].rotation_difference(d_rest).inverted()
                p = p + (world_dec[hand][i] @ align_inv) @ offset
                for name in segs:
                    p = p + world_dec[name][i] @ (VRM_MAP[name][3] * seg_len[name])
            ref = to_gltf_vec(joint(data, target))
            pos_err.append((p - ref).length * scale_cm)

    def stats(values):
        values = sorted(values)
        return {
            "mean": round(sum(values) / len(values), 3),
            "p95": round(values[int(0.95 * (len(values) - 1))], 3),
            "max": round(values[-1], 3),
        }

    return {"compressionDeg": stats(comp), "fingertipErrorCm": stats(pos_err)}


def convert(path, out_dir, tol_deg):
    stem = unicodedata.normalize("NFC", os.path.splitext(os.path.basename(path))[0])
    bpy.ops.wm.open_mainfile(filepath=path, load_ui=False)
    arm = find_armature()
    action = find_action(stem)
    frames, face_frames, rest, fps, start = sample_source(arm, action)
    arm_len = (rest["BnBraco.L"][1] - rest["BnMao.L"][1]).length
    world_tracks, local_tracks = retarget(frames, rest)
    on, off = detect_stroke(frames, fps, arm_len)
    hands = {}
    for key, frame in (("strokeStart", on), ("strokeEnd", off)):
        hands[key] = [
            [round(c, 4) for c in to_gltf_vec(frames[frame][h][1] - rest["BnBraco.L"][1]) / arm_len]
            for h in ("BnMao.L", "BnMao.R")
        ]
    name = slug(stem)
    meta = {
        "name": stem,
        "source": os.path.basename(path),
        "action": action.name,
        "fps": fps,
        "frames": len(frames),
        "duration": round((len(frames) - 1) / fps, 4),
        "strokeStart": round(on / fps, 4),
        "strokeEnd": round(off / fps, 4),
        "hands": hands,
        "license": "GPL-3.0-only",
    }
    glb = os.path.join(out_dir, f"{name}.glb")
    contacts = extract_contacts(frames, rest, world_tracks)
    meta["contacts"] = [
        {
            "node": contact_node_name(c),
            "start": round(c["frames"][0] / fps, 4),
            "end": round(c["frames"][-1] / fps, 4),
            "maxWeight": round(max(c["weights"]), 3),
        }
        for c in contacts
    ]
    face = extract_face(face_frames)
    meta["face"] = {channel: round(max(track), 3) for channel, track in face.items()}
    decoded = write_glb(glb, local_tracks, fps, meta, tol_deg, contacts, face)
    meta["quality"] = measure(frames, rest, world_tracks, decoded, arm_len)
    meta["file"] = f"{name}.glb"
    meta["bytes"] = os.path.getsize(glb)
    with open(os.path.join(out_dir, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
    return meta


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out_dir, tol_deg, files = None, 0.3, []
    it = iter(argv)
    for arg in it:
        if arg == "--out":
            out_dir = next(it)
        elif arg == "--tolerance":
            tol_deg = float(next(it))
        else:
            files.append(arg)
    if not out_dir or not files:
        print("uso: ... -- --out DIR [--tolerance GRAUS] arquivo.blend ...", file=sys.stderr)
        sys.exit(2)
    os.makedirs(out_dir, exist_ok=True)
    failures = 0
    for path in files:
        try:
            meta = convert(path, out_dir, tol_deg)
            q = meta["quality"]
            print(
                f"OK {meta['name']} {meta['duration']}s stroke {meta['strokeStart']}-"
                f"{meta['strokeEnd']}s {meta['bytes']}B "
                f"comp {q['compressionDeg']['max']}deg tip {q['fingertipErrorCm']['max']}cm",
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001 - um arquivo ruim não interrompe o lote
            failures += 1
            print(f"FAIL {path}: {exc}", flush=True)
    sys.exit(1 if failures else 0)


main()
