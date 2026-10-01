-- ═══════════════════════════════════════════════════════════════════════════
-- TWO ATTEMPT COLUMNS SAY WHAT THEY HOLD
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 93. Two question_attempts columns carried descriptions of
-- something they never recorded, and "How you work" on Analysis believed them
-- until 20261115000000:
--
--   attempt_number   described as "Nth attempt on same stem within session".
--                    Practice writes ++attemptNumberRef — the question's place
--                    in its session (1..50 measured), whatever the stem.
--   solution_viewed  described as "learner viewed solution". Practice sets it
--                    when the server returned an explanation, which is then
--                    shown after every answer unasked; there is no "open the
--                    solution" choice to record (1,069 of 8,428 rows true).
--
-- No function, view or screen reads either column now (measured: no public
-- function body names them; the app only writes them). The descriptions are
-- corrected here so the next reader is not misled the way Analysis was. The
-- columns themselves go, with the writes, once the app that writes them is no
-- longer the deployed one — KNOWN_ISSUES 108.
--
-- ROLLBACK: rollback/20261132000000_two_attempt_columns_say_what_they_hold.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

COMMENT ON COLUMN public.question_attempts.attempt_number IS
  'The question''s position in its practice session (1 = the first question asked), written by the practice screen. NOT a count of attempts at this question — count rows per bank_question_id for that (20261132000000).';
COMMENT ON COLUMN public.question_attempts.solution_viewed IS
  'True when the server returned an explanation with this question. The explanation is shown after every answer unasked, so this is NOT a record that the student chose to view a solution (20261132000000).';

DO $proof$
BEGIN
  IF position('position in its practice session' IN
       col_description('public.question_attempts'::regclass,
         (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.question_attempts'::regclass AND attname = 'attempt_number'))) = 0
  OR position('NOT a record that the student chose' IN
       col_description('public.question_attempts'::regclass,
         (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.question_attempts'::regclass AND attname = 'solution_viewed'))) = 0 THEN
    RAISE EXCEPTION 'the attempt columns still carry their old descriptions';
  END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261132000000_two_attempt_columns_say_what_they_hold')
ON CONFLICT (version) DO NOTHING;

COMMIT;
