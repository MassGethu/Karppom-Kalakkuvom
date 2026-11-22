# Codebenders High · Phase 4 Tamil tutor and photo

Ship one end-to-end online doubt flow in the existing Tamil learner screen. Keep the current activity visible when the learner returns.

- Add a Tamil **Ask a doubt** control with a short typed doubt and a camera/gallery option. Preview and resize one equation photo to at most 500 KiB. Send only on an explicit tap. Show the extracted equation for edit or confirmation before asking for a hint.
- Add same-origin Django endpoints for transcription and tutoring. Configure one server-side text/vision provider with environment credentials. Use the active concept and reviewed pack examples. Return a short Tamil hint and one check question. Validate supported linear equations and math fields with deterministic arithmetic. Use a reviewed Tamil fallback for unsupported input, invalid output, timeout or offline.
- Use sample profiles and synthetic photos. Keep keys server-side, bound and validate requests, and keep images and chats out of logs, caches and storage. Leave progress and grading unchanged by AI.

**Done when** a real typed doubt and a real photo both produce a useful Tamil hint, the photo text can be corrected before tutoring, and offline fallback still opens without affecting practice or sync. Report live-provider and fallback results separately. Stop for review.
