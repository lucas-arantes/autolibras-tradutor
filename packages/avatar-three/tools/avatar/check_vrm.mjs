// Carrega o .vrm com @pixiv/three-vrm 3.x no Node e confere ossos, expressões e pose T.
// As imagens não são decodificadas (stub), só a estrutura importa aqui.
// Uso: node check_vrm.mjs <arquivo.vrm>  (precisa de three e @pixiv/three-vrm instalados)
import { readFileSync } from "node:fs";

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const { VRMLoaderPlugin } = await import("@pixiv/three-vrm");
// evita decodificar imagens no Node
THREE.ImageBitmapLoader.prototype.load = (_url, onLoad) => {
  setTimeout(() => onLoad({ width: 1, height: 1, close() {} }), 0);
};
const file = process.argv[2];
const buf = readFileSync(file);
const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res, rej) => loader.parse(ab, "", res, rej));
const vrm = gltf.userData.vrm;
console.log(
  "meta.metaVersion",
  vrm.meta.metaVersion,
  "name",
  vrm.meta.name,
  "licenseUrl",
  vrm.meta.licenseUrl,
);
const names = Object.keys(vrm.humanoid.humanBones);
console.log("humanBones", names.length, names.join(","));
console.log(
  "expressions",
  vrm.expressionManager.expressions.map((e) => e.expressionName).join(","),
);
vrm.scene.updateMatrixWorld(true);
const wp = (b) => vrm.humanoid.getRawBoneNode(b).getWorldPosition(new THREE.Vector3());
const dir = (a, b) => wp(b).sub(wp(a)).normalize();
const f = (v) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
for (const s of ["left", "right"]) {
  for (const [a, b] of [
    ["UpperArm", "LowerArm"],
    ["LowerArm", "Hand"],
    ["IndexProximal", "IndexIntermediate"],
    ["ThumbProximal", "ThumbDistal"],
  ]) {
    console.log(`${s}${a} -> ${s}${b}`, f(dir(s + a, s + b)));
  }
}
// rosto aponta para +Z?
const eyeL = wp("leftEye"),
  head = wp("head");
console.log("leftEye - head", f(eyeL.clone().sub(head)));
let tris = 0;
vrm.scene.traverse((o) => {
  if (o.isMesh)
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
});
console.log("triangles", tris);
for (const n of ["browUp", "browDown", "happy", "aa", "blink"]) {
  vrm.expressionManager.setValue(n, 1);
}
vrm.update(0.016);
console.log("ok: expressions applied without error");
