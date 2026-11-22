// IndexedDB persistence for the tutor lesson, scoped by profileId.
// Database "tutor-v1", version 1. Zero network calls.

const DB_NAME = "tutor-v1";
const DB_VERSION = 1;

function createStores(db) {
  if (!db.objectStoreNames.contains("profiles")) {
    db.createObjectStore("profiles", { keyPath: "profileId" });
  }
  if (!db.objectStoreNames.contains("instances")) {
    const store = db.createObjectStore("instances", { keyPath: "instanceId" });
    store.createIndex("byProfile", "profileId", { unique: false });
  }
  if (!db.objectStoreNames.contains("events")) {
    const store = db.createObjectStore("events", { keyPath: "eventId" });
    // Unique per profile by convention: sequence is assigned inside commitAnswer.
    store.createIndex("byProfileSeq", ["profileId", "sequence"], { unique: false });
  }
  if (!db.objectStoreNames.contains("outbox")) {
    db.createObjectStore("outbox", { keyPath: "eventId" });
  }
  if (!db.objectStoreNames.contains("cursors")) {
    db.createObjectStore("cursors", { keyPath: "profileId" });
  }
}

function newEventId() {
  if (globalThis.crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Shared runner: one transaction, settles only from oncomplete (success or ctx.failure)
// or from onerror/onabort (failCode). Never resolves before the commit completes.
function transact(db, storeNames, mode, failCode, work) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ctx = { result: undefined, failure: null };
    const finish = (fn, arg) => {
      if (!settled) {
        settled = true;
        fn(arg);
      }
    };
    const fail = () => finish(reject, { code: failCode });
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch {
      fail();
      return;
    }
    tx.oncomplete = () =>
      ctx.failure ? finish(reject, ctx.failure) : finish(resolve, ctx.result);
    tx.onerror = fail;
    tx.onabort = fail;
    try {
      work(tx, ctx);
    } catch {
      try {
        tx.abort();
      } catch {
        // Transaction already finished; nothing further to undo.
      }
      fail();
    }
  });
}

// Atomic open: resolves a connection or rejects {code:"STORAGE_UNAVAILABLE"}; never throws raw.
export function openDb(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(name, DB_VERSION);
    } catch {
      reject({ code: "STORAGE_UNAVAILABLE" });
      return;
    }
    req.onupgradeneeded = () => createStores(req.result);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = (event) => {
      event.preventDefault?.();
      reject({ code: "STORAGE_UNAVAILABLE" });
    };
  });
}

// Idempotent create: get-then-add in one readwrite tx; an existing profile is never overwritten.
export function ensureProfile(db, profileId, alias) {
  return transact(db, ["profiles"], "readwrite", "WRITE_FAILED", (tx, ctx) => {
    const store = tx.objectStore("profiles");
    const req = store.get(profileId);
    req.onsuccess = () => {
      if (req.result) {
        ctx.result = req.result;
        return;
      }
      const record = { profileId, alias: alias ?? "", createdAt: new Date().toISOString() };
      store.add(record);
      ctx.result = record;
    };
  });
}

// Read-only: resolves the profile's cursor record, or null when none exists.
export function getCursor(db, profileId) {
  return transact(db, ["cursors"], "readonly", "READ_FAILED", (tx, ctx) => {
    const req = tx.objectStore("cursors").get(profileId);
    req.onsuccess = () => {
      ctx.result = req.result ?? null;
    };
  });
}

// Read-only: resume point for a profile. answeredCount is the committed event sequence.
// Resolves {profileId, currentItemId, currentInstanceId, answeredCount}; zeros/nulls when no cursor exists.
export async function getResumeState(db, profileId) {
  const cursor = await getCursor(db, profileId);
  return {
    profileId,
    currentItemId: cursor?.currentItemId ?? null,
    currentInstanceId: cursor?.currentInstanceId ?? null,
    answeredCount: cursor?.sequence ?? 0,
  };
}

// Atomic open: one readwrite tx over instances/cursors; re-opening the same open instance is a no-op.
export function openInstance(db, { profileId, instanceId, itemId }) {
  return transact(db, ["instances", "cursors"], "readwrite", "WRITE_FAILED", (tx, ctx) => {
    const instances = tx.objectStore("instances");
    const cursors = tx.objectStore("cursors");
    const iReq = instances.get(instanceId);
    const cReq = cursors.get(profileId);
    let openItemId = itemId;
    // Requests in one transaction run in issue order, so iReq settles before cReq.
    iReq.onsuccess = () => {
      const existing = iReq.result;
      if (existing) {
        if (existing.profileId !== profileId || existing.status !== "open") {
          ctx.failure = { code: "STALE" };
          return;
        }
        openItemId = existing.itemId;
      } else {
        instances.add({
          instanceId,
          profileId,
          itemId,
          status: "open",
          createdAt: new Date().toISOString(),
        });
      }
    };
    cReq.onsuccess = () => {
      if (ctx.failure) return;
      const prev = cReq.result || { profileId, sequence: 0 };
      cursors.put({
        ...prev,
        currentInstanceId: instanceId,
        currentItemId: openItemId,
        updatedAt: new Date().toISOString(),
      });
      ctx.result = { instanceId, itemId: openItemId };
    };
  });
}

// Guarded open for the screen the user is on. One readwrite tx over instances/cursors.
// expected is {sequence, itemId} from that screen, or null to open whatever the cursor says.
// Resolves {ok:true, instanceId, itemId}, or {ok:false, reason:"finished"|"stale"} with nothing written.
// Reuses the cursor's open instance for the same item, so a duplicate tap or a second tab adds no instance.
// startItemId is used only when the profile has no cursor yet. Rejects {code:"WRITE_FAILED"}.
export function openCurrentInstance(
  db,
  profileId,
  expected = null,
  { instanceId, startItemId = null } = {},
) {
  return transact(db, ["instances", "cursors"], "readwrite", "WRITE_FAILED", (tx, ctx) => {
    const instances = tx.objectStore("instances");
    const cursors = tx.objectStore("cursors");
    const cReq = cursors.get(profileId);
    cReq.onsuccess = () => {
      const cursor =
        cReq.result ?? { profileId, sequence: 0, currentItemId: startItemId, currentInstanceId: null };
      const sequence = cursor.sequence || 0;
      if (!cursor.currentItemId) {
        ctx.result = { ok: false, reason: "finished" };
        return;
      }
      if (expected && (expected.sequence !== sequence || expected.itemId !== cursor.currentItemId)) {
        ctx.result = { ok: false, reason: "stale" };
        return;
      }
      const openNew = () => {
        const now = new Date().toISOString();
        instances.add({
          instanceId,
          profileId,
          itemId: cursor.currentItemId,
          status: "open",
          createdAt: now,
        });
        cursors.put({ ...cursor, currentInstanceId: instanceId, updatedAt: now });
        ctx.result = { ok: true, instanceId, itemId: cursor.currentItemId };
      };
      if (!cursor.currentInstanceId) {
        openNew();
        return;
      }
      const iReq = instances.get(cursor.currentInstanceId);
      iReq.onsuccess = () => {
        const active = iReq.result;
        if (
          active &&
          active.profileId === profileId &&
          active.status === "open" &&
          active.itemId === cursor.currentItemId
        ) {
          ctx.result = { ok: true, instanceId: active.instanceId, itemId: active.itemId };
          return;
        }
        openNew();
      };
    };
  });
}


// Assistance levels in increasing order. A recorded level never moves down.
const ASSISTANCE_RANK = new Map([
  ["none", 0],
  ["hint", 1],
  ["answer_shown", 2],
]);

// Raises an open instance's assistance to level, never lowers it. One readwrite tx over instances.
// Resolves {instanceId, assistance} with the stored level. Rejects {code:"STALE"} when the instance
// is unknown or no longer open, and {code:"INVALID"} for an unknown level; nothing is written then.
export function setInstanceAssistance(db, instanceId, level) {
  if (!ASSISTANCE_RANK.has(level)) {
    return Promise.reject({ code: "INVALID" });
  }
  return transact(db, ["instances"], "readwrite", "WRITE_FAILED", (tx, ctx) => {
    const instances = tx.objectStore("instances");
    const req = instances.get(instanceId);
    req.onsuccess = () => {
      const inst = req.result;
      if (!inst || inst.status !== "open") {
        ctx.failure = { code: "STALE" };
        return;
      }
      const prev = inst.assistance ?? "none";
      const next = ASSISTANCE_RANK.get(level) > ASSISTANCE_RANK.get(prev) ? level : prev;
      if (next !== prev) {
        instances.put({ ...inst, assistance: next });
      }
      ctx.result = { instanceId, assistance: next };
    };
  });
}

// Atomic commit: one readwrite tx over instances/events/outbox/cursors.
// input.nextItemId (optional) is the caller-computed next unanswered item; it becomes the cursor's
// currentItemId so a reload can resume there. Resolves {sequence} only on oncomplete;
// rejects STALE (nothing written) or WRITE_FAILED (prior state kept).
export function commitAnswer(db, input) {
  const {
    profileId,
    instanceId,
    packVersion,
    policyVersion,
    stepId,
    value,
    correct,
    reasonCode,
    nextItemId,
  } = input;
  const eventId = input.eventId || newEventId();
  return transact(
    db,
    ["instances", "events", "outbox", "cursors"],
    "readwrite",
    "WRITE_FAILED",
    (tx, ctx) => {
      const instances = tx.objectStore("instances");
      const cursors = tx.objectStore("cursors");
      const cReq = cursors.get(profileId);
      const iReq = instances.get(instanceId);
      // Requests in one transaction run in issue order, so cReq settles before iReq.
      iReq.onsuccess = () => {
        const cursor = cReq.result;
        const inst = iReq.result;
        if (
          !inst ||
          inst.profileId !== profileId ||
          inst.status !== "open" ||
          !cursor ||
          cursor.currentInstanceId !== instanceId
        ) {
          ctx.failure = { code: "STALE" };
          return;
        }
        const sequence = (cursor.sequence || 0) + 1;
        const now = new Date().toISOString();
        instances.put({ ...inst, status: "answered" });
        tx.objectStore("events").add({
          eventId,
          profileId,
          sequence,
          packVersion,
          policyVersion,
          itemId: inst.itemId,
          instanceId,
          stepId: stepId ?? null,
          value: value ?? null,
          correct: correct === true,
          assistance: inst.assistance ?? "none",
          reasonCode: reasonCode ?? null,
          createdAt: now,
        });
        tx.objectStore("outbox").add({ eventId, profileId, state: "pending" });
        cursors.put({
          profileId,
          sequence,
          currentInstanceId: null,
          currentItemId: nextItemId ?? null,
          updatedAt: now,
        });
        ctx.result = { sequence };
      };
    },
  );
}

// Read-only: returns this profile's events ordered by sequence (index range bound to profileId).
export function listEvents(db, profileId) {
  return transact(db, ["events"], "readonly", "READ_FAILED", (tx, ctx) => {
    const range = IDBKeyRange.bound([profileId, -Infinity], [profileId, Infinity]);
    const req = tx.objectStore("events").index("byProfileSeq").getAll(range);
    req.onsuccess = () => {
      ctx.result = req.result.filter((e) => e.profileId === profileId);
    };
  });
}

// Pure: summarises event records. No mastery field. lastCorrect is null when there are no events.
export function learnerSummary(events = []) {
  let correct = 0;
  let last = null;
  for (const event of events) {
    if (event.correct === true) correct += 1;
    if (!last || event.sequence > last.sequence) last = event;
  }
  const attempts = events.length;
  return {
    attempts,
    correct,
    incorrect: attempts - correct,
    lastCorrect: last ? last.correct === true : null,
  };
}


// Outbox fields sent to the server (13 fields). A choice event sends stepId with value null;
// a numeric event sends stepId null with the integer value. Never both null.
function outboxEventFields(event) {
  return {
    eventId: event.eventId,
    profileId: event.profileId,
    sequence: event.sequence,
    packVersion: event.packVersion,
    policyVersion: event.policyVersion,
    itemId: event.itemId,
    instanceId: event.instanceId,
    stepId: event.stepId ?? null,
    value: event.value ?? null,
    correct: event.correct,
    assistance: event.assistance,
    reasonCode: event.reasonCode,
    createdAt: event.createdAt,
  };
}

// Read-only: up to limit pending outbox rows with their event records attached.
// Resolves [{eventId, profileId, event}] where event is null when the events row is missing. Deletes nothing.
export function listPendingOutbox(db, limit) {
  if (!(limit > 0)) return Promise.resolve([]);
  return transact(db, ["outbox", "events"], "readonly", "READ_FAILED", (tx, ctx) => {
    const outboxReq = tx.objectStore("outbox").getAll(undefined, limit);
    const events = tx.objectStore("events");
    outboxReq.onsuccess = () => {
      const rows = outboxReq.result.map((row) => ({
        eventId: row.eventId,
        profileId: row.profileId,
        event: null,
      }));
      for (const row of rows) {
        const req = events.get(row.eventId);
        req.onsuccess = () => {
          row.event = req.result ? outboxEventFields(req.result) : null;
        };
      }
      ctx.result = rows;
    };
  });
}

// Read-only: number of rows currently in the outbox.
export function countPendingOutbox(db) {
  return transact(db, ["outbox"], "readonly", "READ_FAILED", (tx, ctx) => {
    const req = tx.objectStore("outbox").count();
    req.onsuccess = () => {
      ctx.result = req.result;
    };
  });
}

// Readwrite over outbox only: deletes the rows whose eventId is listed. Resolves the number of rows removed.
// Never touches the events store, so learner history is kept.
export function removeAcknowledgedOutbox(db, eventIds) {
  const keys = [...new Set((eventIds ?? []).filter((id) => typeof id === "string"))];
  return transact(db, ["outbox"], "readwrite", "WRITE_FAILED", (tx, ctx) => {
    const store = tx.objectStore("outbox");
    ctx.result = 0;
    for (const key of keys) {
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result) {
          store.delete(key);
          ctx.result += 1;
        }
      };
    }
  });
}

