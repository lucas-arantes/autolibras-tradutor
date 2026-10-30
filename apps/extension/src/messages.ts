import type { RecognizerState } from "@autolibras/core";

/** Popup e overlay → service worker. */
export type BackgroundRequest =
  | { type: "start"; tabId: number; streamId: string }
  | { type: "stop" }
  | { type: "status" };

export interface BackgroundResponse {
  ok: boolean;
  error?: string;
}

export interface Session {
  tabId: number;
  /** Último estado e erro da captura, para o overlay que abrir depois deles. */
  state?: RecognizerState;
  error?: string;
}

/** Service worker → documento offscreen (que captura o áudio). */
export type OffscreenRequest =
  | { target: "offscreen"; type: "start"; tabId: number; streamId: string; serverUrl: string }
  | { target: "offscreen"; type: "stop" };

/** Offscreen → todas as páginas da extensão; o overlay filtra pelo `tabId`. */
export type CaptureEvent =
  | { type: "transcript"; tabId: number; id: string; text: string; isFinal: boolean }
  | { type: "capture-state"; tabId: number; state: RecognizerState }
  | { type: "capture-error"; tabId: number; message: string };

/** Mensagens do overlay para a página onde ele está. */
export const MOVE_MESSAGE = "autolibras:move";
