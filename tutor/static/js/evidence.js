// Evidence projection for the Phase 2 concept path.
// Pure functions only: no DOM, no fs, no dependencies, so Node can import this file.
//
// Only INDEPENDENT attempts move a concept's status. Assisted attempts (hint or
// answer_shown) and legacy attempts (packVersion "1", recorded before assistance was
// tracked) are counted and never change status.

export const EVIDENCE_POLICY_VERSION = "2";

export const STATUS = Object.freeze({
  UNASSESSED: "unassessed",
  DEVELOPING: "developing",
  DEMONSTRATED: "demonstrated",
  REVIEW_DUE: "review_due",
});

const ELIGIBLE_KINDS = new Set(["transfer", "explanation", "check"]);
const ASSISTED_LEVELS = new Set(["hint", "answer_shown"]);

export function isEligibleKind(evidenceKind) {
  return ELIGIBLE_KINDS.has(evidenceKind);
}

// Items are indexed once per pack object and reused across calls.
const itemIndexCache = new WeakMap();

function requirePackV2(packs) {
  const pack = packs?.["2"];
  if (!pack || !Array.isArray(pack.items) || !Array.isArray(pack.concepts)) {
    throw new TypeError('packs["2"] with items and concepts is required');
  }
  return pack;
}

function itemIndexFor(pack) {
  let index = itemIndexCache.get(pack);
  if (!index) {
    index = new Map(pack.items.map((item) => [item.id, item]));
    itemIndexCache.set(pack, index);
  }
  return index;
}

// True only when the chosen option (matched by stepId) carries an explicit misconception.
function isTaggedChoice(item, stepId) {
  const option = item?.options?.find((o) => o.stepId === stepId);
  return Boolean(option && option.misconception);
}

// Classify one committed attempt event.
// packs = { "1": packV1, "2": packV2 }. Legacy events take concept and family from the
// v2 item with the same id, or null when there is none.
export function classifyEvent(event, packs) {
  const item = itemIndexFor(requirePackV2(packs)).get(event.itemId) ?? null;
  const result = {
    kind: "unknown",
    conceptId: item ? item.concept : null,
    family: item ? item.family : null,
    evidenceKind: item ? item.evidenceKind : null,
    tagged: item ? isTaggedChoice(item, event.stepId) : false,
    correct: event.correct === true,
    sequence: event.sequence,
    itemId: event.itemId,
    lastObservedAt: event.createdAt ?? null,
  };

  if (event.packVersion === "1") {
    return { ...result, kind: "legacy" };
  }
  if (event.packVersion === "2") {
    if (!item) {
      return result; // unknown item: ignored by projection
    }
    return { ...result, kind: ASSISTED_LEVELS.has(event.assistance) ? "assisted" : "independent" };
  }
  return result; // unknown pack version: ignored by projection
}

function emptyConceptState() {
  return {
    status: STATUS.UNASSESSED,
    independentCorrect: 0,
    independentIncorrect: 0,
    assisted: 0,
    legacy: 0,
    lastObservedAt: null,
  };
}

// Apply one independent attempt to a concept's state. `prev` is the immediately previous
// independent attempt for this concept, or null.
function applyIndependent(state, attempt, prev) {
  if (attempt.correct) {
    state.independentCorrect += 1;
    // A streak needs a prior correct independent attempt on a different item AND a different
    // family, with at least one of the two attempts of an eligible kind.
    const distinct = prev !== null && prev.itemId !== attempt.itemId && prev.family !== attempt.family;
    const eligible = prev !== null && (isEligibleKind(prev.evidenceKind) || isEligibleKind(attempt.evidenceKind));
    const streak = prev !== null && prev.correct && distinct && eligible;
    state.status = streak ? STATUS.DEMONSTRATED : STATUS.DEVELOPING;
    return;
  }

  state.independentIncorrect += 1;
  if (attempt.tagged) {
    state.status = STATUS.DEVELOPING;
  } else if (state.status === STATUS.DEMONSTRATED) {
    state.status = STATUS.REVIEW_DUE;
  } else {
    state.status = STATUS.DEVELOPING;
  }
}

// Project a learner's events into per-concept status.
// `events` is one profile's committed attempts; the caller is responsible for passing
// only that profile's events. Input is not mutated.
export function projectProfile(packs, events) {
  const packV2 = requirePackV2(packs);
  const concepts = {};
  for (const concept of packV2.concepts) {
    concepts[concept.id] = emptyConceptState();
  }

  const previousIndependent = new Map(); // conceptId -> last independent attempt
  const ordered = [...(events ?? [])].sort((a, b) => a.sequence - b.sequence);

  for (const raw of ordered) {
    const attempt = classifyEvent(raw, packs);
    if (attempt.kind === "unknown" || attempt.conceptId === null || !concepts[attempt.conceptId]) {
      continue;
    }
    const state = concepts[attempt.conceptId];
    if (attempt.lastObservedAt !== null) {
      state.lastObservedAt = attempt.lastObservedAt;
    }

    if (attempt.kind === "legacy") {
      state.legacy += 1;
    } else if (attempt.kind === "assisted") {
      state.assisted += 1;
    } else {
      applyIndependent(state, attempt, previousIndependent.get(attempt.conceptId) ?? null);
      previousIndependent.set(attempt.conceptId, attempt);
    }

    // Any activity without independent evidence leaves UNASSESSED as DEVELOPING.
    if (state.status === STATUS.UNASSESSED && attempt.kind !== "independent") {
      state.status = STATUS.DEVELOPING;
    }
  }

  return { concepts };
}

export function conceptStatusFor(packs, events, conceptId) {
  const entry = projectProfile(packs, events).concepts[conceptId];
  return entry ? entry.status : null;
}

// Concept ids with DEMONSTRATED status, in graph order.
export function demonstratedConcepts(packs, events) {
  const packV2 = requirePackV2(packs);
  const { concepts } = projectProfile(packs, events);
  return packV2.concepts.map((c) => c.id).filter((id) => concepts[id].status === STATUS.DEMONSTRATED);
}

// `statuses` is projectProfile(...).concepts. A concept without prerequisites is always met.
export function prerequisitesMet(packV2, conceptId, statuses) {
  const concept = packV2.concepts.find((c) => c.id === conceptId);
  if (!concept) {
    throw new Error(`unknown concept: ${conceptId}`);
  }
  return (concept.prerequisites ?? []).every((id) => statuses?.[id]?.status === STATUS.DEMONSTRATED);
}
