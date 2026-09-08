-- ═══════════════════════════════════════════════════════════════════════════
-- An answer key must address an option that EXISTS (§7, §10.24)
--
-- Closes the gap `20260914080000` left open and probe33 recorded rather than
-- fixed. That migration made `correct` carry POSITIONS instead of the option's
-- text, and tightened `test_questions_shape_matches_format` to require an
-- `indexes` array. What a CHECK cannot do is compare those indexes against the
-- LENGTH of `options` — a CHECK may not run a subquery, and reading a jsonb
-- array element-by-element needs one.
--
-- So `{"indexes":[7]}` on a two-option question was accepted, and it is exactly
-- as unmarkable as the label shape was: `rpc_test_submit` compares
-- `a.response = q.correct`, `QuestionRenderer` can only ever send an index it
-- actually rendered, so index 7 of 2 options can never be matched. Same defect,
-- one layer down.
--
-- Two more shapes were reachable for the same reason and are refused here:
--
--   {"indexes":[]}      an empty key. No answer is correct, so the question is
--                       unmarkable — the failure this whole area is about.
--   {"value":"4"}       a numerical key holding a STRING. jsonb equality is
--                       typed: '"4"' <> '4', so a student typing 4 (which the
--                       renderer sends as a number, QuestionRenderer.tsx:134
--                       `Number(e.target.value)`) never matches it.
--
-- ── A TRIGGER, FOR THE SAME REASON AS tg_question_bank_class_follows_chapter ─
--
-- That trigger exists because a CHECK cannot resolve a chapter's class. This
-- one exists because a CHECK cannot count an array it must also index into.
-- The CHECK constraint stays: it pins the SHAPE cheaply and declaratively on
-- every row, and this trigger adds the part it structurally cannot express.
-- Neither replaces the other.
--
-- ── MEASURED BEFORE WRITING, ACROSS ALL 576 ROWS ─────────────────────────
--
--     empty indexes array .............. 0
--     index >= jsonb_array_length(options) 0
--     numerical `value` not a number ... 0
--
-- The invariant already holds everywhere; this makes it structural, so the
-- next writer cannot reintroduce an unmarkable question.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_test_question_key_addresses_an_option()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _n_options int;
  _n_keys    int;
  _bad       text;
BEGIN
  IF NEW.question_format IN ('mcq', 'multi') THEN
    _n_options := jsonb_array_length(NEW.options);
    _n_keys    := jsonb_array_length(NEW.correct -> 'indexes');

    IF _n_keys = 0 THEN
      RAISE EXCEPTION
        'test_questions.correct names no option: an empty indexes array leaves the question unmarkable (§10.24)'
        USING ERRCODE = '23514';
    END IF;

    -- Reported with the offending value, because "constraint violated" on a
    -- bulk insert of a paper says nothing about WHICH question is wrong.
    SELECT k.v INTO _bad
      FROM jsonb_array_elements_text(NEW.correct -> 'indexes') AS k(v)
     WHERE k.v !~ '^[0-9]+$' OR k.v::int >= _n_options
     LIMIT 1;

    IF _bad IS NOT NULL THEN
      RAISE EXCEPTION
        'test_questions.correct names option % but the question has % option(s) (0..%): rpc_test_submit compares the key to what QuestionRenderer sends, so this answer could never be marked right',
        _bad, _n_options, _n_options - 1
        USING ERRCODE = '23514';
    END IF;

  ELSIF NEW.question_format = 'numerical' THEN
    -- jsonb equality is typed: '"4"' <> '4'. The renderer sends a number.
    IF jsonb_typeof(NEW.correct -> 'value') <> 'number' THEN
      RAISE EXCEPTION
        'test_questions.correct value is % , not a number: jsonb equality is typed, so a numeric answer could never match it',
        coalesce(jsonb_typeof(NEW.correct -> 'value'), 'absent')
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_test_question_key_addresses_an_option ON public.test_questions;
CREATE TRIGGER trg_test_question_key_addresses_an_option
  BEFORE INSERT OR UPDATE OF correct, options, question_format ON public.test_questions
  FOR EACH ROW EXECUTE FUNCTION public.tg_test_question_key_addresses_an_option();

COMMENT ON FUNCTION public.tg_test_question_key_addresses_an_option() IS
  'Every answer key must address an option that exists. A CHECK cannot do this '
  '-- it may not run a subquery, and counting a jsonb array while indexing into '
  'it needs one -- which is why test_questions_shape_matches_format pins the '
  'shape and this pins the range. Same division as '
  'tg_question_bank_class_follows_chapter.';

-- ── verification: inside the transaction, so a failure rolls back ─────────
DO $verify$
DECLARE _n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.test_questions'::regclass
                    AND tgname  = 'trg_test_question_key_addresses_an_option'
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORT: the range trigger is missing';
  END IF;

  -- The CHECK is a different migration's and must survive: this trigger only
  -- covers the range, and without the shape constraint a label key returns.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.test_questions'::regclass
                    AND conname  = 'test_questions_shape_matches_format'
                    AND convalidated) THEN
    RAISE EXCEPTION 'ABORT: the validated shape constraint was lost';
  END IF;

  -- INVARIANT: every existing key addresses a real option.
  SELECT count(*) INTO _n
    FROM public.test_questions q
   WHERE q.question_format IN ('mcq', 'multi')
     AND (jsonb_array_length(q.correct -> 'indexes') = 0
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(q.correct -> 'indexes') AS k(v)
                      WHERE k.v !~ '^[0-9]+$' OR k.v::int >= jsonb_array_length(q.options)));
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % choice question(s) key an option that does not exist', _n;
  END IF;

  SELECT count(*) INTO _n FROM public.test_questions
   WHERE question_format = 'numerical' AND jsonb_typeof(correct -> 'value') <> 'number';
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % numerical question(s) hold a non-numeric key', _n;
  END IF;

  -- POSITIVE CONTROL: "0 bad rows" is also what an empty table reports.
  SELECT count(*) INTO _n FROM public.test_questions WHERE question_format IN ('mcq','multi');
  IF _n = 0 THEN
    RAISE EXCEPTION 'ABORT: there are no choice questions at all -- the invariant above proved nothing';
  END IF;

  RAISE NOTICE 'every key addresses a real option across % choice question(s). probe33 asserts the refusal as the caller.', _n;
END $verify$;

COMMIT;
