"""Server-side tutor provider adapter, deterministic linear-equation validator,
output checks and reviewed Tamil fallbacks.

Privacy: nothing in this module logs, prints, or puts request bodies, images,
doubt text or provider responses into exceptions. Only reason codes leave here.
"""

import json
import os
import re
import socket
import urllib.error
import urllib.request
from fractions import Fraction
from pathlib import Path

from django.conf import settings


class ProviderUnavailable(Exception):
    """Raised with a reason code only. The message is the code, never content."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


# ---------------------------------------------------------------------------
# Provider adapter (stdlib HTTP, one OpenAI-compatible chat endpoint)
# ---------------------------------------------------------------------------

def chat(messages, timeout=None):
    """POST a chat completion and return the assistant message text.

    The API key is read from the environment at call time only.
    """
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        raise ProviderUnavailable("no_key")

    if timeout is None:
        timeout = settings.TUTOR_AI_TIMEOUT_SECONDS
    base = settings.TUTOR_AI_BASE_URL.rstrip("/")
    body = json.dumps(
        {"model": settings.TUTOR_AI_MODEL, "messages": messages, "temperature": 0.2}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            raw = response.read()
    except urllib.error.HTTPError:
        raise ProviderUnavailable("http_error") from None
    except (TimeoutError, socket.timeout):
        raise ProviderUnavailable("timeout") from None
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise ProviderUnavailable("timeout") from None
        raise ProviderUnavailable("network") from None
    except OSError:
        raise ProviderUnavailable("network") from None

    if status != 200:
        raise ProviderUnavailable("http_error")

    try:
        payload = json.loads(raw)
        content = payload["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise ProviderUnavailable("bad_response") from None
    if not isinstance(content, str):
        raise ProviderUnavailable("bad_response")
    return content


# ---------------------------------------------------------------------------
# Deterministic linear-equation validator
# ---------------------------------------------------------------------------

MAX_NUMBER = 999
MAX_EQUATION_CHARS = 80
UNSUPPORTED = {"supported": False, "reason": "non_linear_or_unsupported"}

_ALLOWED_RE = re.compile(r"[0-9x+\-*=\s]+")
_DIGIT_GAP_RE = re.compile(r"\d\s+\d")
_SIDE_RE = re.compile(r"[+-]?(?:\d+\*?x|x|\d+)(?:[+-](?:\d+\*?x|x|\d+))*")
_TERM_RE = re.compile(r"([+-]?)(\d+\*?x|x|\d+)")


def _side_terms(side):
    """Return (x_coefficient_sum, constant_sum, has_x) or None if out of bounds."""
    x_sum = 0
    const_sum = 0
    has_x = False
    for sign, body in _TERM_RE.findall(side):
        negative = sign == "-"
        if body.endswith("x"):
            digits = body[:-1].rstrip("*")
            coef = int(digits) if digits else 1
            if coef > MAX_NUMBER:
                return None
            x_sum += -coef if negative else coef
            has_x = True
        else:
            value = int(body)
            if value > MAX_NUMBER:
                return None
            const_sum += -value if negative else value
    return x_sum, const_sum, has_x


def _render(a, b, c):
    if a == 1:
        lhs = "x"
    elif a == -1:
        lhs = "-x"
    else:
        lhs = f"{a}x"
    if b > 0:
        lhs += f" + {b}"
    elif b < 0:
        lhs += f" - {-b}"
    return f"{lhs} = {c}"


def parse_linear(text):
    """Accept only one-variable linear equations with integer terms.

    Left side carries the x terms and constants; right side is constant only.
    Returns a dict with supported True and the normalized equation, or
    supported False with a reason.
    """
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_EQUATION_CHARS:
        return dict(UNSUPPORTED)
    if not _ALLOWED_RE.fullmatch(text):
        return dict(UNSUPPORTED)
    if _DIGIT_GAP_RE.search(text):
        return dict(UNSUPPORTED)

    compact = re.sub(r"\s+", "", text)
    if compact.count("=") != 1:
        return dict(UNSUPPORTED)
    left, right = compact.split("=")
    if not _SIDE_RE.fullmatch(left) or not _SIDE_RE.fullmatch(right):
        return dict(UNSUPPORTED)

    left_terms = _side_terms(left)
    right_terms = _side_terms(right)
    if left_terms is None or right_terms is None:
        return dict(UNSUPPORTED)

    a, b, _ = left_terms
    _, c, right_has_x = right_terms
    if right_has_x or not left_terms[2] or a == 0:
        return dict(UNSUPPORTED)

    x = Fraction(c - b, a)
    if a * x + b != c:
        return dict(UNSUPPORTED)

    solution = str(x.numerator) if x.denominator == 1 else f"{x.numerator}/{x.denominator}"
    return {
        "supported": True,
        "equation": _render(a, b, c),
        "a": a,
        "b": b,
        "c": c,
        "solution": solution,
        "x": x,
    }


def parse_linear_reply(text):
    """Return the equation string from a transcription reply, or None.

    Raises ProviderUnavailable("bad_output") if the reply is not {"equation": ...}.
    """
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        raise ProviderUnavailable("bad_output") from None
    if not isinstance(data, dict) or "equation" not in data:
        raise ProviderUnavailable("bad_output")
    equation = data["equation"]
    if equation is None or isinstance(equation, str):
        return equation
    raise ProviderUnavailable("bad_output")


# ---------------------------------------------------------------------------
# Tutor output validation
# ---------------------------------------------------------------------------

_TAMIL_LO = "\u0b80"
_TAMIL_HI = "\u0bff"
MAX_OUTPUT_CHARS = 400


def _is_tamil(ch):
    return _TAMIL_LO <= ch <= _TAMIL_HI


def parse_tutor_json(text, solution_str):
    """Validate the provider's tutor reply. Raises ProviderUnavailable("bad_output")."""
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        raise ProviderUnavailable("bad_output") from None
    if not isinstance(data, dict):
        raise ProviderUnavailable("bad_output")

    hint = data.get("hintTa")
    check = data.get("checkQuestionTa")
    if not isinstance(hint, str) or not isinstance(check, str):
        raise ProviderUnavailable("bad_output")
    hint = hint.strip()
    check = check.strip()
    if not hint or not check:
        raise ProviderUnavailable("bad_output")
    if len(hint) > MAX_OUTPUT_CHARS or len(check) > MAX_OUTPUT_CHARS:
        raise ProviderUnavailable("bad_output")

    tamil = sum(1 for ch in hint if _is_tamil(ch))
    latin = sum(1 for ch in hint if ch.isalpha() and not _is_tamil(ch))
    if tamil + latin and tamil * 100 < 30 * (tamil + latin):
        raise ProviderUnavailable("bad_output")

    if solution_str is not None and (solution_str in hint or solution_str in check):
        raise ProviderUnavailable("bad_output")

    return {"hintTa": hint, "checkQuestionTa": check}


# ---------------------------------------------------------------------------
# Reviewed Tamil fallbacks and pack-derived reviewed examples
# ---------------------------------------------------------------------------

# DRAFT: these Tamil sentences are machine-drafted and require a Tamil reviewer
# before they are shown to learners.
FALLBACK_TA = {
    "unsupported": "இந்த சமன்பாட்டுக்கு இப்போது உதவ முடியாது. ஒரே மாறி x கொண்ட நேரியல் சமன்பாட்டை முயற்சி செய்யுங்கள்.",
    "offline": "இணைய இணைப்பு இல்லை. பின்னர் மீண்டும் முயற்சி செய்யுங்கள்.",
    "timeout": "பதில் வர நேரமாகிவிட்டது. சிறிது நேரம் கழித்து மீண்டும் முயற்சி செய்யுங்கள்.",
    "error": "இப்போது உதவி வழங்க முடியவில்லை. கீழே உள்ள எடுத்துக்காட்டைப் பாருங்கள்.",
    "bad_output": "பதிலைச் சரிபார்க்க முடியவில்லை. கீழே உள்ள எடுத்துக்காட்டைப் பாருங்கள்.",
    "no_key": "இந்த சாதனத்தில் AI உதவி கிடைக்கவில்லை. கீழே உள்ள எடுத்துக்காட்டைப் பாருங்கள்.",
    "check": "இதே வகைக் கணக்கை நீங்களே முயற்சி செய்து பாருங்கள்.",
}

CONCEPT_IDS = ("C0", "C1", "C2", "C3", "C4")
PACK_PATH = Path(settings.BASE_DIR) / "tutor" / "content" / "pack-v2.json"


def _load_pack_hints(path):
    """Map each concept to the hintTa of its first pack item."""
    with open(path, encoding="utf-8") as fh:
        pack = json.load(fh)
    items = pack.get("items", []) if isinstance(pack, dict) else pack
    hints = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        concept = item.get("concept")
        hint = item.get("hintTa")
        if concept in CONCEPT_IDS and concept not in hints and isinstance(hint, str) and hint.strip():
            hints[concept] = hint.strip()
    return hints


def _load_pack_concept_names(path):
    """Map each concept id to its nameTa from the pack's concepts list."""
    with open(path, encoding="utf-8") as fh:
        pack = json.load(fh)
    concepts = pack.get("concepts", []) if isinstance(pack, dict) else []
    names = {}
    for concept in concepts:
        if not isinstance(concept, dict):
            continue
        concept_id = concept.get("id")
        name = concept.get("nameTa")
        if concept_id in CONCEPT_IDS and isinstance(name, str) and name.strip():
            names[concept_id] = name.strip()
    return names


_PACK_HINTS = _load_pack_hints(PACK_PATH)
CONCEPT_NAMES_TA = _load_pack_concept_names(PACK_PATH)

FALLBACK_HINT_BY_CONCEPT = {
    concept: _PACK_HINTS.get(concept, FALLBACK_TA["error"]) for concept in CONCEPT_IDS
}
