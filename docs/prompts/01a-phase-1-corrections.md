# Codebenders High · Phase 1 corrections

## Feature name and objective

Fix the verified Phase 1 defects in lesson delivery, misconception recurrence, concurrent resume and offline readiness. Keep the existing offline flow working so Phase 2 can extend it safely.

## Product context

The current app branches from a shared Tamil diagnostic and saves progress offline. A learner needs the mini-lesson before practicing, a targeted response to a repeated conceptual error and the most recent saved position when resuming on a shared phone.

## Existing codebase context

Inspection found a working Django app and 10-item pack. `tutor/static/app.v1.js` renders the screens and computes the proposed route. `tutor/static/js/lesson.js` scores and routes. `tutor/static/js/storage.js` commits event, instance, outbox and cursor atomically. `tutor/static/sw.js` installs and serves the offline shell. Existing Django tests passed 11/11, Node tests 8/8 and the Chromium flow 6/6, including all six storage self-checks. Those tests miss or encode the defect cases below. Recheck the files before making changes.

## Required implementation

1. **Guard cursor transitions.** `goNext` in `app.v1.js` passes an earlier plan to `openInstance`; `openInstance` currently writes that earlier item into the cursor. Reproduced with two offline tabs: A answers E01 correctly and stays on feedback. B resumes E03 and answers `7`, advancing to E02. A taps its old Next, and B now reopens on E03. Within the existing IndexedDB transaction, resume or open only the canonical pending cursor, with a conditional check against the expected cursor or a consistent read of its current pending target. Two tabs opening the same pending item should reuse one active instance. Reject stale navigation without writing, and let the UI re-read and resume the latest state with a short Tamil notice. Guard the finished cursor as well as active items. Preserve the current atomic commit and duplicate-submission check.
2. **Route on a repeated mathematical error across items.** E01 `SUB8_LEFT` → E05 `SUB2_LEFT` currently loops back to E05. A second submission of the same probe is required to get E10, because the rule compares literal option IDs. Match a stable, explicit misconception tag for the one-side-only operation across distinct items. The first matching choice on the fresh probe should route to E10. Another reason on that probe must not trigger this repair. Use the committed events to retain the signal across a restart and avoid counting repeated attempts of the same item as independent confirmation. A correct fresh probe or successful repair returns to E03 or an appropriate fresh target item. Keep numeric-only errors untagged. Update the existing Node test that currently asserts the first erroneous probe should retry.
3. **Show the original worked example.** `pack-v1.json` contains the example and Tamil steps, but `showIntro` displays only a general introduction. Show the example with the solution check before the initial diagnostic. Returning learners must still be able to go straight to their saved item. Keep or link to the same example from the lesson rather than creating a second version.
4. **Make offline readiness trustworthy.** The worker's `isShellReady` checks only the root and pack. Deleting the cached `lesson.js` in an isolated Chromium context still returned `shellReady: true`. Check all required entries and validate the cached pack. Use distinct release cache names and versioned asset references when changing files. A failed installation or update must leave the previous complete release usable; avoid activating an update into an open lesson mid-attempt. Provide an actionable Tamil retry when acquisition fails. If a service-worker status check or asset read fails, avoid displaying ready. Test both first-install failure and interrupted update. Reuse the present staged install where reasonable.

## User experience

The initial lesson shows the example and its steps in Tamil. Choosing the one-sided operation on the diagnostic shows the balance explanation. Repeating the error on the fresh probe immediately offers simpler practice. The next button in a stale tab reopens the latest valid progress. Offline status accurately reflects whether the full lesson can reopen without data.

## Data and architecture

Use the existing stores and preserve all committed attempts, outbox markers and profile progress. Resolve existing events using versioned item and option metadata or a small compatibility lookup for historical Phase 1 events. Carry new metadata forward without invalidating existing item IDs or pending events. If storage changes, test a real upgrade from data created by Phase 1. Keep the worker cache separate from learner storage.

## Offline and online considerations

First acquisition and repair of a missing asset require connectivity. Once available, the worked example, practice, recurrence routing and resume must run with the browser context offline. A partial install must not displace a working package. Keep the worker's cache allowlist and keep future API calls network-only.

## Edge cases

Check duplicate taps, simultaneous opening, stale next after the last activity, a different error on the fresh probe, recurrence interrupted by closing the app, an invalid numeric response, a missing JS module, a malformed pack and an interrupted update. Preserve the existing write-failure recovery and independent sample profiles.

## Constraints

Keep the current Django and vanilla JS structure. Do not clear learner storage or introduce Phase 2 mastery or the adult view in this correction. Keep provider and sync work deferred. Treat the existing Tamil copy as a draft until independently reviewed.

## Testing

- Run `python -m pytest -q` and `node --test tutor/static/js/lesson.test.mjs`. Update the recurrence expectation to cover different operation IDs representing the same mistake, a different mistake as a negative case and a correct return.
- Extend `tests/e2e/check_flow.py` or add a focused regression check covering both paths while offline, the example, E01 → E05 → E10, recovery to the target, and persistence in two offline tabs using the reproduction above. Inspect event and outbox counts and ensure the stale click has no write effect.
- In an isolated browser context, check complete acquisition, missing required resource, malformed content, failed initial fetch plus recovery and failed update retaining an older offline release. Confirm cached readiness reflects the actual worker and package.
- Re-run the existing browser suite against Django with `DJANGO_DEBUG=1`. Distinguish test results from Android/HTTPS or independent Tamil review if those remain pending.

## Acceptance criteria

- [ ] A new learner can read the worked example offline before starting practice.
- [ ] The first repeated one-sided error on the fresh probe routes to E10, persists across reload and can return to the target.
- [ ] Two offline tabs cannot replace the latest cursor or fork pending instances. Existing events and outbox markers survive.
- [ ] Offline readiness requires the complete validated shell and pack. A failed update leaves the last complete release usable.
- [ ] Existing and new regression tests pass. Three synthetic profiles retain separate histories.

## Expected completion report

List changed files, chosen cursor guard, compatibility handling and cache release approach. Include the commands and results for unit, integration and browser checks and note which target-device and Tamil checks were actually performed. Stop for re-verification before Phase 2.
