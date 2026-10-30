/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL do pacote de sinais do avatar próprio (pasta com `manifest.json`). */
  readonly VITE_SIGN_PACK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
