// AudioWorklet que copia cada bloco de 128 amostras do áudio para a thread principal.
// Fica num arquivo próprio (e não num blob:) porque a CSP de extensões só aceita
// scripts da própria origem.
registerProcessor(
  "autolibras-capture",
  class extends AudioWorkletProcessor {
    process(inputs) {
      const channel = inputs[0]?.[0];
      if (channel) this.port.postMessage(channel.slice(0));
      return true;
    }
  },
);
