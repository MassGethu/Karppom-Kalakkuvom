#!/usr/bin/env python3
"""Cold offline boot check for the Tamil tutor slice (Playwright sync API).

Warms the app online, clears Chromium's HTTP cache (Cache Storage is kept),
goes offline and opens a new page in the same context. Then checks that the
release shell boots, learners resume, the adult summary works, and no shell
asset fails and no /api/ request is made.

Setup (optional, not part of pytest):
    pip install playwright
    python -m playwright install chromium

Start the app first:
    python manage.py runserver

Run:
    BASE_URL=http://127.0.0.1:8000 python tests/e2e/check_cold_offline.py

Prints one PASS/FAIL line per check and exits non-zero if any check fails.
Selectors use data-testid attributes from tutor/templates/tutor/index.html and
tutor/static/app.v1.js. Nothing here calls an external host.
"""

import os
import sys
import tempfile
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from check_flow import (  # noqa: E402
    BASE_URL,
    TIMEOUT_MS,
    answer_choice,
    current_item_id,
    next_item_after,
    pick_profile,
    read_idb,
    switch_profile,
    wait_ready,
    wait_saved,
)

OFFLINE_READY_MS = 30000
SHELL_CACHE = "tutor-shell-v6"
ALIAS_TA = {
    "learner-a": "மாணவர் அ",
    "learner-b": "மாணவர் ஆ",
    "learner-c": "மாணவர் இ",
}
CHECKS = [
    "cold_offline_boot",
    "adult_summary_back_offline",
    "three_histories_separate_offline",
    "no_network_after_ready",
]
results = {}


def report(name, ok, detail=""):
    results[name] = bool(ok)
    print(f"{'PASS' if ok else 'FAIL'} {name}" + (f" - {detail}" if detail else ""), flush=True)


def wait_item(page):
    page.wait_for_selector('[data-testid="item"]', state="visible", timeout=TIMEOUT_MS)


def check_summary(page, alias):
    """Open the adult summary on the current profile and check it shows only that alias."""
    page.click('[data-testid="adult-summary-open"]')
    summary = page.wait_for_selector('[data-testid="adult-summary"]', state="visible", timeout=TIMEOUT_MS)
    profile_id = summary.get_attribute("data-profile-id")
    text = summary.text_content() or ""
    own_shown = ALIAS_TA[alias] in text
    other_shown = any(ta in text for other, ta in ALIAS_TA.items() if other != alias)
    ok = profile_id == alias and own_shown and not other_shown
    return ok, f"profile={profile_id}, own alias shown={own_shown}, other alias shown={other_shown}"


def stage_cold_offline_boot(context, state):
    page = context.pages[0] if context.pages else context.new_page()
    page.goto(f"{BASE_URL}/")
    wait_ready(page)

    # learner-a: E01 correct (SUB8_BOTH) -> E11, then E11 correct (SUB2_RIGHT).
    pick_profile(page, "learner-a")
    start_a = current_item_id(page)
    answer_choice(page, "SUB8_BOTH")
    wait_saved(page)
    page.click('[data-testid="next-item"]')
    item_a = next_item_after(page, start_a)
    if item_a != "E11":
        raise RuntimeError(f"learner-a expected E11 after E01, got {item_a}")
    answer_choice(page, "SUB2_RIGHT")
    wait_saved(page)

    # learner-b: wrong on one side (SUB8_LEFT) -> probe E05.
    switch_profile(page)
    pick_profile(page, "learner-b")
    start_b = current_item_id(page)
    answer_choice(page, "SUB8_LEFT")
    wait_saved(page)
    page.click('[data-testid="next-item"]')
    item_b = next_item_after(page, start_b)
    if item_b != "E05":
        raise RuntimeError(f"learner-b expected E05 after SUB8_LEFT, got {item_b}")

    # Event counts before going offline, to compare after the offline phase.
    state["pre_counts"] = {alias: read_idb(page, alias)["events"] for alias in ALIAS_TA}

    # Clear Chromium's HTTP cache only; the service worker's Cache Storage must survive.
    cdp = context.new_cdp_session(page)
    cdp.send("Network.clearBrowserCache")
    cache_keys = page.evaluate("caches.keys()")
    cache_present = SHELL_CACHE in cache_keys

    # Record every request and failed request from here on.
    state["requests"] = []
    state["failed"] = []
    context.on("request", lambda request: state["requests"].append(request.url))
    context.on("requestfailed", lambda request: state["failed"].append(request.url))

    context.set_offline(True)
    offline_page = context.new_page()
    offline_page.goto(f"{BASE_URL}/")
    state["page"] = offline_page
    try:
        offline_page.wait_for_selector(
            '[data-testid="readiness"][data-state="ready"]', timeout=OFFLINE_READY_MS
        )
        ready = True
    except Exception:  # noqa: BLE001 - a timeout here is a FAIL, not a crash
        ready = False
    report("cold_offline_boot", ready, f"ready={ready}, {SHELL_CACHE} in caches={cache_present}")


def stage_adult_summary_back(state):
    page = state["page"]
    pick_profile(page, "learner-a")
    resumed_id = current_item_id(page)
    events_before = read_idb(page, "learner-a")["events"]
    ok, detail = check_summary(page, "learner-a")
    page.click('[data-testid="adult-back"]')
    wait_item(page)
    back_id = current_item_id(page)
    events_after = read_idb(page, "learner-a")["events"]
    ok = ok and back_id == resumed_id and events_after == events_before
    report(
        "adult_summary_back_offline",
        ok,
        f"{detail}, item {resumed_id} -> {back_id}, events {events_before} -> {events_after}",
    )


def stage_three_histories(state):
    page = state["page"]
    switch_profile(page)
    all_ok = True
    details = []
    for alias in ALIAS_TA:
        pick_profile(page, alias)
        ok, detail = check_summary(page, alias)
        page.click('[data-testid="adult-back"]')
        wait_item(page)
        switch_profile(page)
        all_ok = all_ok and ok
        details.append(f"{alias}: {detail}")

    counts = {alias: read_idb(page, alias)["events"] for alias in ALIAS_TA}
    pre = state["pre_counts"]
    counts_ok = (
        counts["learner-a"] == pre["learner-a"]
        and counts["learner-b"] == pre["learner-b"]
        and counts["learner-c"] == 0
    )
    report(
        "three_histories_separate_offline",
        all_ok and counts_ok,
        f"counts={counts}, before offline={pre}; " + "; ".join(details),
    )


def is_shell_path(path):
    return path.startswith("/static/") or path.startswith("/content/") or path == "/manifest.webmanifest"


def stage_no_network(state):
    api_hits = [url for url in state["requests"] if "/api/" in url]
    failed_shell = [url for url in state["failed"] if is_shell_path(urlparse(url).path)]
    ok = not api_hits and not failed_shell
    report(
        "no_network_after_ready",
        ok,
        f"requests={len(state['requests'])}, /api/ requests={len(api_hits)}, "
        f"failed shell assets={len(failed_shell)}",
    )


def run_stage(name, fn, *args):
    try:
        fn(*args)
    except Exception as error:  # noqa: BLE001 - report the stage and keep going
        report(name, False, f"{type(error).__name__}: {error}")


def main():
    with sync_playwright() as p:
        user_dir = tempfile.mkdtemp(prefix="cold-offline-")
        context = p.chromium.launch_persistent_context(user_dir, headless=True)
        state = {}
        try:
            run_stage("cold_offline_boot", stage_cold_offline_boot, context, state)
            run_stage("adult_summary_back_offline", stage_adult_summary_back, state)
            run_stage("three_histories_separate_offline", stage_three_histories, state)
            run_stage("no_network_after_ready", stage_no_network, state)
        finally:
            context.close()

    for name in CHECKS:
        if name not in results:
            report(name, False, "check did not run (see stage error above)")

    failed = [name for name in CHECKS if not results.get(name)]
    print(f"SUMMARY {len(CHECKS) - len(failed)}/{len(CHECKS)} passed", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
