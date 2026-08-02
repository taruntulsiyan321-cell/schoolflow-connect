# Question Bank roadmap

Live product bank for Gurukul practice / battles. No demo fallbacks — empty bank ⇒ honest empty UI.

## Current — full commerce chapter coverage v1

| Item | Detail |
|------|--------|
| Board | RBSE (`schools.board`, default `rbse`) |
| Stream | Commerce |
| Classes | 11, 12 |
| Subjects | Accountancy, Business Studies, Economics, Mathematics, English, Hindi |
| Format | MCQ (4 options) only — no assertion–reason / case-based |
| Starter | `source=seed_rbse_commerce_v1` · **240** MCQs (keep) |
| Full coverage | `source=seed_rbse_commerce_full_v1` · **1590** MCQs · **10 per taxonomy chapter** |
| Combined bank | **1830** platform rows after both seeds (starter + full) |
| Schema | `20260802220000_rbse_question_bank_board_schema.sql` |
| Starter migration | `20260802220100_rbse_commerce_11_12_question_seed.sql` |
| Full migrations | `20260802230000_rbse_commerce_full_accountancy_bst.sql` · `20260802230100_rbse_commerce_full_economics_math.sql` · `20260802230200_rbse_commerce_full_english_hindi.sql` |
| Display / taxonomy | `src/academic/taxonomy` + `src/lib/academicPresentation.ts` (`presentAcademicLabel`) · DB `academic_taxonomy_terms` via `20260802270000_academic_taxonomy_terms.sql` · mojibake cleanup `20260802260000_fix_academic_display_text.sql` |
| One-shot apply | [`docs/APPLY_RBSE_COMMERCE_FULL.sql`](./APPLY_RBSE_COMMERCE_FULL.sql) (full_v1 only; apply schema + starter first) |

### Academic taxonomy & presentation

- **SSOT:** `src/academic/taxonomy/` (types, dictionary, commerce RBSE seeds, science placeholders, `canonicalizeConceptId`, `mergeDuplicateLabels`).
- **UI labels:** always `presentAcademicLabel(raw, kind)` / `displayChapter` / `displayConcept` — never show snake_case or mojibake to users.
- **Storage:** chapters stay human titles; concepts/topics prefer slug ids; display resolved at presentation (or via `academic_taxonomy_terms`).
- **Import path:** `normalizeIncomingAcademicTerm(raw, kind)` when teachers/AI seed questions.
- **AI:** context packs keep `concept_id` slugs; Nova / coach fact strings use display names.
- Apply taxonomy migration: [`docs/APPLY_ACADEMIC_TAXONOMY.sql`](./APPLY_ACADEMIC_TAXONOMY.sql) (or `20260802270000_*` after mojibake fix).

### Per subject × class (full_v1)

| Subject | Class 11 | Class 12 |
|---------|--------:|--------:|
| Accountancy | 90 (9 ch) | 100 (10 ch) |
| Business Studies | 110 (11 ch) | 110 (11 ch) |
| Economics | 160 (16 ch) | 120 (12 ch) |
| Mathematics | 140 (14 ch) | 130 (13 ch) |
| English | 110 (11 ch) | 180 (18 ch) |
| Hindi | 160 (16 ch) | 180 (18 ch) |

Every taxonomy chapter for these subjects has **≥ 10** MCQs; every major concept tag has **2** MCQs.

**Apply on Supabase (SQL editor or CLI):** schema → starter `…220100…` → the three `…2300xx…` files (or `docs/APPLY_RBSE_COMMERCE_FULL.sql` for full_v1). Then verify Practice loads RBSE commerce questions.

Taxonomy: [`GURUKUL_QUESTION_BANK_RBSE_CLASSIFICATION.md`](./GURUKUL_QUESTION_BANK_RBSE_CLASSIFICATION.md) — status **full commerce chapter coverage v1**.

## Filter rules

- Platform rows: `school_id IS NULL`
- School rows: same `school_id` as student
- Board: `question_bank.board IN (school.board, 'both')` or `board IS NULL` (legacy)
- Client: `PracticeService.listBankQuestions` also filters by school board when available
- Subject names match seed: `Business Studies` (not `BST`), `Accountancy`, `Economics`, `Mathematics`, `English`, `Hindi`
- Roles: school `admin` / `principal` / `teacher` manage — **never** `super_admin`

## Next

1. Science 11–12 seed (Physics, Chemistry, Biology) — deferred.
2. Teacher-authored + AI-generated items with approval workflow.
3. CBSE formats (`assertion_reason`, `case_based`) tagged `board=cbse` only.
4. Optional `exam_year` tagging for board-paper style packs.
5. Deepen thin concepts / add numerical variants where useful.

## Regenerating seeds

```bash
node scripts/generate-rbse-commerce-seed.mjs
node scripts/generate-rbse-commerce-full-seed.mjs
```

- Starter: idempotent on `source=seed_rbse_commerce_v1` (≥240 ⇒ skip).
- Full: idempotent per migration file via chapter fingerprint under `source=seed_rbse_commerce_full_v1`.
