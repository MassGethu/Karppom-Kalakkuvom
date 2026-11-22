// Doubt flow helpers for the Tamil learner screen.
// No DOM access at import time; browser APIs are injected so the functions stay testable.

export const MAX_IMAGE_BYTES = 512000;
export const MAX_EDGE_PX = 1600;

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const JPEG_QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.4];
const REQUEST_TIMEOUT_MS = 15000;

const MESSAGES_TA = {
  offline: "இணையம் இல்லை. பின்னர் முயற்சி செய்க. பயிற்சி தொடரும்.",
  timeout: "பதில் வர நேரமானது. மீண்டும் முயற்சி செய்க.",
  too_large: "படம் மிகப் பெரியது. சிறிய படத்தை தேர்ந்தெடுக்கவும்.",
  unsupported_type: "JPEG, PNG அல்லது WEBP படத்தை மட்டும் தேர்ந்தெடுக்கவும்.",
  default: "பிழை ஏற்பட்டது. மீண்டும் முயற்சி செய்க.",
};

export function checkImageSize(bytes) {
  if (bytes <= MAX_IMAGE_BYTES) {
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: "too_large" };
}

// Share of letters (Unicode \p{L}) that fall in the Tamil block U+0B80..U+0BFF.
// Returns 1 when the text has no letters.
export function tamilLetterShare(text) {
  const letters = String(text ?? "").match(/\p{L}/gu) || [];
  if (letters.length === 0) {
    return 1;
  }
  let tamil = 0;
  for (const letter of letters) {
    const code = letter.codePointAt(0);
    if (code >= 0x0b80 && code <= 0x0bff) {
      tamil += 1;
    }
  }
  return tamil / letters.length;
}

function encodeCanvas(canvas, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("encode_failed"));
        }
      }, "image/jpeg", quality);
    } catch (err) {
      reject(err);
    }
  });
}

async function defaultBlobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

// Resize one picked image so its longest edge is at most MAX_EDGE_PX and its
// JPEG encoding is at most MAX_IMAGE_BYTES. Throws Error("unsupported_type") or
// Error("too_large"). Nothing is persisted.
export async function resizeToDataUrl(file, deps) {
  if (!file || !ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("unsupported_type");
  }

  const bitmap = await deps.createImageBitmap(file);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = deps.makeCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") {
    bitmap.close();
  }

  const toDataUrl = deps.blobToDataUrl || defaultBlobToDataUrl;
  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await encodeCanvas(canvas, quality);
    if (checkImageSize(blob.size).ok) {
      const dataUrl = await toDataUrl(blob);
      return { dataUrl, bytes: blob.size, width, height };
    }
  }
  throw new Error("too_large");
}

// POST a JSON body with the CSRF token. Throws Error("offline"),
// Error("timeout") or Error("http_<status>") for non-200 responses.
export async function postDoubt(path, body, { fetchImpl, csrfToken, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    let response;
    try {
      response = await fetchImpl(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken || "",
        },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error("timeout");
      }
      throw new Error("offline");
    }
    if (response.status !== 200) {
      throw new Error(`http_${response.status}`);
    }
    return await response.json();
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

// Tamil text shown when a doubt request fails. Accepts an Error or {message}.
export function messageForError(err) {
  const key = err && typeof err.message === "string" ? err.message : "";
  if (Object.prototype.hasOwnProperty.call(MESSAGES_TA, key)) {
    return MESSAGES_TA[key];
  }
  return MESSAGES_TA.default;
}
