# Como contribuir

Contribuições são bem-vindas, principalmente de pessoas surdas, intérpretes de Libras e quem estuda a língua. Avaliar se a sinalização faz sentido é a parte que o código não resolve sozinho.

## Relatando problemas

Abra uma issue descrevendo o que aconteceu, o navegador usado e, se for um problema de tradução, a frase em português, a glosa mostrada no histórico e o que você esperava. Para erros de tradução, diga também qual tradutor estava ativo (VLibras ou regras locais).

## Preparando o ambiente

O app web precisa do Node.js 22 ou mais recente:

```bash
npm install
```

```bash
npm run dev
```

O servidor de transcrição precisa do Python 3.11 ou mais recente. As instruções estão em [`services/stt-server/README.md`](services/stt-server/README.md).

Para testar a imagem Docker com as suas mudanças, monte-a a partir do código:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Antes de abrir um pull request

Rode as mesmas verificações do CI. No app web:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

No servidor de transcrição, dentro de `services/stt-server`:

```bash
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests && .venv/bin/pytest -q
```

Toda mudança de comportamento precisa de teste. Nas regras de glosa, acrescente a frase e a glosa esperada em `packages/gloss-rules/src/translator.test.ts`, de preferência conferindo como o VLibras traduz a mesma frase.

## Convenções

O código TypeScript usa modo estrito e é formatado pelo Biome (`npm run format`). O Python segue o ruff. Comentários, mensagens da interface e mensagens de commit são escritos em português.

Cada etapa (reconhecimento de fala, tradução para glosa, avatar) implementa uma interface de `packages/core`. Uma nova forma de fazer uma etapa deve entrar como nova implementação dessa interface, sem mudar as outras etapas.

## Licenças

O projeto é MIT. Não inclua código, modelos ou animações com licença incompatível, como GPL ou licenças não comerciais. As animações de sinais do VLibras, por exemplo, são GPL-3.0 e só podem ser usadas a partir de um pacote separado, fora deste repositório. Ao adicionar uma dependência ou serviço de terceiros, registre a licença em [`THIRD_PARTY.md`](THIRD_PARTY.md).
