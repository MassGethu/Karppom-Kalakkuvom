"""Tests for the doubt tutor: validator, endpoints, fallbacks and privacy.

No network: the provider function tutor.ai.chat is monkeypatched in every test
that would otherwise reach it.
"""

import base64
import json
from fractions import Fraction
from pathlib import Path

import pytest
from django.test import Client
from django.urls import reverse

from tutor import ai, doubt

TRANSCRIBE_URL = reverse("api-doubt-transcribe")
TUTOR_URL = reverse("api-doubt-tutor")


def _png_data_url(size=16):
    raw = b"\x89PNG\r\n\x1a\n" + b"\x00" * size
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


def _post(client, url, payload):
    return client.post(url, data=json.dumps(payload), content_type="application/json")


def _fake_chat(reply):
    calls = []

    def fake(messages, timeout=None):
        calls.append(messages)
        if isinstance(reply, Exception):
            raise reply
        return reply

    fake.calls = calls
    return fake


@pytest.fixture
def client():
    return Client(enforce_csrf_checks=False)


# ---------------------------------------------------------------------------
# parse_linear
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "text, expected_x",
    [
        ("2x + 3 = 11", Fraction(4)),
        ("x - 5 = 2", Fraction(7)),
        ("3x = 9", Fraction(3)),
        ("2x = 7", Fraction(7, 2)),
        ("x + 1 = 1", Fraction(0)),
    ],
)
def test_parse_linear_accepts_supported_forms(text, expected_x):
    result = ai.parse_linear(text)
    assert result["supported"] is True
    assert result["x"] == expected_x


def test_parse_linear_normalizes_equation():
    result = ai.parse_linear("2 * x+3=11")
    assert result["supported"] is True
    assert result["equation"] == "2x + 3 = 11"
    assert result["solution"] == "4"


def test_parse_linear_reports_fraction_solution():
    assert ai.parse_linear("2x = 7")["solution"] == "7/2"


@pytest.mark.parametrize(
    "text",
    ["x^2 = 4", "2x + y = 3", "x/2 = 1", "2.5x = 5", "", "1000x = 5", "2 3x = 5", "0x = 4"],
)
def test_parse_linear_rejects_unsupported(text):
    result = ai.parse_linear(text)
    assert result["supported"] is False
    assert result["reason"] == "non_linear_or_unsupported"


# ---------------------------------------------------------------------------
# transcribe
# ---------------------------------------------------------------------------

def test_transcribe_rejects_gif_with_415(client):
    gif = "data:image/gif;base64," + base64.b64encode(b"GIF89a").decode("ascii")
    response = _post(client, TRANSCRIBE_URL, {"image": gif})
    assert response.status_code == 415
    assert response.json() == {"error": "unsupported_type"}


def test_transcribe_rejects_600_kib_jpeg_with_413(client):
    jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\x00" * (600 * 1024)).decode("ascii")
    response = _post(client, TRANSCRIBE_URL, {"image": jpeg})
    assert response.status_code == 413
    assert response.json() == {"error": "too_large"}


def test_transcribe_rejects_decoded_size_over_500_kib(client, monkeypatch):
    fake = _fake_chat('{"equation": "x = 1"}')
    monkeypatch.setattr(ai, "chat", fake)
    jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\x00" * 513_000).decode("ascii")
    response = _post(client, TRANSCRIBE_URL, {"image": jpeg})
    assert response.status_code == 413
    assert fake.calls == []


def test_transcribe_success_returns_normalized_equation(client, monkeypatch):
    monkeypatch.setattr(ai, "chat", _fake_chat('{"equation": "2x + 3 = 11"}'))
    response = _post(client, TRANSCRIBE_URL, {"image": _png_data_url()})
    body = response.json()
    assert response.status_code == 200
    assert body["supported"] is True
    assert body["equation"] == "2x + 3 = 11"
    assert body["source"] == "provider"
    assert body["reason"] == "ok"
    assert "image" not in body


def test_transcribe_timeout_falls_back(client, monkeypatch):
    monkeypatch.setattr(ai, "chat", _fake_chat(ai.ProviderUnavailable("timeout")))
    response = _post(client, TRANSCRIBE_URL, {"image": _png_data_url()})
    body = response.json()
    assert response.status_code == 200
    assert body["source"] == "fallback"
    assert body["reason"] == "timeout"
    assert body["equation"] is None
    assert body["messageTa"] == ai.FALLBACK_TA["timeout"]
    assert body["messageTa"]


def test_transcribe_malformed_provider_output_falls_back(client, monkeypatch):
    monkeypatch.setattr(ai, "chat", _fake_chat("not json"))
    response = _post(client, TRANSCRIBE_URL, {"image": _png_data_url()})
    body = response.json()
    assert body["source"] == "fallback"
    assert body["reason"] == "bad_output"
    assert body["messageTa"] == ai.FALLBACK_TA["error"]


# ---------------------------------------------------------------------------
# tutor
# ---------------------------------------------------------------------------

def test_tutor_rejects_hint_that_leaks_solution(client, monkeypatch):
    leaking = json.dumps({
        "hintTa": "இறுதி விடை x = 4 ஆகும்.",
        "checkQuestionTa": "நீங்கள் இதை முயற்சி செய்யுங்கள்?",
    })
    monkeypatch.setattr(ai, "chat", _fake_chat(leaking))
    response = _post(client, TUTOR_URL, {
        "profileId": "learner-a", "conceptId": "C0", "equation": "2x + 3 = 11", "doubt": "",
    })
    body = response.json()
    assert body["source"] == "fallback"
    assert body["reason"] == "bad_output"
    assert body["hintTa"] == ai.FALLBACK_HINT_BY_CONCEPT["C0"]
    assert body["checkQuestionTa"] == ai.FALLBACK_TA["check"]


def test_tutor_accepts_clean_tamil_reply(client, monkeypatch):
    clean = json.dumps({
        "hintTa": "இருபுறமும் இருந்து 3 ஐக் கழித்து x ஐ தனியாகப் பெறுங்கள்.",
        "checkQuestionTa": "கழித்த பிறகு இடது பக்கம் என்ன கிடைக்கிறது?",
    })
    monkeypatch.setattr(ai, "chat", _fake_chat(clean))
    response = _post(client, TUTOR_URL, {
        "profileId": "learner-a", "conceptId": "C0", "equation": "2x + 3 = 11", "doubt": "",
    })
    body = response.json()
    assert response.status_code == 200
    assert body["source"] == "provider"
    assert body["reason"] == "ok"
    assert body["messageTa"] == ""
    assert body["hintTa"].startswith("இருபுறமும்")


def test_tutor_three_variable_equation_falls_back_without_provider_call(client, monkeypatch):
    fake = _fake_chat("{}")
    monkeypatch.setattr(ai, "chat", fake)
    response = _post(client, TUTOR_URL, {
        "profileId": "learner-a", "conceptId": "C0", "equation": "2x + y = 3", "doubt": "",
    })
    body = response.json()
    assert body["source"] == "fallback"
    assert body["reason"] == "unsupported"
    assert body["messageTa"] == ai.FALLBACK_TA["unsupported"]
    assert fake.calls == []


def test_tutor_no_key_falls_back(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = _post(client, TUTOR_URL, {
        "profileId": "learner-b", "conceptId": "C2", "equation": None, "doubt": "எனக்கு புரியவில்லை",
    })
    body = response.json()
    assert body["source"] == "fallback"
    assert body["reason"] == "no_key"
    assert body["messageTa"] == ai.FALLBACK_TA["no_key"]
    assert body["hintTa"] == ai.FALLBACK_HINT_BY_CONCEPT["C2"]


def test_tutor_rejects_unknown_profile(client, monkeypatch):
    monkeypatch.setattr(ai, "chat", _fake_chat("{}"))
    response = _post(client, TUTOR_URL, {"profileId": "learner-z", "conceptId": "C0", "doubt": "hi"})
    assert response.status_code == 400
    assert response.json() == {"error": "bad_request"}


def test_tutor_rejects_unknown_concept(client, monkeypatch):
    monkeypatch.setattr(ai, "chat", _fake_chat("{}"))
    response = _post(client, TUTOR_URL, {"profileId": "learner-a", "conceptId": "C9", "doubt": "hi"})
    assert response.status_code == 400
    assert response.json() == {"error": "bad_request"}


def test_tutor_rejects_get_with_405(client):
    response = client.get(TUTOR_URL)
    assert response.status_code == 405


def test_success_and_fallback_responses_are_no_store(client, monkeypatch):
    monkeypatch.setattr(ai, "chat", _fake_chat(ai.ProviderUnavailable("network")))
    fallback = _post(client, TUTOR_URL, {"profileId": "learner-a", "conceptId": "C1", "doubt": "x"})
    assert "no-store" in fallback["Cache-Control"]

    monkeypatch.setattr(ai, "chat", _fake_chat(json.dumps({
        "hintTa": "இதை படிப்படியாக செய்யுங்கள்.",
        "checkQuestionTa": "அடுத்த படி என்ன?",
    })))
    success = _post(client, TUTOR_URL, {"profileId": "learner-a", "conceptId": "C1", "doubt": "x"})
    assert "no-store" in success["Cache-Control"]


def test_post_without_csrf_token_is_forbidden():
    strict = Client(enforce_csrf_checks=True)
    response = _post(strict, TUTOR_URL, {"profileId": "learner-a", "conceptId": "C0", "doubt": "hi"})
    assert response.status_code == 403


def test_doubt_modules_do_not_log_or_print_content():
    for module in (ai, doubt):
        source = Path(module.__file__).read_text(encoding="utf-8")
        assert "logger." not in source
        assert "print(" not in source
