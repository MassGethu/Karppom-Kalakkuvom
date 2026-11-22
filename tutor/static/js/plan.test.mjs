// Node tests for plan.js. Run with: node --test tutor/static/js/plan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAX_REMEDIATIONS_PER_CONCEPT,
  PLAN_POLICY_VERSION,
  REASON_TA,
  chooseFreshItem,
  chooseRemediation,
  chooseTarget,
  conceptOrder,
  nextActivity,
} from "./plan.js";

const pack1 = JSON.parse(readFileSync(new URL("../../content/pack-v1.json", import.meta.url), "utf8"));
const pack2 = JSON.parse(readFileSync(new URL("../../content/pack-v2.json", import.meta.url), "utf8"));
const packs = { "1": pack1, "2": pack2 };

// Builds one profile's event list. Each row is [itemId, stepId, correct, reason?]; sequence
// increases from 1 within the array. Only independent v2 events are produced (assistance "none").
function seq(profileId, rows) {
  return rows.map(([itemId, stepId, correct, reason = "practice"], index) => ({
    profileId,
    itemId,
    stepId,
    correct,
    reason,
    assistance: "none",
    packVersion: "2",
    sequence: index + 1,
  }));
}

test("constants: policy version 2 and two remediations per concept", () => {
  assert.equal(PLAN_POLICY_VERSION, "2");
  assert.equal(MAX_REMEDIATIONS_PER_CONCEPT, 2);
});

test("conceptOrder follows the pack's array order", () => {
  assert.deepEqual(conceptOrder(pack2), ["C0", "C1", "C2", "C3", "C4"]);
});

test("empty history: target is C0 and the next activity is practice on a C0 item with a fresh family", () => {
  assert.deepEqual(chooseTarget(packs, []), { conceptId: "C0", reasonCode: "next_in_graph" });

  const activity = nextActivity(packs, [], null);
  assert.equal(activity.kind, "practice");
  assert.equal(activity.conceptId, "C0");
  assert.equal(activity.reasonCode, "next_in_graph");
  assert.equal(activity.reasonTa, REASON_TA.next_in_graph);
  const item = pack2.items.find((i) => i.id === activity.itemId);
  assert.equal(item.concept, "C0");
  assert.equal(activity.family, item.family);
  assert.equal(activity.evidenceKind, item.evidenceKind);
});

test("correct diagnostic E01 then practice on C0 uses a different family and does not repeat E01", () => {
  const events = seq("p1", [["E01", "SUB8_BOTH", true, "diagnostic"]]);
  const activity = nextActivity(packs, events, events[0]);
  assert.equal(activity.kind, "practice");
  assert.equal(activity.conceptId, "C0");
  assert.notEqual(activity.itemId, "E01");
  assert.notEqual(activity.family, "eq_balance_sub");
});

test("tagged error on E01 (SUB8_LEFT) gives an intervention on C0 with I_C0", () => {
  const events = seq("p1", [["E01", "SUB8_LEFT", false, "diagnostic"]]);
  const activity = nextActivity(packs, events, events[0]);
  assert.equal(activity.kind, "intervention");
  assert.equal(activity.conceptId, "C0");
  assert.equal(activity.interventionId, "I_C0");
  assert.equal(activity.reasonCode, "tagged_error");
  assert.equal(activity.reasonTa, REASON_TA.tagged_error);
  // Was E11; the balance probe E05 now carries I_C0 (E11 no longer does).
  assert.equal(activity.itemId, "E05");
});

test("untagged error (ADD2_BOTH on E05) repeats the probe with probe_retry, not an intervention", () => {
  const events = seq("p1", [["E05", "ADD2_BOTH", false]]);
  const activity = nextActivity(packs, events, events[0]);
  assert.equal(activity.kind, "practice");
  assert.equal(activity.conceptId, "C0");
  assert.equal(activity.itemId, "E05");
  assert.equal(activity.reasonCode, "probe_retry");
  assert.equal(activity.reasonTa, REASON_TA.probe_retry);
});

test("tagged error on C1 (E13 SUB7_BOTH, inverse_sign) gives an intervention on C1 with I_C1", () => {
  const events = seq("p1", [["E13", "SUB7_BOTH", false]]);
  const activity = nextActivity(packs, events, events[0]);
  assert.equal(activity.kind, "intervention");
  assert.equal(activity.conceptId, "C1");
  assert.equal(activity.interventionId, "I_C1");
  assert.equal(activity.reasonCode, "tagged_error");
  const item = pack2.items.find((i) => i.id === activity.itemId);
  assert.equal(item.concept, "C1");
  assert.notEqual(activity.itemId, "E13");
});

test("one remediation on C0 still allows an intervention", () => {
  const events = seq("p1", [
    ["E11", "DIV2_RIGHT", false, "remediation"],
    ["E01", "SUB8_LEFT", false, "diagnostic"],
  ]);
  assert.equal(chooseRemediation(packs, events, "C0").remediationCount, 1);
  assert.equal(nextActivity(packs, events, events[1]).kind, "intervention");
});

test("tagged error after MAX_REMEDIATIONS_PER_CONCEPT remediations gives recap with remediation_exhausted", () => {
  const events = seq("p1", [
    ["E11", "DIV2_RIGHT", false, "remediation"],
    ["E10", "ADD4_BOTH", false, "remediation"],
    ["E01", "SUB8_LEFT", false, "diagnostic"],
  ]);
  assert.equal(chooseRemediation(packs, events, "C0").remediationCount, MAX_REMEDIATIONS_PER_CONCEPT);
  const activity = nextActivity(packs, events, events[2]);
  assert.equal(activity.kind, "recap");
  assert.equal(activity.conceptId, "C0");
  assert.equal(activity.interventionId, "I_C0");
  assert.equal(activity.reasonCode, "remediation_exhausted");
  assert.equal(activity.reasonTa, REASON_TA.remediation_exhausted);
});

test("C3 is never the target while C1 or C2 is undemonstrated (real pack)", () => {
  // C0 demonstrated: E01 correct, then E11 correct on a different family (eligible kind).
  const events = seq("p1", [
    ["E01", "SUB8_BOTH", true, "diagnostic"],
    ["E11", "SUB2_RIGHT", true],
  ]);
  const target = chooseTarget(packs, events);
  assert.notEqual(target.conceptId, "C3");
  // C1 is the first undemonstrated concept in graph order and its prerequisite C0 is met.
  assert.deepEqual(target, { conceptId: "C1", reasonCode: "next_in_graph" });
});

test("prerequisite_first: an undemonstrated prerequisite later in the array is returned first (synthetic pack)", () => {
  // Real pack-v2 is in topological order, so this branch is exercised with a synthetic pack
  // whose first concept depends on a concept listed after it.
  const reversed = {
    packVersion: "2",
    policyVersion: "2",
    concepts: [
      { id: "X1", nameTa: "x1", prerequisites: ["X0"] },
      { id: "X0", nameTa: "x0", prerequisites: [] },
    ],
    items: [],
    interventions: [],
  };
  assert.deepEqual(chooseTarget({ "1": pack1, "2": reversed }, []), {
    conceptId: "X0",
    reasonCode: "prerequisite_first",
  });
});

test("chooseFreshItem never repeats an attempted item and returns null once every C0 item is attempted", () => {
  const wrongUntagged = { E01: "ADD8_BOTH", E05: "ADD2_BOTH", E06: "ADD2_BOTH", E10: "ADD4_BOTH", E11: "DIV2_RIGHT" };
  const c0Count = pack2.items.filter((i) => i.concept === "C0").length;
  const events = [];
  const picked = [];
  for (let i = 0; i < c0Count; i += 1) {
    const fresh = chooseFreshItem(packs, events, "C0");
    assert.ok(fresh, `C0 item ${i + 1} should still be available`);
    assert.ok(!picked.includes(fresh.itemId), `${fresh.itemId} was already attempted`);
    picked.push(fresh.itemId);
    events.push({
      profileId: "p1",
      itemId: fresh.itemId,
      stepId: wrongUntagged[fresh.itemId],
      correct: false,
      reason: "practice",
      assistance: "none",
      packVersion: "2",
      sequence: i + 1,
    });
  }
  assert.equal(chooseFreshItem(packs, events, "C0"), null);

  const activity = nextActivity(packs, events, events[events.length - 1]);
  assert.equal(activity.kind, "exhausted");
  assert.equal(activity.conceptId, "C0");
  assert.equal(activity.reasonCode, "items_exhausted");
  assert.equal(activity.reasonTa, REASON_TA.items_exhausted);
});

test("review: a demonstrated concept that later gets an untagged error is targeted with reasonCode review", () => {
  const events = seq("p1", [
    ["E01", "SUB8_BOTH", true, "diagnostic"],
    ["E11", "SUB2_RIGHT", true],
    ["E05", "ADD2_BOTH", false],
  ]);
  assert.deepEqual(chooseTarget(packs, events), { conceptId: "C0", reasonCode: "review" });
  // Before: nextActivity reasonCode "review". After: the untagged probe error stays on E05 (probe_retry).
  const activity = nextActivity(packs, events, events[2]);
  assert.equal(activity.kind, "practice");
  assert.equal(activity.itemId, "E05");
  assert.equal(activity.reasonCode, "probe_retry");
  assert.equal(activity.reasonTa, REASON_TA.probe_retry);
});

test("REASON_TA has a nonempty string for every reasonCode the planner returns", () => {
  const codes = [
    "tagged_error",
    "next_in_graph",
    "prerequisite_first",
    "review",
    "remediation_exhausted",
    "items_exhausted",
    "all_demonstrated",
    "equality_repair",
    "probe_retry",
  ];
  assert.deepEqual(Object.keys(REASON_TA).sort(), [...codes].sort());
  for (const code of codes) {
    assert.equal(typeof REASON_TA[code], "string", code);
    assert.ok(REASON_TA[code].trim().length > 0, code);
  }
});


test("planner is deterministic and does not mutate its inputs", () => {
  const events = seq("p1", [["E01", "SUB8_LEFT", false, "diagnostic"]]);
  const snapshot = JSON.stringify(events);
  const first = nextActivity(packs, events, events[0]);
  const second = nextActivity(packs, events, events[0]);
  assert.deepEqual(second, first);
  assert.deepEqual(chooseTarget(packs, events), chooseTarget(packs, events));
  assert.equal(JSON.stringify(events), snapshot);
});

test("three profiles are planned independently from their own event arrays", () => {
  const profileA = seq("A", [["E01", "SUB8_LEFT", false, "diagnostic"]]);
  const profileB = seq("B", [
    ["E01", "SUB8_BOTH", true, "diagnostic"],
    ["E11", "SUB2_RIGHT", true],
  ]);
  const profileC = [];

  const aFirst = nextActivity(packs, profileA, profileA[0]);
  const bPlan = nextActivity(packs, profileB, null);
  const cPlan = nextActivity(packs, profileC, null);
  const aAgain = nextActivity(packs, profileA, profileA[0]);

  assert.equal(aFirst.kind, "intervention");
  assert.equal(aFirst.conceptId, "C0");
  assert.equal(bPlan.kind, "practice");
  assert.equal(bPlan.conceptId, "C1");
  assert.equal(cPlan.kind, "practice");
  assert.equal(cPlan.conceptId, "C0");
  assert.deepEqual(aAgain, aFirst);
});

// Same as seq() but stores the reason as reasonCode (the field storage.js writes), with no reason field.
function seqCoded(profileId, rows) {
  return seq(profileId, rows).map(({ reason, ...event }) => ({ ...event, reasonCode: reason }));
}

test("correct E01 SUB8_BOTH then practice is exactly E11 (not E05 or E10)", () => {
  const events = seq("p1", [["E01", "SUB8_BOTH", true, "diagnostic"]]);
  const activity = nextActivity(packs, events, events[0]);
  assert.equal(activity.kind, "practice");
  assert.equal(activity.conceptId, "C0");
  assert.equal(activity.itemId, "E11");
});

test("E01 SUB8_LEFT gives intervention E05 with I_C0 (the unattempted balance probe)", () => {
  const events = seq("p1", [["E01", "SUB8_LEFT", false, "diagnostic"]]);
  const activity = nextActivity(packs, events, events[0]);
  assert.equal(activity.kind, "intervention");
  assert.equal(activity.itemId, "E05");
  assert.equal(activity.interventionId, "I_C0");
});

test("E01 SUB8_LEFT then E05 SUB2_LEFT (same tag, different item) routes to equality repair E10", () => {
  const events = seq("p1", [
    ["E01", "SUB8_LEFT", false, "diagnostic"],
    ["E05", "SUB2_LEFT", false],
  ]);
  const activity = nextActivity(packs, events, events[1]);
  assert.equal(activity.kind, "repair");
  assert.equal(activity.conceptId, "C0");
  assert.equal(activity.itemId, "E10");
  assert.equal(activity.reasonCode, "equality_repair");
  assert.equal(activity.reasonTa, REASON_TA.equality_repair);
});

test("untagged ADD2_BOTH wrong twice on E05 stays on the probe with probe_retry", () => {
  const events = seq("p1", [
    ["E05", "ADD2_BOTH", false],
    ["E05", "ADD2_BOTH", false],
  ]);
  const activity = nextActivity(packs, events, events[1]);
  assert.equal(activity.kind, "practice");
  assert.equal(activity.conceptId, "C0");
  assert.equal(activity.itemId, "E05");
  assert.equal(activity.reasonCode, "probe_retry");
});

test("legacy tagged error (packVersion 1, E01 SUB8_LEFT) then E05 SUB2_LEFT routes to equality repair E10", () => {
  const legacy = {
    profileId: "p1",
    itemId: "E01",
    stepId: "SUB8_LEFT",
    correct: false,
    reasonCode: "practice",
    assistance: "none",
    packVersion: "1",
    sequence: 1,
  };
  const current = {
    profileId: "p1",
    itemId: "E05",
    stepId: "SUB2_LEFT",
    correct: false,
    reasonCode: "practice",
    assistance: "none",
    packVersion: "2",
    sequence: 2,
  };
  const activity = nextActivity(packs, [legacy, current], current);
  assert.equal(activity.kind, "repair");
  assert.equal(activity.itemId, "E10");
  assert.equal(activity.reasonCode, "equality_repair");
});

test("same item repeat of SUB2_LEFT on E05 without a prior tagged event on another item is not repair", () => {
  const events = seq("p1", [
    ["E05", "SUB2_LEFT", false],
    ["E05", "SUB2_LEFT", false],
  ]);
  const activity = nextActivity(packs, events, events[1]);
  assert.equal(activity.kind, "intervention");
  assert.notEqual(activity.kind, "repair");
  assert.notEqual(activity.itemId, "E10");
});

test("correct E05 SUB2_BOTH after E01 SUB8_LEFT is practice, not repair and not the probe again", () => {
  const events = seq("p1", [
    ["E01", "SUB8_LEFT", false, "diagnostic"],
    ["E05", "SUB2_BOTH", true],
  ]);
  const activity = nextActivity(packs, events, events[1]);
  assert.equal(activity.kind, "practice");
  assert.equal(activity.conceptId, "C0");
  assert.notEqual(activity.itemId, "E05");
  assert.notEqual(activity.itemId, "E10");
});

test("same item repeated SUB2_LEFT twice on E05 without the E01 event is intervention, not repair", () => {
  const events = seq("p1", [
    ["E05", "SUB2_LEFT", false],
    ["E05", "SUB2_LEFT", false],
  ]);
  const activity = nextActivity(packs, events, events[1]);
  assert.equal(activity.kind, "intervention");
  assert.equal(activity.reasonCode, "tagged_error");
  assert.equal(activity.interventionId, "I_C0");
  assert.notEqual(activity.itemId, "E05");
  assert.notEqual(activity.itemId, "E10");
});

test("remediation cap counts reasonCode remediation: recorded remediations then a tagged error gives recap", () => {
  const events = seqCoded("p1", [
    ["E11", "DIV2_RIGHT", false, "remediation"],
    ["E10", "ADD4_BOTH", false, "remediation"],
    ["E01", "SUB8_LEFT", false, "diagnostic"],
  ]);
  assert.equal(chooseRemediation(packs, events, "C0").remediationCount, MAX_REMEDIATIONS_PER_CONCEPT);
  const activity = nextActivity(packs, events, events[2]);
  assert.equal(activity.kind, "recap");
  assert.equal(activity.reasonCode, "remediation_exhausted");
});

test("events whose reasonCode is not remediation do not count toward the cap", () => {
  const events = seqCoded("p1", [
    ["E11", "DIV2_RIGHT", false, "practice"],
    ["E10", "ADD4_BOTH", false, "practice"],
    ["E01", "SUB8_LEFT", false, "diagnostic"],
  ]);
  assert.equal(chooseRemediation(packs, events, "C0").remediationCount, 0);
  assert.equal(nextActivity(packs, events, events[2]).kind, "intervention");
});

test("legacy reason remediation still counts toward the cap when mixed with reasonCode events", () => {
  // Row 0 keeps the legacy reason field; row 1 is recorded with reasonCode only.
  const events = seq("p1", [
    ["E11", "DIV2_RIGHT", false, "remediation"],
    ["E10", "ADD4_BOTH", false, "remediation"],
    ["E01", "SUB8_LEFT", false, "diagnostic"],
  ]).map((e, i) => (i === 1 ? { ...e, reason: undefined, reasonCode: "remediation" } : e));
  assert.equal(chooseRemediation(packs, events, "C0").remediationCount, 2);
  assert.equal(nextActivity(packs, events, events[2]).kind, "recap");
});
