import { Emitter, type SpeechRecognizer, type SpeechRecognizerEvents } from "@autolibras/core";
import { Pcm16Encoder } from "./pcm";

/** Parte do WebSocket usada aqui (permite testar sem rede). */
export interface SocketLike {
  binaryType: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string | ArrayBufferLike): void;
  close(): void;
}

/** Captura de microfone: chama `onSamples` com blocos float32 na taxa `sampleRate`. */
export interface AudioCapture {
  sampleRate: number;
  stop(): void;
}

export type CaptureAudio = (onSamples: (samples: Float32Array) => void) => Promise<AudioCapture>;

export interface RemoteWhisperOptions {
  /** Endereço do WebSocket, por exemplo `ws://localhost:8000/v1/stream`. */
  url: string;
  /** Intervalo de envio do áudio ao servidor. */
  chunkMs?: number;
  connect?: (url: string) => SocketLike;
  captureAudio?: CaptureAudio;
}

type ServerMessage =
  | { type: "ready"; model: string }
  | { type: "partial"; id: string; text: string }
  | { type: "final"; id: string; text: string }
  | { type: "error"; message: string }
  | { type: "stopped" };

const OPEN = 1;

// Copia cada bloco de 128 amostras do microfone para a thread principal.
const WORKLET_SOURCE = `
registerProcessor("autolibras-capture", class extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
});`;

/** Captura padrão do navegador: getUserMedia + AudioWorklet. */
export const captureMicrophone: CaptureAudio = async (onSamples) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext();
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "autolibras-capture");
  node.port.onmessage = (event: MessageEvent<Float32Array>) => onSamples(event.data);
  source.connect(node);
  return {
    sampleRate: context.sampleRate,
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
};

/**
 * Reconhecimento pelo servidor Whisper do projeto (`services/stt-server`). O
 * áudio vai só para o servidor configurado, que pode rodar na própria máquina.
 */
export class RemoteWhisperRecognizer
  extends Emitter<SpeechRecognizerEvents>
  implements SpeechRecognizer
{
  readonly name = "whisper";
  readonly #url: string;
  readonly #chunkMs: number;
  readonly #connect: (url: string) => SocketLike;
  readonly #captureAudio: CaptureAudio;
  #socket?: SocketLike;
  #capture?: AudioCapture;
  #active = false;
  #connection = 0;

  constructor({ url, chunkMs = 100, connect, captureAudio }: RemoteWhisperOptions) {
    super();
    this.#url = url;
    this.#chunkMs = chunkMs;
    this.#connect = connect ?? ((u) => new WebSocket(u) as unknown as SocketLike);
    this.#captureAudio = captureAudio ?? captureMicrophone;
  }

  static isSupported(): boolean {
    return (
      typeof WebSocket !== "undefined" &&
      typeof AudioWorkletNode !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  get active(): boolean {
    return this.#active;
  }

  start(): void {
    if (this.#active) return;
    this.#active = true;
    const connection = ++this.#connection;
    const socket = this.#connect(this.#url);
    socket.binaryType = "arraybuffer";
    this.#socket = socket;
    let opened = false;

    socket.onopen = () => {
      opened = true;
      void this.#startCapture(socket, connection);
    };
    socket.onmessage = (event) => this.#handle(event.data, connection);
    socket.onerror = () => {
      if (opened) return;
      // O navegador não informa o motivo. Os mais comuns: servidor parado ou, num site
      // publicado acessando localhost, a permissão de rede local negada no Chrome.
      this.#fail(
        `Não foi possível conectar ao servidor de transcrição em ${this.#url}. Verifique se ele ` +
          "está rodando e se o navegador permitiu o acesso a serviços deste dispositivo.",
      );
    };
    socket.onclose = () => {
      if (this.#active && connection === this.#connection) {
        this.#fail("A conexão com o servidor de transcrição caiu.");
      }
    };
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#capture?.stop();
    this.#capture = undefined;
    const socket = this.#socket;
    if (socket?.readyState === OPEN) {
      // O servidor transcreve o que falta, responde "stopped" e fecha.
      socket.send(JSON.stringify({ type: "stop" }));
      setTimeout(() => socket.close(), 5_000);
    } else {
      socket?.close();
    }
    this.emit("state", "idle");
  }

  async #startCapture(socket: SocketLike, connection: number): Promise<void> {
    try {
      let encoder: Pcm16Encoder | undefined;
      let buffered: Int16Array[] = [];
      let bufferedSamples = 0;
      const chunkSamples = (16_000 * this.#chunkMs) / 1000;
      const capture = await this.#captureAudio((samples) => {
        if (!encoder || socket.readyState !== OPEN) return;
        const pcm = encoder.push(samples);
        buffered.push(pcm);
        bufferedSamples += pcm.length;
        if (bufferedSamples < chunkSamples) return;
        const chunk = new Int16Array(bufferedSamples);
        let offset = 0;
        for (const part of buffered) {
          chunk.set(part, offset);
          offset += part.length;
        }
        buffered = [];
        bufferedSamples = 0;
        socket.send(chunk.buffer);
      });
      if (!this.#active || connection !== this.#connection) {
        capture.stop();
        return;
      }
      encoder = new Pcm16Encoder(capture.sampleRate);
      this.#capture = capture;
      this.emit("state", "listening");
    } catch (error) {
      const denied = error instanceof Error && error.name === "NotAllowedError";
      this.#fail(denied ? "Permissão de microfone negada." : `Erro no microfone: ${String(error)}`);
    }
  }

  #handle(data: unknown, connection: number): void {
    if (typeof data !== "string") return;
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    const id = (segment: string) => `whisper-${connection}-${segment}`;
    switch (message.type) {
      case "partial":
        this.emit("transcript", {
          id: id(message.id),
          text: message.text,
          isFinal: false,
          timestamp: Date.now(),
        });
        break;
      case "final":
        // Final vazio: o servidor descartou a frase; só limpa a legenda parcial.
        this.emit("transcript", {
          id: id(message.id),
          text: message.text,
          isFinal: message.text.trim() !== "",
          timestamp: Date.now(),
        });
        break;
      case "error":
        this.emit("error", new Error(`Servidor de transcrição: ${message.message}`));
        break;
      case "stopped":
        this.#socket?.close();
        break;
    }
  }

  #fail(message: string): void {
    this.#active = false;
    this.#capture?.stop();
    this.#capture = undefined;
    this.#socket?.close();
    this.emit("error", new Error(message));
    this.emit("state", "error");
  }
}
