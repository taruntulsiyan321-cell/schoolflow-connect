# screen-capture-mistake (Stage 1 — tap)

Binding: `docs/screen-capture-mistakes-spec.md` §6.3–§7.4, §9–§11.
Cites upload privacy/tagging/mistakes: `docs/custom-practice-upload-spec.md` §2, §5, §6, §9.

## What it does

Student taps the floating Gurukul control → one frame → this function:

1. **Intake gates** (§5.1 / §5.2): unlisted package or lecture suspect → `read: false`, no AI.
2. **Extract** (§7.1): question, student choice, correct, wrong?
3. **Verdict gates** (§6.3–§6.5): refuse correct / teacher-solve / score-only.
4. **Bank-first tags** (§7.2 / upload §5.2): `match_question_bank_for_exam`; inherit or leave null.
5. **Fingerprint upsert** (§7.3) + `rpc_record_concept_mistake` with `capture_question_id`.

Raw frames are never stored. **Nothing enters `question_bank` (§9).**

## Stage 2

Automatic watching is **not** implemented here. Do not add it until Stage 1 §12 passes.
