from __future__ import annotations

import asyncio

import pytest

from autolibras_stt.captions import (
    CaptionAssembler,
    CaptionError,
    embedded_captions_graph,
    follow_hls_captions,
    parse_media_playlist,
    parse_vtt,
    subtitle_playlist,
)

MASTER = """#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="en/subs.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Português",LANGUAGE="pt-BR",URI="pt/subs.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,SUBTITLES="subs"
video.m3u8
"""

SUBS = """#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:10
#EXTINF:6.0,
seg10.vtt
#EXTINF:6.0,
seg11.vtt
"""

SEG10 = """WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

1
00:00:01.000 --> 00:00:02.500 align:start
<c.yellow>Boa noite</c>

00:00:02.500 --> 00:00:04.000
Boa noite a todos.
Hoje
"""

SEG11 = """WEBVTT

00:00:06.000 --> 00:00:08.000
Hoje falamos de Libras
"""


def test_acha_a_faixa_de_legendas_em_portugues() -> None:
    url = subtitle_playlist(MASTER, "https://tv.test/live/master.m3u8")
    assert url == "https://tv.test/live/pt/subs.m3u8"
    assert subtitle_playlist("#EXTM3U\nvideo.m3u8\n", "https://tv.test/m.m3u8") is None
    assert subtitle_playlist(SUBS, "https://tv.test/subs.m3u8") == "https://tv.test/subs.m3u8"


def test_le_a_playlist_de_midia() -> None:
    playlist = parse_media_playlist(SUBS, "https://tv.test/live/pt/subs.m3u8")
    assert playlist.sequence == 10
    assert playlist.segments == [
        "https://tv.test/live/pt/seg10.vtt",
        "https://tv.test/live/pt/seg11.vtt",
    ]
    assert not playlist.ended


def test_le_deixas_vtt_sem_marcacao() -> None:
    cues = parse_vtt(SEG10)
    assert [(c.start, c.end, c.text) for c in cues] == [
        (1.0, 2.5, "Boa noite"),
        (2.5, 4.0, "Boa noite a todos. Hoje"),
    ]


def test_junta_a_legenda_em_rolagem_em_frases() -> None:
    assembler = CaptionAssembler()
    assert assembler.push("Boa noite") == []
    assert assembler.push("Boa noite a todos. Hoje") == ["Boa noite a todos."]
    assert assembler.pending == "Hoje"
    assert assembler.push("Hoje falamos de Libras") == []
    assert assembler.push("de Libras na TV.") == ["Hoje falamos de Libras na TV."]
    assert assembler.flush() == []


def test_frase_sem_pontuacao_sai_pelo_tamanho() -> None:
    assembler = CaptionAssembler(max_words=4)
    assert assembler.push("um dois três quatro cinco") == ["um dois três quatro"]
    assert assembler.flush() == ["cinco"]


def test_acompanha_as_legendas_ate_o_fim_da_transmissao() -> None:
    pages = {
        "https://tv.test/master.m3u8": MASTER,
        "https://tv.test/en/subs.m3u8": "",
        "https://tv.test/pt/seg10.vtt": SEG10,
        "https://tv.test/pt/seg11.vtt": SEG11,
    }
    playlists = [SUBS, SUBS + "#EXT-X-ENDLIST\n"]
    pages_seen: list[str] = []

    def fetch(url: str) -> str:
        pages_seen.append(url)
        if url.endswith("pt/subs.m3u8"):
            return playlists.pop(0)
        return pages[url]

    emitted: list[tuple[str, bool]] = []

    async def emit(text: str, final: bool) -> None:
        emitted.append((text, final))

    async def no_sleep(_: float) -> None:
        return None

    asyncio.run(
        follow_hls_captions("https://tv.test/master.m3u8", emit, fetch=fetch, sleep=no_sleep)
    )
    assert [text for text, final in emitted if final] == [
        "Boa noite a todos.",
        "Hoje falamos de Libras",
    ]
    # Cada segmento é baixado uma vez só, mesmo aparecendo de novo na playlist.
    assert pages_seen.count("https://tv.test/pt/seg10.vtt") == 1


def test_avisa_quando_nao_ha_legendas() -> None:
    async def emit(text: str, final: bool) -> None:
        return None

    with pytest.raises(CaptionError):
        asyncio.run(
            follow_hls_captions("https://tv.test/m.m3u8", emit, fetch=lambda _: "#EXTM3U\nv.m3u8\n")
        )


def test_tira_marcacao_falante_e_descricao_de_som() -> None:
    vtt = (
        "00:00:00,834 --> 00:00:02,969\n"
        '<font face="Monospace">{\\an7}(<i> inaudible radio chatter</i> )\n'
        ">> Safety remains our number one</font>\n"
    )
    assert [c.text for c in parse_vtt(vtt)] == ["Safety remains our number one"]


def test_filtro_do_ffmpeg_escapa_o_endereco() -> None:
    graph = embedded_captions_graph("http://h.test:80/a?x=1,2", "http,https")
    # Nível do filtro: "\\:" em vez de ":"; nível do grafo: a barra e a vírgula ganham "\\".
    assert graph == (
        "movie=filename=http\\\\://h.test\\\\:80/a?x=1\\,2"
        ":format_opts=protocol_whitelist=http\\,https[out+subcc]"
    )
