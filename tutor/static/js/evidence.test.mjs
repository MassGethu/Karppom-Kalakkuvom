import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STATUS,
  classifyEvent,
  conceptStatusFor,
  demonstratedConcepts,
  isEligibleKind,
  prerequisitesMet,
  projectProfile,
} from "./evidence.js";

const packV1 = JSON.parse(readFileSync(new URL("../../content/pack-v1.json", import.meta.url), "utf8"));
const packV2 = JSON.parse(readFileSync(new URL("../../content/pack-v2.json", import.meta.url), "utf8"));
const packs = { "1": packV1, "2": packV2 };

// Synthetic committed-attempt event with the field names storage.js commitAnswer writes.
// Numeric items have no option, so pass stepId null for them.
function ev(sequence, itemId, stepId, correct, extra = {}) {
  return {
    profileId: "A",
    sequence,
    packVersion: "2",
    itemId,
    stepId,
    correct,
    assistance: "none",
    reasonCode: null,
    createdAt: null,
    ...extra,
  };
}

function statusOf(events, conceptId) {
  return projectProfile(packs, events).concepts[conceptId].status;
}

test("empty history leaves every concept UNASSESSED", () => {
  const { concepts } = projectProfile(packs, []);
  assert.deepEqual(Object.keys(concepts), ["C0", "C1", "C2", "C3", "C4"]);
  for (const id of Object.keys(concepts)) {
    assert.equal(concepts[id].status, STATUS.UNASSESSED);
  }
});

test("two correct independent answers on different families with one eligible demonstrate", () => {
  // E05 is practice (eq_balance_sub); E11 is explanation (eq_balance_mirror).
  const events = [ev(1, "E05", "SUB2_BOTH", true), ev(2, "E11", "SUB2_RIGHT", true)];
  assert.equal(statusOf(events, "C0"), STATUS.DEMONSTRATED);
});

test("two correct independent answers on different families with neither eligible stay DEVELOPING", () => {
  // E08 (undo_add_sub) and E21 (undo_sub) are both practice items.
  const events = [ev(1, "E08", null, true), ev(2, "E21", null, true)];
  assert.equal(statusOf(events, "C1"), STATUS.DEVELOPING);
});

test("the same item answered correctly twice stays DEVELOPING", () => {
  const events = [ev(1, "E05", "SUB2_BOTH", true), ev(2, "E05", "SUB2_BOTH", true)];
  assert.equal(statusOf(events, "C0"), STATUS.DEVELOPING);
});

test("two correct answers on the same family with different items stay DEVELOPING", () => {
  // E05 and E06 both use family eq_balance_sub.
  const events = [ev(1, "E05", "SUB2_BOTH", true), ev(2, "E06", "SUB2_BOTH", true)];
  assert.equal(statusOf(events, "C0"), STATUS.DEVELOPING);
});

test("an assisted correct answer after two independent correct answers does not demote", () => {
  const events = [
    ev(1, "E05", "SUB2_BOTH", true),
    ev(2, "E11", "SUB2_RIGHT", true),
    ev(3, "E01", "SUB8_BOTH", true, { assistance: "hint" }),
  ];
  const state = projectProfile(packs, events).concepts.C0;
  assert.equal(state.status, STATUS.DEMONSTRATED);
  assert.equal(state.assisted, 1);
});

test("an assisted correct answer alone does not demonstrate", () => {
  const events = [
    ev(1, "E05", "SUB2_BOTH", true, { assistance: "answer_shown" }),
    ev(2, "E11", "SUB2_RIGHT", true, { assistance: "hint" }),
  ];
  assert.equal(statusOf(events, "C0"), STATUS.DEVELOPING);
});

test("an assisted attempt followed by an independent correct on a different family does not complete a streak", () => {
  const events = [
    ev(1, "E05", "SUB2_BOTH", true, { assistance: "answer_shown" }),
    ev(2, "E11", "SUB2_RIGHT", true),
  ];
  assert.equal(statusOf(events, "C0"), STATUS.DEVELOPING);
});

test("a tagged independent incorrect answer between two correct answers breaks the streak", () => {
  // E01 option SUB8_LEFT carries misconception one_side_subtraction.
  const events = [
    ev(1, "E05", "SUB2_BOTH", true),
    ev(2, "E01", "SUB8_LEFT", false),
    ev(3, "E11", "SUB2_RIGHT", true),
  ];
  assert.equal(statusOf(events, "C0"), STATUS.DEVELOPING);
});

test("after DEMONSTRATED, an untagged incorrect answer gives REVIEW_DUE and a later streak restores DEMONSTRATED", () => {
  // E10 option ADD4_BOTH has no misconception, so it is untagged.
  const demonstrated = [ev(1, "E05", "SUB2_BOTH", true), ev(2, "E11", "SUB2_RIGHT", true)];
  assert.equal(statusOf(demonstrated, "C0"), STATUS.DEMONSTRATED);

  const afterMiss = [...demonstrated, ev(3, "E10", "ADD4_BOTH", false)];
  assert.equal(statusOf(afterMiss, "C0"), STATUS.REVIEW_DUE);

  const afterOneCorrect = [...afterMiss, ev(4, "E06", "SUB2_BOTH", true)];
  assert.equal(statusOf(afterOneCorrect, "C0"), STATUS.DEVELOPING);

  const restored = [...afterOneCorrect, ev(5, "E11", "SUB2_RIGHT", true)];
  assert.equal(statusOf(restored, "C0"), STATUS.DEMONSTRATED);
});

test("after DEMONSTRATED, a tagged incorrect answer resets to DEVELOPING", () => {
  const events = [
    ev(1, "E05", "SUB2_BOTH", true),
    ev(2, "E11", "SUB2_RIGHT", true),
    ev(3, "E01", "SUB8_LEFT", false),
  ];
  assert.equal(statusOf(events, "C0"), STATUS.DEVELOPING);
});

test("version-1 events only leave concepts DEVELOPING, never DEMONSTRATED, and count as legacy", () => {
  const events = [
    ev(1, "E01", "SUB8_BOTH", true, { packVersion: "1" }),
    ev(2, "E05", "SUB2_BOTH", true, { packVersion: "1" }),
    ev(3, "E11", "SUB2_RIGHT", true, { packVersion: "1" }),
  ];
  const { concepts } = projectProfile(packs, events);
  assert.equal(concepts.C0.status, STATUS.DEVELOPING);
  assert.equal(concepts.C0.legacy, 3);
  assert.equal(concepts.C0.independentCorrect, 0);
  assert.deepEqual(demonstratedConcepts(packs, events), []);
});

test("an event for an unknown itemId is ignored and does not throw", () => {
  const unknown = ev(1, "E99", null, true);
  assert.equal(classifyEvent(unknown, packs).kind, "unknown");
  const { concepts } = projectProfile(packs, [unknown]);
  for (const id of Object.keys(concepts)) {
    assert.equal(concepts[id].status, STATUS.UNASSESSED);
  }
});

test("prerequisitesMet: C3 needs C1 and C2 demonstrated, and C0 has no prerequisites", () => {
  // C1: E08 (practice) then E13 (explanation, different family) demonstrates.
  // C2: E07 (practice) then E15 (explanation, different family) demonstrates.
  const events = [
    ev(1, "E08", null, true),
    ev(2, "E13", "ADD7_BOTH", true),
    ev(3, "E07", "INV_DIV4", true),
    ev(4, "E15", "DIV2_BOTH", true),
  ];
  const onlyC1 = projectProfile(packs, events.slice(0, 2)).concepts;
  const both = projectProfile(packs, events).concepts;

  assert.equal(prerequisitesMet(packV2, "C0", {}), true);
  assert.equal(prerequisitesMet(packV2, "C3", onlyC1), false);
  assert.equal(prerequisitesMet(packV2, "C3", both), true);
});

test("three synthetic profiles stay separate when projected from separate arrays", () => {
  const profileA = [ev(1, "E05", "SUB2_BOTH", true, { profileId: "A" }), ev(2, "E11", "SUB2_RIGHT", true, { profileId: "A" })];
  const profileB = [ev(1, "E08", null, true, { profileId: "B" }), ev(2, "E13", "ADD7_BOTH", true, { profileId: "B" })];
  const profileC = [ev(1, "E01", "SUB8_LEFT", false, { profileId: "C" })];

  const aBefore = projectProfile(packs, profileA);
  projectProfile(packs, profileB);
  projectProfile(packs, profileC);
  const aAfter = projectProfile(packs, profileA);

  assert.deepEqual(aAfter, aBefore);
  assert.equal(conceptStatusFor(packs, profileA, "C0"), STATUS.DEMONSTRATED);
  assert.equal(conceptStatusFor(packs, profileA, "C1"), STATUS.UNASSESSED);
  assert.equal(conceptStatusFor(packs, profileB, "C1"), STATUS.DEMONSTRATED);
  assert.equal(conceptStatusFor(packs, profileC, "C0"), STATUS.DEVELOPING);
});

test("classifyEvent labels assisted, legacy and tagged choices", () => {
  const assisted = classifyEvent(ev(1, "E05", "SUB2_BOTH", true, { assistance: "hint" }), packs);
  assert.equal(assisted.kind, "assisted");
  assert.equal(assisted.conceptId, "C0");
  assert.equal(assisted.family, "eq_balance_sub");

  const legacy = classifyEvent(ev(2, "E05", "SUB2_BOTH", true, { packVersion: "1" }), packs);
  assert.equal(legacy.kind, "legacy");

  const tagged = classifyEvent(ev(3, "E01", "SUB8_LEFT", false), packs);
  assert.equal(tagged.kind, "independent");
  assert.equal(tagged.tagged, true);
  assert.equal(tagged.evidenceKind, "diagnostic");
});

test("isEligibleKind accepts transfer, explanation and check only", () => {
  for (const kind of ["transfer", "explanation", "check"]) {
    assert.equal(isEligibleKind(kind), true);
  }
  for (const kind of ["diagnostic", "practice", undefined, null]) {
    assert.equal(isEligibleKind(kind), false);
  }
});

test("lastObservedAt comes from createdAt and is null when no timestamp is present", () => {
  const stamped = [ev(1, "E05", "SUB2_BOTH", true, { createdAt: "2025-01-01T00:00:00.000Z" })];
  assert.equal(projectProfile(packs, stamped).concepts.C0.lastObservedAt, "2025-01-01T00:00:00.000Z");

  const unstamped = [ev(1, "E05", "SUB2_BOTH", true)];
  assert.equal(projectProfile(packs, unstamped).concepts.C0.lastObservedAt, null);
});
