import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { type Pose, SignPack } from "./sign-pack";

/**
 * Monta um .glb no mesmo formato que `tools/clips/vlibras_to_vrm.py` grava: um nó por
 * osso VRM e rotações em int16 normalizado, com tempos em float32.
 */
function encodeGlb(bone: string, times: number[], quats: Quaternion[]): ArrayBuffer {
  const timeBytes = new Float32Array(times);
  const quatBytes = new Int16Array(
    quats.flatMap((q) => q.toArray().map((c) => Math.round(c * 32767))),
  );
  const bin = new Uint8Array(timeBytes.byteLength + quatBytes.byteLength);
  bin.set(new Uint8Array(timeBytes.buffer), 0);
  bin.set(new Uint8Array(quatBytes.buffer), timeBytes.byteLength);
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "hips", children: [1] }, { name: bone }],
    animations: [
      {
        name: "TESTE",
        samplers: [{ input: 0, output: 1, interpolation: "LINEAR" }],
        channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
      },
    ],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: timeBytes.byteLength },
      { buffer: 0, byteOffset: timeBytes.byteLength, byteLength: quatBytes.byteLength },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: times.length,
        type: "SCALAR",
        min: [Math.min(...times)],
        max: [Math.max(...times)],
      },
      { bufferView: 1, componentType: 5122, normalized: true, count: quats.length, type: "VEC4" },
    ],
  };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
  padded.set(json);
  json = padded;
  const total = 12 + 8 + json.length + 8 + bin.length;
  const out = new DataView(new ArrayBuffer(total));
  out.setUint32(0, 0x46546c67, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, total, true);
  out.setUint32(12, json.length, true);
  out.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out.buffer).set(json, 20);
  out.setUint32(20 + json.length, bin.length, true);
  out.setUint32(24 + json.length, 0x004e4942, true);
  new Uint8Array(out.buffer).set(bin, 28 + json.length);
  return out.buffer;
}

describe("SignPack com o GLTFLoader", () => {
  it("lê os clipes do conversor (int16 normalizado) e amostra com slerp", async () => {
    const axis = new Vector3(1, 0, 0);
    const glb = encodeGlb(
      "leftIndexProximal",
      [0, 1],
      [new Quaternion(), new Quaternion().setFromAxisAngle(axis, Math.PI / 2)],
    );
    const pack = new SignPack("https://sinais.test/", {
      fetch: async (url) =>
        String(url).endsWith("manifest.json")
          ? Response.json({
              format: "autolibras-sign-pack",
              rest: null,
              signs: { TESTE: { file: "TESTE.glb", duration: 1, strokeStart: 0, strokeEnd: 1 } },
            })
          : new Response(glb),
    });
    await pack.load();
    const clip = await pack.clip("TESTE");
    expect(clip.bones).toEqual(["leftIndexProximal"]);
    expect(clip.duration).toBeCloseTo(1);
    const pose: Pose = clip.sample(0.5, new Map());
    const q = pose.get("leftIndexProximal") ?? new Quaternion();
    const expected = new Quaternion().setFromAxisAngle(axis, Math.PI / 4);
    expect(q.angleTo(expected)).toBeLessThan(0.001);
  });
});
