# Verification and demo

## Evidence and release gates

Use adult operators and synthetic learner profiles, questions and photographs. Record build revision, browser, phone model, OS, network condition, actual result, known limitation and any artifact path. Mocked provider responses belong in automated tests. Real calls, physical camera and genuine disconnection are required for demo readiness.

| Area | Checks and prototype targets |
| --- | --- |
| Curriculum and Tamil | Have a Tamil-medium mathematics reviewer verify original content, curriculum references, every item/rationale, UI states, tutor prompts and fallbacks. Audit at least 12 synthetic tutor turns across normal, ambiguous, off-topic and failure cases. All shipped answer keys must be correct. Revise any serious errors before demo. |
| Deterministic adaptation | Test each rule with supported, alternative-valid, ambiguous and repeated evidence. Confirm identical inputs produce identical decisions online and offline. A/B diverge on the same first item and each moves back toward target after sufficient evidence. Verify hints, transfer family uniqueness, intervention links and lower-confidence outcomes. |
| Local persistence | Run three complete airplane-mode close/reopens on the target phone with zero lost committed attempts. Cover first offline visit without warm assets, interrupted download, failed update, quota or unavailable storage, rapid double taps and stale two-tab submission. Show save status only when committed. |
| Shared-phone usage | Use three sample profiles with different histories. Verify active-only view, cursor recovery, back navigation and cancellation of an active tutor response when switching. Verify adult and learner summaries project the same evidence. |
| Sync | Check success, timeout after server commit, duplicate retry, order inversion, partial acknowledgment, permanent rejection and forbidden scope. Compare ID sets on device and server. Ensure a retry never removes an unacknowledged event. |
| Photo and online AI | Test three clear synthetic captures and require confirmation before tutoring in all cases. Include blurry/unsupported image, wrong extraction corrected by learner, file picker, camera denial, timeout, offline and recognized-math validation. Confirm a valid in-scope typed doubt yields useful Tamil guidance, and provider failure uses the authored fallback. Inspect logs for payloads. |
| Performance and usability | Cold shell + pack at or under 500 KiB compressed. Measure ten representative online tutor calls and report median/p95, timeout count and cost estimate. Verify 360-pixel layout, text zoom, focus, touch targets, readability and simple Tamil status. Have two adult operators complete the synthetic flow without instruction beyond the onboarding. |

Prototype metrics include original exercises verified, rules and ambiguous controls passing, distinct independent branch outcomes, recovery after targeted instruction, upload/transcription confirmation success, offline survival, exact sync and end-to-end task completion. Record assisted versus independent checks separately. Educational effects would require a separate study with appropriate protections and matched independent and delayed items.

## Demo runbook

1. Open the HTTPS app on Android. Show the chosen board lesson and sample profiles, prepare the offline pack and record its readiness.
2. Ask about an original handwritten algebra fixture via the camera or gallery. Confirm transcription and obtain a real Tamil hint. Demonstrate how the learner can proceed without typing a Tamil sentence.
3. Turn on airplane mode and verify Wi-Fi and cellular are off. Profile A picks the one-side-only operation in the diagnostic. Show the authored balance intervention and a fresh follow-up. Submit an answer and observe the local save.
4. Kill or close and reopen the installed app or browser while still offline. Verify A resumes after the committed attempt. Switch to B and give a valid initial operation. Show its different path, then return to A. The adult handoff should reflect A's evidence.
5. Reconnect, show pending progress acknowledge and verify the server holds one copy of each event. Retry once to demonstrate deduplication. Explain the sponsor hypothesis and the observed coverage and limitations.

Rehearse bandwidth and provider access. If the live provider fails, show the real fallback and use a clearly identified recording of a verified photo turn if available. The local learning flow should remain demonstrable.
