// Service worker for the Tamil tutor. Classic script, served at scope "/".
// The shell lives in one versioned release cache. Install stages every shell URL and validates
// it, then promotes it; the previous release is deleted only after this one activates.
// No skipWaiting: a new worker waits so an open lesson mid-attempt is not switched.

const RELEASE_CACHE = "tutor-shell-v6";
const STAGING_CACHE = `${RELEASE_CACHE}-staging`;
const PACK_URL = "/content/pack-v1.json";
const PACK_V2_URL = "/content/pack-v2.json";
const PACK_URLS = new Set([PACK_URL, PACK_V2_URL]);
// Allowed item counts per packVersion.
const PACK_ITEM_RANGES = {
  "1": { min: 10, max: 10 },
  "2": { min: 18, max: 24 },
};
const SHELL_URLS = [
  "/",
  "/static/app.v1.css",
  "/static/app.v1.js",
  "/static/js/lesson.js",
  "/static/js/storage.js",
  "/static/js/profiles.js",
  "/static/js/evidence.js",
  "/static/js/plan.js",
  "/static/js/sync.js",
  "/static/js/doubt.js",
  PACK_URL,
  PACK_V2_URL,
  "/manifest.webmanifest",
];
const SHELL_PATHS = new Set(SHELL_URLS);
const OFFLINE_TEXT = "ஆஃப்லைன்: இணைய இணைப்பு இல்லை";
// Outcome of the most recent REPAIR, reported in every STATUS and REPAIR reply.
let lastRepair = null;

function offlineResponse() {
  return new Response(OFFLINE_TEXT, {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Throws unless the body is a pack in the pack-v1.json or pack-v2.json shape.
async function validatePack(response) {
  const data = await response.json();
  if (!data || typeof data !== "object") {
    throw new Error("Pack is not a JSON object");
  }
  if (data.packVersion === undefined || data.packVersion === null) {
    throw new Error("Pack is missing packVersion");
  }
  if (data.policyVersion === undefined || data.policyVersion === null) {
    throw new Error("Pack is missing policyVersion");
  }
  if (!Array.isArray(data.concepts)) {
    throw new Error("Pack concepts must be an array");
  }
  const version = String(data.packVersion);
  const range = PACK_ITEM_RANGES[version];
  if (!range) {
    throw new Error(`Pack has unsupported packVersion ${version}`);
  }
  if (!Array.isArray(data.items) || data.items.length < range.min || data.items.length > range.max) {
    throw new Error(`Pack must have between ${range.min} and ${range.max} items`);
  }
  const isV2 = version === "2";
  const conceptIds = new Set();
  if (isV2) {
    for (const concept of data.concepts) {
      if (!concept || typeof concept.id !== "string" || concept.id.trim() === "") {
        throw new Error("Pack concept is missing an id");
      }
      conceptIds.add(concept.id);
    }
    for (const concept of data.concepts) {
      if (!Array.isArray(concept.prerequisites)) {
        throw new Error(`Concept ${concept.id} must have a prerequisites array`);
      }
      for (const prerequisite of concept.prerequisites) {
        if (!conceptIds.has(prerequisite)) {
          throw new Error(`Concept ${concept.id} has unknown prerequisite ${prerequisite}`);
        }
      }
    }
  }
  for (const item of data.items) {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.prompt !== "string" ||
      !["choice", "numeric"].includes(item.evidenceType) ||
      item.answer === undefined
    ) {
      throw new Error("Pack item is missing required keys");
    }
    if (isV2) {
      if (typeof item.concept !== "string" || item.concept.trim() === "") {
        throw new Error(`Pack item ${item.id} has no concept`);
      }
      if (!conceptIds.has(item.concept)) {
        throw new Error(`Pack item ${item.id} references unknown concept ${item.concept}`);
      }
      if (typeof item.family !== "string" || item.family.trim() === "") {
        throw new Error(`Pack item ${item.id} has no family`);
      }
    }
    if (item.evidenceType === "choice") {
      validateChoiceItem(item);
    }
  }
}

// Throws unless a choice item has options with unique, nonempty step IDs and labels, and its
// answer names one of those step IDs. Numeric items carry no options and are not checked here.
function validateChoiceItem(item) {
  if (!Array.isArray(item.options) || item.options.length === 0) {
    throw new Error(`Choice item ${item.id} must have options`);
  }
  const stepIds = new Set();
  for (const option of item.options) {
    if (!option || typeof option.stepId !== "string" || option.stepId.trim() === "") {
      throw new Error(`Choice item ${item.id} has an option without a stepId`);
    }
    if (stepIds.has(option.stepId)) {
      throw new Error(`Choice item ${item.id} has duplicate stepId ${option.stepId}`);
    }
    stepIds.add(option.stepId);
    if (typeof option.label !== "string" || option.label.trim() === "") {
      throw new Error(`Choice item ${item.id} option ${option.stepId} has no label`);
    }
  }
  if (!stepIds.has(item.answer)) {
    throw new Error(`Choice item ${item.id} answer does not match an option`);
  }
}

// Fetch every shell URL into the staging cache and validate the pack. Throws on any failure.
async function buildStaging() {
  await caches.delete(STAGING_CACHE);
  const staging = await caches.open(STAGING_CACHE);
  const fetched = [];
  for (const url of SHELL_URLS) {
    const response = await fetch(
      new Request(url, { cache: "reload", redirect: "error" })
    );
    if (!response.ok) {
      throw new Error(`Shell fetch failed: ${url} (${response.status})`);
    }
    if (PACK_URLS.has(url)) {
      await validatePack(response.clone());
    }
    fetched.push([url, response]);
  }
  for (const [url, response] of fetched) {
    await staging.put(url, response);
  }
  const missingModules = await moduleGraphMissing(staging);
  if (missingModules.length > 0) {
    throw new Error(`Staged module graph is incomplete: ${missingModules.join(", ")}`);
  }
}

// Copy the validated staging cache into the release cache.
async function promoteStaging() {
  const staging = await caches.open(STAGING_CACHE);
  const target = await caches.open(RELEASE_CACHE);
  for (const url of SHELL_URLS) {
    const response = await staging.match(url);
    if (!response) {
      throw new Error(`Staging cache is missing ${url}`);
    }
    await target.put(url, response);
  }
  await caches.delete(STAGING_CACHE);
}

// Shell URLs absent from the cache, plus the pack when it is present but does not validate.
async function missingEntries(cache) {
  const missing = [];
  for (const url of SHELL_URLS) {
    const hit = await cache.match(url);
    if (!hit) {
      missing.push(url);
    } else if (PACK_URLS.has(url)) {
      try {
        await validatePack(hit);
      } catch {
        missing.push(url);
      }
    }
  }
  return missing;
}

// The learner app entry module. The static import graph is walked from here.
const MODULE_ENTRY = "/static/app.v1.js";
// Matches `from "x"`, `from 'x'`, and bare `import "x"`. Dynamic import() is not matched.
const STATIC_IMPORT = /\b(?:from|import)\s*["']([^"']+)["']/g;

// Relative and absolute specifiers from a module's static imports and re-exports.
function staticSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(STATIC_IMPORT)) {
    const specifier = match[1];
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

// Walks the static import graph from MODULE_ENTRY inside one cache and returns the module URLs
// that are missing. Each specifier resolves against the importing module's URL. A specifier that
// cannot be resolved is reported as missing. Each module is visited once, so cycles terminate.
// A module read that throws propagates to the caller.
async function moduleGraphMissing(cache) {
  const missing = [];
  const visited = new Set([MODULE_ENTRY]);
  const queue = [MODULE_ENTRY];
  while (queue.length > 0) {
    const current = queue.shift();
    const hit = await cache.match(current);
    if (!hit) {
      missing.push(current);
      continue;
    }
    const source = await hit.text();
    for (const specifier of staticSpecifiers(source)) {
      let resolved;
      try {
        resolved = new URL(specifier, new URL(current, self.location.origin)).pathname;
      } catch {
        missing.push(specifier);
        continue;
      }
      if (!visited.has(resolved)) {
        visited.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return missing;
}

// Re-fetches only the missing or invalid entries. Nothing is written unless every fetch and the
// fresh pack validation succeed, so a failure leaves the existing release untouched.
async function repairRelease() {
  const cache = await caches.open(RELEASE_CACHE);
  const missing = await missingEntries(cache);
  const fetched = [];
  for (const url of missing) {
    const response = await fetch(
      new Request(url, { cache: "reload", redirect: "error" })
    );
    if (!response.ok) {
      throw new Error(`Repair fetch failed: ${url} (${response.status})`);
    }
    if (PACK_URLS.has(url)) {
      await validatePack(response.clone());
    }
    fetched.push([url, response]);
  }
  for (const [url, response] of fetched) {
    await cache.put(url, response);
  }
  return missing;
}

async function runRepair() {
  try {
    const repaired = await repairRelease();
    return { ok: true, repaired, error: null };
  } catch (error) {
    return {
      ok: false,
      repaired: [],
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function navigate(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cache = await caches.open(RELEASE_CACHE);
    const cached = await cache.match("/");
    return cached || offlineResponse();
  }
}

async function cacheFirst(request, path) {
  const cache = await caches.open(RELEASE_CACHE);
  const hit = await cache.match(path);
  if (hit) {
    return hit;
  }
  try {
    return await fetch(request);
  } catch (error) {
    return offlineResponse();
  }
}

// Ready only when every SHELL_URLS entry is cached, the pack validates, and the static module
// graph from MODULE_ENTRY is fully cached. Any thrown error yields shellReady false with
// checkError true.
async function isShellReady() {
  try {
    if (!(await caches.has(RELEASE_CACHE))) {
      return {
        shellReady: false,
        checkError: false,
        error: null,
        missing: [...SHELL_URLS],
        missingModules: [],
      };
    }
    const cache = await caches.open(RELEASE_CACHE);
    const missing = await missingEntries(cache);
    const missingModules = await moduleGraphMissing(cache);
    return {
      shellReady: missing.length === 0 && missingModules.length === 0,
      checkError: false,
      error: null,
      missing,
      missingModules,
    };
  } catch (error) {
    return {
      shellReady: false,
      checkError: true,
      error: error && error.message ? error.message : String(error),
      missing: [],
      missingModules: [],
    };
  }
}

self.addEventListener("install", (event) => {
  // No skipWaiting: the new worker waits until pages on the old release have closed.
  event.waitUntil(
    (async () => {
      try {
        await buildStaging();
        await promoteStaging();
      } catch (error) {
        await caches.delete(STAGING_CACHE);
        throw error;
      }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      // Removes the previous release and any stale staging cache.
      await Promise.all(
        names
          .filter((name) => name.startsWith("tutor-") && name !== RELEASE_CACHE)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    return; // network only, never cached
  }
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }
  if (SHELL_PATHS.has(url.pathname)) {
    event.respondWith(cacheFirst(request, url.pathname));
  }
});

// STATUS and REPAIR both reply with the same shape:
// { cacheVersion, shellReady, checkError, error, missing, missingModules, lastRepair }.
// missingModules lists module URLs missing from the static import graph of MODULE_ENTRY.
// lastRepair is { ok, repaired, error } from the most recent REPAIR, or null.
self.addEventListener("message", (event) => {
  if (!event.data) {
    return;
  }
  const type = event.data.type;
  if (type !== "STATUS" && type !== "REPAIR") {
    return;
  }
  const port = event.ports && event.ports[0];
  const target = port || event.source;
  if (!target) {
    return;
  }
  event.waitUntil(
    (async () => {
      if (type === "REPAIR") {
        lastRepair = await runRepair();
      }
      const status = await isShellReady();
      target.postMessage({ cacheVersion: RELEASE_CACHE, ...status, lastRepair });
    })()
  );
});
