-- ===========================================================================
-- MISTAKE COPIES FOLLOW THE REPAIRED BANK
--
-- The Mistake Book shows a mistake from the row's own copy of the question
-- (question_text, options, student_answer). Measured 2026-09-25 on CUET rows
-- keyed on a bank question, those copies had come apart from the question:
--
--   * The bank repair (20261084000000) took the "[<chapter>]" tags, page
--     furniture and bled option labels off the bank, but not off the copies:
--     eleven rows still read "…or belief. [Principles of Management]
--     [Principles of Management]", two still offer "Either" / "or (b) (d)
--     Only (b)".
--   * Three rows show a variant's answer against the original's options —
--     written before 20261097000000.
--
-- Repair: the copies take the bank's text and options (only where the option
-- count matches, so every stored index still points at the same choice), and
-- the three answers go back to the student's own last wrong answer on the
-- original (or a copy retired in its favour), from question_attempts — none
-- found, no answer. Each row's previous copy is logged for the rollback.
--
-- Scope: CUET rows. The school side is out of scope (ruled 2026-09-25).
--
-- ROLLBACK: rollback/20261098000000_mistake_copies_follow_the_repaired_bank.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.mistake_copy_repair_20261098 (
  mistake_id uuid PRIMARY KEY,
  kind       text NOT NULL,        -- copy | answer | copy+answer
  before     jsonb NOT NULL        -- question_text, options, student_answer as they were
);
ALTER TABLE public.mistake_copy_repair_20261098 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mistake_copy_repair_20261098 FROM PUBLIC, anon, authenticated;

-- The rows whose answer came from a variant: the answer, label stripped, is a
-- choice of a variant of the question and not of the question itself.
CREATE TEMP TABLE _answer ON COMMIT DROP AS
SELECT sm.id,
       (SELECT (a.selected_answer->>'index')::int
          FROM public.question_attempts a
          LEFT JOIN public.question_bank d ON d.id = a.bank_question_id
         WHERE a.user_id = sm.user_id AND NOT a.is_correct AND NOT COALESCE(a.skipped, false)
           AND (a.bank_question_id = sm.question_id OR d.replaced_by_question_id = sm.question_id)
         ORDER BY a.created_at DESC LIMIT 1) AS own_index
  FROM public.student_mistakes sm
  JOIN public.question_bank q ON q.id = sm.question_id
 WHERE q.board = 'cuet' AND sm.student_answer ? 'text'
   AND EXISTS (SELECT 1 FROM public.question_bank v, jsonb_array_elements_text(v.options) o
                WHERE v.source_question_id = sm.question_id
                  AND regexp_replace(o, '^\s*[A-D][.)]\s+', '') = regexp_replace(sm.student_answer->>'text', '^\s*[A-D][.)]\s+', ''))
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(q.options) o WHERE o = sm.student_answer->>'text');

-- The rows whose copy differs from the bank, where the bank's options line up
-- with the stored ones.
CREATE TEMP TABLE _copy ON COMMIT DROP AS
SELECT sm.id
  FROM public.student_mistakes sm
  JOIN public.question_bank q ON q.id = sm.question_id
 WHERE q.board = 'cuet'
   AND (sm.question_text IS DISTINCT FROM q.question OR sm.options IS DISTINCT FROM q.options)
   AND jsonb_typeof(sm.options) = 'array' AND jsonb_typeof(q.options) = 'array'
   AND jsonb_array_length(sm.options) = jsonb_array_length(q.options);

INSERT INTO public.mistake_copy_repair_20261098 (mistake_id, kind, before)
SELECT sm.id,
       CASE WHEN c.id IS NOT NULL AND a.id IS NOT NULL THEN 'copy+answer'
            WHEN c.id IS NOT NULL THEN 'copy' ELSE 'answer' END,
       jsonb_build_object('question_text', sm.question_text, 'options', sm.options, 'student_answer', sm.student_answer)
  FROM public.student_mistakes sm
  LEFT JOIN _copy c ON c.id = sm.id
  LEFT JOIN _answer a ON a.id = sm.id
 WHERE c.id IS NOT NULL OR a.id IS NOT NULL;

UPDATE public.student_mistakes sm
   SET question_text = q.question, options = q.options
  FROM public.question_bank q
 WHERE q.id = sm.question_id AND sm.id IN (SELECT id FROM _copy);

UPDATE public.student_mistakes sm
   SET student_answer = CASE
         WHEN a.own_index IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('index', a.own_index, 'selected_index', a.own_index,
                                 'text', sm.options->>a.own_index) END
  FROM _answer a
 WHERE a.id = sm.id;

-- ── Verify (each check can fail) ─────────────────────────────────────────────
DO $proof$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.mistake_copy_repair_20261098;
  IF _n < 3 THEN RAISE EXCEPTION 'expected the three variant answers and the stale copies, repaired %', _n; END IF;

  SELECT count(*) INTO _n FROM public.student_mistakes sm JOIN public.question_bank q ON q.id = sm.question_id
   WHERE q.board = 'cuet' AND (sm.question_text IS DISTINCT FROM q.question OR sm.options IS DISTINCT FROM q.options);
  IF _n <> 0 THEN RAISE EXCEPTION '% CUET mistake rows still differ from their question', _n; END IF;

  SELECT count(*) INTO _n FROM public.student_mistakes sm JOIN public.question_bank q ON q.id = sm.question_id
   WHERE q.board = 'cuet' AND sm.student_answer ? 'text'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(sm.options) o WHERE o = sm.student_answer->>'text')
     AND sm.id IN (SELECT mistake_id FROM public.mistake_copy_repair_20261098 WHERE kind LIKE '%answer');
  IF _n <> 0 THEN RAISE EXCEPTION '% repaired answers are still not one of their question''s choices', _n; END IF;

END
$proof$;

COMMIT;
