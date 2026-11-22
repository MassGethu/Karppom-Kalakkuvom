# Codebenders High · Phase 1 browser regression fixes

## Feature name and objective

Fix the three failures in `tests/e2e/check_regressions.py`. Keep Phase 2 on hold until Codex independently reruns the suite.

## Product context

The Tamil tutor already saves work and resumes offline. These fixes make it select the right remedial activity, recover from a failed initial download and accurately report whether the full lesson is usable offline.

## Existing codebase context

Recheck the workspace before editing. The latest independent run passed 17 Django tests, 14 Node tests, 7 original Chromium checks and 8 of 11 new Chromium regressions. The failures are `repeated_untagged_probe`, `first_install_retry` and `incomplete_choice_pack`. The rest of the browser suite covers cross-item recurrence, stale Next, duplicate taps, offline launch, worker repair and updates, and compatibility with version-1 IndexedDB records.

## Required implementation

1. **Require a tagged error on a different item for equality repair.** In `tutor/static/js/lesson.js`, the old `lastErrorStepId` and `probeFailures` shortcut can route to E10 before checking the misconception tag. Remove that shortcut and remove its replay state from `tutor/static/app.v1.js` if unused. The reproduction is E01 `SUB8_LEFT`, then E05 `ADD2_BOTH` twice. Both untagged probe answers should retry E05. E01 `SUB8_LEFT` followed by E05 `SUB2_LEFT` should still route to E10 on the first probe error. Keep historical event lookup by item and option IDs and preserve the correct-return behavior. Update any Node expectation that still encodes the old same-option shortcut.
2. **Recover an initial install from the Tamil retry button.** In `tutor/static/app.v1.js`, the retry currently needs a controlling worker. A fresh install whose manifest request returns 503 has no controller, so the button stays hidden. When the initial install fails, provide the existing Tamil retry control and let it initiate a new acquisition without a manual reload. Handle the case where registration succeeds but the installing worker becomes redundant. Keep the existing `REPAIR` flow for a controlling worker, prevent overlapping retries and display ready only after a controlling worker confirms the validated cache. If another attempt fails, leave the control available.
3. **Reject an incomplete choice item.** In `tutor/static/sw.js`, the pack can pass validation with ten items even if E01 has no choices. Extend the existing validator used by staging, readiness and repair. Each choice item needs a nonempty options array with unique, nonempty step IDs, usable Tamil-facing labels and an answer that matches a listed option. Numeric items continue to use their existing shape and do not need options. Check that an invalid pack from the origin cannot be promoted or used to replace the last valid cache entry. Keep the existing release isolation and update lifecycle.

## User experience

Repeated untagged answers keep the learner in the probe with the existing generic feedback. After an initial download failure, the learner can retry in Tamil on the same page. The offline-ready indicator appears only after the complete lesson is available and validated.

## Data and architecture

Reuse the local scoring and cache code. Preserve IndexedDB stores, existing records and pending outbox markers. Keep content IDs and policy compatibility intact. If the worker or shell needs a release revision, follow the existing versioned-cache approach. A failed update should leave the prior complete release usable.

## Offline and online considerations

Scoring and the next activity continue to work offline. A fresh acquire or cache repair uses the origin when reachable. Keep the original test fixtures and fault injection so browser networking and worker behavior are exercised.

## Edge cases

Verify a same-item repeat, a different error, and a cross-item matching tag after reload. For initial acquisition, verify that a 503 can be retried after the origin recovers, that another failure leaves retry available and that rapid retry clicks do not produce overlapping installs. For the pack, cover absent and empty options, duplicate IDs, and an answer with no matching option.

## Constraints

Keep this handoff to the three fixes and directly related tests. Preserve the existing test assertions and failure fixtures in `check_regressions.py`. Leave the adult view, expanded personalization, sync and AI for their planned phases.

## Testing

Run these commands in the same Playwright-enabled environment used for Phase 1:

```sh
python -m pytest -q
node --test tutor/static/js/lesson.test.mjs
python tests/e2e/check_regressions.py
```

With the Django dev server running under `DJANGO_DEBUG=1`, also run:

```sh
BASE_URL=http://127.0.0.1:8000 python tests/e2e/check_flow.py
```

## Acceptance criteria

- [ ] All three named browser regressions pass and the full regression suite reports at least 11/11.
- [ ] The original Chromium flow passes all 7 checks, including the storage self-test.
- [ ] Django and Node suites pass, with the outdated recurrence expectation corrected.
- [ ] Historical progress and outbox records survive. Failed updates still preserve the last complete release.

## Expected completion report

List changed files, exact commands and pass counts. Include any remaining failures and whether the recovery paths were exercised in Chromium. Stop after reporting so Codex can rerun the suite before Phase 2.
