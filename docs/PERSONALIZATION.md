# Personalization specification

## Evidence and concept graph

Define C0 equality preservation, C1 undo addition/subtraction, C2 undo multiplication by a nonzero integer, C3 solve two steps and C4 check by substitution. C0 enables C1 and C2, C1 and C2 enable C3, and C3 leads into C4 within the module. Start on a short two-step diagnostic with an operation choice, then choose an in-scope practice item. A brief diagnostic can reveal a missing prerequisite even before all nodes have practice evidence. Keep check-by-substitution distinct from solving. Use item-family IDs so two clones with switched numbers cannot count as two independent types of evidence.

Collect the submitted operation, final signed-integer response, item/family/version, hint use and linked explanation where applicable. Display concept states as unassessed, developing, demonstrated or review due. During development, keep diagnostic hypotheses distinct from mastery. Do not record a learner's fixed style or infer cognitive traits.

| Signal | Hypothesis and default action |
| --- | --- |
| Chooses to remove a term from only one side | Possible equality-preservation gap. Use a small illustrated balance, then a fresh operation probe. |
| Chooses to add a positive term that must be undone, or subtract a negative term that must be undone | Possible inverse-sign confusion. Show a concrete undo example and choose an item with different numbers, then the opposite sign if appropriate. |
| Chooses to subtract the coefficient from a multiple of the variable | Possible coefficient-as-addend confusion. Use equal groups and ask what operation undoes multiplication on both sides. |
| Enters an unexpected wrong number without a diagnostic step, or matches two rules | Unresolved. Offer a Tamil substitution check and a step probe. A numeric match alone never confirms a tag. |
| Repeats an explicit matching choice on a fresh item | Treat the tag as recurring and route to the prerequisite. Do not count duplicate submission, repeated taps or assisted steps as independent confirmation. |
| Makes a valid alternative step | Credit it if the item supports it, or ask for the prescribed strategy using wording that scopes the question. Never label an equivalent legal step as a misconception. |

A rule match is a hypothesis with a reason code and evidence IDs. Consider it resolved after two fresh unaided successful checks on the implicated skill, with at least one independent transfer or probe item. One immediate improvement is useful provisional evidence. Retain the event history as a record. A later equivalent explicit error can reopen the tag.

## Selecting the next activity

1. If an unanswered committed item exists, resume it. A deliberate move to a next activity creates a fresh item instance.
2. After a plausible new misconception, pick an authored targeted intervention and a fresh check. After recurrence, select a prerequisite probe or simpler guided practice before retrying the target. Pick a second variant if the first was followed by a matching error.
3. With insufficient evidence, progress through prerequisites in graph order or follow the highest-priority gap identified in diagnostics. Show an understandable Tamil reason. A correct initial diagnostic selects independent practice rather than remediation.
4. Mark a concept demonstrated after two consecutive unaided correct observations on distinct item families for that concept, including at least one transfer or explanation/check item. Use last independent evidence for decisions. Assisted work can demonstrate participation. An intervening independent mistake resets the consecutive evidence count for that concept. A single ambiguous wrong answer after demonstration schedules review; explicit recurring errors reopen developing status for the implicated concept.
5. Once a prerequisite is demonstrated, return to the blocked objective. In P1, a next-session revisit becomes due roughly one day after demonstration and uses a fresh mixed or transfer item. A missed review has no penalty. A passing revisit clears due status without recording new mastery for unrelated concepts. Cap remediation to two adjacent guided activities before offering a simpler authored recap and a choice to continue later.
6. Select stable pack order among unused suitable items after filtering by objective/family and required evidence type. Once no fresh family remains, offer optional review or completion without claiming additional independent evidence. Explain each recommendation with a deterministic reason code and locally authored Tamil copy.

Two distinct observations address single-answer guessing and narrow memorization while remaining feasible in the demo. The threshold and one-day revisit are MVP heuristics. Tune only after testing; do not present these as psychometrically validated cutoffs. See the [research assessment](RESEARCH.md).

## Memory, intervention effectiveness and responsibilities

The durable history and derived state belong in IndexedDB. Rebuild projections deterministically using the recorded event/policy versions. Store exposure to an intervention with a stable ID, related concept, item instance and subsequent check result. Record whether that result is independent and whether it occurs in the same or later session. Keep outcomes as counts and evidence links. A first successful independent response can make a variant a reasonable default in the current context. Switch variants after a repeat error. Small samples do not support claims that one explanation is generally superior. A typed doubt or model guess cannot update a hypothesis unless a later deterministic exercise yields supporting evidence.

The LLM provides optional in-scope Tamil rephrasing and doubt answers. The local engine owns item selection, correctness, tags and confidence, transitions, evidence and progress. Provide the assistant with a compact summary of local evidence only for the active request. Discard short-term open prompts, photos and replies on profile switch or session close. Persist learning evidence and structured intervention history only.

## Worked traces and evaluation

- **Learner A:** On original item `3x + 8 = 26`, chooses to subtract 8 only on the left. Gets a balance explanation and a fresh probe. Repeats the pattern on `x + 9 = 16`. Works a C0 repair and then correctly selects matching operations on two fresh checks with distinct item families. The tag clears when sufficient evidence exists, and the engine returns to C3. These are planning examples and can be changed if a content review discovers overlap with existing textbooks.
- **Learner B:** Correctly picks subtract 8 on both sides, then chooses divide by 3 when prompted. Gets a new independent solving item instead of C0 repair. Completing two sufficiently different independent items earns a demonstrated C3 state. Their progress remains distinct from A's.
- **Learner C:** Types `12` on a numeric-only item that offers several plausible explanations for the error. Gets a next-step probe and a substitution hint. No diagnosis is recorded as recurring.

Track coverage of known rules, ambiguous cases that correctly remain unresolved, same-input decisions online and offline, intended branch divergence and intervention-to-fresh-check outcomes. Synthetic fixtures establish mechanical correctness. With a future approved pilot, evaluate independent pre/post matched items, delayed transfer and the share of tagged errors that recur after an intervention. Use individual evidence cautiously and report sample size, attrition and uncertainty.
