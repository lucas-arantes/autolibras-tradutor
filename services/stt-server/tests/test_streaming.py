from __future__ import annotations

import numpy as np
from conftest import FakeEngine, chunks, silence, tone

from autolibras_stt.engine import is_hallucination
from autolibras_stt.protocol import Final, Partial
from autolibras_stt.streaming import StreamingOptions, StreamingSession, agreed_prefix
from autolibras_stt.vad import energy_vad


def feed(session: StreamingSession, audio: np.ndarray) -> list:
    """Simula o servidor: acrescenta blocos de 100 ms e roda os passos devidos."""
    events = []
    for chunk in chunks(audio):
        session.append(chunk)
        if session.should_step():
            events.extend(session.step())
    return events


def test_silencio_nao_gera_eventos_nem_acumula_audio(engine: FakeEngine) -> None:
    session = StreamingSession(engine, energy_vad())
    assert feed(session, silence(5)) == []
    assert engine.calls == []
    assert len(session._buffer) <= 16_000  # só o último meio segundo


def test_parciais_e_final_da_mesma_frase(engine: FakeEngine) -> None:
    session = StreamingSession(engine, energy_vad())
    events = feed(session, np.concatenate([silence(1), tone(2.5), silence(1)]))

    partials = [e for e in events if isinstance(e, Partial)]
    finals = [e for e in events if isinstance(e, Final)]
    assert len(partials) >= 1
    assert {p.id for p in partials} == {"s1"}
    assert len(finals) == 1
    final = finals[0]
    assert final.id == "s1"
    # O final cobre a fala (1,0 s a 3,5 s) com a margem de 0,2 s.
    assert abs(final.start - 0.8) < 0.1
    assert abs(final.end - 3.7) < 0.1


def test_frases_seguidas_recebem_ids_novos(engine: FakeEngine) -> None:
    session = StreamingSession(engine, energy_vad())
    audio = np.concatenate([tone(1), silence(1), tone(1), silence(1)])
    finals = [e for e in feed(session, audio) if isinstance(e, Final)]
    assert [f.id for f in finals] == ["s1", "s2"]
    assert finals[1].start > finals[0].end


def test_parcial_marca_o_comeco_estavel() -> None:
    engine = FakeEngine(["hoje eu", "hoje eu vou", "Hoje eu vou ao", "hoje eu vou ao mercado"])
    options = StreamingOptions(partial_interval_s=0.5)
    session = StreamingSession(engine, energy_vad(), options)
    partials = [e for e in feed(session, tone(2.4)) if isinstance(e, Partial)]
    assert [p.stable for p in partials] == ["", "hoje eu", "Hoje eu vou", "hoje eu vou ao"]


def test_frase_longa_e_cortada_sem_pausa(engine: FakeEngine) -> None:
    options = StreamingOptions(max_utterance_s=4)
    session = StreamingSession(engine, energy_vad(), options)
    finals = [e for e in feed(session, tone(9)) if isinstance(e, Final)]
    assert len(finals) == 2
    assert all(f.end - f.start <= 4.3 for f in finals)


def test_flush_encerra_a_frase_em_andamento(engine: FakeEngine) -> None:
    session = StreamingSession(engine, energy_vad())
    feed(session, tone(1.5))
    events = session.flush()
    assert len(events) == 1 and isinstance(events[0], Final)
    assert session.flush() == []


def test_final_vazio_apaga_parciais_quando_o_motor_nao_ouve_nada() -> None:
    # Um parcial ouve "algo"; os seguintes (outro parcial e o final) não ouvem nada.
    engine = FakeEngine(["algo", "", ""])
    session = StreamingSession(engine, energy_vad(), StreamingOptions(partial_interval_s=0.5))
    events = feed(session, np.concatenate([tone(0.8), silence(1)]))
    assert [type(e).__name__ for e in events] == ["Partial", "Final"]
    assert events[-1].text == ""


def test_agreed_prefix_ignora_caixa_e_pontuacao() -> None:
    assert agreed_prefix(["Bom", "dia,"], ["bom", "dia", "tudo"]) == 2
    assert agreed_prefix(["eu", "vou"], ["você", "vai"]) == 0


def test_filtra_alucinacoes_conhecidas() -> None:
    assert is_hallucination("Legendas pela comunidade Amara.org")
    assert is_hallucination(" ... ")
    assert not is_hallucination("Obrigado pela ajuda.")
    assert not is_hallucination("E aí, tudo bem?")
