"""Same-origin JSON API: installation session and progress event batches.

Plain Django views (no DRF). CSRF is enforced by CsrfViewMiddleware, so these
views must not be csrf_exempt. Tokens are never logged or stored in plain text.
"""

import hashlib
import json
import re
import secrets

from django.db import IntegrityError, transaction
from django.http import HttpResponseNotAllowed, JsonResponse

from tutor.models import Installation, ProgressEvent

SYNTHETIC_PROFILES = {"learner-a", "learner-b", "learner-c"}
PACK_VERSIONS = {"1", "2"}
POLICY_VERSIONS = {"1", "2"}
ASSISTANCE = {"none", "hint", "answer_shown"}
MAX_BATCH = 25
ITEM_ID = re.compile(r"E\d{2}", re.ASCII)
TOKEN_HEADER = "X-Install-Token"


def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _find_installation(request):
    """Return the Installation matching the X-Install-Token header, or None."""
    token = request.headers.get(TOKEN_HEADER, "")
    if not token:
        return None
    return Installation.objects.filter(token_hash=_hash_token(token)).first()


def session(request):
    """Reuse the installation named by X-Install-Token, or issue a new one."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])

    profiles = sorted(SYNTHETIC_PROFILES)
    installation = _find_installation(request)
    if installation is not None:
        return JsonResponse(
            {
                "installId": installation.id,
                "token": request.headers.get(TOKEN_HEADER, ""),
                "profiles": profiles,
                "reused": True,
            },
            status=200,
        )

    token = secrets.token_urlsafe(32)
    installation = Installation.objects.create(token_hash=_hash_token(token))
    return JsonResponse(
        {
            "installId": installation.id,
            "token": token,
            "profiles": profiles,
            "reused": False,
        },
        status=201,
    )


def _is_text(value, max_len):
    return isinstance(value, str) and 0 < len(value) <= max_len


def _is_member(value, allowed):
    return isinstance(value, str) and value in allowed


def _validate(raw):
    """Return (clean_fields, None) for a valid event, or (None, field_name)."""
    if not isinstance(raw, dict):
        return None, "event"

    if not _is_text(raw.get("eventId"), 64):
        return None, "eventId"
    if not _is_member(raw.get("profileId"), SYNTHETIC_PROFILES):
        return None, "profileId"

    sequence = raw.get("sequence")
    # type() check keeps bool out: True/False are ints to isinstance().
    if type(sequence) is not int or sequence < 1:
        return None, "sequence"

    item_id = raw.get("itemId")
    if not isinstance(item_id, str) or not ITEM_ID.fullmatch(item_id):
        return None, "itemId"
    if not _is_text(raw.get("instanceId"), 64):
        return None, "instanceId"

    # Exactly one answer form: a choice code (stepId) or a bounded integer (value).
    step_id = raw.get("stepId")
    value = raw.get("value")
    if step_id is not None and value is not None:
        return None, "stepId_and_value_both_set"
    if step_id is not None:
        if not _is_text(step_id, 64):
            return None, "stepId"
    elif value is None:
        return None, "stepId_or_value_required"
    elif type(value) is not int:
        # type() check keeps bool out: True/False are ints to isinstance().
        return None, "value_not_integer"
    elif not -9999 <= value <= 9999:
        return None, "value_out_of_range"

    correct = raw.get("correct")
    if not isinstance(correct, bool):
        return None, "correct"
    if not _is_member(raw.get("assistance"), ASSISTANCE):
        return None, "assistance"

    reason_code = raw.get("reasonCode")
    if not isinstance(reason_code, str) or len(reason_code) > 32:
        return None, "reasonCode"
    if not _is_member(raw.get("packVersion"), PACK_VERSIONS):
        return None, "packVersion"
    if not _is_member(raw.get("policyVersion"), POLICY_VERSIONS):
        return None, "policyVersion"

    created_at = raw.get("createdAt")
    if not isinstance(created_at, str) or len(created_at) > 40:
        return None, "createdAt"

    clean = {
        "event_id": raw["eventId"],
        "profile_id": raw["profileId"],
        "sequence": sequence,
        "item_id": item_id,
        "instance_id": raw["instanceId"],
        "step_id": step_id,
        "value": value,
        "correct": correct,
        "assistance": raw["assistance"],
        "reason_code": reason_code,
        "pack_version": raw["packVersion"],
        "policy_version": raw["policyVersion"],
        "created_at_client": created_at,
    }
    return clean, None


def _same_payload(stored, clean):
    return all(getattr(stored, field) == value for field, value in clean.items() if field != "event_id")


def _classify_and_insert(installation, clean):
    """Return (status, error) for one validated event. Caller holds the transaction."""
    existing = ProgressEvent.objects.filter(
        installation=installation, event_id=clean["event_id"]
    ).first()
    if existing is not None:
        if _same_payload(existing, clean):
            return "duplicate", None
        return "conflict", "eventId_reused_with_different_payload"

    sequence_taken = ProgressEvent.objects.filter(
        installation=installation,
        profile_id=clean["profile_id"],
        sequence=clean["sequence"],
    ).exists()
    if sequence_taken:
        return "conflict", "sequence_taken"

    ProgressEvent.objects.create(installation=installation, **clean)
    return "stored", None


def _store(installation, clean):
    """Store one event atomically; re-classify once if a concurrent insert wins the race."""
    try:
        with transaction.atomic():
            return _classify_and_insert(installation, clean)
    except IntegrityError:
        return _classify_and_insert(installation, clean)


def _process(installation, raw):
    """Build the per-event result object for one raw input event."""
    clean, bad_field = _validate(raw)
    raw_event_id = raw.get("eventId") if isinstance(raw, dict) else None
    event_id = raw_event_id if isinstance(raw_event_id, str) else None

    if clean is None:
        return {"eventId": event_id, "status": "invalid", "error": f"invalid_{bad_field}"}

    status, error = _store(installation, clean)
    result = {"eventId": event_id, "status": status}
    if error is not None:
        result["error"] = error
    return result


def progress_events(request):
    """Accept up to MAX_BATCH outbox events and report a result for each one."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])

    installation = _find_installation(request)
    if installation is None:
        return JsonResponse({"error": "unauthorized"}, status=401)

    try:
        body = json.loads(request.body)
    except ValueError:
        return JsonResponse({"error": "bad_request"}, status=400)

    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        return JsonResponse({"error": "bad_request"}, status=400)
    if len(events) > MAX_BATCH:
        return JsonResponse({"error": "batch_too_large"}, status=400)

    results = [_process(installation, raw) for raw in events]
    return JsonResponse({"results": results})
