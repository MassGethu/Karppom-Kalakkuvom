// DEBUG-only browser self-test for storage.js. Writes results as plain text; no innerHTML.
// storage.js is loaded with a dynamic import; every await is bounded so a stall shows as TIMEOUT.
const out = document.getElementById("result");
const STEP_MS = 4000;
let pass = 0;
let fail = 0;

function line(text) {
  out.textContent += `\n${text}`;
  console.log("SELFTEST " + text);
}

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT " + label)), ms))]);

function describe(e) {
  if (e instanceof Error) return e.message;
  return (e && e.code) || String(e);
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

// Asserts that the promise rejects with the given {code}.
async function expectCode(promise, code) {
  try {
    await promise;
  } catch (e) {
    expect(e && e.code === code, `expected ${code}, got ${describe(e)}`);
    return;
  }
  throw new Error(`expected ${code}, but it resolved`);
}

async function check(name, fn) {
  line(`START ${name}`);
  try {
    await withTimeout(fn(), STEP_MS, `check ${name}`);
    pass += 1;
    line(`PASS ${name}`);
  } catch (e) {
    fail += 1;
    line(`FAIL ${name}: ${describe(e)}`);
  }
}

async function main() {
  out.textContent = "module-started";
  window.addEventListener("error", (e) => { line(`UNCAUGHT ${e.message || e}`); });
  window.addEventListener("unhandledrejection", (e) => {
    line(`UNHANDLED ${(e.reason && e.reason.message) || e.reason}`);
  });

  let db = null;
  try {
    let s;
    try {
      s = await withTimeout(import("./storage.js"), STEP_MS, "import storage.js");
      line("storage-imported");
    } catch (err) {
      line(`IMPORT-FAILED ${(err && err.message) || err}`);
      return;
    }
    // Unique database per run so reruns never see old state.
    const dbName = `selftest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      db = await withTimeout(s.openDb(dbName), STEP_MS, "openDb");
      line(`opened ${dbName}`);
    } catch (e) {
      fail += 1;
      line(`FAIL open: ${describe(e)}`);
      return;
    }

    const t = (p, label) => withTimeout(p, STEP_MS, label);
    const commit = (profileId, instanceId) => t(s.commitAnswer(db, { profileId, instanceId, stepId: "SUB8_BOTH", correct: true }), `commitAnswer ${instanceId}`);
    const listEvents = (pid) => t(s.listEvents(db, pid), `listEvents ${pid}`);
    const getCursor = (pid) => t(s.getCursor(db, pid), `getCursor ${pid}`);

    await check("commit atomic", async () => {
      await t(s.ensureProfile(db, "P1", ""), "ensureProfile P1");
      await t(s.openInstance(db, { profileId: "P1", instanceId: "I1", itemId: "E01" }), "openInstance I1");
      const result = await commit("P1", "I1");
      expect(result.sequence === 1, `sequence ${result.sequence}`);
      expect((await listEvents("P1")).length === 1, "events length not 1");
      const cursor = await getCursor("P1");
      expect(cursor.sequence === 1, `cursor sequence ${cursor.sequence}`);
      expect(cursor.currentInstanceId === null, "currentInstanceId not null");
    });

    await check("duplicate", async () => {
      await expectCode(commit("P1", "I1"), "STALE");
      expect((await listEvents("P1")).length === 1, "events changed on duplicate");
    });

    await check("stale instance", async () => {
      await t(s.openInstance(db, { profileId: "P1", instanceId: "I2", itemId: "E02" }), "openInstance I2");
      await expectCode(commit("P1", "I-OLD"), "STALE");
      expect((await listEvents("P1")).length === 1, "events changed on stale commit");
    });

    await check("profile scope", async () => {
      await t(s.ensureProfile(db, "P2", ""), "ensureProfile P2");
      await t(s.openInstance(db, { profileId: "P2", instanceId: "I3", itemId: "E01" }), "openInstance I3");
      await commit("P2", "I3");
      const p1Events = await listEvents("P1");
      expect(p1Events.length === 1, "P1 events length not 1");
      expect(p1Events.every((e) => e.profileId === "P1"), "P1 has a P2 event");
      expect((await listEvents("P2")).length === 1, "P2 events length not 1");
      await expectCode(commit("P1", "I3"), "STALE");
    });

    await check("write failure keeps prior state", async () => {
      await t(s.openInstance(db, { profileId: "P1", instanceId: "I4", itemId: "E03" }), "openInstance I4");
      const real = db.transaction.bind(db);
      db.transaction = (stores, mode) => {
        const tx = real(stores, mode);
        setTimeout(() => {
          try {
            tx.abort();
          } catch {
            // Already finished; the check below will report it.
          }
        }, 0);
        return tx;
      };
      try {
        await expectCode(commit("P1", "I4"), "WRITE_FAILED");
      } finally {
        delete db.transaction;
      }
      expect((await listEvents("P1")).length === 1, "events changed after failed write");
      const cursor = await getCursor("P1");
      expect(cursor.currentInstanceId === "I4", `currentInstanceId ${cursor.currentInstanceId}`);
    });

    await check("learner summary", async () => {
      const summary = s.learnerSummary(await listEvents("P1"));
      expect(summary.attempts === 1, `attempts ${summary.attempts}`);
      expect(summary.correct === 1, `correct ${summary.correct}`);
      expect(!Object.keys(summary).some((k) => /master/i.test(k)), "summary has a mastery-like key");
    });
  } finally {
    if (db) db.close();
    line(`DONE pass=${pass} fail=${fail}`);
  }
}
main();
