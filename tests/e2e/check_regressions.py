#!/usr/bin/env python3
"""Phase 1 browser regressions. Run with the Playwright Python package and Chromium.

This script starts its own loopback Django WSGI server. The shell tests change
responses on that server to exercise real service-worker requests.
"""

import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from threading import Thread
from wsgiref.simple_server import WSGIRequestHandler, make_server

from django.core.wsgi import get_wsgi_application
from playwright.sync_api import Error, expect, sync_playwright

from check_flow import answer_choice, pick_profile, wait_ready, wait_saved

ROOT = Path(__file__).resolve().parents[2]
PACK_PATH = "/content/pack-v1.json"
LESSON_PATH = "/static/js/lesson.js"
PROFILE = "learner-a"
WORKER_STATUS = """type => new Promise((resolve, reject) => {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return reject(new Error('No controlling service worker'));
  const channel = new MessageChannel();
  const timer = setTimeout(() => reject(new Error('Worker reply timed out')), 5000);
  channel.port1.onmessage = ({data}) => {
    clearTimeout(timer);
    channel.port1.close();
    resolve(data);
  };
  worker.postMessage({type}, [channel.port2]);
})"""
SNAPSHOT = """async profileId => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tutor-v1');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const names = ['cursors', 'events', 'instances', 'outbox'];
  const transaction = db.transaction(names, 'readonly');
  const records = await Promise.all(names.map(name => new Promise((resolve, reject) => {
    const request = transaction.objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result.filter(row => row.profileId === profileId));
    request.onerror = () => reject(request.error);
  })));
  db.close();
  return Object.fromEntries(names.map((name, index) => [name, records[index]]));
}"""


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


@contextmanager
def local_app():
    sys.path.insert(0, str(ROOT))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django = get_wsgi_application()
    responses = {}

    def app(environ, start_response):
        override = responses.get(environ["PATH_INFO"])
        if override is None:
            return django(environ, start_response)
        status, content_type, body = override
        start_response(status, [("Content-Type", content_type), ("Cache-Control", "no-store")])
        return [body]

    with make_server("127.0.0.1", 0, app, handler_class=QuietHandler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", responses
        finally:
            server.shutdown()
            thread.join()


def resume(page, item_id):
    pick_profile(page, PROFILE)
    expect_item(page, item_id)


def expect_item(page, item_id):
    expect(page.get_by_test_id("item")).to_have_attribute("data-item-id", item_id)


def advance(page, item_id):
    wait_saved(page)
    next_button = page.get_by_test_id("next-item")
    next_button.click()
    expect(next_button).to_be_hidden()
    expect_item(page, item_id)


def warm(page, url):
    page.goto(url)
    wait_ready(page)


def recurrence(context, url, _responses):
    page = context.new_page()
    warm(page, url)
    context.set_offline(True)
    resume(page, "E01")
    answer_choice(page, "SUB8_LEFT")
    advance(page, "E05")
    page.close()

    page = context.new_page()
    page.goto(url)
    resume(page, "E05")
    answer_choice(page, "SUB2_LEFT")
    advance(page, "E10")
    answer_choice(page, "SUB4_BOTH")
    # Phase 2: planner returns E11 after a correct E10 repair (C0 fresh practice); was E03.
    advance(page, "E11")
    snapshot = page.evaluate(SNAPSHOT, PROFILE)
    assert len(snapshot["events"]) == len(snapshot["outbox"]) == 3


def repeated_untagged_probe(context, url, _responses):
    page = context.new_page()
    warm(page, url)
    context.set_offline(True)
    resume(page, "E01")
    answer_choice(page, "SUB8_LEFT")
    advance(page, "E05")
    for _ in range(2):
        answer_choice(page, "ADD2_BOTH")
        advance(page, "E05")


def stale_next(context, url, _responses):
    old = context.new_page()
    warm(old, url)
    context.set_offline(True)
    resume(old, "E01")
    answer_choice(old, "SUB8_BOTH")
    wait_saved(old)

    latest = context.new_page()
    latest.goto(url)
    # Phase 2: planner returns E11 after a correct E01 (C0 explanation practice); was E03.
    resume(latest, "E11")
    answer_choice(latest, "SUB2_RIGHT")
    # Phase 2: a correct E11 moves the learner to C1 fresh practice E08; was E02.
    advance(latest, "E08")
    before = latest.evaluate(SNAPSHOT, PROFILE)
    old.get_by_test_id("next-item").click()
    expect(old.get_by_test_id("intro")).to_be_visible()
    old.get_by_test_id("intro-start").click()
    # Phase 2: the stale tab resumes at the latest stored item E08; was E02.
    expect_item(old, "E08")
    assert latest.evaluate(SNAPSHOT, PROFILE) == before


def duplicate_taps(context, url, _responses):
    page = context.new_page()
    second = context.new_page()
    warm(page, url)
    context.set_offline(True)
    second.goto(url)
    resume(page, "E01")
    resume(second, "E01")
    assert len(page.evaluate(SNAPSHOT, PROFILE)["instances"]) == 1

    page.get_by_test_id("answer-option-SUB8_BOTH").evaluate("(button) => { button.click(); button.click(); }")
    wait_saved(page)
    second.get_by_test_id("answer-option-SUB8_BOTH").click()
    expect(second.get_by_test_id("intro")).to_be_visible()
    page.get_by_test_id("next-item").evaluate("(button) => { button.click(); button.click(); }")
    # Phase 2: planner returns E11 after a correct E01 (C0 explanation practice); was E03.
    expect_item(page, "E11")
    second.get_by_test_id("intro-start").click()
    expect_item(second, "E11")
    snapshot = page.evaluate(SNAPSHOT, PROFILE)
    assert len(snapshot["events"]) == len(snapshot["outbox"]) == 1, snapshot
    assert len(snapshot["instances"]) == 2, snapshot
    assert sum(row["status"] == "open" for row in snapshot["instances"]) == 1, snapshot


def cold_offline(context, url, _responses):
    context.set_offline(True)
    page = context.new_page()
    try:
        page.goto(url)
    except Error as error:
        assert "ERR_INTERNET_DISCONNECTED" in str(error), error
    else:
        raise AssertionError("A clean origin unexpectedly opened with networking disabled")

    context.set_offline(False)
    warm(page, url)
    resume(page, "E01")


def first_install_retry(context, url, responses):
    responses["/manifest.webmanifest"] = ("503 Service Unavailable", "text/plain", b"Unavailable")
    page = context.new_page()
    page.goto(url)
    version = page.evaluate("""async () => {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const worker = registration.installing || registration.active;
      if (!worker) throw new Error('No worker');
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Initial install did not settle')), 5000);
        const done = () => {
          if (['activated', 'redundant'].includes(worker.state)) {
            clearTimeout(timer);
            resolve(worker.state);
          }
        };
        worker.addEventListener('statechange', done);
        done();
      });
    }""")
    assert version == "redundant", version
    expect(page.get_by_test_id("readiness")).not_to_have_attribute("data-state", "ready")
    responses.clear()
    retry = page.get_by_test_id("shell-retry")
    if not retry.is_visible():
        page.reload()
        wait_ready(page)
        raise AssertionError("Reload recovered the initial install, but the in-app retry was hidden")
    retry.click()
    wait_ready(page)


def missing_module_and_repair(context, url, _responses):
    page = context.new_page()
    warm(page, url)
    cache = page.evaluate(WORKER_STATUS, "STATUS")["cacheVersion"]
    assert page.evaluate("async ([name, path]) => (await caches.open(name)).delete(path)", [cache, LESSON_PATH])
    context.set_offline(True)
    status = page.evaluate(WORKER_STATUS, "REPAIR")
    assert status["shellReady"] is False and LESSON_PATH in status["missing"], status
    assert status["lastRepair"]["ok"] is False, status
    context.set_offline(False)
    page.reload()
    expect(page.get_by_test_id("readiness")).to_have_attribute("data-state", "notReady")
    page.get_by_test_id("shell-retry").click()
    wait_ready(page)
    context.set_offline(True)
    page.reload()
    wait_ready(page)
    resume(page, "E01")


def malformed_pack(context, url, responses):
    page = context.new_page()
    warm(page, url)
    cache = page.evaluate(WORKER_STATUS, "STATUS")["cacheVersion"]
    malformed = json.dumps({"packVersion": "1", "items": []})
    page.evaluate(
        "async ([name, path, body]) => (await caches.open(name)).put(path, new Response(body))",
        [cache, PACK_PATH, malformed],
    )
    responses[PACK_PATH] = ("200 OK", "application/json", malformed.encode())
    status = page.evaluate(WORKER_STATUS, "REPAIR")
    assert not status["shellReady"] and PACK_PATH in status["missing"], status
    assert status["lastRepair"]["ok"] is False, status
    responses.clear()
    status = page.evaluate(WORKER_STATUS, "REPAIR")
    assert status["shellReady"] and PACK_PATH in status["lastRepair"]["repaired"], status


def incomplete_choice_pack(context, url, responses):
    page = context.new_page()
    warm(page, url)
    cache = page.evaluate(WORKER_STATUS, "STATUS")["cacheVersion"]
    pack = json.loads((ROOT / "tutor/content/pack-v1.json").read_text(encoding="utf-8"))
    diagnostic = next(item for item in pack["items"] if item["id"] == "E01")
    del diagnostic["options"]
    malformed = json.dumps(pack)
    page.evaluate(
        "async ([name, path, body]) => (await caches.open(name)).put(path, new Response(body))",
        [cache, PACK_PATH, malformed],
    )
    responses[PACK_PATH] = ("200 OK", "application/json", malformed.encode())
    status = page.evaluate(WORKER_STATUS, "REPAIR")
    if status["shellReady"]:
        context.set_offline(True)
        page.reload()
        page.get_by_test_id("profile-learner-a").click()
        page.get_by_test_id("intro-start").click()
        example = page.get_by_test_id("example-continue")
        example.click()
        expect(page.get_by_test_id("item")).to_have_count(0)
        raise AssertionError(f"Worker reported ready, but the diagnostic could not render: {status}")
    assert PACK_PATH in status["missing"] and status["lastRepair"]["ok"] is False, status


def interrupted_update(context, url, responses):
    page = context.new_page()
    warm(page, url)
    resume(page, "E01")
    answer_choice(page, "SUB8_LEFT")
    advance(page, "E05")
    active = page.evaluate(WORKER_STATUS, "STATUS")["cacheVersion"]
    future = f"{active}-regression-next"
    worker = (ROOT / "tutor/static/sw.js").read_text()
    assert active in worker
    responses["/sw.js"] = ("200 OK", "application/javascript", worker.replace(active, future, 1).encode())
    responses[LESSON_PATH] = ("503 Service Unavailable", "text/plain", b"Interrupted")
    outcome = page.evaluate("""async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const watch = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Update did not settle')), 5000);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          const done = () => {
            if (['installed', 'redundant'].includes(worker.state)) {
              clearTimeout(timer);
              resolve(worker.state);
            }
          };
          worker.addEventListener('statechange', done);
          done();
        }, {once:true});
      });
      await registration.update();
      return await watch;
    }""")
    assert outcome == "redundant", outcome
    assert not page.evaluate("name => caches.has(name)", future)
    context.set_offline(True)
    page.reload()
    wait_ready(page)
    assert page.evaluate(WORKER_STATUS, "STATUS")["cacheVersion"] == active
    resume(page, "E05")


def phase1_data_compatibility(context, url, _responses):
    page = context.new_page()
    page.goto(f"{url}/manifest.webmanifest")
    # These unchanged writers are the same functions used to create real
    # records in Phase 1. Seed them before the corrected app opens this origin.
    page.evaluate("""async profileId => {
      const storage = await import('/static/js/storage.js');
      const db = await storage.openDb();
      await storage.ensureProfile(db, profileId, 'மாதிரி');
      await storage.openInstance(db, {profileId, itemId:'E01', instanceId:'phase1-instance'});
      await storage.commitAnswer(db, {
        profileId, instanceId:'phase1-instance', eventId:'phase1-event',
        packVersion:'1', policyVersion:'1', stepId:'SUB8_LEFT', correct:false,
        reasonCode:'explain', nextItemId:'E05',
      });
      db.close();
    }""", PROFILE)
    before = page.evaluate(SNAPSHOT, PROFILE)
    assert "misconception" not in before["events"][0]
    warm(page, url)
    context.set_offline(True)
    resume(page, "E05")
    answer_choice(page, "SUB2_LEFT")
    advance(page, "E10")
    after = page.evaluate(SNAPSHOT, PROFILE)
    assert before["events"][0] in after["events"]
    assert before["outbox"][0] in after["outbox"]
    assert len(after["events"]) == len(after["outbox"]) == 2


CHECKS = (
    recurrence, repeated_untagged_probe, stale_next, duplicate_taps, cold_offline,
    first_install_retry, missing_module_and_repair, malformed_pack,
    incomplete_choice_pack, interrupted_update, phase1_data_compatibility,
)


def main():
    failures = 0
    with local_app() as (url, responses), sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for check in CHECKS:
            with browser.new_context(viewport={"width": 360, "height": 740}) as context:
                context.set_default_timeout(7000)
                try:
                    check(context, url, responses)
                    print(f"PASS {check.__name__}", flush=True)
                except (AssertionError, Error) as error:
                    failures += 1
                    print(f"FAIL {check.__name__}: {error}", flush=True)
                finally:
                    responses.clear()
    print(f"SUMMARY {len(CHECKS) - failures}/{len(CHECKS)} passed", flush=True)
    return bool(failures)


if __name__ == "__main__":
    sys.exit(main())
