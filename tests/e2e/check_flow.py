#!/usr/bin/env python3
"""Standalone browser flow check for the Tamil tutor slice (Playwright sync API).

Setup (optional, not part of pytest):
    pip install playwright
    python -m playwright install chromium

Start the app first. DJANGO_DEBUG=1 is required so /selftest/ is served:
    DJANGO_DEBUG=1 python manage.py runserver

Run:
    BASE_URL=http://127.0.0.1:8000 python tests/e2e/check_flow.py

Prints one PASS/FAIL line per check and exits non-zero if any check fails.
Selectors use data-testid attributes from tutor/templates/tutor/index.html and
tutor/static/app.v1.js. Nothing here calls an external host.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000").rstrip("/")
TIMEOUT_MS = 15000
SELFTEST_TIMEOUT_MS = 60000
BLANK_PATH = "/__blank_probe__"
CHECKS = [
    "idb_open",
    "selftest",
    "profile_paths_diverge",
    "offline_answer_saved",
    "reopen_restores_profile_a",
    "reopen_restores_profile_b",
    "example_before_practice",
]
results = {}

IDB_PROBE_JS = """
() => new Promise((resolve) => {
  try {
    const req = indexedDB.open('idb-flow-probe', 1);
    req.onsuccess = () => {
      req.result.close();
      indexedDB.deleteDatabase('idb-flow-probe');
      resolve(true);
    };
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(false);
  } catch (e) {
    resolve(false);
  }
})
"""

# Reads the app's own IndexedDB (tutor-v1). Read-only; no writes.
IDB_READ_JS = """
async (profileId) => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('tutor-v1');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const getAll = (store) => new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve([]);
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const cursors = await getAll('cursors');
  const events = await getAll('events');
  const outbox = await getAll('outbox');
  db.close();
  const cursor = cursors.find((c) => c.profileId === profileId) || null;
  return {
    currentItemId: cursor ? cursor.currentItemId : null,
    sequence: cursor ? cursor.sequence : 0,
    events: events.filter((e) => e.profileId === profileId).length,
    outboxPending: outbox.filter((o) => o.profileId === profileId && o.state === 'pending').length,
  };
}
"""

NEXT_ITEM_JS = """
(previous) => {
  const el = document.querySelector('[data-testid="item"]');
  return !!el && el.dataset.itemId !== previous;
}
"""


def report(name, ok, detail=""):
    results[name] = bool(ok)
    print(f"{'PASS' if ok else 'FAIL'} {name}" + (f" - {detail}" if detail else ""), flush=True)


def serve_blank(route):
    route.fulfill(
        status=200,
        content_type="text/html",
        body="<!doctype html><html lang='en'><title>blank</title><body></body></html>",
    )


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


def next_item_after(page, previous):
    page.wait_for_function(NEXT_ITEM_JS, arg=previous, timeout=TIMEOUT_MS)
    return current_item_id(page)


def answer_choice(page, step_id):
    page.click(f'[data-testid="answer-option-{step_id}"]')


def answer_numeric(page, text):
    page.fill('[data-testid="answer-input"]', text)
    page.click('[data-testid="answer-submit"]')


def wait_saved(page):
    page.wait_for_selector('[data-testid="status"][data-state="saved"]', timeout=TIMEOUT_MS)


def switch_profile(page):
    page.click('[data-testid="switch-profile"]')
    page.wait_for_selector('[data-testid="profile-picker"]', timeout=TIMEOUT_MS)


def read_idb(page, profile_id):
    return page.evaluate(IDB_READ_JS, profile_id)


def run_fresh_checks(p):
    browser = p.chromium.launch(headless=True)
    try:
        context = browser.new_context()
        page = context.new_page()
        page.route(f"{BASE_URL}{BLANK_PATH}", serve_blank)
        page.goto(f"{BASE_URL}{BLANK_PATH}")
        idb_ok = page.evaluate(IDB_PROBE_JS)
        print(f"IDB_OPEN {'OK' if idb_ok else 'FAIL'}", flush=True)
        report("idb_open", idb_ok, "indexedDB.open on a blank same-origin page")

        try:
            page.goto(f"{BASE_URL}/selftest/")
            page.wait_for_function(
                "() => { const el = document.getElementById('result');"
                " return !!el && el.textContent.includes('DONE'); }",
                timeout=SELFTEST_TIMEOUT_MS,
            )
            text = page.text_content("#result") or ""
            print("SELFTEST_RESULT " + text.replace("\n", " | "), flush=True)
            bad = any(marker in text for marker in ("FAIL ", "UNCAUGHT", "UNHANDLED", "IMPORT-FAILED", "TIMEOUT"))
            report("selftest", "fail=0" in text and not bad, "DONE line with fail=0")
        except Exception as error:  # noqa: BLE001 - report and keep going
            report("selftest", False, f"selftest page did not finish ({type(error).__name__}); is DJANGO_DEBUG=1 set?")
        context.close()
    finally:
        browser.close()


def run_persistent_flow(p, user_dir):
    context = p.chromium.launch_persistent_context(user_dir, headless=True)
    page = context.pages[0] if context.pages else context.new_page()
    page.goto(f"{BASE_URL}/")
    wait_ready(page)

    # Profile A: correct step on E01 -> planner moves to C0 explanation practice (E11).
    # Phase 2: planner returns E11 after a correct E01 (was E03, a two-step numeric item).
    pick_profile(page, "learner-a")
    path_a_start = current_item_id(page)
    answer_choice(page, "SUB8_BOTH")
    wait_saved(page)
    page.click('[data-testid="next-item"]')
    path_a = next_item_after(page, path_a_start)

    # Profile B: subtraction on one side only -> balance explanation and probe (E05).
    switch_profile(page)
    pick_profile(page, "learner-b")
    path_b_start = current_item_id(page)
    answer_choice(page, "SUB8_LEFT")
    wait_saved(page)
    page.click('[data-testid="next-item"]')
    path_b = next_item_after(page, path_b_start)

    report(
        "profile_paths_diverge",
        # Phase 2: learner-a's expected next item is E11 (was E03).
        bool(path_a) and bool(path_b) and path_a == "E11" and path_a != path_b,
        f"learner-a -> {path_a}, learner-b -> {path_b}",
    )

    # Return to A (must resume at E11), then go offline and answer E11 correctly (SUB2_RIGHT).
    switch_profile(page)
    pick_profile(page, "learner-a")
    resumed_a = current_item_id(page)
    context.set_offline(True)
    page.wait_for_selector('[data-testid="connection"][data-state="offline"]', timeout=TIMEOUT_MS)
    # Phase 2: E11 is a CHOICE item; was a numeric "7" answer on E03.
    answer_choice(page, "SUB2_RIGHT")
    wait_saved(page)
    stored_a = read_idb(page, "learner-a")
    # Phase 2: resume at E11 (was E03) and stored next after a correct E11 is E08 (was E02).
    offline_ok = (
        resumed_a == "E11"
        and stored_a["events"] == 2
        and stored_a["outboxPending"] == 2
        and stored_a["currentItemId"] == "E08"
    )
    report(
        "offline_answer_saved",
        offline_ok,
        f"status=saved, events={stored_a['events']}, outboxPending={stored_a['outboxPending']}, "
        f"stored next={stored_a['currentItemId']}",
    )
    stored_b = read_idb(page, "learner-b")
    context.close()

    # Reopen in the same persisted profile directory, still offline.
    context = p.chromium.launch_persistent_context(user_dir, headless=True)
    context.set_offline(True)
    page = context.pages[0] if context.pages else context.new_page()
    page.goto(f"{BASE_URL}/")
    wait_ready(page)

    pick_profile(page, "learner-a")
    restored_a = current_item_id(page)
    report(
        "reopen_restores_profile_a",
        restored_a == stored_a["currentItemId"],
        f"restored={restored_a}, stored={stored_a['currentItemId']}",
    )

    switch_profile(page)
    pick_profile(page, "learner-b")
    restored_b = current_item_id(page)
    report(
        "reopen_restores_profile_b",
        restored_b == stored_b["currentItemId"],
        f"restored={restored_b}, stored={stored_b['currentItemId']}",
    )
    context.close()


def example_before_practice(p):
    pack = json.loads((Path(__file__).resolve().parents[2] / "tutor" / "content" / "pack-v1.json").read_text(encoding="utf-8"))
    expected_step = pack["workedExample"]["stepsTa"][0]
    browser = p.chromium.launch(headless=True)
    try:
        context = browser.new_context()
        page = context.new_page()
        page.goto(f"{BASE_URL}/")
        wait_ready(page)
        page.click('[data-testid="profile-learner-c"]')
        page.wait_for_selector('[data-testid="intro"][data-profile-id="learner-c"]', timeout=TIMEOUT_MS)
        page.click('[data-testid="intro-start"]')
        page.wait_for_selector('[data-testid="worked-example"]', timeout=TIMEOUT_MS)
        example_text = page.text_content('[data-testid="worked-example"]') or ""
        item_visible = page.is_visible('[data-testid="item"]')
        ok = expected_step in example_text and not item_visible
        report("example_before_practice", ok, "worked example shown before first item")
        context.close()
    except Exception as error:  # noqa: BLE001 - report and keep going
        report("example_before_practice", False, f"{type(error).__name__}: {error}")
    finally:
        browser.close()


def main():
    with sync_playwright() as p:
        try:
            run_fresh_checks(p)
        except Exception as error:  # noqa: BLE001
            print(f"fresh-context stage error: {type(error).__name__}: {error}", flush=True)

        try:
            example_before_practice(p)
        except Exception as error:  # noqa: BLE001
            print(f"example stage error: {type(error).__name__}: {error}", flush=True)

        user_dir = tempfile.mkdtemp(prefix="tutor-flow-")
        try:
            run_persistent_flow(p, user_dir)
        except Exception as error:  # noqa: BLE001
            print(f"persistent-flow stage error: {type(error).__name__}: {error}", flush=True)

    for name in CHECKS:
        if name not in results:
            report(name, False, "check did not run (see stage error above)")

    failed = [name for name in CHECKS if not results.get(name)]
    print(f"SUMMARY {len(CHECKS) - len(failed)}/{len(CHECKS)} passed", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
