#!/usr/bin/env python3
"""Standalone reconnect-sync check for the Tamil tutor (Playwright sync API).

Setup (optional, not part of pytest):
    pip install playwright
    python -m playwright install chromium

Start the app first with the Django dev server and a writable SQLite file:
    DJANGO_DEBUG=1 python manage.py runserver

Run:
    BASE_URL=http://127.0.0.1:8000 python tests/e2e/check_sync.py

Optional: TUTOR_SQLITE_PATH (default data/progress.sqlite3, relative to the
project root) must point at the same SQLite file the server writes to.

Prints one PASS/FAIL/SKIPPED line per check and exits non-zero if any check fails.
Selectors use data-testid attributes from tutor/templates/tutor/index.html and
tutor/static/app.v1.js. Nothing here calls an external host.
"""

import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000").rstrip("/")
SQLITE_PATH = Path(os.environ.get("TUTOR_SQLITE_PATH", "data/progress.sqlite3"))
if not SQLITE_PATH.is_absolute():
    SQLITE_PATH = ROOT / SQLITE_PATH
TIMEOUT_MS = 15000
SYNC_TIMEOUT_S = 30
CHECKS = [
    "offline_answer_survives_reload",
    "reconnect_stores_in_sqlite",
    "replay_same_batch_one_row",
    "failed_request_keeps_outbox",
    "numeric_answer_reconnect_stored",
    "numeric_replay_one_row",
]
EVENT_FIELDS = [
    "eventId",
    "profileId",
    "sequence",
    "packVersion",
    "policyVersion",
    "itemId",
    "instanceId",
    "stepId",
    "value",
    "correct",
    "assistance",
    "reasonCode",
    "createdAt",
]
results = {}
skipped = {}

# Reads one whole IndexedDB store of the app's tutor-v1 database. Read-only.
IDB_STORE_JS = """
async (storeName) => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('tutor-v1');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    if (!db.objectStoreNames.contains(storeName)) return [];
    return await new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
"""

SYNC_STATE_JS = """
() => {
  const el = document.querySelector('[data-testid="sync-status"]');
  return el ? el.dataset.state : null;
}
"""

# Replays one stored event (13 fields) to the same-origin API. Argument is either an eventId string
# (event sent exactly as stored) or {eventId, value} to send the stored event with a different value.
REPLAY_JS = """
async (args) => {
  const eventId = typeof args === 'string' ? args : args.eventId;
  const override = typeof args === 'string' ? undefined : args.value;
  const install = JSON.parse(localStorage.getItem('tutor.install.v1') || 'null');
  const cookie = document.cookie.split('; ').find((c) => c.startsWith('csrftoken='));
  const csrf = cookie ? decodeURIComponent(cookie.slice('csrftoken='.length)) : null;
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('tutor-v1');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const row = await new Promise((resolve, reject) => {
    const req = db.transaction('events', 'readonly').objectStore('events').get(eventId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!install || !csrf || !row) {
    return { ok: false, install: !!install, csrf: !!csrf, row: !!row };
  }
  const fields = %FIELDS%;
  const event = {};
  for (const key of fields) event[key] = row[key];
  if (override !== undefined) event.value = override;
  const response = await fetch('/api/progress/events', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrf,
      'X-Install-Token': install.token,
    },
    body: JSON.stringify({ events: [event] }),
  });
  const body = await response.json().catch(() => null);
  return { ok: true, httpStatus: response.status, body, event };
}
""".replace("%FIELDS%", json.dumps(EVENT_FIELDS))


def report(name, ok, detail=""):
    results[name] = bool(ok)
    print(f"{'PASS' if ok else 'FAIL'} {name}" + (f" - {detail}" if detail else ""), flush=True)


def skip(name, reason):
    skipped[name] = reason
    print(f"SKIPPED {name} - {reason}", flush=True)


def guarded(name, fn):
    """Run one check; an unexpected exception is reported as a FAIL, not a crash."""
    try:
        fn()
    except Exception as error:  # noqa: BLE001 - report and keep going
        report(name, False, f"{type(error).__name__}: {error}")


def wait_ready(page):
    page.wait_for_selector('[data-testid="readiness"][data-state="ready"]', timeout=45000)


def pick_profile(page, alias):
    page.click(f'[data-testid="profile-{alias}"]')
    page.wait_for_selector(f'[data-testid="intro"][data-profile-id="{alias}"]', timeout=TIMEOUT_MS)
    page.click('[data-testid="intro-start"]')
    page.wait_for_selector('[data-testid="item"], [data-testid="worked-example"]', timeout=TIMEOUT_MS)
    if page.is_visible('[data-testid="worked-example"]'):
        page.click('[data-testid="example-continue"]')
    page.wait_for_selector('[data-testid="item"]', timeout=TIMEOUT_MS)


def current_item_id(page):
    return page.get_attribute('[data-testid="item"]', "data-item-id")


def answer_choice(page, step_id):
    page.click(f'[data-testid="answer-option-{step_id}"]')


def wait_saved(page):
    page.wait_for_selector('[data-testid="status"][data-state="saved"]', timeout=TIMEOUT_MS)


def read_store(page, store):
    return page.evaluate(IDB_STORE_JS, store)


def event_ids(page):
    return [row["eventId"] for row in read_store(page, "events")]


def outbox_ids(page):
    return [row["eventId"] for row in read_store(page, "outbox")]


def sync_state(page):
    return page.evaluate(SYNC_STATE_JS)


def poll(read, timeout_s=SYNC_TIMEOUT_S, interval_s=0.5):
    """Call read() until it returns a truthy value or the timeout passes. Returns the last value."""
    deadline = time.monotonic() + timeout_s
    value = read()
    while not value and time.monotonic() < deadline:
        time.sleep(interval_s)
        value = read()
    return value


def sqlite_count(event_id):
    connection = sqlite3.connect(str(SQLITE_PATH))
    try:
        row = connection.execute(
            "SELECT COUNT(*) FROM tutor_progress_event WHERE event_id = ?",
            (event_id,),
        ).fetchone()
    finally:
        connection.close()
    return row[0]


def sqlite_numeric_rows(event_id):
    """(value, step_id) for every tutor_progress_event row with this event_id."""
    connection = sqlite3.connect(str(SQLITE_PATH))
    try:
        return connection.execute(
            "SELECT value, step_id FROM tutor_progress_event WHERE event_id = ?",
            (event_id,),
        ).fetchall()
    finally:
        connection.close()


def wait_for_item(page, expected):
    """Wait until the planner shows expected; return the item id actually on screen."""
    poll(lambda: current_item_id(page) == expected, timeout_s=TIMEOUT_MS / 1000)
    return current_item_id(page)


def new_event_ids(page, before):
    """Event ids that appeared in the events store since the snapshot in `before`."""
    return [eid for eid in event_ids(page) if eid not in before]


def go_online_event(page):
    page.evaluate("() => window.dispatchEvent(new Event('online'))")


def run_shared_session(p, state):
    """Checks 1-3 share one persistent profile so the reload and replay see the same local store."""
    context = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix="tutor-sync-"), headless=True)
    try:
        page = context.pages[0] if context.pages else context.new_page()

        def check_offline_answer_survives_reload():
            page.goto(f"{BASE_URL}/")
            wait_ready(page)
            pick_profile(page, "learner-a")
            # Offline before the answer so the outbox entry cannot be flushed while online.
            context.set_offline(True)
            page.wait_for_selector('[data-testid="connection"][data-state="offline"]', timeout=TIMEOUT_MS)
            before = set(event_ids(page))
            answer_choice(page, "SUB8_BOTH")
            wait_saved(page)
            new_ids = new_event_ids(page, before)
            pending = outbox_ids(page)
            ok = len(new_ids) == 1 and new_ids[0] in pending
            if not ok:
                report(
                    "offline_answer_survives_reload",
                    False,
                    f"new events={new_ids}, outbox={pending}",
                )
                return
            event_id = new_ids[0]
            page.reload()
            wait_ready(page)
            stored = event_id in event_ids(page)
            still_pending = event_id in outbox_ids(page)
            report(
                "offline_answer_survives_reload",
                stored and still_pending,
                f"eventId={event_id}, after reload events-store={stored}, outbox={still_pending}",
            )
            if stored and still_pending:
                state["event_id"] = event_id

        def check_reconnect_stores_in_sqlite():
            event_id = state["event_id"]
            context.set_offline(False)
            go_online_event(page)

            def synced():
                return sync_state(page) == "synced" and event_id not in outbox_ids(page)

            done = poll(synced)
            count = sqlite_count(event_id)
            ok = bool(done) and count == 1
            report(
                "reconnect_stores_in_sqlite",
                ok,
                f"sync-status={sync_state(page)}, outbox has eventId={event_id in outbox_ids(page)}, "
                f"sqlite rows={count}",
            )

        def check_replay_same_batch_one_row():
            event_id = state["event_id"]
            replay = page.evaluate(REPLAY_JS, event_id)
            if not replay.get("ok"):
                report(
                    "replay_same_batch_one_row",
                    False,
                    f"could not build replay: install={replay.get('install')}, "
                    f"csrf={replay.get('csrf')}, row={replay.get('row')}",
                )
                return
            body = replay.get("body") or {}
            results_list = body.get("results") or [{}]
            status = results_list[0].get("status")
            count = sqlite_count(event_id)
            report(
                "replay_same_batch_one_row",
                replay.get("httpStatus") == 200 and status == "duplicate" and count == 1,
                f"http={replay.get('httpStatus')}, status={status}, sqlite rows={count}",
            )

        guarded("offline_answer_survives_reload", check_offline_answer_survives_reload)
        if "event_id" not in state:
            skip("reconnect_stores_in_sqlite", "no offline answer was stored by offline_answer_survives_reload")
            skip("replay_same_batch_one_row", "no offline answer was stored by offline_answer_survives_reload")
            return
        guarded("reconnect_stores_in_sqlite", check_reconnect_stores_in_sqlite)
        guarded("replay_same_batch_one_row", check_replay_same_batch_one_row)
    finally:
        context.close()


def run_failed_request(p):
    """A failed POST must keep the outbox entry; sync-retry must then clear it once the server answers."""
    name = "failed_request_keeps_outbox"
    context = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix="tutor-sync-"), headless=True)
    try:
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(f"{BASE_URL}/")
        wait_ready(page)
        pick_profile(page, "learner-b")
        before = set(event_ids(page))
        answer_choice(page, "SUB8_LEFT")
        wait_saved(page)
        page.click('[data-testid="next-item"]')
        page.wait_for_function(
            "() => { const el = document.querySelector('[data-testid=\"item\"]');"
            " return !!el && el.dataset.itemId === 'E05'; }",
            timeout=TIMEOUT_MS,
        )
        first_ids = new_event_ids(page, before)
        first_synced = poll(lambda: sync_state(page) == "synced" and not any(
            eid in outbox_ids(page) for eid in first_ids
        ))
        if not first_synced:
            report(name, False, f"first answer never synced: sync-status={sync_state(page)}, "
                                f"outbox={outbox_ids(page)}")
            return

        page.route("**/api/progress/events", lambda route: route.abort())
        try:
            before_e05 = set(event_ids(page))
            answer_choice(page, "SUB2_BOTH")
            wait_saved(page)
            e05_ids = new_event_ids(page, before_e05)
            if len(e05_ids) != 1:
                report(name, False, f"expected one new E05 event, got {e05_ids}")
                return
            event_id = e05_ids[0]
            go_online_event(page)
            retry = poll(lambda: sync_state(page) == "retry")
            pending_after_fail = event_id in outbox_ids(page)
            stored_after_fail = event_id in event_ids(page)
            if not (retry and pending_after_fail and stored_after_fail):
                report(
                    name,
                    False,
                    f"after aborted POST: sync-status={sync_state(page)}, "
                    f"outbox has eventId={pending_after_fail}, events store has eventId={stored_after_fail}",
                )
                return
        finally:
            page.unroute("**/api/progress/events")

        page.click('[data-testid="sync-retry"]')

        def acknowledged():
            return sync_state(page) == "synced" and event_id not in outbox_ids(page)

        done = poll(acknowledged)
        count = sqlite_count(event_id)
        report(
            name,
            bool(done) and count == 1,
            f"sync-status={sync_state(page)}, outbox has eventId={event_id in outbox_ids(page)}, "
            f"sqlite rows={count}",
        )
    finally:
        context.close()


def run_numeric_session(p):
    """Numeric E08 answer: stored offline, synced on reconnect, then replayed as duplicate/conflict."""
    context = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix="tutor-sync-"), headless=True)
    state = {}
    try:
        page = context.pages[0] if context.pages else context.new_page()

        def check_numeric_answer_reconnect_stored():
            name = "numeric_answer_reconnect_stored"
            page.goto(f"{BASE_URL}/")
            wait_ready(page)
            pick_profile(page, "learner-a")
            # Planner route E01 -> E11 -> E08. Each item is read from data-item-id before answering.
            observed = current_item_id(page)
            if observed != "E01":
                report(name, False, f"planner started at {observed}, expected E01")
                return
            answer_choice(page, "SUB8_BOTH")
            wait_saved(page)
            page.click('[data-testid="next-item"]')
            observed = wait_for_item(page, "E11")
            if observed != "E11":
                report(name, False, f"planner reached {observed}, expected E11")
                return
            answer_choice(page, "SUB2_RIGHT")
            wait_saved(page)
            page.click('[data-testid="next-item"]')
            observed = wait_for_item(page, "E08")
            if observed != "E08":
                report(name, False, f"planner reached {observed}, expected E08")
                return

            context.set_offline(True)
            page.wait_for_selector('[data-testid="connection"][data-state="offline"]', timeout=TIMEOUT_MS)
            before = set(event_ids(page))
            page.fill('[data-testid="answer-input"]', "-5")
            page.click('[data-testid="answer-submit"]')
            wait_saved(page)
            new_ids = new_event_ids(page, before)
            if len(new_ids) != 1:
                report(name, False, f"expected one new E08 event offline, got {new_ids}")
                return
            event_id = new_ids[0]
            local = next((row for row in read_store(page, "events") if row["eventId"] == event_id), None)
            if not local or local.get("value") != -5 or local.get("stepId") is not None:
                report(name, False, f"local event wrong: value={local and local.get('value')}, "
                                    f"stepId={local and local.get('stepId')}")
                return

            context.set_offline(False)
            go_online_event(page)

            def synced():
                return sync_state(page) == "synced" and event_id not in outbox_ids(page)

            done = poll(synced)
            rows = sqlite_numeric_rows(event_id)
            ok = bool(done) and rows == [(-5, None)]
            report(
                name,
                ok,
                f"sync-status={sync_state(page)}, outbox has eventId={event_id in outbox_ids(page)}, "
                f"sqlite rows (value, stepId)={rows}",
            )
            if ok:
                state["event_id"] = event_id

        def check_numeric_replay_one_row():
            name = "numeric_replay_one_row"
            event_id = state["event_id"]
            replay = page.evaluate(REPLAY_JS, {"eventId": event_id})
            if not replay.get("ok"):
                report(name, False, f"could not build replay: install={replay.get('install')}, "
                                    f"csrf={replay.get('csrf')}, row={replay.get('row')}")
                return
            status = ((replay.get("body") or {}).get("results") or [{}])[0].get("status")
            rows_after_replay = sqlite_numeric_rows(event_id)

            # Same eventId, different value: must conflict and leave the stored -5 untouched.
            changed = page.evaluate(REPLAY_JS, {"eventId": event_id, "value": -4})
            conflict_status = ((changed.get("body") or {}).get("results") or [{}])[0].get("status")
            rows_after_conflict = sqlite_numeric_rows(event_id)

            ok = (
                replay.get("httpStatus") == 200
                and status == "duplicate"
                and rows_after_replay == [(-5, None)]
                and changed.get("httpStatus") == 200
                and conflict_status == "conflict"
                and rows_after_conflict == [(-5, None)]
            )
            report(
                name,
                ok,
                f"replay http={replay.get('httpStatus')} status={status} rows={rows_after_replay}; "
                f"value -4 http={changed.get('httpStatus')} status={conflict_status} rows={rows_after_conflict}",
            )

        guarded("numeric_answer_reconnect_stored", check_numeric_answer_reconnect_stored)
        if "event_id" not in state:
            skip("numeric_replay_one_row", "no numeric answer was stored by numeric_answer_reconnect_stored")
            return
        guarded("numeric_replay_one_row", check_numeric_replay_one_row)
    finally:
        context.close()


def main():
    with sync_playwright() as p:
        state = {}
        guarded("offline_answer_survives_reload", lambda: run_shared_session(p, state))
        guarded("failed_request_keeps_outbox", lambda: run_failed_request(p))
        guarded("numeric_session", lambda: run_numeric_session(p))
        for name in CHECKS:
            if name not in results and name not in skipped:
                report(name, False, "check did not run (see stage error above)")

    failed = [name for name in CHECKS if not results.get(name) and name not in skipped]
    passed = [name for name in CHECKS if results.get(name)]
    print(
        f"SUMMARY {len(passed)}/{len(CHECKS)} passed, {len(skipped)} skipped",
        flush=True,
    )
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
