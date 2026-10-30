export * from "./assets";
export * from "./collision";
export * from "./contacts";
export * from "./gloss";
export * from "./player";
export * from "./sign-pack";
export * from "./three-stage";
export * from "./timeline";
export * from "./vrm-renderer";

import { DEFAULT_AVATAR_URL } from "./assets";
import { ThreeVrmStage, type ThreeVrmStageOptions } from "./three-stage";
import { VrmRenderer, type VrmRendererOptions } from "./vrm-renderer";

/** Avatar VRM pronto para o navegador: palco three.js + pacote de sinais por URL. */
export function createVrmRenderer(
  options: Omit<ThreeVrmStageOptions, "avatarUrl"> &
    Partial<Pick<ThreeVrmStageOptions, "avatarUrl">> &
    Omit<VrmRendererOptions, "stage">,
): VrmRenderer {
  const stage = new ThreeVrmStage({
    ...options,
    avatarUrl: options.avatarUrl ?? DEFAULT_AVATAR_URL,
  });
  return new VrmRenderer({ ...options, stage });
}
