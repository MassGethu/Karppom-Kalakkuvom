# Codebenders High · Implementation 01

## Feature name and objective

Build the first runnable vertical slice of The Last-Mile Tutor. A fictional Class 8 learner on a shared Android phone opens an original Tamil algebra mini-lesson, answers a short diagnostic, gets a targeted next item and resumes on a fresh launch while offline.

## Product context

This is the foundation for the Tamil Nadu state-board mathematics tutor. The slice should prove the hardest product behavior with one module: when two learners answer the same equation differently, their subsequent activities differ and stay different after restart. Use the 2022-revised government Tamil-medium Class 8 Mathematics textbook, Algebra §3.8.4, printed pp. 103–105, only as a curriculum reference. Use the pack and event contracts in [architecture](../ARCHITECTURE.md), the worked traces in [personalization](../PERSONALIZATION.md) and the gate for Phase 1 in [roadmap](../ROADMAP.md).

## Existing codebase context

Discovery found an empty directory. A subsequent inspection before this prompt found the planning files under `docs/` and Codebenders metadata at `.codebenders/state.json`, with no application code, Git metadata, dependency manifests, services, schemas, assets, configuration or tests. This is initial setup. Recheck briefly before writing, respect any newer user or agent changes and preserve the planning docs and Codebenders metadata.

## Required implementation

1. Scaffold one minimal runnable Django service using a supported LTS and pinned tested dependencies. Serve a Tamil mobile-first shell, manifest, scoped service worker, versioned same-origin CSS/JS and a versioned Tamil module. Use vanilla JavaScript modules and Django templates. Document setup, local start and test commands. The main app route must serve the learning flow.
2. Author one short lesson with an original worked example and roughly 8–10 original items in a compact pack. Include equality, inverse operations and one two-step equation. Each item needs a stable ID, concept and family ID, Tamil prompt and feedback, an exact answer and evidence type. Define an operation-choice item and at least one bounded signed integer item. Include explicit step options and correct arithmetic. Keep curriculum/source metadata and mark language review pending unless a qualified reviewer verifies it.
3. Provide three distinct synthetic learner aliases with no data entry. On first activity, all start on the same diagnostic. For the initial item use `3x + 8 = 26` or an independently written equivalent. Ask specifically which operation removes the constant term while preserving equality. Selecting subtraction of 8 on both sides should advance to independent two-step practice. Selecting subtraction on only one side should produce an authored balance explanation and a fresh equality probe. If the same explicit error recurs on the probe, route to a simpler equality repair. A correct probe returns toward the original goal with a fresh item. Ensure later items can end cleanly with an honest summary.
4. Score supplied step IDs and signed integers deterministically. Validate submitted IDs against the active item. For unexpected numeric-only wrong answers show a generic Tamil hint or a probe without labeling a specific misconception. Where an item asks an open step, credit alternatives defined by its rubric. A strategy-specific item should declare its goal clearly. For any displayed concept state, a single response or assisted response does not establish demonstrated competence. Any demonstration label must follow the distinct unaided evidence criteria in the design, or use simple recent activity and omit the label in this phase.
5. Keep evidence, explanation choice, reason code and next item scoped to the active profile. Expose the next activity reason in clear Tamil and return to the current item on switching away and back. Provide a small learner summary based on persisted attempts. Show when the lesson pack is ready for use without data and whether the last response has saved on the device. Never imply that cloud sync or AI has occurred.
6. Cache only the app shell and required static resources. The app may indicate offline readiness only after control by the service worker and validation of the cached package. An update failure leaves the last complete pack operational. Use real offline fallbacks for assets and navigation while keeping any future API path out of the public cache.

## User experience

The learner selects an alias, sees a short Tamil introduction, answers by tapping a labeled operation or using a short numeric input, then sees an explanation and one clear next action. Ensure readable Tamil and equations at 360 CSS px and large touch targets. Add descriptive Tamil error, saving, offline and readiness states. When displaying a balance diagram, provide accompanying Tamil text. A returning learner sees their pending activity or the next activity and can switch profiles. State is derived from saved work.

## Data and architecture

Use stable content and policy versions. In IndexedDB, scope profile records, active item instances and immutable events by profile ID. Use a per-profile sequence and globally random event ID. Record pack and policy versions, item and instance IDs, bounded selected response, assistance and applicable intervention or reason. Derive a small projection or replay the event history. Commit event, pending outbox marker and next cursor in a single transaction. Check the current item instance inside that transaction to reject duplicate or stale submissions. Show committed UI only after success. The pending marker is for a later phase, with zero network calls required to write it now. Use one canonical client grading and progression implementation and pass no personal profile information to remote services. Keep IDs and interfaces documented so the next increment can extend them.

## Offline and online considerations

Initial acquisition needs localhost or HTTPS and access to the app origin. After readiness, switching profiles, lesson views, practice, feedback, path selection, progress and reopening must work with both data and Wi-Fi disabled. Use no external fonts, content, images or scripts for the learning flow. Expose a retry for missing initial assets. Record transferred size for a cold load with the 500 KiB compressed budget as the design target.

## Edge cases

- If storage is denied, full or the write fails, retain the previous committed state. Keep the answer retryable and display an honest Tamil failure.
- Rapid repeated taps, a reload during the save and a stale second tab can result in at most one recorded response for the item instance. Reconcile to the current cursor.
- Explain an invalid entry without committing an attempt or consuming the item. Handle leading/trailing space, supported digit variants and negative sign deliberately. Keep math parsing bounded and avoid evaluation of arbitrary text.
- Refreshing the installed app offline on its learning entry route restores the profile and next unanswered activity. Switching profiles must never carry an answer, hint or hidden state into the new profile.
- An interrupted first download permits a retry. An interrupted package update leaves the previous usable package. Item exhaustion offers a Tamil end state and optional practice without inflated progress.

## Constraints

Build this slice only. Leave cloud sync, tutor/provider, photo upload, remote registration and the distinct adult view to their later phases. Use original content, only synthetic learner records and no copied Kolibri code or textbook examples. No CDN dependency or simulated completion. Retain the architecture boundaries so those features can build on this slice. Add dependencies when required to make the initial setup or tests runnable.

## Testing

- Unit-test grading, valid and ambiguous choices, misconception-specific branching, returning to a fresh item after recovery and exhaustion behavior. Verify answer keys with substitution or expected operation tests.
- Integration-test profile scopes, event/outbox/cursor write consistency, duplicate and stale instance handling and storage failure. Verify Django can load the main view and serve the manifest, worker and content.
- Run a browser flow from a clean origin, wait for offline readiness, switch to genuine request blocking, submit profile A's wrong step, close/reopen the page or app and confirm A's saved path. Use profile B to pick the correct step from the same initial prompt and show a different item. Return to A. Run a fresh offline entry and an interrupted load to inspect errors.
- Verify on actual Android over HTTPS if available. Record browser emulation and physical test evidence separately. Capture the shell/pack size, screenshots for branch outcomes and a short reproducible command or manual recipe.

## Acceptance criteria

- [ ] A fresh checkout has runnable setup instructions and serves a complete Tamil local demo.
- [ ] The pack contains original exercises with a syllabus reference and verified answer keys.
- [ ] Identical initial content produces distinct evidence-driven paths for two synthetic profiles.
- [ ] Useful Tamil lesson, feedback, recommendation and learner progress work with no connectivity after readiness.
- [ ] An offline close/reopen restores the correct learner, one committed attempt and the next item. Switching among three demo profiles preserves independence.
- [ ] Rapid duplicate submissions and failed saves do not invent progress.
- [ ] A clean online start and interrupted acquisition give accurate availability states.
- [ ] Relevant automated tests and offline flow checks are run, with any unverified physical test explicitly reported.

## Expected completion report

List files created and modified, setup/start/test commands, important decisions, actual pack size and the test outcomes. Include the first item and exact branches you used for manual verification, evidence for offline reload, known limitations and unresolved issues. Report whether a real phone was tested and whether the original Tamil copy was independently reviewed. Stop at this handoff for review.
