# Codebenders High · Phase 3 reconnect sync

Build one real reconnect flow for the existing Tamil tutor. Phase 2 cold-offline Adult and Back passed in Chromium.

- Reuse the IndexedDB events and pending outbox in `tutor/static/js/storage.js`. Flush on startup, reconnect or Tamil Retry while the app is open. Send up to 25 pending events per batch. Remove only markers explicitly acknowledged by the server and retain local learner history.
- Add same-origin Django `POST /api/session` and `POST /api/progress/events` with SQLite persistence, a server-issued installation session, CSRF protection and install-scoped synthetic profiles. Validate event fields and versions 1 and 2. Enforce uniqueness on `(install, eventId)` and `(install, profileId, sequence)`. Acknowledge exact retries without inserting again. Reject conflicting payloads.
- Keep practice and the adult view local. Leave pending events intact on a timeout or failed response. Show pending, synced and retry states in Tamil. Keep APIs network-only and leave cloud restore and AI for later.

**Done when** a real Chromium offline answer survives reload, reconnect stores it in SQLite, and replaying the same batch leaves exactly one server row per event. Verify a failed request leaves the outbox intact and rerun the cold-offline test. Report the commands and results, then stop.
