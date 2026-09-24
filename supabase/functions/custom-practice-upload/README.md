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
- **§5.2** Bank-first tags via `match_question_bank_for_exam`; never guess a
  chapter. Unresolved → `chapter_id` null.
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
5. **§5.2** For each extracted question: embed the stem and call
   `match_question_bank_for_exam` (threshold 0.82). On a hit, inherit
   `chapter_id` / `topic_id` / `difficulty` and set `matched_bank_question_id`.
   On a miss, resolve the model's free-text chapter/topic/subject labels against
   the exam catalog (`resolveCurriculumLabels`). Still unresolved →
   `chapter_id` null (practisable; excluded from recovery/revision per §5.1).
6. Missing model key / download / transport failure → status `failed` with an honest
   reason — never demo questions. Classifier JSON parse failure → `unusable` (§4.1
   refuse rather than invent). Never routes through `ai-gateway`.

## Env

| Secret | Role |
|---|---|
| `OPENROUTER_API_KEY` | Required for classification |
| `OPENROUTER_MODEL` / `OPENROUTER_PRIMARY_MODEL` | Optional; default Qwen 3.7 Flash |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Standard |

## Confidence threshold (§4.2 / §13)

`CONFIDENCE_THRESHOLD = 0.55` (same as `IMAGE_DOUBT_CONFIDENCE_THRESHOLD`).
Tune against the §4.5 refusal battery and record the measurement in the spec.
