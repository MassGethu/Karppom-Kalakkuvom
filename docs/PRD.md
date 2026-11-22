# The Last-Mile Tutor · Product requirements

Status: proposed hackathon MVP, 22 November 2026. Start with [requirements](REQUIREMENTS.md), [architecture](ARCHITECTURE.md) and [roadmap](ROADMAP.md). See [progress](PROGRESS.md) for verified implementation status.

## 1. Product overview

Build a Tamil-language tutor for a Class 8 learner in a Tamil Nadu government school who shares a basic Android phone and may have intermittent data and little help at study time. A short session should help the learner identify and correct a specific algebra mistake, establish independent evidence of understanding and resume later without losing work.

Teach solving one-variable linear equations with integer coefficients and integer solutions, limited to one- and two-step equations with the variable on one side. Start with equality, undoing addition/subtraction and undoing multiplication. Finish with two-step solving and checking by substitution. A short Tamil word problem can express the same two-step equation. Curriculum: Tamil Nadu Class 8 Mathematics, Algebra, §3.8.4 (சமன்பாடுகளின் தீர்வுகள்), reference pages 103–105, with §3.8 prerequisites. The 2022-revised Tamil-medium edition was inspected via a mirrored copy. Confirm the current classroom edition with a teacher before making a current-edition claim. [State SCERT Class 8 mathematics listing](https://tnschools.gov.in/scert-taxonomy/class-8-maths) · [Tamil-medium government textbook, mirrored PDF](https://dl.tamilbookspdf.com/TN%20Text%20Books/Tamil%208th%20Class%20Books/Std_08_All_Subjects/8th_Mathematics_TM%20-%20www.TamilBooksPDF.com.pdf)

Success for the prototype means two sample learners take meaningfully different paths, the first learner's path survives an offline restart, a real photo doubt gets useful Tamil guidance when online, and an adult can act on a concise progress summary. A prototype walkthrough establishes functionality. Learning gains require separate evaluation.

## 2. Learners, constraints and journeys

- **Primary learner.** A fictional Class 8 Tamil-medium student using a household Android phone for 5–10 minutes at a time. Assume another family member may need the device mid-session and there may be no adult available to explain algebra. Include short sentences, familiar quantities and equations supported by visual groups or a balance.
- **Second learner.** Another sample profile on the same phone, with stronger prerequisite evidence. Their path and progress must be independent. Profile selection uses Tamil aliases and distinct icons.
- **Supporting adult.** A parent, teacher or volunteer with access to the device and the active learner's permission. They need a plain-language summary and a suggested action, such as asking the learner to explain why both sides change. Remote access and a classroom roster are deferred.
- **First visit.** Pick a sample alias, start a short explanation and practice immediately after the tiny offline package is ready. Explain in Tamil how to prepare offline and how to change learners.
- **Return or disconnect.** Resume the last committed activity. The app restores the next recommended item after a restart and keeps feedback available. A lost connection changes the availability of photo/AI, with authored help immediately available.
- **Doubt.** Tap a Tamil starter, type a short question, or take/select a photo of a single algebra equation. Review the extracted equation before starting a tutoring turn. Return to the exact practice item.
- **Recurring mistake.** See one concrete explanation and a fresh check. If the same pattern recurs, work through the relevant prerequisite before returning. A correct answer without hints can support progression.
- **Adult handoff.** Learner opens their summary and lets the adult read it. Leaving the active profile clears the progress view, and switching profiles also clears temporary tutor state.

Shared access, short sessions and low-end hardware are product design assumptions. The [research assessment](RESEARCH.md) ties those choices to the available evidence and describes its limits.

## 3. Requirements and priorities

The [compliance matrix](REQUIREMENTS.md) maps the official PDF to features, acceptance evidence and demo checks. P0 covers the full demonstration journey. P1 improves the value and reliability of personalization. P2 is optional.

## 4. Positioning

The product's distinctive claim is a testable combination: a Tamil state-board tutor can identify a likely algebra mistake, select a targeted response, check whether it worked and use that evidence to choose the next practice while offline. Kolibri establishes the offline-content and coaching precedent. Mastery platforms and adaptive tutoring establish that personalization already exists. The [research assessment](RESEARCH.md) compares these products and the limits of the claim. Main risks are shallow Tamil, overly narrow exercise coverage and a false inference from an ambiguous answer.

## 5. MVP features

| Feature | Learner behavior, inputs and outputs | Data, dependencies and failure behavior | Acceptance and testing |
| --- | --- | --- | --- |
| P0 · Tamil lesson pack | Read an original introductory lesson, work an example and enter practice. | Versioned pack with concepts, item IDs, answer schema, explanation variants and curriculum citation. Available after initial install. Failed install leaves a retry and preserves prior complete pack. | Validate pack references and answer keys, then review every learner-facing string, hint, example and error in Tamil. Open after airplane-mode restart. |
| P0 · Shared profiles | Tap an alias and resume that learner's practice. | Local sample IDs, progress and practice position scoped by profile. Purge transient draft and tutor state on switch. | With three profiles, answer as A, switch to B and C, then verify A's state resumes and history is isolated. |
| P0 · Adaptive practice | Choose an operation or submit a signed integer using large tap targets. See immediate Tamil feedback and a recommended next problem. | Deterministic scoring and recommendation run locally. Persist evidence in one transaction. Ambiguity leads to a step probe, and an assisted answer never advances independent mastery. | Run the contrasting learner traces and recurrence, ambiguous-answer, repeated-tap and reload tests in the [test plan](TEST_PLAN.md). |
| P0 · Progress | Learner sees the next action and concept evidence. Adult sees the same learner's progress in plain language. | Derived from committed attempts. Available locally after install. Empty state guides the learner to begin. Display coarse status and freshness. | Compare screens to known fixtures, verify offline refresh and profile switches. |
| P0 · Online Tamil AI tutor | Pick a tap-to-ask doubt or type. Get a simple Tamil hint, a grounded explanation and a check question. | Same-origin backend, approved examples, scoped algebra validator and auth/rate controls. Transient context only. Timeout, invalid output or lost connection yields reviewed offline help. | Real provider call, substitution check, common misconception, Tamil output review, refusal/redirection and outage cases. |
| P0 · Photo doubt | Capture/select a cropped picture of a single equation, confirm recognized text, then get help. | First do an end-to-end camera/provider spike. Decode and resize locally, transmit only on confirmation of crop, then require confirmation of extracted text before tutoring. Failure offers retake or tap starters. Online processing. | Clear photo recognized on target Android, deliberate error corrected, camera denied and no-data paths tested. |
| P0 · Reconnection sync | Continue practicing while offline. When back online, see local attempts successfully acknowledged. | Transactional outbox with immutable events, idempotent server writes and explicit acknowledgments. Refresh/retry on foreground. Local practice survives failure. | Disconnect during submit, restart offline, reconnect, replay a batch and verify one server row per event. |
| P1 · Targeted revisit and intervention history | Get a short revisit at the next meaningful session; if the first explanation failed, try another reviewed explanation. | Use evidence tied to item and intervention IDs. Keep recommendation reasons explainable, and avoid style labels. | Verify different explanations can be selected, distinguish immediate practice and delayed evidence, and show why a revisit is suggested. |
| P2 · Optional improvements | Add a small number of fresh items for gaps surfaced in review. Consider Tamil voice after a device/provider spike. | Requires ability to maintain Tamil and mathematical quality and meet byte targets. | Run the same language, math, usability and bandwidth checks as P0. |

## 6. Personalization and memory

The [personalization specification](PERSONALIZATION.md) defines the concept graph, diagnostic rules, scoring, thresholds, memory, interventions, outcomes, example traces and evaluation. The learner record is a replayable history of selected/committed mathematical evidence scoped to a synthetic ID. Temporary chat does not enter the permanent record.

## 7. Architecture and 8. Data models

Use a small same-origin Django application with a mobile PWA shell, Cache Storage for the learning pack, IndexedDB for attempts and adaptive state and SQLite on a persistent server volume for acknowledgments. Use server routes for AI and image recognition. See [architecture](ARCHITECTURE.md) for tradeoffs, models, versioning, sync semantics, API contracts and deployment.

## 9. AI behavior

Ground help in the selected concept, validated equation, approved explanation variants and a short summary of demonstrated evidence. Request one hint and check at a time in natural Tamil. Help the learner work out a step before showing the final value. Validate the response format and any math fields with deterministic arithmetic. The provider cannot grade, award mastery, choose the persisted path or write to learner storage. Free-form prose still needs quality review even when schema and math checks pass. Provider, limits and fallbacks are in [architecture](ARCHITECTURE.md).

## 10. Interaction and accessibility

A narrow screen needs one clear action per view, visible progress and no dependency on a Tamil keyboard for practice or common doubts. Use semantic controls, native focus order, Tamil document language, stable labels, readable math, clear textual feedback and touch targets of at least 44 CSS px. Validate at 360 CSS px, 200% text zoom and with Android accessibility tools. Keep connection and sync state separate. Screen reader feedback should announce changes without moving focus unexpectedly. The adult view shows demonstrated concepts, where help is useful and freshness. Avoid public labels, rankings and raw conversation.

## 11. Scope and operating model

P0 is one complete journey across one Tamil module and a reviewed bank of roughly 18–24 original items, with approximately 8–10 needed for the first slice. Build two targeted intervention variants per supported misconception by the final demo. Use synthetic profiles exclusively. Defer cross-device restore, full courses, school enrollment, remote dashboards, a local LLM, broad OCR and statewide rollout. The likely pilot buyer is an NGO or CSR education program, with a school or community partner reviewing content and existing devices used for delivery. The learner pays nothing. Track delivery and inference cost per active learner before proposing any funding commitment. This is a business hypothesis.

## 12. Risks and tradeoffs

| Risk | Decision and release evidence |
| --- | --- |
| Curriculum edition and Tamil quality | Record the published section and item-to-objective links. Have a Tamil-medium mathematics reviewer approve wording, terminology, answers and all UI states before making a quality claim. |
| Diagnosis overconfidence | Base tags on observable choices and patterns, use probes for ambiguous answers, and require evidence on fresh items. |
| Low-end hardware and lost storage | Keep the app small and test airplane-mode restart on physical Android. Browser data can be evicted or cleared. Report device results with storage policy. |
| AI latency, errors and photo privacy | Cap requests, validate outputs, use synthetic image fixtures, strip metadata, and offer offline explanations when the provider fails. |
| Shared phone and interrupted sessions | Scope state to profiles and test profile changes mid-request. Commit atomically and expose adult progress only from the active learner's view. |
| Final integration | Complete the offline slice first, spike real photo recognition early and use an HTTPS rehearsal build with provisioned keys. |

## 13. Success metrics

Use the [test plan](TEST_PLAN.md) for offline retention, sync accuracy, diagnostic cases, tutoring review, learner interaction and release gates. Report synthetic scripted pass counts as engineering evidence. Report authentic learning improvement only after separately approved and appropriately designed evaluation. A delayed independent item provides a stronger individual signal than an immediate assisted correct answer.

## 14. Demo

Start online with sample learners, install the lesson and ask a real Tamil photo doubt. Disconnect Wi-Fi and mobile data. Profile A selects an incorrect operation, gets targeted guidance and a fresh check, then closes and reopens the app while offline. Use profile B to show a different starting path on the same device. Reopen A, finish the next independent item and show the adult summary and its explanation. Reconnect and verify actual server acknowledgments. Narrate connectivity boundaries as they occur. See the runbook in the [test plan](TEST_PLAN.md).
