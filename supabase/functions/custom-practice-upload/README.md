# custom-practice-upload

Edge function for **Custom Practice — the student's own upload**.

Binding: `docs/custom-practice-upload-spec.md` (§4–§7, §13).

## Rules this function must not break

- **§2** Owner-only. Load and write through the caller's JWT client; never
  return another account's upload.
- **§4.1** Refusal is the feature. Never invent questions from a timetable,
  receipt, blank page, or low-confidence read.
- **§4.2–§4.4** Confidence below threshold → `unusable`; fewer than 3 usable
  questions and no notes → `unusable`.
- **§11** Individual (exam) accounts only.
- **Do not deploy via ai-gateway** — use this function. See KNOWN_ISSUES
  edge-drift.

## Current behaviour

Stub: marks the upload `failed` with an honest reason until the classifier
model path (§13) is measured. Writes **zero** questions and notes.
