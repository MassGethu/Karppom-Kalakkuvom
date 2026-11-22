"""Phase 1 slice tests: views, service worker, manifest, content pack and profile fixture.

Uses only Django's test client and local file reads. No network access.
"""

import json
import re
import os
from pathlib import Path

import pytest
from django.test import Client, override_settings

ROOT = Path(__file__).resolve().parent.parent
PACK_PATH = ROOT / "tutor" / "content" / "pack-v1.json"
PACK_V2_PATH = ROOT / "tutor" / "content" / "pack-v2.json"
PROFILES_PATH = ROOT / "tutor" / "static" / "js" / "profiles.js"
REQUIRED_ITEM_KEYS = {"id", "concept", "familyId", "prompt", "feedback", "evidenceType", "answer"}


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def pack():
    return json.loads(PACK_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def pack_v2():
    return json.loads(PACK_V2_PATH.read_text(encoding="utf-8"))


def test_index_serves_tamil_shell_with_manifest_link(client):
    response = client.get("/")
    assert response.status_code == 200
    body = response.content.decode("utf-8")
    assert 'lang="ta"' in body
    assert "<h1>கற்றல் பயணம்</h1>" in body
    assert '<link rel="manifest" href="/manifest.webmanifest">' in body
    assert 'data-testid="status"' in body
    assert 'src="/static/app.v1.js"' in body


@override_settings(DEBUG=True)
def test_selftest_served_when_debug(client):
    response = client.get("/selftest/")
    assert response.status_code == 200


@override_settings(DEBUG=False)
def test_selftest_hidden_when_not_debug(client):
    assert client.get("/selftest/").status_code == 404


def test_manifest_served(client):
    response = client.get("/manifest.webmanifest")
    assert response.status_code == 200
    assert response["Content-Type"].startswith("application/manifest+json")
    data = json.loads(response.content)
    assert data["start_url"] == "/"
    assert data["scope"] == "/"
    assert data["lang"] == "ta"


def test_service_worker_served_at_root_scope(client):
    response = client.get("/sw.js")
    assert response.status_code == 200
    assert response["Content-Type"] == "application/javascript"
    assert response["Service-Worker-Allowed"] == "/"
    body = response.content.decode("utf-8")
    assert '"STATUS"' in body
    # The learner app imports profiles.js, so it must be in the cached shell.
    assert '"/static/js/profiles.js"' in body


def test_pack_endpoint_serves_json(client):
    response = client.get("/content/pack-v1.json")
    assert response.status_code == 200
    assert json.loads(response.content)["packVersion"] == "1"


def test_pack_has_ten_items_with_required_keys(pack):
    items = pack["items"]
    assert [item["id"] for item in items] == [f"E{n:02d}" for n in range(1, 11)]
    for item in items:
        assert REQUIRED_ITEM_KEYS <= item.keys(), item.get("id")
        assert item["prompt"].strip() and item["feedback"].strip()


def test_pack_choice_answers_are_declared_options(pack):
    for item in pack["items"]:
        if item["evidenceType"] == "choice":
            step_ids = {option["stepId"] for option in item["options"]}
            assert item["answer"] in step_ids, item["id"]


def test_pack_numeric_answer_keys_satisfy_their_equations(pack):
    items = {item["id"]: item for item in pack["items"]}
    checks = {
        "E02": lambda x: 3 * x + 8 == 26,
        "E03": lambda x: 2 * x - 5 == 9,
        "E04": lambda x: 2 * x + 6 == 0,
        "E08": lambda x: x + 9 == 4,
    }
    for item_id, holds in checks.items():
        assert holds(int(items[item_id]["answer"])), item_id
    assert int(items["E09"]["answer"]) == 3 * 6 + 8


def test_pack_has_balance_explanation_exhaustion_and_review_status(pack):
    e01 = next(item for item in pack["items"] if item["id"] == "E01")
    assert e01["balanceExplanation"].strip()
    assert pack["exhaustedText"].strip()
    assert pack["languageReview"] == "PENDING"
    assert pack["source"]["section"]


def test_profiles_fixture_has_three_distinct_aliases():
    source = PROFILES_PATH.read_text(encoding="utf-8")
    aliases = re.findall(r'alias:\s*"([^"]+)"', source)
    ids = re.findall(r'id:\s*"([^"]+)"', source)
    assert len(aliases) == 3
    assert len(set(aliases)) == 3
    assert len(set(ids)) == 3
    assert set(ids) == {"learner-a", "learner-b", "learner-c"}


def test_pack_worked_example_has_steps_and_solution(pack):
    example = pack["workedExample"]
    assert isinstance(example["stepsTa"], list) and example["stepsTa"]
    assert example["solution"] == "3"


def _option(pack, item_id, step_id):
    item = next(item for item in pack["items"] if item["id"] == item_id)
    return next(option for option in item["options"] if option["stepId"] == step_id)


def test_sub8_left_and_sub2_left_share_misconception(pack):
    assert _option(pack, "E01", "SUB8_LEFT")["misconception"] == "one_side_subtraction"
    assert _option(pack, "E05", "SUB2_LEFT")["misconception"] == "one_side_subtraction"


def test_sub2_both_has_no_misconception(pack):
    assert "misconception" not in _option(pack, "E05", "SUB2_BOTH")


def test_sw_release_is_v6():
    # Phase 4: release cache renamed from tutor-shell-v5 to tutor-shell-v6 (was v5 before).
    source = (ROOT / "tutor" / "static" / "sw.js").read_text(encoding="utf-8")
    assert re.search(r'RELEASE_CACHE\s*=\s*"tutor-shell-v6"', source)


def _shell_urls():
    source = (ROOT / "tutor" / "static" / "sw.js").read_text(encoding="utf-8")
    block = re.search(r"const SHELL_URLS = \[(.*?)\];", source, re.DOTALL).group(1)
    return re.findall(r'"([^"]+)"', block)


# Relative import/export specifiers: from "..." , from '...' , or bare import "...".
_RELATIVE_SPECIFIER = re.compile(r"""(?:\bfrom|\bimport)\s*["'](\.{1,2}/[^"']+)["']""")


def test_shell_lists_every_static_module_import():
    shell = set(_shell_urls())
    static_dir = ROOT / "tutor" / "static"
    modules = [static_dir / "app.v1.js", *sorted((static_dir / "js").glob("*.js"))]
    gaps = []
    for module in modules:
        base = "/static/" if module.parent == static_dir else "/static/js/"
        source = module.read_text(encoding="utf-8")
        for specifier in _RELATIVE_SPECIFIER.findall(source):
            resolved = os.path.normpath(os.path.join(base, specifier)).replace(os.sep, "/")
            if resolved not in shell:
                gaps.append(f"{module.relative_to(ROOT)} imports {specifier} -> {resolved}")
    assert not gaps, "SHELL_URLS in sw.js is missing module(s):\n" + "\n".join(gaps)


def test_shell_includes_sync_module():
    assert "/static/js/sync.js" in _shell_urls()


def test_sync_module_imports_resolve():
    # If sync.js has no relative imports, this loop finds nothing and the test passes vacuously.
    shell = set(_shell_urls())
    source = (ROOT / "tutor" / "static" / "js" / "sync.js").read_text(encoding="utf-8")
    unresolved = []
    for specifier in _RELATIVE_SPECIFIER.findall(source):
        resolved = os.path.normpath(os.path.join("/static/js/", specifier)).replace(os.sep, "/")
        if resolved not in shell:
            unresolved.append(f"{specifier} -> {resolved}")
    assert not unresolved, "sync.js imports not in SHELL_URLS:\n" + "\n".join(unresolved)


def test_shell_urls_exist_on_disk():
    static_dir = ROOT / "tutor" / "static"
    missing = []
    for url in _shell_urls():
        # "/", "/content/pack-v1.json", "/content/pack-v2.json" and "/manifest.webmanifest" are
        # served by Django views, not from tutor/static, so they are skipped here.
        if not url.startswith("/static/"):
            continue
        if not (static_dir / url[len("/static/"):]).is_file():
            missing.append(url)
    assert not missing, f"SHELL_URLS entries with no file under tutor/static: {missing}"


def test_index_has_shell_retry():
    template = (ROOT / "tutor" / "templates" / "tutor" / "index.html").read_text(encoding="utf-8")
    assert 'data-testid="shell-retry"' in template


def test_manifest_is_django_view(client):
    response = client.get("/manifest.webmanifest")
    assert response.status_code == 200
    assert "manifest" in response["Content-Type"]


# Phase 2: pack-v2 checks. Read-only; pack-v2 is the content the planner reads.

def _item_v2(pack_v2, item_id):
    return next(item for item in pack_v2["items"] if item["id"] == item_id)


def test_pack_v2_has_22_items_in_range(pack_v2):
    assert 18 <= len(pack_v2["items"]) <= 24
    assert len(pack_v2["items"]) == 22


def test_pack_v2_concept_prerequisites_exist(pack_v2):
    concept_ids = {concept["id"] for concept in pack_v2["concepts"]}
    for concept in pack_v2["concepts"]:
        for prerequisite in concept["prerequisites"]:
            assert prerequisite in concept_ids, concept["id"]


def test_pack_v2_items_have_family_and_evidence_kind(pack_v2):
    for item in pack_v2["items"]:
        assert item.get("family"), item["id"]
        assert item.get("evidenceKind"), item["id"]


def test_pack_v2_choice_answers_match_option_step_ids(pack_v2):
    for item in pack_v2["items"]:
        if item["evidenceType"] == "choice":
            step_ids = {option["stepId"] for option in item["options"]}
            assert item["answer"] in step_ids, item["id"]


def test_pack_v2_probe_and_repair_roles(pack_v2):
    assert _item_v2(pack_v2, "E05")["role"] == "probe"
    assert _item_v2(pack_v2, "E10")["role"] == "repair"


def test_pack_v2_recurrence_maps_one_side_subtraction_to_e10(pack_v2):
    assert pack_v2["recurrence"]["one_side_subtraction"]["repairItemId"] == "E10"


def test_pack_v2_e11_has_no_intervention(pack_v2):
    assert "interventionId" not in _item_v2(pack_v2, "E11")


def test_pack_v2_endpoint_serves_json(client):
    response = client.get("/content/pack-v2.json")
    assert response.status_code == 200
    assert json.loads(response.content)["packVersion"] == "2"

