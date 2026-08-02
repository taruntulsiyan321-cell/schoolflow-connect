# Question Bank roadmap

Live product bank for Gurukul practice / battles. No demo fallbacks — empty bank ⇒ honest empty UI.

## Current (APPROVED v1)

| Item | Detail |
|------|--------|
| Board | RBSE (`schools.board`, default `rbse`) |
| Stream | Commerce |
| Classes | 11, 12 |
| Subjects | English, Hindi, Accountancy, Mathematics, Business Studies, Economics |
| Format | MCQ (4 options) only — no assertion–reason / case-based |
| Source | `source_type=ncert_aligned`, `source=seed_rbse_commerce_v1` |
| Count | **240** (20 per subject × class) |
| Migrations | `20260802220000_rbse_question_bank_board_schema.sql` · `20260802220100_rbse_commerce_11_12_question_seed.sql` |

**Apply both SQL migrations on Supabase**, then verify Practice loads RBSE commerce questions.

Taxonomy reference: [`GURUKUL_QUESTION_BANK_RBSE_CLASSIFICATION.md`](./GURUKUL_QUESTION_BANK_RBSE_CLASSIFICATION.md).

## Filter rules

- Platform rows: `school_id IS NULL`
- School rows: same `school_id` as student
- Board: `question_bank.board IN (school.board, 'both')` or `board IS NULL` (legacy)
- Client: `PracticeService.listBankQuestions` also filters by school board when available
- Roles: school `admin` / `principal` / `teacher` manage — **never** `super_admin`

## Next

1. Deepen commerce (more MCQs per NCERT chapter).
2. Science 11–12 seed (Physics, Chemistry, Biology) — deferred.
3. Teacher-authored + AI-generated items with approval workflow.
4. CBSE formats (`assertion_reason`, `case_based`) tagged `board=cbse` only.
5. Optional `exam_year` tagging for board-paper style packs.

## Regenerating commerce seed

```bash
node scripts/generate-rbse-commerce-seed.mjs
```

Idempotent on re-apply: skips if `source=seed_rbse_commerce_v1` already has ≥240 rows; otherwise replaces that source batch.
