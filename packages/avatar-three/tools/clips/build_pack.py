#!/usr/bin/env python3
"""Monta um pacote de sinais (clipes glTF + manifest.json) a partir do dicionário do VLibras.

Baixa os .blend do repositório público `vlibras-dictionary-sources` (GPL-3.0), converte
com o Blender headless (`vlibras_to_vrm.py`) e grava `manifest.json` com os metadados e as
medidas de qualidade de cada sinal. Funciona em lotes e retoma de onde parou, para
escalar até o dicionário inteiro (~23 mil sinais).

    python3 build_pack.py --out DIR [--cache DIR] [--region BR] [--jobs 4] SINAL ...
    python3 build_pack.py --out DIR --all          # dicionário inteiro da região
    python3 build_pack.py --out DIR --list FILE    # um sinal por linha

O resultado é GPL-3.0: publique-o à parte (nunca no repositório MIT).
Só usa a biblioteca padrão do Python.
"""

import argparse
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

API = "https://gitlab.lavid.ufpb.br/api/v4/projects/566/repository"
SOURCE_URL = "https://gitlab.lavid.ufpb.br/vlibras-public/vlibras-dictionary/vlibras-dictionary-sources"
HERE = os.path.dirname(os.path.abspath(__file__))
CONVERTER = os.path.join(HERE, "vlibras_to_vrm.py")
DEFAULT_CACHE = os.path.join(
    os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "autolibras", "vlibras-sources"
)


def get(url, attempts=4):
    for i in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                return resp.read(), resp.headers
        except (urllib.error.URLError, TimeoutError) as exc:
            # Erro do cliente (404 etc.) não melhora com outra tentativa.
            client_error = isinstance(exc, urllib.error.HTTPError) and exc.code < 500
            if client_error or i == attempts - 1:
                raise
            time.sleep(2**i)
    raise AssertionError("inalcançável")


def resolve_ref(ref):
    """Commit (SHA) do repositório de origem para um branch, tag ou SHA."""
    body, _ = get(f"{API}/commits/{urllib.parse.quote(ref, safe='')}")
    return json.loads(body)["id"]


def list_region(region, cache, ref="main"):
    """Lista os sinais de uma região (paginando a API do GitLab), com cache local."""
    index_path = os.path.join(cache, f"index-{region}-{ref[:12]}.json")
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as fh:
            return json.load(fh)
    names, page = [], 1
    path = urllib.parse.quote(f"FILES/BLENDS/{region}", safe="")
    while page:
        body, headers = get(f"{API}/tree?path={path}&ref={ref}&per_page=100&page={page}")
        for entry in json.loads(body):
            if entry["type"] == "blob" and entry["name"].endswith(".blend"):
                names.append(unicodedata.normalize("NFC", entry["name"][: -len(".blend")]))
        page = int(headers.get("x-next-page") or 0)
    os.makedirs(cache, exist_ok=True)
    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(names, fh, ensure_ascii=False)
    return names


def download(name, region, cache, ref="main"):
    """Baixa o .blend (conteúdo LFS) para o cache, se ainda não estiver lá."""
    target = os.path.join(cache, region, f"{name}.blend")
    if os.path.exists(target):
        return target
    os.makedirs(os.path.dirname(target), exist_ok=True)
    # Alguns arquivos do repositório têm o nome em NFD (acento separado da letra).
    spellings = dict.fromkeys(unicodedata.normalize(f, name) for f in ("NFC", "NFD"))
    for i, spelling in enumerate(spellings):
        path = urllib.parse.quote(f"FILES/BLENDS/{region}/{spelling}.blend", safe="")
        try:
            body, _ = get(f"{API}/files/{path}/raw?ref={ref}&lfs=true")
            break
        except urllib.error.HTTPError as exc:
            if exc.code != 404 or i == len(spellings) - 1:
                raise
    if body.startswith(b"version https://git-lfs"):
        raise RuntimeError(f"{name}: o servidor devolveu o ponteiro LFS em vez do arquivo")
    tmp = target + ".part"
    with open(tmp, "wb") as fh:
        fh.write(body)
    os.replace(tmp, target)
    return target


def convert_batch(blender, files, out_dir, tolerance):
    """Converte um lote num processo do Blender e devolve as linhas OK/FAIL.

    Se o Blender cair no meio do lote, os arquivos que ficaram sem resposta voltam como
    FAIL, para que nenhum sinal suma em silêncio.
    """
    cmd = [
        blender,
        "-b",
        "--factory-startup",
        "--disable-autoexec",
        "--python",
        CONVERTER,
        "--",
        "--out",
        out_dir,
        "--tolerance",
        str(tolerance),
        *files,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    lines = [ln for ln in proc.stdout.splitlines() if ln.startswith(("OK ", "FAIL "))]
    answered = len(lines)
    if answered < len(files):
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-1:] or ["sem saída"]
        for path in files[answered:]:
            lines.append(f"FAIL {path}: o Blender saiu com código {proc.returncode} ({tail[0]})")
    return lines


def sign_of(path):
    """Nome do sinal a partir do caminho do .blend (ou do próprio nome)."""
    name = os.path.basename(path)
    if name.endswith(".blend"):
        name = name[: -len(".blend")]
    return unicodedata.normalize("NFC", name)


def is_sign_meta(entry):
    """Metadados de um sinal (`<slug>.json`), sem contar os arquivos do próprio pacote."""
    return entry.endswith(".json") and entry not in ("manifest.json", "failures.json")


def write_manifest(out_dir, region, rest, source_commit=None):
    signs = {}
    for entry in sorted(os.listdir(out_dir)):
        if not is_sign_meta(entry):
            continue
        with open(os.path.join(out_dir, entry), encoding="utf-8") as fh:
            meta = json.load(fh)
        signs[meta["name"]] = {
            "file": meta["file"],
            "duration": meta["duration"],
            "strokeStart": meta["strokeStart"],
            "strokeEnd": meta["strokeEnd"],
            "hands": meta["hands"],
            "quality": meta["quality"],
        }
    manifest = {
        "format": "autolibras-sign-pack",
        "version": 1,
        "skeleton": "vrm-humanoid-normalized",
        "region": region,
        "license": "GPL-3.0-only",
        "source": SOURCE_URL,
        "sourceCommit": source_commit,
        "rest": rest if rest in signs else next(iter(signs), None),
        "signs": signs,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("signs", nargs="*")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    ap.add_argument("--region", default="BR", choices=["BR", "MS", "PB", "RS", "SC"])
    ap.add_argument("--ref", default="main", help="branch, tag ou commit do repositório de origem")
    ap.add_argument("--list", help="arquivo com um sinal por linha")
    ap.add_argument("--all", action="store_true", help="todos os sinais da região")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    ap.add_argument("--batch", type=int, default=50, help="arquivos por processo do Blender")
    ap.add_argument("--tolerance", type=float, default=0.3, help="erro máximo da redução, em graus")
    ap.add_argument("--rest", default="CASA", help="sinal cujo primeiro quadro é a pose de repouso")
    ap.add_argument("--blender", default=shutil.which("blender") or "blender")
    ap.add_argument("--force", action="store_true", help="reconverte sinais já convertidos")
    args = ap.parse_args()

    names = [unicodedata.normalize("NFC", n) for n in args.signs]
    if args.list:
        with open(args.list, encoding="utf-8") as fh:
            names += [unicodedata.normalize("NFC", ln.strip()) for ln in fh if ln.strip()]
    # Fixa o commit de origem: o pacote inteiro sai da mesma versão do dicionário.
    commit = resolve_ref(args.ref)
    print(f"origem: {SOURCE_URL} @ {commit}", file=sys.stderr)
    # Os .blend ficam em cache pelo nome; avisa se o cache veio de outro commit.
    marker = os.path.join(args.cache, args.region, ".commit")
    if os.path.exists(marker):
        with open(marker, encoding="utf-8") as fh:
            cached = fh.read().strip()
        if cached != commit:
            print(f"AVISO: o cache tem arquivos do commit {cached}; use outro --cache", file=sys.stderr)
    else:
        os.makedirs(os.path.dirname(marker), exist_ok=True)
        with open(marker, "w", encoding="utf-8") as fh:
            fh.write(commit)
    available = set(list_region(args.region, args.cache, commit))
    if args.all:
        names = sorted(available)
    missing = [n for n in names if n not in available]
    for n in missing:
        print(f"SKIP {n}: não existe em {args.region}", file=sys.stderr)
    names = [n for n in dict.fromkeys(names) if n in available]
    if not names:
        sys.exit("nenhum sinal para converter")

    os.makedirs(args.out, exist_ok=True)
    done = set()
    if not args.force:
        for entry in os.listdir(args.out):
            if is_sign_meta(entry):
                with open(os.path.join(args.out, entry), encoding="utf-8") as fh:
                    done.add(json.load(fh)["name"])
    todo = [n for n in names if n not in done]
    print(f"{len(names)} sinais, {len(todo)} a converter", file=sys.stderr)

    failures_path = os.path.join(args.out, "failures.json")
    failures = {}
    if os.path.exists(failures_path):
        with open(failures_path, encoding="utf-8") as fh:
            failures = {k: v for k, v in json.load(fh).items() if k not in done}

    def save_failures():
        tmp = failures_path + ".part"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(dict(sorted(failures.items())), fh, ensure_ascii=False, indent=1)
        os.replace(tmp, failures_path)

    def fetch(name):
        try:
            return download(name, args.region, args.cache, commit)
        except Exception as exc:  # noqa: BLE001 - um download ruim não interrompe o resto
            return RuntimeError(f"download: {exc}")

    def run_batch(batch):
        """Baixa e converte um lote; devolve as linhas OK/FAIL."""
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as dl:
            got = list(dl.map(fetch, batch))
        files = [g for g in got if isinstance(g, str)]
        lines = [f"FAIL {n}: {g}" for n, g in zip(batch, got) if not isinstance(g, str)]
        if files:
            lines += convert_batch(args.blender, files, args.out, args.tolerance)
        return lines

    # Baixa e converte lote a lote, para começar logo e não depender de baixar tudo antes.
    batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]
    ok = fail = 0
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        jobs = [pool.submit(run_batch, b) for b in batches]
        for k, job in enumerate(concurrent.futures.as_completed(jobs), 1):
            for line in job.result():
                print(line, flush=True)
                if line.startswith("OK "):
                    ok += 1
                    failures.pop(line.split(" ", 2)[1], None)
                else:
                    fail += 1
                    target, _, reason = line[len("FAIL ") :].partition(": ")
                    failures[sign_of(target)] = reason
            save_failures()
            rate = (ok + fail) / max(1e-6, time.monotonic() - started)
            left = (len(todo) - ok - fail) / max(rate, 1e-6)
            print(
                f"# lote {k}/{len(batches)}: {ok} ok, {fail} falhas, ~{left / 60:.0f} min restantes",
                file=sys.stderr,
                flush=True,
            )

    manifest = write_manifest(args.out, args.region, args.rest, commit)
    print(f"{ok} convertidos, {fail} falhas, {len(manifest['signs'])} no manifest", file=sys.stderr)
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
