// Reconnect sync for the outbox. No DOM access and no imports: callers pass
// in fetch, storage, the IndexedDB handle and the storage.js namespace.

export const SYNC_BATCH = 25;
export const INSTALL_KEY = "tutor.install.v1";
export const SESSION_URL = "/api/session";
export const EVENTS_URL = "/api/progress/events";

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function readInstall(storageImpl) {
  const raw = storageImpl.getItem(INSTALL_KEY);
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !isNonEmptyString(parsed.installId) || !isNonEmptyString(parsed.token)) {
      return null;
    }
    return { installId: parsed.installId, token: parsed.token };
  } catch {
    return null;
  }
}

export async function ensureInstall({ fetchImpl, csrfToken, storageImpl }) {
  const existing = readInstall(storageImpl);
  if (existing) return existing;

  const response = await fetchImpl(SESSION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error("session_failed");
  }
  const body = await response.json();
  if (!body || !isNonEmptyString(body.installId) || !isNonEmptyString(body.token)) {
    throw new Error("session_failed");
  }
  const install = { installId: body.installId, token: body.token };
  storageImpl.setItem(INSTALL_KEY, JSON.stringify(install));
  return install;
}

export function computeSyncState(pendingCount, lastResult) {
  if (lastResult && lastResult.state === "retry") return "retry";
  if (pendingCount > 0) return "pending";
  return "synced";
}

export async function flushOutbox({
  db,
  fetchImpl,
  csrfToken,
  storageImpl,
  timeoutMs = 15000,
  storage,
}) {
  const rows = await storage.listPendingOutbox(db, SYNC_BATCH);
  if (rows.length === 0) {
    return { state: "synced", sent: 0, acked: 0, conflicts: 0, pending: 0 };
  }

  const events = rows.filter((row) => row.event !== null).map((row) => row.event);
  if (events.length === 0) {
    // Rows without an events record are never sent and never removed.
    const pending = await storage.countPendingOutbox(db);
    return { state: computeSyncState(pending, null), sent: 0, acked: 0, conflicts: 0, pending };
  }

  const fail = async (error, sent) => ({
    state: "retry",
    error,
    sent,
    acked: 0,
    conflicts: 0,
    pending: await storage.countPendingOutbox(db),
  });

  let install;
  try {
    install = await ensureInstall({ fetchImpl, csrfToken, storageImpl });
  } catch {
    return fail("session_failed", 0);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let results;
  try {
    let response;
    try {
      response = await fetchImpl(EVENTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken,
          "X-Install-Token": install.token,
        },
        body: JSON.stringify({ events }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error && error.name === "AbortError";
      return fail(aborted ? "timeout" : "network_error", events.length);
    }

    if (response.status === 401) {
      storageImpl.removeItem(INSTALL_KEY);
      return fail("unauthorized", events.length);
    }
    if (response.status === 400) {
      return fail("bad_batch", events.length);
    }
    if (!response.ok) {
      return fail("server_error", events.length);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return fail("invalid_json", events.length);
    }
    if (!body || !Array.isArray(body.results)) {
      return fail("invalid_results", events.length);
    }
    results = body.results;
  } finally {
    clearTimeout(timer);
  }

  const ackIds = results
    .filter((r) => r && (r.status === "stored" || r.status === "duplicate") && isNonEmptyString(r.eventId))
    .map((r) => r.eventId);
  const conflicts = results.filter(
    (r) => r && (r.status === "conflict" || r.status === "invalid"),
  ).length;

  const acked = await storage.removeAcknowledgedOutbox(db, ackIds);
  const pending = await storage.countPendingOutbox(db);
  const result = {
    state: conflicts > 0 ? "retry" : computeSyncState(pending, null),
    sent: events.length,
    acked,
    conflicts,
    pending,
  };
  if (conflicts > 0) result.error = "conflicts";
  return result;
}
