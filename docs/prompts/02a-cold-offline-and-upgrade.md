# Codebenders High · Phase 2 offline fix

Fix the cold offline boot and prove the upgrade. Stop after this correction for Codex review.

- In `tutor/static/sw.js`, include `/static/js/evidence.js` and `/static/js/plan.js` in the release shell. `app.v1.js` imports both. Readiness must check the full module graph. Use a new cache revision and release-specific shell asset URLs so an active old release and a waiting update can each serve a consistent app. Preserve the staged install and learner storage.
- Add a Chromium regression that warms the app, clears Chromium's HTTP cache while preserving Cache Storage and IndexedDB, disables networking and opens a new tab. Verify the Tamil adult summary, Back to the same activity and three separate histories.
- Exercise a same-origin upgrade from a Phase 1 release to the corrected release. Start with a pending item, a committed attempt and an outbox row. Verify failed update recovery, then successful activation and a cold offline reopen with the same records. Use the actual prior release if available. If only a fixture is available, describe what it represents and keep the full release upgrade marked unverified.

Rerun pytest, all Node test files and both Chromium suites. Report exact pass counts and the upgrade source. Keep Phase 3 on hold.
