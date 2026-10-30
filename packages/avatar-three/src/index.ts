export * from "./contacts";
export * from "./gloss";
export * from "./player";
export * from "./sign-pack";
export * from "./three-stage";
export * from "./timeline";
export * from "./vrm-renderer";

import { ThreeVrmStage, type ThreeVrmStageOptions } from "./three-stage";
import { VrmRenderer, type VrmRendererOptions } from "./vrm-renderer";

/** Avatar VRM pronto para o navegador: palco three.js + pacote de sinais por URL. */
export function createVrmRenderer(
  options: ThreeVrmStageOptions & Omit<VrmRendererOptions, "stage">,
): VrmRenderer {
  return new VrmRenderer({ ...options, stage: new ThreeVrmStage(options) });
}
