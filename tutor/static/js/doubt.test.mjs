import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_IMAGE_BYTES,
  checkImageSize,
  tamilLetterShare,
  messageForError,
  resizeToDataUrl,
  postDoubt,
} from "./doubt.js";

test("checkImageSize accepts the 512000 byte limit and rejects one byte more", () => {
  assert.equal(MAX_IMAGE_BYTES, 512000);
  assert.equal(checkImageSize(512000).ok, true);
  assert.equal(checkImageSize(512001).ok, false);
  assert.equal(checkImageSize(512001).reason, "too_large");
});

test("tamilLetterShare handles empty, Latin and Tamil text", () => {
  assert.equal(tamilLetterShare(""), 1);
  assert.equal(tamilLetterShare("abc"), 0);
  assert.equal(tamilLetterShare("கணக்கு"), 1);
});

test("messageForError maps known error codes to Tamil text", () => {
  assert.equal(
    messageForError({ message: "offline" }),
    "இணையம் இல்லை. பின்னர் முயற்சி செய்க. பயிற்சி தொடரும்."
  );
  assert.equal(
    messageForError(new Error("timeout")),
    "பதில் வர நேரமானது. மீண்டும் முயற்சி செய்க."
  );
  assert.equal(
    messageForError(new Error("too_large")),
    "படம் மிகப் பெரியது. சிறிய படத்தை தேர்ந்தெடுக்கவும்."
  );
  assert.equal(
    messageForError(new Error("unsupported_type")),
    "JPEG, PNG அல்லது WEBP படத்தை மட்டும் தேர்ந்தெடுக்கவும்."
  );
  assert.equal(
    messageForError(new Error("http_500")),
    "பிழை ஏற்பட்டது. மீண்டும் முயற்சி செய்க."
  );
});

function fakeDeps(blobSize) {
  return {
    createImageBitmap: async () => ({ width: 800, height: 600, close() {} }),
    makeCanvas: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob(callback) {
        callback({ size: blobSize, type: "image/jpeg" });
      },
    }),
    blobToDataUrl: async () => "data:image/jpeg;base64,AA==",
  };
}

test("resizeToDataUrl rejects GIF with unsupported_type", async () => {
  await assert.rejects(
    resizeToDataUrl({ type: "image/gif" }, fakeDeps(1000)),
    (err) => err.message === "unsupported_type"
  );
});

test("resizeToDataUrl throws too_large when every encode stays above the limit", async () => {
  await assert.rejects(
    resizeToDataUrl({ type: "image/jpeg" }, fakeDeps(600000)),
    (err) => err.message === "too_large"
  );
});

test("resizeToDataUrl succeeds when the encoded blob is small", async () => {
  const result = await resizeToDataUrl({ type: "image/png" }, fakeDeps(1000));
  assert.equal(result.dataUrl, "data:image/jpeg;base64,AA==");
  assert.equal(result.bytes, 1000);
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
});

test("postDoubt maps a network failure to offline", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    postDoubt("/api/doubt/tutor", {}, { fetchImpl, csrfToken: "t" }),
    (err) => err.message === "offline"
  );
});

test("postDoubt maps an abort to timeout", async () => {
  const fetchImpl = async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  await assert.rejects(
    postDoubt("/api/doubt/tutor", {}, { fetchImpl, csrfToken: "t" }),
    (err) => err.message === "timeout"
  );
});

test("postDoubt maps a 500 to http_500", async () => {
  const fetchImpl = async () => ({ status: 500, ok: false, json: async () => ({}) });
  await assert.rejects(
    postDoubt("/api/doubt/tutor", {}, { fetchImpl, csrfToken: "t" }),
    (err) => err.message === "http_500"
  );
});

test("postDoubt returns parsed JSON on 200 and sends the CSRF header", async () => {
  let seenHeaders = null;
  const fetchImpl = async (path, init) => {
    seenHeaders = init.headers;
    return { status: 200, ok: true, json: async () => ({ hintTa: "குறிப்பு" }) };
  };
  const data = await postDoubt("/api/doubt/tutor", { doubt: "x" }, { fetchImpl, csrfToken: "tok" });
  assert.deepEqual(data, { hintTa: "குறிப்பு" });
  assert.equal(seenHeaders["X-CSRFToken"], "tok");
});
