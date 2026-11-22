#!/usr/bin/env python3
"""Upgrade and cold-offline checks for the Tamil tutor app (Playwright sync API).

Setup (optional, not part of pytest):
    pip install playwright
    python -m playwright install chromium

Start the app first:
    DJANGO_DEBUG=1 python manage.py runserver

Run:
    BASE_URL=http://127.0.0.1:8000 python tests/e2e/check_upgrade.py

UPGRADE SOURCE: seeded fixture (not an actual Phase 1 release). The "old
release" records and shell cache are written into the browser by this script.
Checks 3 and 4 are skipped because this repository has no second worker release
and no real Phase 1 release artefact.

Prints one PASS/FAIL/SKIP line per check and exits non-zero if any check fails.
Selectors use data-testid attributes from tutor/templates/tutor/index.html.
Nothing here calls an external host.
"""

import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000").rstrip("/")
TIMEOUT_MS = 15000
READY_TIMEOUT_MS = 45000
OFFLINE_READY_TIMEOUT_MS = 30000
UPGRADE_SOURCE = "seeded fixture (not an actual Phase 1 release)"
SIMULATED_PREFIX = "SIMULATED (staging fixture), not a real failed worker update"
OLD_RELEASE_CACHE = "tutor-shell-v2"
OLD_RELEASE_URLS = ["/static/app.v1.js", "/static/js/storage.js", "/content/pack-v1.json"]
ACTIVE_RELEASE_CACHE = "tutor-shell-v6"
STAGING_CACHE = "tutor-shell-v6-staging"
CHECKS = [
    "upgrade_preserves_records_offline",
    "failed_update_keeps_active_release",
    "successful_activation",
    "full_release_upgrade_from_phase1",
]
results = {}

# Creates the tutor-v1 stores if missing, then writes the Phase 1 fixture records.
SEED_PHASE1_JS = """
async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('tutor-v1', 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      const tx = req.transaction;
      const specs = [
        ['profiles', 'profileId', []],
        ['instances', 'instanceId', [['byProfile', 'profileId']]],
        ['events', 'eventId', [['byProfileSeq', ['profileId', 'sequence']]]],
        ['outbox', 'eventId', []],
        ['cursors', 'profileId', []],
      ];
      for (const [name, keyPath, indexes] of specs) {
        const store = database.objectStoreNames.contains(name)
          ? tx.objectStore(name)
          : database.createObjectStore(name, { keyPath });
        for (const [indexName, indexKey] of indexes) {
          if (!store.indexNames.contains(indexName)) store.createIndex(indexName, indexKey);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('tutor-v1 open blocked'));
  });
  const records = [
    ['profiles', {
      profileId: 'learner-a', alias: 'learner-a', createdAt: '2024-01-01T00:00:00Z',
    }],
    ['cursors', {
      profileId: 'learner-a', sequence: 1, currentInstanceId: 'I_PHASE1', currentItemId: 'E03',
      updatedAt: '2024-01-01T00:00:00Z',
    }],
    ['instances', {
      instanceId: 'I_PHASE1', profileId: 'learner-a', itemId: 'E03', status: 'open',
      createdAt: '2024-01-01T00:00:00Z',
    }],
    ['events', {
      eventId: 'EV_PHASE1_1', profileId: 'learner-a', sequence: 1, packVersion: '1',
      policyVersion: '1', itemId: 'E01', instanceId: 'I_PHASE1', stepId: 'SUB8_BOTH',
      value: null, correct: true, assistance: 'none', reasonCode: 'practice',
      createdAt: '2024-01-01T00:00:00Z',
    }],
    ['outbox', { eventId: 'EV_PHASE1_1', profileId: 'learner-a', state: 'pending' }],
  ];
  const tx = db.transaction(['profiles', 'cursors', 'instances', 'events', 'outbox'], 'readwrite');
  for (const [store, record] of records) tx.objectStore(store).put(record);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  return records.length;
}
"""

# Fetches each URL and stores the response in the named Cache Storage bucket.
CACHE_FIXTURE_JS = """
async ({ name, urls }) => {
  const cache = await caches.open(name);
  for (const url of urls) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`fetch ${url} returned ${res.status}`);
    await cache.put(url, res);
  }
  return urls.length;
}
"""

# Read-only snapshot of the app's own IndexedDB (tutor-v1).
SNAPSHOT_JS = """
async () => {
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
  const events = await getAll('events');
  const outbox = await getAll('outbox');
  const cursors = await getAll('cursors');
  db.close();
  return { events, outbox, cursors };
}
"""


def report(name, ok, detail=""):
    results[name] = bool(ok)
    print(f"{'PASS' if ok else 'FAIL'} {name}" + (f" - {detail}" if detail else ""), flush=True)


def skip(name, reason):
    results[name] = "skipped"
    print(f"SKIP {name} - {reason}", flush=True)


def wait_ready(page, timeout_ms):
    page.wait_for_selector('[data-testid="readiness"][data-state="ready"]', timeout=timeout_ms)


def snapshot(page):
    return page.evaluate(SNAPSHOT_JS)


def cursor_for(snap, profile_id):
    return next((c for c in snap["cursors"] if c.get("profileId") == profile_id), None)


def events_for(snap, profile_id):
    return [e for e in snap["events"] if e.get("profileId") == profile_id]


def run_guarded(name, check, p, detail_prefix=""):
    try:
        check(p)
    except Exception as error:  # noqa: BLE001 - report and keep going
        report(name, False, f"{detail_prefix}{type(error).__name__}: {error}")


def check_upgrade_preserves_records_offline(p):
    name = "upgrade_preserves_records_offline"
    user_dir = tempfile.mkdtemp(prefix="tutor-upgrade-")
    context = p.chromium.launch_persistent_context(user_dir, headless=True)
    try:
        # a. Warm the app on the current release.
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(f"{BASE_URL}/")
        wait_ready(page, READY_TIMEOUT_MS)

        # b. Seed the Phase 1 records into tutor-v1.
        page.evaluate(SEED_PHASE1_JS)

        # c. Seed the old release's shell cache; the active tutor-shell-v6 is left intact.
        page.evaluate(CACHE_FIXTURE_JS, {"name": OLD_RELEASE_CACHE, "urls": OLD_RELEASE_URLS})

        # d. Reload and read back the preserved records.
        page.reload()
        wait_ready(page, READY_TIMEOUT_MS)
        snap = snapshot(page)
        has_event = any(e.get("eventId") == "EV_PHASE1_1" for e in snap["events"])
        outbox_row = next((o for o in snap["outbox"] if o.get("eventId") == "EV_PHASE1_1"), None)
        # Phase 3: outbox rows are removed only after server acknowledgement
        outbox_state = outbox_row.get("state") if outbox_row else "removed"
        cursor = cursor_for(snap, "learner-a")
        cursor_item = cursor.get("currentItemId") if cursor else None
        reload_ok = has_event and outbox_state in ("pending", "removed") and cursor_item == "E03"

        # e. Clear the HTTP cache, go offline, and open a new page on the app.
        cdp = context.new_cdp_session(page)
        cdp.send("Network.clearBrowserCache")
        context.set_offline(True)
        offline_page = context.new_page()
        offline_page.goto(f"{BASE_URL}/")
        wait_ready(offline_page, OFFLINE_READY_TIMEOUT_MS)
        offline_snap = snapshot(offline_page)
        offline_cursor = cursor_for(offline_snap, "learner-a")
        offline_item = offline_cursor.get("currentItemId") if offline_cursor else None
        offline_events = len(events_for(offline_snap, "learner-a"))
        offline_ok = offline_item == "E03" and offline_events == 1

        report(
            name,
            reload_ok and offline_ok,
            f"reload: event={has_event}, outbox={outbox_state}, cursor={cursor_item}; "
            f"offline: cursor={offline_item}, events={offline_events}",
        )
    finally:
        context.close()


def check_failed_update_keeps_active_release(p):
    name = "failed_update_keeps_active_release"
    user_dir = tempfile.mkdtemp(prefix="tutor-upgrade-")
    context = p.chromium.launch_persistent_context(user_dir, headless=True)
    try:
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(f"{BASE_URL}/")
        wait_ready(page, READY_TIMEOUT_MS)

        # Stand-in for a failed staged update: a partial staging cache only.
        page.evaluate(CACHE_FIXTURE_JS, {"name": STAGING_CACHE, "urls": ["/static/app.v1.js"]})

        page.reload()
        wait_ready(page, READY_TIMEOUT_MS)
        keys = page.evaluate("() => caches.keys()")
        active_present = ACTIVE_RELEASE_CACHE in keys
        report(
            name,
            active_present,
            f"{SIMULATED_PREFIX}; {ACTIVE_RELEASE_CACHE} present={active_present}, "
            f"cache keys={sorted(keys)}",
        )
    finally:
        context.close()


def main():
    print(f"UPGRADE SOURCE: {UPGRADE_SOURCE}", flush=True)
    with sync_playwright() as p:
        run_guarded("upgrade_preserves_records_offline", check_upgrade_preserves_records_offline, p)
        run_guarded(
            "failed_update_keeps_active_release",
            check_failed_update_keeps_active_release,
            p,
            detail_prefix=f"{SIMULATED_PREFIX}; ",
        )
    skip("successful_activation", "no second worker release exists in this repository")
    skip(
        "full_release_upgrade_from_phase1",
        "no actual Phase 1 release artefact exists in this repository; "
        "the seeded fixture is not the real release",
    )

    for name in CHECKS:
        if name not in results:
            report(name, False, "check did not run (see error above)")

    passed = sum(1 for name in CHECKS if results.get(name) is True)
    skipped = sum(1 for name in CHECKS if results.get(name) == "skipped")
    failed = [name for name in CHECKS if results.get(name) is False]
    print(f"SUMMARY {passed}/{len(CHECKS)} passed ({skipped} skipped)", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
