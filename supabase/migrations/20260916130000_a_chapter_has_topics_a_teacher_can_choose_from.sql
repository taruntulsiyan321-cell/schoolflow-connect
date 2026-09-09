-- ═══════════════════════════════════════════════════════════════════════════
-- A chapter has topics a teacher can choose from (§5, §10.9)
--
-- `question_bank.topic` was never a classification. Measured 2026-09-09:
--
--     21,696 questions
--     11,917 distinct topics          -- 1.8 questions per topic
--      8,360 topics used exactly ONCE
--        523 chapters, median 24 distinct topics each, worst 150
--
-- A teacher picking a topic for a question paper is handed a list that is
-- nearly as long as the question list. Three separate defects produced that,
-- and they need three different remedies -- which is why one normalisation
-- pass was never going to be enough:
--
--   1. SPELLING. `inference` / `drawing_inferences`, `main_idea` /
--      `identifying_main_idea`, `fact_opinion` / `fact_vs_opinion`. The label
--      names an exercise verb rather than a topic.
--
--   2. PER-QUESTION LABELS. Hindi / व्याकरण - संधि had 150 topics for 219
--      questions: `anusvara_sandhi_k`, `anusvara_sandhi_kha`,
--      `anusvara_sandhi_p`, `anusvara_sandhi_ta` … whoever generated these
--      wrote the specific example into the topic field.
--
--   3. TRANSLITERATION. `vyajan` / `vyanjan` / `vyanjana`, `svar` / `swar`,
--      `deergh` / `dirgh` / `dirgha` — one Hindi word, several Latin
--      spellings. English stemming cannot see these, and neither can the
--      embeddings, because an embedding describes the QUESTION and most of
--      these topics carry a single question.
--
-- ── WHAT THIS COLUMN IS ──────────────────────────────────────────────────
--
-- `topic_group` is the canonical topic for grouping and filtering.
-- `topic` KEEPS ITS ORIGINAL VALUE and is not touched: this is additive and
-- reversible, and the raw label still carries the finer distinction for
-- anyone who wants it. Nothing reads `topic_group` until a caller opts in.
--
-- It is computed by `scripts/classify-question-topics.mjs`, which holds the
-- rules and proves them with `--self-test`. The grouping is scoped to
-- (subject, chapter): `inference` in English and `inference` in Mathematics
-- are different topics and never merge.
--
-- Result of the first run, recorded here so a later run that moves these
-- numbers a long way is visibly a change and not a no-op:
--
--     distinct topics per chapter   median 24 -> 15,  worst 150 -> 68
--     chapters with more than 40    48 -> 7
--     question rows given a group different from their raw topic:  8,328
--
-- Rollback: supabase/migrations/rollback/
--           20260916130000_a_chapter_has_topics_a_teacher_can_choose_from.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS topic_group text;

COMMENT ON COLUMN public.question_bank.topic_group IS
  'Canonical topic for grouping and filtering, scoped to (subject, chapter). '
  'Computed by scripts/classify-question-topics.mjs from `topic`, which keeps '
  'its raw value. NULL means not yet classified — treat it as unknown, never '
  'as a topic named "none" (G4).';

-- The teacher-facing query is "the topics of this chapter", and the paper
-- filler then asks for "questions in this chapter with this topic".
CREATE INDEX IF NOT EXISTS question_bank_chapter_topic_group_idx
  ON public.question_bank (chapter_id, topic_group)
  WHERE topic_group IS NOT NULL;

CREATE INDEX IF NOT EXISTS question_bank_subject_chapter_topic_group_idx
  ON public.question_bank (subject, chapter, topic_group)
  WHERE topic_group IS NOT NULL;

DO $verify$
DECLARE n_cols int; n_idx int;
BEGIN
  SELECT count(*) INTO n_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='question_bank' AND column_name='topic_group';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION 'verify: topic_group column missing';
  END IF;

  SELECT count(*) INTO n_idx FROM pg_indexes
   WHERE schemaname='public' AND tablename='question_bank'
     AND indexname IN ('question_bank_chapter_topic_group_idx',
                       'question_bank_subject_chapter_topic_group_idx');
  IF n_idx <> 2 THEN
    RAISE EXCEPTION 'verify: expected 2 topic_group indexes, found %', n_idx;
  END IF;

  -- The positive control: `topic` must still be there and still populated.
  -- Without this, a migration that dropped the source column would pass.
  IF (SELECT count(*) FROM public.question_bank WHERE topic IS NOT NULL) = 0 THEN
    RAISE EXCEPTION 'verify: question_bank.topic is empty — the source label was lost';
  END IF;

  RAISE NOTICE 'verify OK: topic_group added, 2 indexes present, topic intact';
END
$verify$;
