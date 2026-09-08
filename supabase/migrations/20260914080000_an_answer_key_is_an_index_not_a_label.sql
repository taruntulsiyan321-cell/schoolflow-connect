-- ═══════════════════════════════════════════════════════════════════════════
-- An answer key is an INDEX, not a label — 576 questions could never be marked
-- right (§7, §10.24; KNOWN_ISSUES 28, second half)
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────
--
-- `rpc_test_submit` marks with plain jsonb equality:
--
--     is_correct = (a.response IS NOT NULL AND a.response = q.correct)
--
-- and `QuestionRenderer` — the ONLY component that draws a test question —
-- sends `{"indexes":[i]}` when a student picks option i (`QuestionRenderer.tsx`
-- line 84). So `correct` must hold `{"indexes":[i]}` for the two ever to be
-- equal.
--
-- Every row in the table held a bare jsonb STRING instead. Measured before
-- writing this, across all 576 `test_questions` rows:
--
--     correct is a jsonb string ........... 576 of 576   (all question_format 'mcq')
--     correct is an object ................   0
--     the string is one of the row's own options .. 576 of 576
--     the string matches MORE than one option .....   0
--
-- `{"indexes":[0]} = "a"` is false, so a student answering one of these
-- correctly scored zero, and there was no answer they could have given that
-- would have scored anything else. The key was written as the option's TEXT and
-- read as the option's POSITION — the two-homes shape (G9) in one column.
--
-- ── WHY THE CONSTRAINT DID NOT CATCH IT ───────────────────────────────────
--
-- `test_questions_shape_matches_format` exists, is VALIDATED, and passed all
-- 576 rows, because for a choice question it only ever asserted
-- `correct IS NOT NULL`. A constraint named for a shape it does not check is
-- the "check that cannot fail" shape (G11): it reads as coverage and provides
-- none. This migration makes the name true.
--
-- ── WHO WROTE THE OLD SHAPE ───────────────────────────────────────────────
--
-- Not the client. `TestService.toCorrect` has written `{indexes:[i]}` /
-- `{value}` / `{text}` since 20260914040000. All 576 rows came from
-- `supabase/fixtures/SCALE_FIXTURE.sql` — `'Scale Q' || g` with options
-- `["a","b","c","d"]` and correct `"a"` — a performance fixture. Two more
-- writers held the same shape and are corrected alongside this migration:
-- `SEED_DEMO_DATA.sql` and `verification/CHUNK75_VERIFY.sql`, plus the fixtures
-- inside probe7 and probe31.
--
-- These are all fixtures, which is why nothing was reported. It is also why
-- this is worth fixing rather than shrugging at: they are the ONLY test data in
-- the project (72 tests, all of them scale fixtures), so anyone measuring
-- "does marking work?" would have measured 0% and gone looking in the grader.
--
-- ── NO RE-MARKING QUESTION ────────────────────────────────────────────────
--
-- `test_answers` holds 0 rows, so no stored `is_correct` and no stored score
-- was ever computed from the old shape. Nothing is re-marked by this change and
-- no student's recorded result moves.
--
-- ── THE REPAIR IS DERIVED, NOT GUESSED ────────────────────────────────────
--
-- Each row's key is resolved against THAT ROW'S OWN `options` array. The
-- migration refuses to run if any row's label names no option, names more than
-- one, or sits on a format where a label is not a position — a wrong key is
-- worse than a missing one, so an unresolvable row aborts the whole thing
-- rather than being repaired on an assumption.
--
-- Verification runs BEFORE COMMIT deliberately. A DO block after COMMIT is a
-- report, not a guard — it cannot roll back what it just found wrong, and this
-- migration rewrites data.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. the premise, asserted before anything is rewritten ─────────────────
DO $premise$
DECLARE
  _odd          int;
  _unresolvable int;
  _ambiguous    int;
BEGIN
  -- A bare string on a written or numerical question is not an option label and
  -- must never be turned into one.
  SELECT count(*) INTO _odd
    FROM public.test_questions
   WHERE jsonb_typeof(correct) = 'string'
     AND question_format NOT IN ('mcq', 'multi');
  IF _odd > 0 THEN
    RAISE EXCEPTION
      'ABORT: % row(s) hold a bare-string key on a non-choice format; repair those by hand', _odd;
  END IF;

  SELECT count(*) INTO _unresolvable
    FROM public.test_questions q
   WHERE jsonb_typeof(q.correct) = 'string'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements_text(coalesce(q.options, '[]'::jsonb)) AS o(val)
        WHERE o.val = q.correct #>> '{}');
  IF _unresolvable > 0 THEN
    RAISE EXCEPTION
      'ABORT: % key(s) name no option in their own row -- the position cannot be derived', _unresolvable;
  END IF;

  SELECT count(*) INTO _ambiguous
    FROM (
      SELECT q.id
        FROM public.test_questions q
        CROSS JOIN LATERAL jsonb_array_elements_text(q.options) AS o(val)
       WHERE jsonb_typeof(q.correct) = 'string'
         AND o.val = q.correct #>> '{}'
       GROUP BY q.id
      HAVING count(*) > 1) s;
  IF _ambiguous > 0 THEN
    RAISE EXCEPTION
      'ABORT: % row(s) have a key matching more than one option -- ambiguous, not repairable', _ambiguous;
  END IF;
END $premise$;

-- ── 2. the repair ─────────────────────────────────────────────────────────
-- `min(ord)` is defensive only: the premise above proved no row has more than
-- one match, so there is exactly one ordinal per row to take.
WITH resolved AS (
  SELECT q.id, (min(o.ord) - 1)::int AS idx
    FROM public.test_questions q
    CROSS JOIN LATERAL jsonb_array_elements_text(q.options) WITH ORDINALITY AS o(val, ord)
   WHERE jsonb_typeof(q.correct) = 'string'
     AND q.question_format IN ('mcq', 'multi')
     AND o.val = q.correct #>> '{}'
   GROUP BY q.id
)
UPDATE public.test_questions tq
   SET correct = jsonb_build_object('indexes', jsonb_build_array(r.idx))
  FROM resolved r
 WHERE r.id = tq.id;

-- ── 3. make the constraint's name true ────────────────────────────────────
-- Every branch begins with a test that is FALSE rather than NULL when it does
-- not apply, because a CHECK passes on NULL. `correct IS NOT NULL` leads each
-- key test for exactly that reason: `false AND NULL` is false, `NULL AND NULL`
-- is not.
ALTER TABLE public.test_questions DROP CONSTRAINT IF EXISTS test_questions_shape_matches_format;
ALTER TABLE public.test_questions
  ADD CONSTRAINT test_questions_shape_matches_format
  CHECK (
    (question_format IN ('mcq', 'multi')
       AND options IS NOT NULL
       AND correct IS NOT NULL
       AND correct ? 'indexes'
       AND jsonb_typeof(correct -> 'indexes') = 'array'
       AND answer IS NULL)
    OR
    (question_format = 'numerical'
       AND correct IS NOT NULL
       AND correct ? 'value'
       AND answer IS NULL)
    OR
    (question_format IN ('short', 'long')
       AND answer IS NOT NULL
       AND correct IS NULL)
  );

COMMENT ON COLUMN public.test_questions.correct IS
  'The answer KEY, in the shape rpc_test_submit compares a response against: '
  '{"indexes":[i,...]} for mcq/multi -- POSITIONS in `options`, never the option '
  'text -- and {"value":n} for numerical. NULL for short/long, whose model '
  'answer lives in `answer`. Marking is plain jsonb equality against what '
  'QuestionRenderer sends, so a key in any other shape can never be matched.';

-- ── 4. verification: invariants, inside the transaction so it can roll back ─
-- These say nothing about who may WRITE these rows (they run as the migration
-- role); probe33 asserts that as the caller, and proves the constraint can
-- actually refuse something.
DO $verify$
DECLARE
  _n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.test_questions'::regclass
                    AND conname  = 'test_questions_shape_matches_format') THEN
    RAISE EXCEPTION 'ABORT: the shape constraint is missing';
  END IF;

  -- A NOT VALID constraint would accept every existing row without looking at
  -- one. That is the failure this whole migration is about, so it is asserted.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.test_questions'::regclass
                    AND conname  = 'test_questions_shape_matches_format'
                    AND convalidated) THEN
    RAISE EXCEPTION 'ABORT: the shape constraint exists but was never validated';
  END IF;

  -- INVARIANT 1: no key is a bare label anywhere in the table.
  SELECT count(*) INTO _n FROM public.test_questions
   WHERE jsonb_typeof(correct) = 'string';
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % question(s) still key on the option text', _n;
  END IF;

  -- INVARIANT 2: every choice question carries a position list the grader can
  -- match. Stated independently of the constraint so a dropped constraint and a
  -- broken repair cannot pass each other.
  SELECT count(*) INTO _n FROM public.test_questions
   WHERE question_format IN ('mcq', 'multi')
     AND NOT (correct IS NOT NULL
              AND correct ? 'indexes'
              AND jsonb_typeof(correct -> 'indexes') = 'array');
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % choice question(s) have no indexes list', _n;
  END IF;

  -- INVARIANT 3: every index actually addresses an option. A key of
  -- {"indexes":[7]} on a four-option question is exactly as unmarkable as the
  -- label was, and the CHECK cannot see this (it would need a subquery).
  SELECT count(*) INTO _n
    FROM public.test_questions q
    CROSS JOIN LATERAL jsonb_array_elements_text(q.correct -> 'indexes') AS k(v)
   WHERE q.question_format IN ('mcq', 'multi')
     AND (k.v !~ '^[0-9]+$' OR k.v::int >= jsonb_array_length(q.options));
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % key index(es) point past the end of their options', _n;
  END IF;

  -- POSITIVE CONTROL: the repair must not have emptied the table or the column.
  -- "0 bad rows" is also what a deleted table reports.
  SELECT count(*) INTO _n FROM public.test_questions
   WHERE question_format IN ('mcq', 'multi');
  RAISE NOTICE 'answer keys are positions now: % choice question(s) carry a matchable key.', _n;
END $verify$;

COMMIT;
