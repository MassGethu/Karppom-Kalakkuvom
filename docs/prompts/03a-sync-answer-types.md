# Codebenders High · Phase 3 sync fixes

Fix two failures before Phase 4.

1. **Sync numeric answers.** Offline E08 answer `-5` saves locally, then reconnect returns `invalid_stepId` and inserts zero rows. `storage.js` omits `value` and `api.py` requires a nonempty `stepId`. Send the signed integer, accept either a choice code or a bounded integer, and persist it with a migration compatible with existing choice rows. Replay the same numeric event as a duplicate. A different answer under the same event ID must conflict.
2. **Flush after an online save.** `app.v1.js` starts sync at startup and reconnect, but a new online answer can stay pending while the UI says synced. After a committed answer, update the pending state and schedule the existing single-flight sync when online. Preserve outbox rows on a failed POST so the Tamil Retry button can recover.

Extend `check_sync.py` with the numeric reconnect and replay, then rerun it, pytest and `check_cold_offline.py`. Report exact pass counts. Stop for independent verification.
