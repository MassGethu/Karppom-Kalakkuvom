"""Doubt-flow end-to-end checks for the Tamil tutor screen.

Run against a live server: BASE_URL (default http://127.0.0.1:8000).
Detail strings never include typed doubt text or base64 content.
"""
import os
import struct
import sys
import tempfile
import zlib

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000")
DOUBT_TEXT = "இது ஏன்?"
results = []


def report(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    results.append((name, status))
    print(f"{status} {name} {detail}".rstrip())


def skip(name, reason):
    results.append((name, "SKIPPED"))
    print(f"SKIPPED {name} reason={reason}")


def make_png(path, width=200, height=60):
    """Write a solid-colour RGB PNG using only zlib and struct."""
    raw = b"".join(b"\x00" + b"\x40\x80\xc0" * width for _ in range(height))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def open_practice(page):
    page.goto(BASE_URL)
    page.click("[data-testid=profile-learner-a]")
    page.click("[data-testid=intro-start]")
    if page.is_visible("[data-testid=example-continue]"):
        page.click("[data-testid=example-continue]")
    page.wait_for_selector("[data-testid=answer-option-SUB8_BOTH]")


def answer_e01(page):
    page.click("[data-testid=answer-option-SUB8_BOTH]")
    page.click("[data-testid=answer-submit]")
    page.wait_for_selector("[data-testid=next-item]")


def open_panel(page):
    answer_e01(page)
    page.click("[data-testid=ask-doubt]")
    page.wait_for_selector("[data-testid=doubt-text]")


def text_of(page, sel):
    return (page.inner_text(sel) or "").strip() if page.is_visible(sel) else ""


def check_typed_doubt(page):
    name = "typed_doubt"
    open_practice(page)
    open_panel(page)
    page.fill("[data-testid=doubt-text]", DOUBT_TEXT)
    page.click("[data-testid=doubt-send]")
    page.wait_for_function(
        "() => { const e = document.querySelector('[data-testid=doubt-hint]');"
        " return e && e.textContent.trim().length > 0; }",
        timeout=30000,
    )
    source = page.get_attribute("[data-testid=doubt-source]", "data-source") or ""
    hint = text_of(page, "[data-testid=doubt-hint]")
    error = text_of(page, "[data-testid=doubt-error]")
    ok = source in ("provider", "fallback") and bool(hint or error)
    report(name, ok, f"data-source={source!r} hint_len={len(hint)} error_len={len(error)}")


def check_photo(page):
    name = "photo_send_uses_corrected_text"
    open_practice(page)
    open_panel(page)
    transcribe_calls = []
    page.on("request", lambda r: transcribe_calls.append(r.url) if "/api/doubt/transcribe" in r.url else None)
    tmp = os.path.join(tempfile.mkdtemp(), "equation.png")
    make_png(tmp)
    page.set_input_files("[data-testid=doubt-photo]", tmp)
    if transcribe_calls:
        report(name, False, "transcribe requested before explicit tap")
        return
    page.click("[data-testid=doubt-transcribe]")
    page.wait_for_function(
        "() => { const e = document.querySelector('[data-testid=doubt-equation-edit]');"
        " const err = document.querySelector('[data-testid=doubt-error]');"
        " return (e && e.value && e.value.length > 0) || (err && !err.hidden && err.offsetParent !== null); }",
        timeout=20000,
    )
    if not page.is_visible("[data-testid=doubt-equation-edit]"):
        report(name, False, "no equation field after transcribe")
        return
    page.fill("[data-testid=doubt-equation-edit]", "2x + 5 = 11")
    with page.expect_request(lambda r: r.url.endswith("/api/doubt/tutor") and r.method == "POST") as info:
        page.click("[data-testid=doubt-send]")
    body = info.value.post_data_json or {}
    ok = body.get("equation") == "2x + 5 = 11"
    report(name, ok, f"transcribe_requests={len(transcribe_calls)} equation_len={len(str(body.get('equation', '')))}")


def check_close(page):
    name = "close_keeps_activity"
    open_practice(page)
    open_panel(page)
    page.click("[data-testid=doubt-close]")
    item = page.get_attribute("[data-item-id]", "data-item-id") or ""
    hidden = not page.is_visible("[data-testid=doubt-text]")
    report(name, item == "E01" and hidden, f"item={item!r} panel_hidden={hidden}")


def check_offline(page):
    name = "offline_fallback_keeps_practice"
    open_practice(page)
    page.context.set_offline(True)
    try:
        page.click("[data-testid=answer-option-SUB8_BOTH]")
        page.click("[data-testid=answer-submit]")
        page.wait_for_selector("[data-testid=next-item]", timeout=10000)
        page.click("[data-testid=next-item]")
        page.wait_for_selector("[data-testid=ask-doubt]", timeout=10000)
        disabled = page.is_disabled("[data-testid=ask-doubt]")
        if not disabled:
            page.click("[data-testid=ask-doubt]")
            disabled = page.is_visible("[data-testid=doubt-error]")
    finally:
        page.context.set_offline(False)
    report(name, disabled, "doubt disabled or error shown while offline")


def check_request_failure(page):
    name = "request_failure_fallback"
    open_practice(page)
    open_panel(page)
    page.route("**/api/doubt/**", lambda r: r.abort())
    try:
        page.fill("[data-testid=doubt-text]", DOUBT_TEXT)
        page.click("[data-testid=doubt-send]")
        page.wait_for_selector("[data-testid=doubt-error]", state="visible", timeout=15000)
        error = text_of(page, "[data-testid=doubt-error]")
        hint = text_of(page, "[data-testid=doubt-hint]")
        ok = bool(error) and not hint
        report(name, ok, f"error_len={len(error)} hint_len={len(hint)}")
    finally:
        page.unroute("**/api/doubt/**")


def check_no_image_storage(page):
    name = "no_image_storage"
    data = page.evaluate(
        """async () => {
            const ls = Object.keys(localStorage);
            const lsVals = ls.map(k => localStorage.getItem(k) || '');
            const dbs = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : [];
            const caches_ = self.caches ? await caches.keys() : [];
            return { ls: ls.length, lsImg: lsVals.filter(v => v.includes('data:image')).length,
                     dbs: dbs.length, caches: caches_.length };
        }"""
    )
    ok = data["lsImg"] == 0
    report(name, ok, f"localStorage_keys={data['ls']} indexedDB_dbs={data['dbs']} cache_keys={data['caches']}")


def check_live_provider(page):
    name = "live_provider"
    if os.environ.get("LIVE_PROVIDER") != "1":
        skip(name, "no live provider key in this run")
        return
    open_practice(page)
    open_panel(page)
    page.fill("[data-testid=doubt-text]", DOUBT_TEXT)
    page.click("[data-testid=doubt-send]")
    page.wait_for_function(
        "() => { const e = document.querySelector('[data-testid=doubt-hint]');"
        " return e && e.textContent.trim().length > 0; }",
        timeout=30000,
    )
    source = page.get_attribute("[data-testid=doubt-source]", "data-source") or ""
    report(name, source == "provider", f"data-source={source!r}")


def main():
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=True)
        page = context.new_page()
        checks = [check_typed_doubt, check_photo, check_close, check_offline,
                  check_request_failure, check_no_image_storage, check_live_provider]
        for fn in checks:
            try:
                fn(page)
            except Exception as exc:  # report and continue so every check runs
                report(fn.__name__, False, f"exception={type(exc).__name__}")
                page.close()
                page = context.new_page()
        context.close()

    failed = [n for n, s in results if s == "FAIL"]
    passed = [n for n, s in results if s == "PASS"]
    skipped = [n for n, s in results if s == "SKIPPED"]
    print(f"SUMMARY pass={len(passed)} fail={len(failed)} skipped={len(skipped)}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
