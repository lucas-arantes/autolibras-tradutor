/**
 * Lista dos sinais que o avatar do VLibras sabe fazer (~22 mil), carregada do
 * servidor do VLibras em tempo de execução e guardada no navegador. Os dados não
 * fazem parte deste repositório.
 */
export const VLIBRAS_SIGNS_VERSION = "2018.3.1";
export const VLIBRAS_SIGNS_URL = `https://dicionario2.vlibras.gov.br/static/TREES/${VLIBRAS_SIGNS_VERSION}.json`;

interface TrieNode {
  end?: boolean;
  children?: Record<string, TrieNode>;
}

/** Converte a árvore de prefixos do VLibras na lista de sinais. */
export function signsFromTrie(tree: { root: TrieNode }): Set<string> {
  const signs = new Set<string>();
  const stack: Array<[TrieNode, string]> = [[tree.root, ""]];
  while (stack.length > 0) {
    const [node, prefix] = stack.pop() as [TrieNode, string];
    if (node.end) signs.add(prefix);
    for (const [char, child] of Object.entries(node.children ?? {})) {
      stack.push([child, prefix + char]);
    }
  }
  return signs;
}

export interface VocabularyOptions {
  url?: string;
  fetch?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

const STORAGE_KEY = `autolibras:vlibras-signs:${VLIBRAS_SIGNS_VERSION}`;

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Carrega o dicionário de sinais (3,4 MB na primeira vez; depois, do armazenamento local). */
export async function loadVLibrasVocabulary(options: VocabularyOptions = {}): Promise<Set<string>> {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  try {
    const cached = storage?.getItem(STORAGE_KEY);
    if (cached) return new Set(cached.split("\n"));
  } catch {
    // Armazenamento bloqueado: baixa de novo.
  }
  const fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const response = await fetchFn(options.url ?? VLIBRAS_SIGNS_URL);
  if (!response.ok)
    throw new Error(`Dicionário do VLibras respondeu com status ${response.status}`);
  const signs = signsFromTrie((await response.json()) as { root: TrieNode });
  try {
    storage?.setItem(STORAGE_KEY, [...signs].join("\n"));
  } catch {
    // Sem espaço ou bloqueado: segue sem guardar.
  }
  return signs;
}
