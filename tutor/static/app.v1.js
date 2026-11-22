// Tamil learner app for the offline slice. Vanilla ES modules; no CDN and no network
// calls beyond same-origin shell, pack and service-worker requests. Every storage call is
// scoped by the selected profile id, and switching profiles drops all on-screen state.
import {
  openDb,
  ensureProfile,
  getResumeState,
  openCurrentInstance,
  commitAnswer,
  listEvents,
  learnerSummary,
  setInstanceAssistance,
} from "./js/storage.js";
import { parseSignedInt, gradeChoice, gradeNumeric } from "./js/lesson.js";
import { projectProfile } from "./js/evidence.js";
import { nextActivity } from "./js/plan.js";
import { SAMPLE_PROFILES } from "./js/profiles.js";
import * as sync from "./js/sync.js";
import * as storageModule from "./js/storage.js";
import { resizeToDataUrl, postDoubt, messageForError } from "./js/doubt.js";

// pack-v1 is kept only so events recorded with packVersion "1" can still be replayed; the planner
// reads items from pack-v2 for every event.
const PACK_V1_URL = "/content/pack-v1.json";
const PACK_V2_URL = "/content/pack-v2.json";
const SW_URL = "/sw.js";

const TEXT = {
  pickerTitle: "மாணவர் சுயவிவரத்தைத் தேர்ந்தெடுக்கவும்",
  pickerNote: "இவை கற்பனையான மாதிரி மாணவர்கள். எதையும் உள்ளிட வேண்டியதில்லை.",
  intro: "இந்தப் பாடத்தில் சமன்பாடுகளைத் தீர்ப்போம். ஒவ்வொரு படியிலும் சமன்பாட்டின் இரு பக்கங்களும் சமமாக இருக்க வேண்டும்.",
  introFirst: "இது உங்கள் முதல் கேள்வி.",
  introResume: "நீங்கள் நிறுத்திய இடத்திலிருந்து தொடரலாம்.",
  introNone: "இந்தப் பாடத்தின் கேள்விகள் முடிந்துவிட்டன.",
  start: "தொடங்கு",
  next: "அடுத்தது",
  submit: "சமர்ப்பி",
  retry: "மீண்டும் முயற்சி",
  switchProfile: "சுயவிவரத்தை மாற்று",
  numericHint: "எதிர்க்குறி தேவையெனில் - குறியைப் பயன்படுத்தவும். எ.கா. 6 அல்லது -3",
  correct: "சரி!",
  wrong: "தவறு. மீண்டும் முயலுங்கள்.",
  hint: "மீண்டும் சிந்தியுங்கள்: சமன்பாட்டின் இரு பக்கங்களிலும் ஒரே செயலைச் செய்ய வேண்டும்.",
  invalid: "உள்ளீடு புரியவில்லை. ஒரு முழு எண்ணை உள்ளிடவும். பதில் சேமிக்கப்படவில்லை; கேள்வியும் மாறவில்லை.",
  packFailed: "பாடத் தொகுப்பை ஏற்ற முடியவில்லை. இணைய இணைப்புடன் மீண்டும் முயலவும்.",
  storageUnavailable: "இந்தச் சாதனத்தில் சேமிப்பு கிடைக்கவில்லை. பதில்கள் சேமிக்கப்பட மாட்டாது.",
  storageFailed: "சேமிப்பில் பிழை ஏற்பட்டது. முந்தைய நிலை பாதுகாக்கப்பட்டுள்ளது.",
  saveFailed: "சேமிக்க முடியவில்லை. முந்தைய நிலை பாதுகாக்கப்பட்டுள்ளது. மீண்டும் சமர்ப்பிக்கவும்.",
  stale: "இந்தக் கேள்விக்கு வேறொரு தாவலில் ஏற்கெனவே பதில் அளிக்கப்பட்டது. தற்போதைய நிலை மீண்டும் ஏற்றப்படுகிறது.",
  summaryPrefix: "இதுவரை",
  exampleAnswer: "விடை",
  exampleContinue: "தொடரவும்",
  openExample: "எடுத்துக்காட்டைக் காட்டு",
  hintButton: "குறிப்பு",
  showAnswerButton: "விடையைக் காட்டு",
  resumeLater: "பின்னர் தொடரலாம்",
};

const REASON_TEXT = {
  explain: "சமநிலை விளக்கத்தைப் படித்துவிட்டு ஒரு சரிபார்ப்புக் கேள்விக்குச் செல்கிறீர்கள்.",
  retry: "இதே வகைக் கேள்வியை மீண்டும் முயலுங்கள்.",
  repair: "இதே தவறு மீண்டும் வந்துள்ளது. எளிய சமன்பாட்டில் சமநிலையைப் பயிலுவோம்.",
  return: "சரி. இப்போது இரு படிச் சமன்பாட்டுக்குத் திரும்புகிறோம்.",
  advance: "அடுத்த பயிற்சிக் கேள்வி.",
  hint: "இதே கேள்வியை மீண்டும் முயலுங்கள்.",
};

const STATUS_TEXT = {
  idle: "",
  saving: "சேமிக்கப்படுகிறது…",
  saved: "சாதனத்தில் சேமிக்கப்பட்டது",
  failed: "சேமிக்க முடியவில்லை",
};

const CONNECTION_TEXT = {
  online: "இணைப்பு உள்ளது. பதில்கள் இந்தச் சாதனத்தில் மட்டுமே சேமிக்கப்படுகின்றன.",
  offline: "ஆஃப்லைன்: இணைய இணைப்பு இல்லை. பதில்கள் இந்தச் சாதனத்தில் சேமிக்கப்படுகின்றன.",
};

const READINESS_TEXT = {
  checking: "ஆஃப்லைன் தயார்நிலை சரிபார்க்கப்படுகிறது…",
  ready: "ஆஃப்லைன் பயன்பாட்டுக்குத் தயார்",
  notControlled: "ஆஃப்லைன் தயார்நிலைக்கு இப்பக்கத்தை ஒருமுறை மீண்டும் ஏற்றவும்",
  notReady: "பாடத் தொகுப்பு இன்னும் முழுமையாகச் சேமிக்கப்படவில்லை. ஆஃப்லைன் பாடம் இன்னும் கிடைக்கவில்லை.",
  unsupported: "இந்த உலாவியில் ஆஃப்லைன் வசதி இல்லை",
};

const CONCEPT_STATUS_TEXT = {
  unassessed: "இன்னும் மதிப்பீடு இல்லை",
  developing: "வளர்ச்சியில் உள்ளது",
  demonstrated: "உறுதிப்படுத்தப்பட்டது",
  review_due: "மீள்பார்வை தேவை",
};

// Adult summary: read-only, active learner only. Tamil copy is a draft pending review.
const ADULT_ALIAS = { "learner-a": "மாணவர் அ", "learner-b": "மாணவர் ஆ", "learner-c": "மாணவர் இ" };
const ADULT_TEXT = {
  open: "பெற்றோர்/ஆசிரியருக்கான சுருக்கம்",
  back: "திரும்பு",
  proven: "நிரூபிக்கப்பட்ட கருத்துகள்",
  provenNone: "இன்னும் இல்லை",
  difficulty: "உதவி தேவைப்படக்கூடிய இடம்",
  difficultyNone: "தற்போது கவனிக்க வேண்டியது எதுவுமில்லை",
  noEvidence: "இன்னும் சான்று இல்லை",
  evidence: "கருத்துவாரியான சான்று",
  lastAttempt: "கடைசி முயற்சி",
  noEvidenceDate: "சான்று இல்லை",
  coaching: "அடுத்த படி",
  noCoaching: "இப்போது சிறப்பு உதவி தேவையில்லை. அடுத்த பயிற்சியைத் தொடரலாம்.",
};

const app = document.getElementById("app");
const statusEl = document.getElementById("status");
const readinessEl = document.getElementById("readiness");
const retryEl = document.getElementById("shell-retry");
const connectionEl = document.getElementById("connection");
const syncStatusEl = document.getElementById("sync-status");
const syncPendingEl = document.getElementById("sync-pending-count");
const syncRetryEl = document.getElementById("sync-retry");

let db = null;
let packs = null; // { "1": pack-v1, "2": pack-v2 }, the shape plan.js and evidence.js read
let pack = null; // pack-v2: the pack new items, workedExample and end text come from
// The item on screen: { profile, instanceId, item, plan }. Null on every other screen.
let current = null;

function textEl(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(label, testid, onClick, className = "btn") {
  const node = textEl("button", label, className);
  node.type = "button";
  node.dataset.testid = testid;
  node.addEventListener("click", onClick);
  return node;
}

function screen(testid) {
  const node = document.createElement("section");
  node.className = "screen";
  node.dataset.testid = testid;
  return node;
}

function render(node) {
  app.replaceChildren(node);
}

function q(testid) {
  return app.querySelector(`[data-testid="${testid}"]`);
}

// Random event/instance id: crypto.randomUUID where available, otherwise 16 random bytes as hex.
function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function setStatus(state) {
  statusEl.dataset.state = state;
  statusEl.textContent = STATUS_TEXT[state] ?? "";
}

function renderConnection() {
  const online = navigator.onLine !== false;
  connectionEl.dataset.state = online ? "online" : "offline";
  connectionEl.textContent = online ? CONNECTION_TEXT.online : CONNECTION_TEXT.offline;
}

const SYNC_TEXT = {
  idle: "",
  pending: "ஒத்திசைக்க காத்திருக்கின்றன",
  synced: "எல்லா பதிவுகளும் சேமிக்கப்பட்டன",
  retry: "இணையம் கிடைக்கவில்லை. மீண்டும் முயற்சி செய்க",
};

// Sync status under the connection line. Synced is never shown while events remain pending.
function setSync(state, pending) {
  const shown = state === "synced" && pending > 0 ? "pending" : state;
  const known = ["pending", "synced", "retry"].includes(shown) ? shown : "idle";
  syncStatusEl.dataset.state = known;
  syncStatusEl.textContent = SYNC_TEXT[known];
  const showCount = (known === "pending" || known === "retry") && pending > 0;
  syncPendingEl.textContent = showCount ? String(pending) : "";
  syncRetryEl.hidden = known !== "retry";
}

// The csrftoken cookie value, or "" when the cookie is absent.
function readCookie(name) {
  const prefix = `${name}=`;
  const part = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : "";
}

let syncInFlight = false;

// One flush of the pending outbox. Single-flight; any failure shows retry and never throws into answering.
async function runSync() {
  if (syncInFlight || !db) return;
  syncInFlight = true;
  try {
    try {
      setSync("pending", await storageModule.countPendingOutbox(db));
      const result = await sync.flushOutbox({
        db,
        fetchImpl: fetch.bind(window),
        csrfToken: readCookie("csrftoken"),
        storageImpl: localStorage,
        storage: storageModule,
      });
      // Synced only when the flush reports an empty outbox; any other count stays pending or retry.
      const state = result.state === "synced" && result.pending !== 0 ? "pending" : result.state;
      setSync(state, result.pending);
    } finally {
      syncInFlight = false;
    }
  } catch {
    setSync("retry", 0);
  }
}

// After a committed answer: show the outbox as pending, then flush when online. Never awaited by the
// answer flow. Offline, it stays pending and the window "online" listener calls runSync later.
async function syncAfterCommit() {
  try {
    setSync("pending", await storageModule.countPendingOutbox(db));
  } catch {
    setSync("retry", 0);
  }
  if (navigator.onLine === false) return;
  runSync().catch(() => setSync("retry", 0));
}

syncRetryEl.addEventListener("click", () => runSync());

function setReadiness(state) {
  readinessEl.dataset.state = state;
  readinessEl.textContent = READINESS_TEXT[state] ?? "";
}

// One message round-trip to the controlling worker. Resolves null on timeout, a failed post or a
// missing reply, so the caller treats every such case as not ready.
function postToWorker(worker, message, timeoutMs) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data ?? null);
    };
    try {
      worker.postMessage(message, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function queryShell(worker) {
  return postToWorker(worker, { type: "STATUS" }, 3000);
}

// Ready only when the worker reports a complete shell and its check did not throw.
function isShellReadyReply(reply) {
  return Boolean(reply && reply.shellReady === true && reply.checkError !== true);
}

// True while a retry attempt runs. A click during an attempt is ignored and the button stays disabled.
let retryInFlight = false;

// Shown when the shell is not ready. The retry control stays disabled while an attempt runs.
function showRetry(visible) {
  retryEl.hidden = !visible;
  retryEl.disabled = retryInFlight;
}

async function checkReadiness() {
  if (!navigator.serviceWorker) {
    setReadiness("unsupported");
    showRetry(false);
    return;
  }
  setReadiness("checking");
  showRetry(false);
  const worker = navigator.serviceWorker.controller;
  if (!worker) {
    // Nothing controls the page, so no offline shell can be confirmed. Offer retry, never ready.
    setReadiness("notReady");
    showRetry(true);
    return;
  }
  const ready = isShellReadyReply(await queryShell(worker));
  setReadiness(ready ? "ready" : "notReady");
  showRetry(!ready);
  if (ready) runSync();
}

// Resolves once the worker is activated or redundant, or parked as "installed" (waiting), which
// without a controller would never progress on its own.
function settleWorker(worker) {
  return new Promise((resolve) => {
    const settled = () => ["activated", "redundant", "installed"].includes(worker.state);
    if (settled()) {
      resolve();
      return;
    }
    worker.addEventListener("statechange", () => {
      if (settled()) resolve();
    });
  });
}

// No controlling worker: register again so the browser re-runs install after a failed one, then
// wait for that worker to settle. Ready is decided only by checkReadiness, never by register().
async function acquireController() {
  let registration;
  try {
    registration = await navigator.serviceWorker.register(SW_URL);
  } catch {
    setReadiness("notReady");
    showRetry(true);
    return;
  }
  const worker = registration.installing || registration.waiting;
  if (!worker) {
    await checkReadiness();
    return;
  }
  await settleWorker(worker);
  if (worker.state === "redundant") {
    setReadiness("notReady");
    showRetry(true);
    return;
  }
  await checkReadiness();
}

// Retry. With a controlling worker, ask it to re-fetch missing or invalid entries; without one,
// start a new acquisition. Only one attempt runs at a time; the flag clears even when it fails.
async function repairShell() {
  if (retryInFlight) return;
  retryInFlight = true;
  retryEl.disabled = true;
  try {
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!worker) {
      await acquireController();
      return;
    }
    await postToWorker(worker, { type: "REPAIR" }, 20000);
    await checkReadiness();
  } finally {
    retryInFlight = false;
    retryEl.disabled = false;
    runSync();
  }
}

retryEl.addEventListener("click", () => repairShell());

async function registerWorker() {
  if (!navigator.serviceWorker) {
    setReadiness("unsupported");
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", checkReadiness);
  try {
    await navigator.serviceWorker.register(SW_URL);
  } catch {
    setReadiness("notReady");
    return;
  }
  checkReadiness();
}

async function loadPack(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`pack ${response.status}`);
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.items)) {
    throw new Error("pack has no items");
  }
  return data;
}

function itemById(id) {
  const item = pack.items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`unknown item ${id}`);
  }
  return item;
}

function conceptName(item) {
  return pack.concepts.find((concept) => concept.id === item.concept)?.nameTa ?? "";
}

function interventionBody(interventionId) {
  return pack.interventions.find((intervention) => intervention.id === interventionId)?.bodyTa ?? "";
}

// The reasonCode an item's answer is saved with, taken from the activity that opened the item.
// plan.js counts only "remediation" toward its cap; "repair" marks an equality-repair item.
function reasonCodeFor(activity) {
  if (activity?.kind === "intervention") return "remediation";
  if (activity?.kind === "repair") return "repair";
  return "practice";
}

// The planner activity that set the saved cursor. nextActivity is deterministic, so replaying it on the
// last committed event gives the activity the answered screen showed. Null when it does not name the cursor item.
function cursorActivity(events, resume) {
  const last = events.find((e) => e.sequence === resume.answeredCount);
  if (!last) return null;
  const activity = nextActivity(packs, events, last);
  return (activity.itemId ?? null) === (resume.currentItemId ?? null) ? activity : null;
}

// One row per concept with its status word from projectProfile. No percentages.
async function conceptStatusList(profileId) {
  const { concepts } = projectProfile(packs, await listEvents(db, profileId));
  const list = document.createElement("ul");
  list.className = "concept-status-list";
  for (const concept of pack.concepts) {
    const status = concepts[concept.id].status;
    const row = textEl("li", `${concept.nameTa}: ${CONCEPT_STATUS_TEXT[status]}`, "concept-status");
    row.dataset.testid = "concept-status";
    row.dataset.conceptId = concept.id;
    row.dataset.status = status;
    list.append(row);
  }
  return list;
}

// The button that opens the adult summary. returnNode is the screen Back redraws; mine is the open
// item (item screen only), so the button does nothing while that item is saving or has moved on.
function adultOpenButton(profile, returnNode, mine = null) {
  return button(
    ADULT_TEXT.open,
    "adult-summary-open",
    () => {
      if (mine && (current !== mine || mine.busy)) return;
      openAdultSummary(profile, returnNode, mine);
    },
    "btn quiet",
  );
}

// Reads this profile's events only: no write, no network. Renders only while returnNode is still the
// screen on show, so a late read never paints over the picker or another learner's screen.
async function openAdultSummary(profile, returnNode, mine = null) {
  let events;
  try {
    events = await listEvents(db, profile.id);
  } catch {
    if (app.firstElementChild === returnNode) showStorageError(profile);
    return;
  }
  if (app.firstElementChild !== returnNode) return;
  if (mine && (current !== mine || mine.busy)) return;
  render(adultSummaryNode(profile, returnNode, events));
}

function adultDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("ta-IN");
}

// A heading and a list of concept names, or a note when empty. Empty with no note renders nothing.
function adultSection(heading, concepts, emptyText) {
  if (concepts.length === 0 && !emptyText) return [];
  const nodes = [textEl("h2", heading)];
  if (concepts.length === 0) {
    nodes.push(textEl("p", emptyText, "note"));
    return nodes;
  }
  const list = document.createElement("ul");
  list.className = "adult-list";
  for (const concept of concepts) list.append(textEl("li", concept.nameTa));
  nodes.push(list);
  return nodes;
}

// Builds the summary from this profile's projection only. Back redraws returnNode as it was.
function adultSummaryNode(profile, returnNode, events) {
  const { concepts } = projectProfile(packs, events);
  const node = screen("adult-summary");
  node.classList.add("adult-summary");
  node.dataset.profileId = profile.id;

  const proven = pack.concepts.filter((c) => concepts[c.id].status === "demonstrated");
  // Graph order: pack.concepts is ordered, so the first match is the coaching target.
  const difficult = pack.concepts.filter((c) => {
    const state = concepts[c.id];
    return (state.status === "developing" || state.status === "review_due") && state.independentIncorrect > 0;
  });
  const unassessed = pack.concepts.filter((c) => concepts[c.id].status === "unassessed");

  const target = difficult[0] ?? null;
  const intervention = target ? pack.interventions.find((i) => i.conceptId === target.id) : null;
  const action = document.createElement("div");
  action.className = "adult-action";
  action.dataset.testid = "adult-coaching-action";
  if (intervention) {
    action.append(
      textEl("p", intervention.titleTa, "concept"),
      textEl("p", intervention.bodyTa, "intervention"),
    );
  } else {
    action.textContent = ADULT_TEXT.noCoaching;
  }

  const freshness = document.createElement("ul");
  freshness.className = "adult-list";
  for (const concept of pack.concepts) {
    const last = concepts[concept.id].lastObservedAt;
    const when = last ? `${ADULT_TEXT.lastAttempt}: ${adultDate(last)}` : ADULT_TEXT.noEvidenceDate;
    freshness.append(textEl("li", `${concept.nameTa}: ${when}`));
  }

  const back = button(ADULT_TEXT.back, "adult-back", () => render(returnNode), "btn primary");
  node.append(
    textEl("h2", `சுயவிவரம்: ${ADULT_ALIAS[profile.id] ?? profile.alias}`),
    ...adultSection(ADULT_TEXT.proven, proven, ADULT_TEXT.provenNone),
    ...adultSection(ADULT_TEXT.difficulty, difficult, ADULT_TEXT.difficultyNone),
    ...adultSection(ADULT_TEXT.noEvidence, unassessed, null),
    textEl("h2", ADULT_TEXT.evidence),
    freshness,
    textEl("h2", ADULT_TEXT.coaching),
    action,
    back,
    button(TEXT.switchProfile, "switch-profile", () => showPicker(), "btn quiet"),
  );
  return node;
}

async function summaryText(profileId) {
  const summary = learnerSummary(await listEvents(db, profileId));
  return `${TEXT.summaryPrefix} முயற்சிகள்: ${summary.attempts}; சரியானவை: ${summary.correct}; தவறானவை: ${summary.incorrect}`;
}

function showPackError() {
  const node = screen("pack-error");
  node.append(
    textEl("p", TEXT.packFailed, "notice"),
    button(TEXT.retry, "retry-load", () => loadAndShow()),
  );
  render(node);
}

function showPicker(notice) {
  current = null;
  setStatus("idle");
  const node = screen("profile-picker");
  node.append(textEl("h2", TEXT.pickerTitle), textEl("p", TEXT.pickerNote, "note"));
  if (notice) node.append(textEl("p", notice, "notice"));
  for (const profile of SAMPLE_PROFILES) {
    node.append(
      button(profile.alias, `profile-${profile.id}`, () => showIntro(profile), "btn profile"),
    );
  }
  render(node);
}

function showStorageError(profile) {
  current = null;
  const node = screen("storage-error");
  node.append(
    textEl("p", TEXT.storageFailed, "notice"),
    button(TEXT.retry, "retry-profile", () => showIntro(profile)),
    button(TEXT.switchProfile, "switch-profile", () => showPicker(), "btn quiet"),
  );
  render(node);
}

// End screen. plan is the planner result that ended the path. A recap shows its intervention body;
// exhausted and done show the planner's reason; with no plan (a reload with no open item) the
// pack's exhausted text is shown.
async function showEnd(profile, plan = null) {
  current = null;
  setStatus("idle");
  try {
    const node = screen("end");
    const isRecap = plan?.kind === "recap";
    const endText = textEl("p", isRecap ? TEXT.resumeLater : (plan?.reasonTa ?? pack.exhaustedText), "end-text");
    endText.dataset.testid = "end-state";
    node.append(textEl("h2", TEXT.introNone));
    if (isRecap) {
      const body = textEl("p", interventionBody(plan.interventionId), "intervention");
      body.dataset.testid = "intervention-text";
      node.append(body);
    }
    node.append(
      endText,
      await conceptStatusList(profile.id),
      textEl("p", await summaryText(profile.id), "summary"),
      adultOpenButton(profile, node),
      button(TEXT.switchProfile, "switch-profile", () => showPicker(), "btn quiet"),
    );
    render(node);
  } catch {
    showStorageError(profile);
  }
}

// Intro for a selected profile. Every profile starts from the same diagnostic; ensureProfile is
// idempotent and never overwrites an existing record.
async function showIntro(profile, notice) {
  current = null;
  setStatus("idle");
  try {
    await ensureProfile(db, profile.id, profile.alias);
    const resume = await getResumeState(db, profile.id);
    const node = screen("intro");
    node.dataset.profileId = profile.id;
    node.append(
      textEl("h2", `சுயவிவரம்: ${profile.alias}`),
      textEl("p", TEXT.intro, "intro"),
    );
    if (notice) {
      const noticeEl = textEl("p", notice, "notice");
      noticeEl.dataset.testid = "stale-notice";
      node.append(noticeEl);
    }
    if (resume.currentItemId) {
      node.append(
        textEl("p", resume.answeredCount === 0 ? TEXT.introFirst : TEXT.introResume, "note"),
        textEl("p", conceptName(itemById(resume.currentItemId)), "concept"),
      );
    } else if (resume.answeredCount === 0) {
      node.append(textEl("p", TEXT.introFirst, "note"));
    } else {
      node.append(textEl("p", TEXT.introNone, "note"));
    }
    node.append(
      button(TEXT.start, "intro-start", () => startLesson(profile), "btn primary"),
      await conceptStatusList(profile.id),
      textEl("p", await summaryText(profile.id), "summary"),
      adultOpenButton(profile, node),
      button(TEXT.switchProfile, "switch-profile", () => showPicker(), "btn quiet"),
    );
    render(node);
  } catch (error) {
    if (error && error.code === "STALE") {
      await showIntro(profile, TEXT.stale);
      return;
    }
    showStorageError(profile);
  }
}

// A new learner (no saved cursor) sees the worked example first; returning learners go straight
// to their saved item.
async function startLesson(profile) {
  try {
    const resume = await getResumeState(db, profile.id);
    if (pack.workedExample && !resume.currentItemId && resume.answeredCount === 0) {
      showExample(profile, () => enterLesson(profile));
      return;
    }
    await enterLesson(profile);
  } catch {
    showStorageError(profile);
  }
}

// A saved cursor item always wins over the planner. A learner with no saved item and no answers
// (new) gets the planner's first activity; openCurrentInstance uses it only when no cursor exists.
async function enterLesson(profile) {
  try {
    const resume = await getResumeState(db, profile.id);
    const events = await listEvents(db, profile.id);
    let activity = null;
    if (!resume.currentItemId && resume.answeredCount === 0) {
      activity = nextActivity(packs, events, null);
    } else if (resume.answeredCount > 0) {
      activity = cursorActivity(events, resume);
    }
    const opened = await openCurrentInstance(db, profile.id, null, {
      instanceId: newId(),
      startItemId: activity?.itemId ?? null,
    });
    if (!opened.ok) {
      await showEnd(profile, activity);
      return;
    }
    showItem(profile, opened.instanceId, opened.itemId, activity);
  } catch {
    showStorageError(profile);
  }
}

// Worked example from pack.workedExample (problem, Tamil steps, solution check). Shown before the
// first diagnostic and from the item screen; onContinue returns the learner to the lesson.
function showExample(profile, onContinue) {
  const example = pack.workedExample;
  const node = screen("worked-example");
  node.dataset.profileId = profile.id;
  const steps = document.createElement("ol");
  steps.className = "steps";
  for (const step of example.stepsTa) steps.append(textEl("li", step));
  node.append(
    textEl("p", example.equation, "prompt equation"),
    steps,
    textEl("p", `${TEXT.exampleAnswer}: ${example.solution}`, "answer"),
    button(TEXT.exampleContinue, "example-continue", onContinue, "btn primary"),
  );
  render(node);
}

// Doubt panel. Its markup is cloned from #doubt-template in index.html and placed in the item screen,
// so the item element and its data-item-id are not touched. The photo and typed text are held only in
// the closure built by doubtControls: close clears them, and rendering another screen drops them.
const DOUBT_SOURCE_TEXT = { provider: "வழங்குநரின் பதில்", fallback: "நிலையான பதில்" };
// Set by showItem to the panel on screen; the window online/offline events refresh it.
let refreshDoubtUi = null;

// Failed request or resize -> message key. HTTP 413 and 415 map to the size and type messages.
function doubtFailureKey(err) {
  const message = err && err.message;
  if (message === "http_413") return "too_large";
  if (message === "http_415") return "unsupported_type";
  return message;
}

function doubtRequestOptions() {
  return { fetchImpl: fetch.bind(window), csrfToken: readCookie("csrftoken") };
}

// Converts the resized data: URL to a Blob so the preview can use an object URL.
function dataUrlToBlob(dataUrl) {
  const type = dataUrl.slice(5, dataUrl.indexOf(";"));
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Builds one doubt panel for the item in mine. Returns the root to place in the item screen and refresh,
// which applies offline state and the send/transcribe enablement.
function doubtControls(mine) {
  const root = document.getElementById("doubt-template").content.firstElementChild.cloneNode(true);
  const find = (testid) => root.querySelector(`[data-testid="${testid}"]`);
  const askButton = find("ask-doubt");
  const panel = find("doubt-panel");
  const closeButton = find("doubt-close");
  const text = find("doubt-text");
  const photo = find("doubt-photo");
  const preview = find("doubt-preview");
  const transcribeButton = find("doubt-transcribe");
  const equationEdit = find("doubt-equation-edit");
  const sendButton = find("doubt-send");
  const noteEl = find("doubt-note");
  const hintEl = find("doubt-hint");
  const checkEl = find("doubt-check");
  const sourceEl = find("doubt-source");
  const errorEl = find("doubt-error");
  const resizeDeps = {
    createImageBitmap: (file) => createImageBitmap(file),
    makeCanvas: () => document.createElement("canvas"),
  };

  let imageDataUrl = null; // resized photo, in memory only
  let previewUrl = null; // object URL of the preview; revoked on close or reselect
  let pending = false; // one request at a time
  let session = 0; // bumped on close so replies that arrive later are dropped
  const offlineText = messageForError({ message: "offline" });

  const isOffline = () => navigator.onLine === false;

  function showFailure(err) {
    errorEl.textContent = messageForError({ message: doubtFailureKey(err) });
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }

  function showNote(textTa) {
    noteEl.textContent = textTa || "";
    noteEl.hidden = !textTa;
  }

  function clearResults() {
    hintEl.textContent = "";
    hintEl.hidden = true;
    checkEl.textContent = "";
    checkEl.hidden = true;
    sourceEl.textContent = "";
    sourceEl.hidden = true;
    delete sourceEl.dataset.source;
    showNote("");
  }

  function showTutorReply(data) {
    hintEl.textContent = data.hintTa || "";
    hintEl.hidden = !data.hintTa;
    checkEl.textContent = data.checkQuestionTa || "";
    checkEl.hidden = !data.checkQuestionTa;
    const source = data.source === "provider" ? "provider" : "fallback";
    sourceEl.dataset.source = source;
    sourceEl.textContent = DOUBT_SOURCE_TEXT[source];
    sourceEl.hidden = false;
    showNote(data.messageTa);
  }

  function refresh() {
    const offline = isOffline();
    if (offline) {
      errorEl.textContent = offlineText;
      errorEl.hidden = false;
    } else if (errorEl.textContent === offlineText) {
      clearError();
    }
    askButton.disabled = offline;
    transcribeButton.disabled = offline || pending || !imageDataUrl;
    const hasDoubt = text.value.trim() !== "" || equationEdit.value.trim() !== "";
    sendButton.disabled = offline || pending || !hasDoubt;
  }

  function revokePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.removeAttribute("src");
    preview.hidden = true;
  }

  // Drops every in-memory doubt value and invalidates any request still in flight.
  function clearDoubt() {
    session += 1;
    pending = false;
    revokePreview();
    imageDataUrl = null;
    photo.value = "";
    text.value = "";
    equationEdit.value = "";
    clearResults();
    clearError();
    refresh();
  }

  // Selecting a photo only resizes and previews it. Nothing is uploaded until the explicit transcribe tap.
  photo.addEventListener("change", async () => {
    const file = photo.files && photo.files[0];
    const mySession = session;
    revokePreview();
    imageDataUrl = null;
    clearResults();
    clearError();
    if (file) {
      try {
        const resized = await resizeToDataUrl(file, resizeDeps);
        if (mySession !== session) return;
        imageDataUrl = resized.dataUrl;
        previewUrl = URL.createObjectURL(dataUrlToBlob(resized.dataUrl));
        preview.src = previewUrl;
        preview.hidden = false;
      } catch (err) {
        if (mySession !== session) return;
        showFailure(err);
      }
    }
    refresh();
  });

  transcribeButton.addEventListener("click", async () => {
    if (pending || !imageDataUrl || isOffline()) {
      refresh();
      return;
    }
    const mySession = session;
    pending = true;
    clearError();
    refresh();
    try {
      const data = await postDoubt("/api/doubt/transcribe", { image: imageDataUrl }, doubtRequestOptions());
      if (mySession !== session) return;
      equationEdit.value = data.equation ?? "";
      showNote(data.messageTa);
    } catch (err) {
      if (mySession !== session) return;
      showFailure(err);
    } finally {
      if (mySession === session) {
        pending = false;
        refresh();
      }
    }
  });

  // Sends the equation exactly as the learner left it in the edit box, or null when that box is empty.
  sendButton.addEventListener("click", async () => {
    const typed = text.value.trim();
    const hasEquation = equationEdit.value.trim() !== "";
    if (pending || isOffline() || (typed === "" && !hasEquation)) {
      refresh();
      return;
    }
    const mySession = session;
    pending = true;
    clearError();
    clearResults();
    refresh();
    try {
      const data = await postDoubt(
        "/api/doubt/tutor",
        {
          profileId: mine.profile.id,
          conceptId: mine.item.concept,
          equation: hasEquation ? equationEdit.value : null,
          doubt: typed,
        },
        doubtRequestOptions(),
      );
      if (mySession !== session) return;
      showTutorReply(data);
    } catch (err) {
      if (mySession !== session) return;
      showFailure(err);
    } finally {
      if (mySession === session) {
        pending = false;
        refresh();
      }
    }
  });

  askButton.addEventListener("click", () => {
    panel.hidden = false;
    refresh();
  });
  closeButton.addEventListener("click", () => {
    panel.hidden = true;
    clearDoubt();
    askButton.focus();
  });
  text.addEventListener("input", refresh);
  equationEdit.addEventListener("input", refresh);

  refresh();
  return { root, refresh };
}

// activity is the planner result that led to this item (null after a reload). Its reason sits above
// the item; an intervention's body is shown before the item.
function showItem(profile, instanceId, itemId, activity = null) {
  const item = itemById(itemId);
  current = { profile, instanceId, item, plan: null, assistance: "none", reasonCode: reasonCodeFor(activity) };
  const mine = current;
  setStatus("idle");

  const node = screen("item");
  node.dataset.itemId = item.id;
  node.append(
    textEl("p", `சுயவிவரம்: ${profile.alias}`, "meta"),
    textEl("p", conceptName(item), "concept"),
  );
  if (activity?.reasonTa) {
    const reason = textEl("p", activity.reasonTa, "reason");
    reason.dataset.testid = "next-reason";
    node.append(reason);
  }
  if (activity?.kind === "intervention") {
    const body = textEl("p", interventionBody(activity.interventionId), "intervention");
    body.dataset.testid = "intervention-text";
    node.append(body);
  }
  node.append(textEl("p", item.prompt, "prompt equation"));

  const answers = document.createElement("div");
  answers.className = "answers";
  answers.dataset.testid = "answers";
  // Hint and show-answer live inside #answers so the submit-time disable and hide cover them too.
  const hintText = textEl("p", "", "aid");
  hintText.dataset.testid = "hint-text";
  hintText.hidden = true;
  const explanationText = textEl("p", "", "aid");
  explanationText.dataset.testid = "explanation-text";
  explanationText.hidden = true;
  answers.append(
    button(TEXT.hintButton, "hint-button", () => useAid(mine, "hint", item.hintTa, hintText), "btn quiet"),
    button(
      TEXT.showAnswerButton,
      "show-answer-button",
      () => useAid(mine, "answer_shown", item.explanationTa, explanationText),
      "btn quiet",
    ),
    hintText,
    explanationText,
  );
  if (item.evidenceType === "choice") {
    for (const option of item.options) {
      answers.append(
        button(option.label, `answer-option-${option.stepId}`, () =>
          submitAnswer({ stepId: option.stepId }), "btn option"),
      );
    }
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "எ.கா. 6";
    input.setAttribute("aria-label", "உங்கள் பதில்");
    input.dataset.testid = "answer-input";
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitAnswer({ text: input.value });
      }
    });
    answers.append(
      input,
      textEl("p", TEXT.numericHint, "note"),
      button(TEXT.submit, "answer-submit", () => submitAnswer({ text: input.value }), "btn primary"),
    );
  }

  const feedback = textEl("div", "", "feedback");
  feedback.dataset.testid = "feedback";
  feedback.setAttribute("aria-live", "polite");
  // Shown only after a wrong one-side subtraction choice (see submitAnswer).
  const balanceText = textEl("p", "", "aid");
  balanceText.dataset.testid = "balance-explanation";
  balanceText.hidden = true;

  const next = button(
    TEXT.next,
    "next-item",
    () => goNext(profile, current?.plan, current?.expected),
    "btn primary",
  );
  next.hidden = true;

  const summary = textEl("p", "", "summary");
  summary.dataset.testid = "summary";
  const nodes = [answers, feedback, balanceText, next, summary];
  if (pack.workedExample) {
    // Returns to this same item screen (DOM and feedback preserved) when the example is closed.
    nodes.push(
      button(
        TEXT.openExample,
        "open-example",
        () => {
          if (current !== mine || mine.busy) return;
          showExample(profile, () => render(node));
        },
        "btn quiet",
      ),
    );
  }
  const doubt = doubtControls(mine);
  refreshDoubtUi = doubt.refresh;
  node.append(
    ...nodes,
    doubt.root,
    adultOpenButton(profile, node, mine),
    button(TEXT.switchProfile, "switch-profile", () => showPicker(), "btn quiet"),
  );
  render(node);
  summaryText(profile.id)
    .then((text) => {
      const target = q("summary");
      if (target && current && current.profile === profile) target.textContent = text;
    })
    .catch(() => {});
}

// Records an assistance level on the open instance before the answer is submitted, then reveals the
// text. Assistance only rises. A failed write shows the save error and reveals nothing.
async function useAid(mine, level, text, box) {
  if (current !== mine || mine.busy || mine.plan) return;
  try {
    await setInstanceAssistance(db, mine.instanceId, level);
  } catch {
    if (current === mine) {
      const feedback = q("feedback");
      feedback.textContent = TEXT.saveFailed;
      feedback.dataset.tone = "error";
    }
    return;
  }
  if (current !== mine || mine.plan) return;
  if (level === "answer_shown") mine.assistance = "answer_shown";
  else if (mine.assistance === "none") mine.assistance = "hint";
  box.textContent = text;
  box.hidden = false;
}

// Grades one submission, commits it with the instance and cursor check, then shows the result.
// Invalid input is rejected before any write. Failed writes keep the answer retryable.
async function submitAnswer(raw) {
  if (!current || current.plan) return;
  if (current.busy) return;
  const mine = current;
  const { profile, instanceId, item } = mine;
  const isChoice = item.evidenceType === "choice";
  const feedback = q("feedback");

  let graded;
  let value = null;
  if (isChoice) {
    graded = gradeChoice(item, raw.stepId);
  } else {
    graded = gradeNumeric(item, raw.text);
    if (graded.ok) value = parseSignedInt(raw.text).value;
  }
  if (!graded.ok) {
    feedback.textContent = TEXT.invalid;
    feedback.dataset.tone = "error";
    return;
  }

  const verdict = {
    itemId: item.id,
    kind: isChoice ? "choice" : "numeric",
    stepId: isChoice ? raw.stepId : null,
    correct: graded.correct,
  };
  const answers = q("answers");
  mine.busy = true;
  for (const control of answers.querySelectorAll("button, input")) control.disabled = true;
  setStatus("saving");
  try {
    const events = await listEvents(db, profile.id);
    // The answer being saved, shaped like a committed event, so the planner sees it before the write.
    const lastEvent = {
      sequence: events.reduce((max, e) => Math.max(max, e.sequence), 0) + 1,
      itemId: item.id,
      packVersion: pack.packVersion,
      stepId: verdict.stepId,
      correct: verdict.correct,
      assistance: mine.assistance,
      reasonCode: mine.reasonCode,
      createdAt: new Date().toISOString(),
    };
    const plan = nextActivity(packs, events, lastEvent);
    const committed = await commitAnswer(db, {
      profileId: profile.id,
      instanceId,
      packVersion: pack.packVersion,
      policyVersion: pack.policyVersion,
      stepId: verdict.stepId,
      value,
      correct: verdict.correct,
      reasonCode: mine.reasonCode,
      nextItemId: plan.itemId ?? null,
    });
    syncAfterCommit();
    mine.busy = false;
    if (current !== mine) return; // profile switched while saving; the write stays on its own profile
    mine.plan = plan;
    // The cursor this screen now believes in; Next is checked against it before opening anything.
    mine.expected = { sequence: committed.sequence, itemId: plan.itemId ?? null };
    setStatus("saved");
    const lines = [verdict.correct ? TEXT.correct : TEXT.wrong, item.feedback];
    feedback.textContent = lines.join(" ");
    feedback.dataset.tone = verdict.correct ? "correct" : "wrong";
    // Phase 1 explained the balance idea after a wrong one-side subtraction choice; pack-v2 carries that text on E01.
    const chosen = isChoice ? item.options.find((o) => o.stepId === raw.stepId) : null;
    const sideError = !verdict.correct && chosen?.misconception === "one_side_subtraction";
    const balance = sideError ? (item.balanceExplanation ?? null) : null;
    const balanceEl = q("balance-explanation");
    balanceEl.textContent = balance ?? "";
    balanceEl.hidden = !balance;
    answers.hidden = true;
    q("next-item").hidden = false;
  } catch (error) {
    mine.busy = false;
    if (current !== mine) return;
    if (error && error.code === "STALE") {
      await showIntro(profile, TEXT.stale);
      return;
    }
    setStatus("failed");
    feedback.textContent = TEXT.saveFailed;
    feedback.dataset.tone = "error";
    for (const control of answers.querySelectorAll("button, input")) control.disabled = false;
  }
}

// expected is the cursor the answered screen saw. If another tab has moved the cursor, nothing is
// written and the saved state is re-read instead.
async function goNext(profile, plan, expected) {
  if (!plan) return;
  if (!plan.itemId) {
    await showEnd(profile, plan);
    return;
  }
  try {
    const opened = await openCurrentInstance(db, profile.id, expected, { instanceId: newId() });
    if (!opened.ok) {
      await showIntro(profile, TEXT.stale);
      return;
    }
    showItem(profile, opened.instanceId, opened.itemId, plan);
  } catch {
    showStorageError(profile);
  }
}

async function loadAndShow() {
  if (!db) {
    try {
      db = await openDb();
    } catch {
      db = null;
    }
  }
  try {
    const [packV1, packV2] = await Promise.all([loadPack(PACK_V1_URL), loadPack(PACK_V2_URL)]);
    if (!Array.isArray(packV2.concepts) || !Array.isArray(packV2.interventions)) {
      throw new Error("pack-v2 has no concepts or interventions");
    }
    packs = { "1": packV1, "2": packV2 };
    pack = packV2;
  } catch {
    showPackError();
    return;
  }
  showPicker(db ? "" : TEXT.storageUnavailable);
}

async function boot() {
  renderConnection();
  window.addEventListener("online", renderConnection);
  window.addEventListener("online", runSync);
  window.addEventListener("offline", renderConnection);
  window.addEventListener("online", () => refreshDoubtUi?.());
  window.addEventListener("offline", () => refreshDoubtUi?.());
  registerWorker();
  await loadAndShow();
  runSync();
}

boot();
