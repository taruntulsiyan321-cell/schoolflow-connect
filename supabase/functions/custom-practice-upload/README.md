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
- **§6** File answer key when present (`answer_source = file`); otherwise AI
  solves and marks `answer_source = ai` (client: `ai_answered`).
- **§11** Individual (exam) accounts only.
- **Do not deploy via ai-gateway** — use this function. See KNOWN_ISSUES
  edge-drift.

## Behaviour

1. Download the private `student-uploads` object (service role).
2. Prepare media: images → data-URI vision; PDF → `unpdf` text when present,
   else PDF file attach for OCR.
3. Classify via OpenRouter (`OPENROUTER_API_KEY` / Qwen via `modelRouter`).
4. Apply §4 gates; persist `student_upload_questions` / `student_upload_notes`
   only when the verdict is usable; otherwise status `unusable` with a one-line
   reason and **zero** downstream rows.
5. Missing key / download / parse failure → status `failed` with an honest
   reason — never demo questions.

## Env

| Secret | Role |
|---|---|
| `OPENROUTER_API_KEY` | Required for classification |
| `OPENROUTER_MODEL` / `OPENROUTER_PRIMARY_MODEL` | Optional; default Qwen 3.7 Flash |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Standard |

## Confidence threshold (§4.2 / §13)

`CONFIDENCE_THRESHOLD = 0.55` (same as `IMAGE_DOUBT_CONFIDENCE_THRESHOLD`).
Tune against the §4.5 refusal battery and record the measurement in the spec.
