from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from conftest import FakeEngine
from fastapi.testclient import TestClient

from autolibras_stt.composer import (
    CompositionError,
    CompositionOptions,
    DelayBuffer,
    compose_args,
    input_args,
    window_page_url,
)
from autolibras_stt.config import Settings
from autolibras_stt.server import create_app
from autolibras_stt.sessions import ComposerConfig, SessionError, SessionHub
from autolibras_stt.vad import energy_vad

YOUTUBE = "rtmp://a.rtmp.youtube.test/live2/chave-secreta"


def test_valida_as_opcoes() -> None:
    CompositionOptions(output=YOUTUBE).validate()
    CompositionOptions(output="srt://srt.test:9000?streamid=x").validate()
    for bad in [
        CompositionOptions(output="file:///tmp/x.flv"),
        CompositionOptions(output="https://site.test/"),
        CompositionOptions(output=YOUTUBE, delay=1),
        CompositionOptions(output=YOUTUBE, size=0.9),
        CompositionOptions(output=YOUTUBE, resolution="grande"),
    ]:
        with pytest.raises(CompositionError):
            bad.validate()


def test_posicao_e_tamanho_da_janela() -> None:
    options = CompositionOptions(output=YOUTUBE)
    # Metade da altura de 720, proporção 3:4, margem de 3% da altura.
    assert options.window() == (270, 360, 988, 338)
    left = CompositionOptions(output=YOUTUBE, position="left", size=0.4, resolution="1920x1080")
    assert left.window() == (324, 432, 32, 616)


def test_api_nao_mostra_a_chave_da_saida() -> None:
    public = CompositionOptions(output=YOUTUBE).public()
    assert public["output"] == "rtmp://a.rtmp.youtube.test/…"
    assert "chave" not in str(public)


def test_entrada_divide_programa_e_audio() -> None:
    pulled = input_args("ffmpeg", "https://tv.test/a.m3u8", "http,https", True, 7)
    assert pulled[pulled.index("-protocol_whitelist") + 1] == "http,https"
    assert "-re" in pulled and "-listen" not in pulled
    assert pulled[-1] == "pipe:7" and "pipe:1" in pulled
    listen = input_args("ffmpeg", "rtmp://0.0.0.0:1935/live/k", "x", False, 7, listen=True)
    assert listen[listen.index("-listen") + 1] == "1"
    assert "-protocol_whitelist" not in listen


def test_composicao_junta_programa_e_janela() -> None:
    args = compose_args("ffmpeg", CompositionOptions(output=YOUTUBE), 9)
    graph = args[args.index("-filter_complex") + 1]
    assert "overlay=988:338" in graph
    assert "colorkey" not in graph
    assert "pipe:9" in args
    assert args[-2:] == ["flv", YOUTUBE]
    cut = compose_args(
        "ffmpeg", CompositionOptions(output="srt://srt.test:9000", background="recorte"), 9
    )
    assert "colorkey=0x00ff00" in cut[cut.index("-filter_complex") + 1]
    assert cut[-2] == "mpegts"


def test_pagina_da_janela_no_modo_sincronizado() -> None:
    options = CompositionOptions(output=YOUTUBE, delay=9, caption=False)
    url = window_page_url("http://127.0.0.1:8000/", "sessao-123", options, "https://sinais.test/")
    parsed = urlparse(url)
    assert parsed.path == "/broadcast.html"
    query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    assert query == {
        "session": "sessao-123",
        "avatar": "propio",
        "signs": "https://sinais.test/",
        "atraso": "9",
        "bg": "#e9eef3",
    }


def test_atraso_devolve_os_bytes_na_hora() -> None:
    now = [100.0]
    buffer = DelayBuffer(8, now=lambda: now[0])
    buffer.push(b"a")
    now[0] = 103
    buffer.push(b"bc")
    assert buffer.due() == (b"", 5.0)
    assert buffer.size == 3
    now[0] = 108
    assert buffer.due() == (b"a", 3.0)
    now[0] = 112
    assert buffer.due() == (b"bc", None)
    assert buffer.size == 0


def make_hub(unavailable: str | None = None) -> SessionHub:
    async def run(step):  # noqa: ANN001, ANN202
        return step()

    return SessionHub(
        FakeEngine(), energy_vad(), run, composer=ComposerConfig(unavailable=unavailable)
    )


def test_composicao_indisponivel_explica_o_motivo() -> None:
    hub = make_hub("Chromium não está instalado no servidor")
    with pytest.raises(SessionError, match="Chromium"):
        hub.create("url", "rtmp://tv.test/live", composition=CompositionOptions(output=YOUTUBE))
    with pytest.raises(SessionError, match="'url' ou 'rtmp'"):
        make_hub(None).create("audio", composition=CompositionOptions(output=YOUTUBE))


def test_sessao_rtmp_entrega_a_chave_so_para_quem_tem_o_token(tmp_path: Path) -> None:
    app = create_app(FakeEngine(), energy_vad(), Settings(token="segredo", rtmp_port=19999))
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer segredo"}
        created = client.post(
            "/v1/sessions", json={"source": {"type": "rtmp"}}, headers=headers
        ).json()
        assert created["rtmp"]["server"] == "rtmp://testserver:19999/live"
        key = created["rtmp"]["key"]
        assert len(key) >= 16
        public = client.get(f"/v1/sessions/{created['id']}").json()
        assert "rtmp" not in public and key not in str(public)
        listed = client.get("/v1/sessions", headers=headers).json()
        assert listed[0]["rtmp"]["key"] == key
        # Só uma sessão RTMP por vez: a porta é uma só.
        again = client.post("/v1/sessions", json={"source": {"type": "rtmp"}}, headers=headers)
        assert again.status_code == 400
        # Sem o app servido, não há composição, e o servidor diz por quê.
        composed = client.post(
            "/v1/sessions",
            json={
                "source": {"type": "url", "url": "rtmp://tv.test/x"},
                "composition": {"output": YOUTUBE},
            },
            headers=headers,
        )
        assert composed.status_code == 400
        assert "AUTOLIBRAS_WEB_DIR" in composed.json()["detail"]
