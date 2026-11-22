// Phase 2 planner: chooses the next learning activity from committed evidence.
// Pure functions only: no DOM, no fs, no dependencies beyond evidence.js, so Node can import this file.
//
// Concept order is the pack's array order. Prerequisites are checked against the
// DEMONSTRATED status that evidence.js projects from independent attempts.

import { STATUS, classifyEvent, isEligibleKind, projectProfile } from "./evidence.js";

export const PLAN_POLICY_VERSION = "2";
export const MAX_REMEDIATIONS_PER_CONCEPT = 2;

// DRAFT Tamil reason text keyed by reasonCode. Pending language review (pack-v2 languageReview is PENDING).
export const REASON_TA = Object.freeze({
  tagged_error: "இந்தத் தவறு மீண்டும் வருகிறது. முதலில் இந்தக் கருத்தை மீள்பார்க்கலாம்.",
  next_in_graph: "இந்தக் கருத்தில் இன்னும் சான்று தேவை. அதற்காக இந்தப் பயிற்சி.",
  prerequisite_first: "இதற்கு முன் உள்ள கருத்தில் சான்று இல்லை. அதனால் அதை முதலில் பார்க்கலாம்.",
  review: "சில நாட்களுக்கு முன் கற்ற கருத்தை மீண்டும் உறுதிப்படுத்தலாம்.",
  remediation_exhausted: "இந்தக் கருத்தை இப்போது சுருக்கமாக மீண்டும் படிக்கலாம். பின்னர் தொடரலாம்.",
  items_exhausted: "இந்தக் கருத்தின் கேள்விகள் முடிந்தன. பின்னர் தொடரலாம்.",
  all_demonstrated: "எல்லாக் கருத்துகளும் உறுதிப்படுத்தப்பட்டன.",
  equality_repair: "இதே பிழை வேறு கேள்வியிலும் வந்தது. சமநிலை பற்றி மீண்டும் பார்க்கலாம்.",
  probe_retry: "இந்தப் பதிலில் பிழை இருந்தது. அதே கேள்வியை மீண்டும் முயலலாம்.",
});

function packV2Of(packs) {
  const pack = packs?.["2"];
  if (!pack || !Array.isArray(pack.concepts) || !Array.isArray(pack.items)) {
    throw new TypeError('packs["2"] with concepts and items is required');
  }
  return pack;
}

// Event reason: storage.js writes "reasonCode"; older events carry "reason". Prefer reasonCode.
function reasonOf(event) {
  return event.reasonCode ?? event.reason;
}

// The misconception tag on the option the learner chose, or null when the choice is untagged.
function misconceptionOf(packV2, event) {
  const item = packV2.items.find((i) => i.id === event.itemId);
  const option = item?.options?.find((o) => o.stepId === event.stepId);
  return option?.misconception ?? null;
}

// Cross-item recurrence. Example: E01 SUB8_LEFT, then E05 SUB2_LEFT. Both choices carry
// "one_side_subtraction", they are different items of C0, and the earlier E01 answer is an
// independent incorrect one. So the E05 error routes to the pack's repair item (E10).
// A repeat on the same item does not count, and neither does an earlier event with another tag.
// Legacy (packVersion "1") tagged errors count: the tag is resolved from (itemId, stepId) in pack-v2.
// Returns the repair item id, or null.
function recurrenceRepair(packs, history, lastEvent, conceptId) {
  const pack = packV2Of(packs);
  const tag = misconceptionOf(pack, lastEvent);
  const repairItemId = tag ? pack.recurrence?.[tag]?.repairItemId : undefined;
  if (!repairItemId || history.some((e) => e.itemId === repairItemId)) {
    return null; // no repair configured for this tag, or the repair item was already answered
  }
  const recurred = history.some((e) => {
    if (e.itemId === lastEvent.itemId || !(e.sequence < lastEvent.sequence)) {
      return false;
    }
    const attempt = classifyEvent(e, packs);
    return (
      (attempt.kind === "independent" || attempt.kind === "legacy") &&
      !attempt.correct &&
      attempt.conceptId === conceptId &&
      misconceptionOf(pack, e) === tag
    );
  });
  return recurred ? repairItemId : null;
}

export function conceptOrder(packV2) {
  return packV2.concepts.map((concept) => concept.id);
}

// Returns events with lastEvent included exactly once, so the item just answered is
// excluded from fresh practice even when the caller has not yet appended it.
function withLastEvent(events, lastEvent) {
  if (!lastEvent) {
    return events;
  }
  const present = events.some(
    (e) => e === lastEvent || (e.sequence === lastEvent.sequence && e.itemId === lastEvent.itemId),
  );
  return present ? events : [...events, lastEvent];
}

// Walks prerequisites in graph order and returns the deepest unmet prerequisite, or null
// when every prerequisite of conceptId is DEMONSTRATED.
function firstUnmetPrerequisite(pack, conceptId, statuses, seen = new Set()) {
  if (seen.has(conceptId)) {
    return null; // guards against a malformed cyclic graph
  }
  seen.add(conceptId);
  const concept = pack.concepts.find((c) => c.id === conceptId);
  for (const prereqId of concept?.prerequisites ?? []) {
    if (statuses[prereqId]?.status !== STATUS.DEMONSTRATED) {
      return firstUnmetPrerequisite(pack, prereqId, statuses, seen) ?? prereqId;
    }
  }
  return null;
}

// Returns {conceptId, reasonCode} for the concept the learner should work on next.
export function chooseTarget(packs, events) {
  const pack = packV2Of(packs);
  const { concepts: statuses } = projectProfile(packs, events ?? []);

  const target = conceptOrder(pack).find((id) => statuses[id]?.status !== STATUS.DEMONSTRATED);
  if (!target) {
    return { conceptId: null, reasonCode: "all_demonstrated" };
  }

  const blocker = firstUnmetPrerequisite(pack, target, statuses);
  if (blocker) {
    return { conceptId: blocker, reasonCode: "prerequisite_first" };
  }

  const reasonCode = statuses[target].status === STATUS.REVIEW_DUE ? "review" : "next_in_graph";
  return { conceptId: target, reasonCode };
}

// Returns {itemId, family, evidenceKind} for an unattempted item of conceptId, or null when
// every item of that concept has already been attempted.
export function chooseFreshItem(packs, events, conceptId) {
  const pack = packV2Of(packs);
  const history = events ?? [];
  const attempted = new Set(history.map((e) => e.itemId));
  const candidates = pack.items.filter((item) => item.concept === conceptId && !attempted.has(item.id));
  if (candidates.length === 0) {
    return null;
  }

  const observed = history
    .map((e) => classifyEvent(e, packs))
    .filter((a) => a.kind === "independent" && a.conceptId === conceptId);
  const observedFamilies = new Set(observed.map((a) => a.family));
  const hasCorrect = observed.some((a) => a.correct);

  const fresh = (item) => !observedFamilies.has(item.family);
  const eligible = (item) => isEligibleKind(item.evidenceKind);
  // Once the concept has a correct independent attempt, prefer eligible kinds so that a
  // second attempt on a different family can complete the demonstration streak.
  const tiers = hasCorrect
    ? [(item) => fresh(item) && eligible(item), fresh, eligible, () => true]
    : [fresh, () => true];

  let item = null;
  for (const tier of tiers) {
    item = candidates.find(tier) ?? null;
    if (item) {
      break;
    }
  }
  return { itemId: item.id, family: item.family, evidenceKind: item.evidenceKind };
}

// Returns {itemId, interventionId, remediationCount}, or {exhausted:true, recapInterventionId,
// remediationCount} once the concept has MAX_REMEDIATIONS_PER_CONCEPT remediation events.
export function chooseRemediation(packs, events, conceptId, failedItemId = null) {
  const pack = packV2Of(packs);
  const history = events ?? [];
  const remediationCount = history.filter(
    // The app must record a remediation response with reasonCode exactly "remediation".
    // Legacy events with reason "remediation" are still counted via reasonOf.
    (e) => reasonOf(e) === "remediation" && classifyEvent(e, packs).conceptId === conceptId,
  ).length;

  const interventionId = pack.interventions.find((i) => i.conceptId === conceptId)?.id ?? null;
  if (remediationCount >= MAX_REMEDIATIONS_PER_CONCEPT) {
    return { exhausted: true, recapInterventionId: interventionId, remediationCount };
  }

  // Never return an item the learner already answered, including the item that produced the error.
  const attempted = new Set([...history.map((e) => e.itemId), failedItemId]);
  const withIntervention = pack.items.find(
    (item) => item.concept === conceptId && item.interventionId && !attempted.has(item.id),
  );
  if (withIntervention) {
    return {
      itemId: withIntervention.id,
      interventionId: withIntervention.interventionId,
      remediationCount,
    };
  }

  const fresh = chooseFreshItem(packs, history, conceptId);
  if (fresh) {
    return { itemId: fresh.itemId, interventionId, remediationCount };
  }
  return { exhausted: true, recapInterventionId: interventionId, remediationCount };
}

// Main planner. lastEvent may be null. Returns one of:
//   {kind:"intervention", conceptId, interventionId, itemId, reasonCode, reasonTa}
//   {kind:"recap", conceptId, interventionId, reasonCode, reasonTa}
//   {kind:"repair", conceptId, itemId, reasonCode, reasonTa}
//   {kind:"practice", conceptId, itemId, family, evidenceKind, reasonCode, reasonTa}
//   {kind:"exhausted", conceptId, reasonCode, reasonTa}
//   {kind:"done", reasonCode, reasonTa}
export function nextActivity(packs, events, lastEvent) {
  packV2Of(packs);
  const history = withLastEvent(events ?? [], lastEvent ?? null);

  if (lastEvent) {
    const attempt = classifyEvent(lastEvent, packs);
    if (attempt.kind === "independent" && !attempt.correct && attempt.tagged && attempt.conceptId) {
      const conceptId = attempt.conceptId;
      const remediation = chooseRemediation(packs, history, conceptId, lastEvent.itemId);
      if (remediation.exhausted) {
        return {
          kind: "recap",
          conceptId,
          interventionId: remediation.recapInterventionId,
          reasonCode: "remediation_exhausted",
          reasonTa: REASON_TA.remediation_exhausted,
        };
      }
      // Same tag as an earlier independent error on another item: equality repair, not the intervention.
      const repairItemId = recurrenceRepair(packs, history, lastEvent, conceptId);
      if (repairItemId) {
        return {
          kind: "repair",
          conceptId,
          itemId: repairItemId,
          reasonCode: "equality_repair",
          reasonTa: REASON_TA.equality_repair,
        };
      }
      // Return to the blocked goal: the tagged error only lowers this concept to DEVELOPING.
      // Once the remediation item is answered correctly and independently, lastEvent is no
      // longer a tagged error, so this branch is skipped and chooseTarget picks the blocked
      // concept again whenever it is the first concept not yet DEMONSTRATED in graph order.
      return {
        kind: "intervention",
        conceptId,
        interventionId: remediation.interventionId,
        itemId: remediation.itemId,
        reasonCode: "tagged_error",
        reasonTa: REASON_TA.tagged_error,
      };
    }

    // An untagged wrong answer on the balance probe (role "probe") is retried on the same item.
    // Only tagged errors and the recurrence rule leave the probe.
    const probe = packV2Of(packs).items.find((i) => i.id === lastEvent.itemId);
    if (attempt.kind === "independent" && !attempt.correct && !attempt.tagged && probe?.role === "probe") {
      return {
        kind: "practice",
        conceptId: attempt.conceptId,
        itemId: probe.id,
        family: attempt.family,
        evidenceKind: attempt.evidenceKind,
        reasonCode: "probe_retry",
        reasonTa: REASON_TA.probe_retry,
      };
    }
  }

  const target = chooseTarget(packs, history);
  if (target.conceptId === null) {
    return { kind: "done", reasonCode: "all_demonstrated", reasonTa: REASON_TA.all_demonstrated };
  }

  const fresh = chooseFreshItem(packs, history, target.conceptId);
  if (!fresh) {
    return {
      kind: "exhausted",
      conceptId: target.conceptId,
      reasonCode: "items_exhausted",
      reasonTa: REASON_TA.items_exhausted,
    };
  }

  return {
    kind: "practice",
    conceptId: target.conceptId,
    itemId: fresh.itemId,
    family: fresh.family,
    evidenceKind: fresh.evidenceKind,
    reasonCode: target.reasonCode,
    reasonTa: REASON_TA[target.reasonCode],
  };
}
