import copy
import hashlib
import json

import pytest
from django.test import Client

from tutor.models import Installation, ProgressEvent

SESSION_URL = "/api/session"
EVENTS_URL = "/api/progress/events"


def make_event(**overrides):
    event = {
        "eventId": "evt-1",
        "profileId": "learner-a",
        "sequence": 1,
        "packVersion": "1",
        "policyVersion": "1",
        "itemId": "E01",
        "instanceId": "inst-1",
        "stepId": "SUB8_BOTH",
        "correct": True,
        "assistance": "none",
        "reasonCode": "correct",
        "createdAt": "2024-01-01T00:00:00Z",
    }
    event.update(overrides)
    return event


def csrf_client():
    client = Client(enforce_csrf_checks=True)
    client.get("/")
    token = client.cookies["csrftoken"].value
    return client, token


def start_install(client, csrf):
    response = client.post(SESSION_URL, HTTP_X_CSRFTOKEN=csrf)
    assert response.status_code == 201, response.content
    return response.json()


def post_events(client, csrf, install_token, events):
    return client.post(
        EVENTS_URL,
        data=json.dumps({"events": events}),
        content_type="application/json",
        HTTP_X_CSRFTOKEN=csrf,
        HTTP_X_INSTALL_TOKEN=install_token,
    )


def first_result(response):
    assert response.status_code == 200, response.content
    return response.json()["results"][0]


@pytest.mark.django_db
def test_session_creates_install_then_reuses_it():
    client, csrf = csrf_client()
    created = start_install(client, csrf)
    assert created["reused"] is False
    assert created["installId"]
    assert created["token"]

    again = client.post(
        SESSION_URL,
        HTTP_X_CSRFTOKEN=csrf,
        HTTP_X_INSTALL_TOKEN=created["token"],
    )
    assert again.status_code == 200, again.content
    body = again.json()
    assert body["reused"] is True
    assert body["installId"] == created["installId"]


@pytest.mark.django_db
def test_session_rejects_get():
    client, _ = csrf_client()
    response = client.get(SESSION_URL)
    assert response.status_code == 405


@pytest.mark.django_db
def test_progress_without_install_token_is_401():
    client, csrf = csrf_client()
    response = client.post(
        EVENTS_URL,
        data=json.dumps({"events": [make_event()]}),
        content_type="application/json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert response.status_code == 401


@pytest.mark.django_db
def test_progress_without_csrf_token_is_403():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    response = client.post(
        EVENTS_URL,
        data=json.dumps({"events": [make_event()]}),
        content_type="application/json",
        HTTP_X_INSTALL_TOKEN=install["token"],
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_batch_of_26_is_rejected_as_too_large():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    events = [
        make_event(eventId=f"evt-{i}", sequence=i + 1) for i in range(26)
    ]
    response = post_events(client, csrf, install["token"], events)
    assert response.status_code == 400
    assert "batch_too_large" in response.content.decode()


@pytest.mark.django_db
def test_valid_v1_event_is_stored():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    result = first_result(
        post_events(client, csrf, install["token"], [make_event()])
    )
    assert result["status"] == "stored"
    assert ProgressEvent.objects.filter(event_id="evt-1").count() == 1


@pytest.mark.django_db
def test_valid_v2_event_is_stored():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    event = make_event(eventId="evt-v2", packVersion="2", policyVersion="2")
    result = first_result(post_events(client, csrf, install["token"], [event]))
    assert result["status"] == "stored"
    assert ProgressEvent.objects.filter(event_id="evt-v2").count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    "overrides",
    [
        {"profileId": "learner-z"},
        {"itemId": "X1"},
        {"packVersion": "3"},
        {"assistance": "guess"},
        {"sequence": True},
    ],
    ids=["profile", "item", "pack_version", "assistance", "sequence_bool"],
)
def test_invalid_field_is_rejected(overrides):
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    event = make_event(eventId="evt-bad", **overrides)
    result = first_result(post_events(client, csrf, install["token"], [event]))
    assert result["status"] == "invalid", result
    assert ProgressEvent.objects.filter(event_id="evt-bad").count() == 0


@pytest.mark.django_db
def test_exact_retry_returns_duplicate_and_keeps_one_row():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    event = make_event()
    first = first_result(post_events(client, csrf, install["token"], [event]))
    assert first["status"] == "stored"
    second = first_result(post_events(client, csrf, install["token"], [event]))
    assert second["status"] == "duplicate"
    assert ProgressEvent.objects.filter(event_id="evt-1").count() == 1


@pytest.mark.django_db
def test_same_event_id_with_different_step_is_conflict_and_row_unchanged():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    first_result(post_events(client, csrf, install["token"], [make_event()]))
    before = ProgressEvent.objects.get(event_id="evt-1")
    before_step = before.step_id

    changed = make_event(stepId="SUB8_LEFT")
    result = first_result(post_events(client, csrf, install["token"], [changed]))
    assert result["status"] == "conflict"

    after = ProgressEvent.objects.get(event_id="evt-1")
    assert after.step_id == before_step
    assert ProgressEvent.objects.filter(event_id="evt-1").count() == 1


@pytest.mark.django_db
def test_same_profile_and_sequence_with_different_event_id_is_conflict():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    first_result(post_events(client, csrf, install["token"], [make_event()]))
    clash = make_event(eventId="evt-other")
    result = first_result(post_events(client, csrf, install["token"], [clash]))
    assert result["status"] == "conflict"
    assert ProgressEvent.objects.filter(event_id="evt-other").count() == 0


@pytest.mark.django_db
def test_two_installs_can_each_store_sequence_one_for_same_learner():
    client_a, csrf_a = csrf_client()
    install_a = start_install(client_a, csrf_a)
    client_b, csrf_b = csrf_client()
    install_b = start_install(client_b, csrf_b)

    result_a = first_result(
        post_events(client_a, csrf_a, install_a["token"], [make_event(eventId="evt-a")])
    )
    result_b = first_result(
        post_events(client_b, csrf_b, install_b["token"], [make_event(eventId="evt-b")])
    )
    assert result_a["status"] == "stored"
    assert result_b["status"] == "stored"
    assert ProgressEvent.objects.filter(profile_id="learner-a", sequence=1).count() == 2


@pytest.mark.django_db
def test_batch_of_25_valid_events_all_stored():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    events = [
        make_event(eventId=f"evt-{i}", sequence=i + 1) for i in range(25)
    ]
    response = post_events(client, csrf, install["token"], events)
    assert response.status_code == 200, response.content
    results = response.json()["results"]
    assert len(results) == 25
    assert all(r["status"] == "stored" for r in results), results
    assert ProgressEvent.objects.count() == 25


@pytest.mark.django_db
def test_install_token_is_stored_as_sha256_hash():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    token = install["token"]
    row = Installation.objects.get(id=install["installId"])
    assert row.token_hash == hashlib.sha256(token.encode("utf-8")).hexdigest()
    assert row.token_hash != token


@pytest.mark.django_db
def test_numeric_answer_is_stored_with_value_and_null_step():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    event = make_event(eventId="evt-num", stepId=None, value=-5)
    result = first_result(post_events(client, csrf, install["token"], [event]))
    assert result["status"] == "stored", result
    row = ProgressEvent.objects.get(event_id="evt-num")
    assert row.value == -5
    assert row.step_id is None


@pytest.mark.django_db
def test_numeric_replay_is_duplicate_and_keeps_one_row():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    event = make_event(eventId="evt-num", stepId=None, value=-5)
    first = first_result(post_events(client, csrf, install["token"], [event]))
    assert first["status"] == "stored"
    second = first_result(post_events(client, csrf, install["token"], [event]))
    assert second["status"] == "duplicate", second
    assert ProgressEvent.objects.filter(event_id="evt-num").count() == 1


@pytest.mark.django_db
def test_same_event_id_with_different_value_is_conflict_and_row_unchanged():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    event = make_event(eventId="evt-num", stepId=None, value=-5)
    first_result(post_events(client, csrf, install["token"], [event]))

    changed = make_event(eventId="evt-num", stepId=None, value=-4)
    result = first_result(post_events(client, csrf, install["token"], [changed]))
    assert result["status"] == "conflict", result
    assert result["error"] == "eventId_reused_with_different_payload"

    after = ProgressEvent.objects.get(event_id="evt-num")
    assert after.value == -5
    assert ProgressEvent.objects.filter(event_id="evt-num").count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    "overrides,error",
    [
        ({"stepId": None, "value": 10000}, "invalid_value_out_of_range"),
        ({"stepId": None, "value": -10000}, "invalid_value_out_of_range"),
        ({"stepId": None, "value": True}, "invalid_value_not_integer"),
        ({"stepId": None, "value": "5"}, "invalid_value_not_integer"),
        ({"stepId": "SUB8_BOTH", "value": -5}, "invalid_stepId_and_value_both_set"),
        ({"stepId": None, "value": None}, "invalid_stepId_or_value_required"),
    ],
    ids=["too_high", "too_low", "bool", "string", "both_set", "neither_set"],
)
def test_invalid_answer_form_is_rejected(overrides, error):
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    event = make_event(eventId="evt-bad-value", **overrides)
    result = first_result(post_events(client, csrf, install["token"], [event]))
    assert result["status"] == "invalid", result
    assert result["error"] == error, result
    assert ProgressEvent.objects.filter(event_id="evt-bad-value").count() == 0


@pytest.mark.django_db
def test_choice_event_with_null_value_is_still_stored():
    client, csrf = csrf_client()
    install = start_install(client, csrf)
    event = make_event(eventId="evt-choice", value=None)
    result = first_result(post_events(client, csrf, install["token"], [event]))
    assert result["status"] == "stored", result
    row = ProgressEvent.objects.get(event_id="evt-choice")
    assert row.step_id == "SUB8_BOTH"
    assert row.value is None
