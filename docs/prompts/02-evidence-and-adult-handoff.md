# Codebenders High · Phase 2 evidence-based practice and adult handoff

## Feature name and objective

Expand the Tamil offline tutor from a branching diagnostic into a short concept-based learning path. Use committed evidence to select practice, distinguish demonstrated skills from work in progress and give an adult a read-only view of the active learner's progress.

## Product context

This is P0 Phase 2 in [the roadmap](../ROADMAP.md). Keep Tamil Nadu State Board Class 8 Mathematics and the same narrow one-variable linear-equation scope. The learner on a shared phone should see why the next activity was chosen. A parent, teacher or volunteer should see what that learner has demonstrated and one concrete way to help. The skill and evidence rules are in [the personalization spec](../PERSONALIZATION.md).

## Existing codebase context

- The normal entry is the Django view in `tutor/views.py` serving `tutor/templates/tutor/index.html`. The learner interface is `tutor/static/app.v1.js`; it has the profile picker, worked example, answer controls, feedback, cursor guard and a simple attempt summary.
- `tutor/content/pack-v1.json` contains E01–E10 and concepts C0–C4. `tutor/static/js/lesson.js` handles scoring and diagnostic/probe rules. The app's `PRACTICE_ORDER` still drives subsequent practice.
- `tutor/static/js/storage.js` holds `tutor-v1` in IndexedDB. `commitAnswer` atomically writes event, outbox marker and next cursor, with an instance guard. `openCurrentInstance` rejects stale navigation. Events already store item ID, profile ID, sequence, pack and policy versions, answer, correctness, reason and an `assistance` field currently set to `none`.
- `tutor/static/sw.js` uses a versioned cache and staged install, and currently validates a ten-item pack. Independent baseline verification passed 17 Django tests, 17 Node tests, 7 original Chromium checks (including 6 storage self-checks) and 11 Chromium regressions. Recheck the files before starting.

## Required implementation

1. **Complete the small concept graph and item pack.** Use C0 equality, C1 undo addition/subtraction, C2 undo multiplication, C3 solve a two-step equation and C4 verify by substitution. Dependencies are C0 → C1 and C2, C1 + C2 → C3, C3 → C4. Keep the existing initial E01 diagnostic and stable IDs and meanings for existing items. Aim for roughly 18–24 original Tamil items, with enough distinct item families to demonstrate each concept and at least one eligible transfer, explanation or check item per concept. Changing numbers alone does not create a new family. Add prerequisites, family, evidence kind and intervention references to versioned pack data. Author original Tamil examples and feedback using the board section as a reference. Record language review as pending unless a qualified reviewer actually signs off.
2. **Derive concept status from evidence.** Make a pure projection over the active profile's committed events in sequence order, resolved through the appropriate versioned pack and policy. Show Tamil equivalents of unassessed, developing, demonstrated and review due. Demonstrated requires two consecutive independent correct observations for that concept from distinct families, including at least one eligible transfer/explanation/check. Repeated items, same-family variants and assisted attempts cannot supply that evidence. Assistance does not erase prior observations. An intervening independent mistake breaks the streak. An ambiguous mistake after demonstration can flag review. New explicit recurring errors can move the implicated skill back to developing. Keep timed revision for Phase 6. Flag review from evidence only in this phase.
3. **Extend the existing deterministic route.** Keep the first diagnostic paths: correct starts independent practice; `SUB8_LEFT` shows the balance intervention and fresh probe; a matching `SUB2_LEFT` on the probe goes to equality repair. Expand the authored option tags to include inverse-sign and coefficient-as-addend errors on suitable items. Generic numeric mistakes or ambiguous answers get a Tamil check or step probe without a firm tag. Scope strategy-specific questions clearly and credit valid alternatives on open-step items. After a confirmed error, choose a prerequisite activity and fresh evidence, then return to the blocked goal when evidence is sufficient. Record the intervention ID with the linked activity and distinguish a subsequent unaided success from an assisted success. Cap guided remediation and provide a Tamil recap and a path to continue later if suitable items are exhausted.
4. **Use the graph for ordinary practice.** Replace the app's fixed practice order where it decides what to teach next. Reuse the existing item lookup, grading, state and cursor flow. Choose from eligible fresh families in stable order and explain the decision in plain Tamil. A correct diagnostic may select a short independent probe of the target skill early. This does not imply that prerequisites are already demonstrated. Commit the proposed next item with its qualifying attempt; preserve a saved pending item on reload.
5. **Add an offline learner summary and adult handoff.** The learner sees concept progress, a suggested next step and an accessible Tamil button to open a read-only summary for a parent, teacher or volunteer. From the selected learner's view, the summary shows demonstrated concepts, where support may help, the evidence freshness and one concrete coaching action. Keep it readable at 360 CSS px and distinguish no evidence from evidence of difficulty. The summary reads only the active sample profile. Back returns to the same learner and activity; profile switching clears the view. Use Tamil display aliases while preserving the existing internal profile IDs and keys. The handoff is local and deliberately initiated by the learner.

## User experience

Keep the worked example, tap-first practice and clearly expressed Tamil feedback. Show one understandable reason for the next activity. After using a hint or being shown this item's answer, a retry of that item should remain assisted evidence. A fresh independent check can qualify. The adult should be able to identify one useful teaching action without needing technical codes, raw event data or a mastery percentage.

## Data and architecture

Use the existing atomic commit and guarded cursor transitions. Record assistance at the item-instance level when necessary so reopening or switching tabs cannot turn an assisted attempt into an independent one. Extend versioned event metadata only as needed, and keep stable event IDs, profile keys, outbox entries and event order. Version the new pack and policy, and retain old item metadata for version-1 replay. Phase 1's `assistance: "none"` was emitted by default; treat such records conservatively unless the required independent evidence is reconstructable. Keep previous progress visible with its original meaning, preserve unresolved tags and avoid upgrading historical activity into demonstrated mastery by assumption. Test a version-1 pending cursor and event/outbox record before switching to the new release.

## Offline and online considerations

Cache the complete new shell and pack using a **distinct release cache and release-specific asset references**, so a waiting worker cannot replace assets under the active release. Update the worker's pack checks for the expanded schema, replacing the hard-coded ten-item assumption for the new pack. Validate referenced IDs, prerequisites, choice options and required app assets. Retain the old functional release during an interrupted update. The currently tested initial-download retry covers a failed manifest fetch; also handle a rejected worker registration so a first fetch failure at `/sw.js` can be retried. Profiles, practice, progress and adult handoff must continue without network after readiness.

## Edge cases

Check empty or exhausted histories, ambiguous numeric answers, valid alternative steps, repeat and same-family attempts, guided retry after reload, a second tab with stale state, three learners sharing a browser, and a pending legacy activity during release upgrade. Make an obvious Tamil empty state and never clear committed work to recover.

## Constraints

Keep this slice on the existing Django and vanilla JS architecture. Leave reconnect syncing, remote accounts, AI/photo, timed revision and alternate-intervention selection for later phases. Keep the content and shell lightweight. Use only synthetic profiles. Keep the existing regression cases and their substantive assertions; update version-specific test fixtures and selectors where the expanded pack requires it.

## Testing

- Add Node tests for versioned evidence replay, assisted and same-family exclusions, mastery threshold and reset, misconception-specific versus ambiguous routing, prerequisite return, valid alternatives and item exhaustion. Extend Django checks for the new pack and math keys.
- Extend Chromium tests to show different paths for two learners, verify an assisted item remains assisted after reload, show two qualifying items changing concept status and verify adult handoff isolation across all three profiles offline. Check an old-to-new release on an existing browser origin and exercise both a failed update and successful activation. Verify the revision preserves pending cursors and outbox entries.
- Rerun `python -m pytest -q`, `node --test tutor/static/js/lesson.test.mjs`, `python tests/e2e/check_regressions.py` and `BASE_URL=http://127.0.0.1:8000 python tests/e2e/check_flow.py` with the local Django server started using `DJANGO_DEBUG=1` for the final command.

## Acceptance criteria

- [ ] The reviewed-in-code concept graph and original Tamil items exercise every scoped concept. State what Tamil review was actually performed.
- [ ] Independent evidence controls the concept labels. Tagged recurrence can route to repair; uncertainty and assisted retries do not inflate the label.
- [ ] Two demo learners have visibly different next actions and the reason is understandable in Tamil.
- [ ] The active learner's progress and adult handoff work offline after reload, and all three sample histories stay separate.
- [ ] Version-1 records, instance guards, duplicate prevention, outbox and interrupted-update behavior survive the new release.
- [ ] Existing and Phase 2 checks pass and the README records how to reproduce the paths.

## Expected completion report

List changed files, pack and policy versions, any transitional behavior for historical activity, exact commands and results, and the two learner traces. Report the limits of manual Android and Tamil checks. Stop for Codex review before Phase 3.
