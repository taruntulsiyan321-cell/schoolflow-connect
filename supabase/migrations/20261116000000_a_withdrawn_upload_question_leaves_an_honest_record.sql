-- ===========================================================================
-- A QUESTION THE PRODUCT WITHDREW MUST NOT STILL BE COUNTED.
--
-- Measured on production 2026-09-27, on the CUET account with the most Custom
-- Practice history:
--
--   question_attempts for that account .................... 243
--   the same attempts summed per chapter (by_chapter) ...... 240
--   the same attempts summed per subject (by_subject) ...... 240
--
-- The three missing ones are a real story, not rounding. The student uploaded a
-- Chemistry worksheet (`upload_kinetics.png`) at 02:57 on 2026-09-25, answered
-- three of its questions a minute later — two of them wrong — and at 07:22 the
-- upload was re-classified `unusable`: "Chemistry isn't one of your CUET
-- Commerce subjects, so it wasn't saved." §4.3 then did exactly what it says
-- and deleted the questions and notes, keeping the file.
--
-- What it left behind is three `question_attempts` rows pointing at
-- `generated_question->>'upload_question_id'` values that no longer exist, with
-- `subject = ''` and `chapter = NULL`. So they:
--
--   * still count in `effort.attempts`, the number the Practice tab shows;
--   * cannot appear in by_chapter or by_subject, which group by name;
--   * are invisible in the charts, which require a chapter.
--
-- One number for one thing: a withdrawn question's attempt is either counted
-- everywhere or nowhere. It has to be NOWHERE — the product decided the student
-- should never have been served it, and its own mistake rows are already gone.
--
-- THE FLAG ALREADY EXISTS AND ALREADY MEANS THIS. `excluded_from_accuracy`
-- (20261065000000, §6.1) is "retained for audit, omitted from practice
-- accuracy", written for a disputed AI-upload answer. A withdrawn
-- out-of-syllabus question is the same judgement: keep the row, stop counting
-- it. `rpc_student_practice_analytics` and `_write_chapter_tally` both already
-- honour it (verified on production), so setting it is all that is needed —
-- there is no reader to teach.
--
-- A TRIGGER, NOT A FIX IN THE EDGE FUNCTION. `custom-practice-upload` is the
-- caller that withdrew these, but it is not the only thing that can delete an
-- upload question: `studentUploadService` deletes them too, and
-- `ai-recovery-variants` reads them. The fact is "a deleted upload question's
-- attempts stop counting", and it belongs to the table, next to the two
-- triggers that already fill a mistake's school and chapter.
--
-- NOT TOUCHED: `student_mistakes.upload_question_id` is ON DELETE SET NULL, so
-- a mistake outlives its question by design. Measured: this account has no
-- mistake from the withdrawn upload at all (45 rows, every one with a chapter,
-- every one in an in-syllabus subject), so there is nothing to repair there and
-- nothing is invented here.
--
-- ROLLBACK: rollback/20261116000000_a_withdrawn_upload_question_leaves_an_honest_record.sql
-- ===========================================================================

BEGIN;

-- ── What the numbers are before anything changes ────────────────────────────
CREATE TEMP TABLE _before AS
SELECT qa.user_id,
       count(*) AS orphan_attempts,
       count(*) FILTER (WHERE NOT qa.excluded_from_accuracy) AS still_counted
  FROM public.question_attempts qa
 WHERE qa.source = 'upload'
   AND NULLIF(qa.generated_question->>'upload_question_id', '') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.student_upload_questions q
      WHERE q.id = NULLIF(qa.generated_question->>'upload_question_id', '')::uuid)
 GROUP BY qa.user_id;

-- ── The rule, at the table ──────────────────────────────────────────────────
CREATE FUNCTION public.tg_upload_question_withdrawn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- The attempts made on this question stop counting, and keep their row.
  UPDATE public.question_attempts qa
     SET excluded_from_accuracy = true
   WHERE qa.user_id = OLD.owner_id
     AND NOT qa.excluded_from_accuracy
     AND NULLIF(qa.generated_question->>'upload_question_id', '')::uuid = OLD.id;
  RETURN OLD;
END
$function$;

COMMENT ON FUNCTION public.tg_upload_question_withdrawn() IS
  'When an upload question is deleted (§4.3 unusable, or the student removing it), the attempts already made on it are kept for audit and stop counting towards accuracy (§6.1''s excluded_from_accuracy).';

REVOKE ALL ON FUNCTION public.tg_upload_question_withdrawn() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS upload_question_withdrawn ON public.student_upload_questions;
CREATE TRIGGER upload_question_withdrawn
  AFTER DELETE ON public.student_upload_questions
  FOR EACH ROW EXECUTE FUNCTION public.tg_upload_question_withdrawn();

-- ── The rows already left behind ────────────────────────────────────────────
-- Only attempts whose question is genuinely gone. An empty subject is set to
-- NULL in the same pass: '' is not a subject, and it is what the client sent
-- when it had none.
UPDATE public.question_attempts qa
   SET excluded_from_accuracy = true,
       subject = NULLIF(btrim(qa.subject), '')
 WHERE qa.source = 'upload'
   AND NOT qa.excluded_from_accuracy
   AND NULLIF(qa.generated_question->>'upload_question_id', '') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.student_upload_questions q
      WHERE q.id = NULLIF(qa.generated_question->>'upload_question_id', '')::uuid);

-- ── Proof, and every check can fail ─────────────────────────────────────────
DO $proof$
DECLARE
  _repaired int;
  _left     int;
  _uid      uuid;
  _pa       jsonb;
  _effort   int;
  _by_chap  int;
  _by_subj  int;
  _uq       uuid;
  _att      uuid;
  _other    uuid;
  _flagged  boolean;
  _control  boolean;
BEGIN
  -- 1. THE REPAIR. Nothing un-excluded may be left pointing at a question that
  --    does not exist.
  SELECT coalesce(sum(still_counted), 0) INTO _repaired FROM _before;
  SELECT count(*) INTO _left
    FROM public.question_attempts qa
   WHERE qa.source = 'upload'
     AND NOT qa.excluded_from_accuracy
     AND NULLIF(qa.generated_question->>'upload_question_id', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.student_upload_questions q
        WHERE q.id = NULLIF(qa.generated_question->>'upload_question_id', '')::uuid);
  IF _left <> 0 THEN
    RAISE EXCEPTION 'still % attempt(s) counted on a question that no longer exists', _left;
  END IF;

  IF _repaired = 0 THEN
    -- Not a failure: a later run has nothing to repair. Said out loud, because
    -- check 2 then proves nothing about a repair.
    RAISE WARNING 'nothing to repair on this database: no attempt was counted on a withdrawn upload question.';
  ELSE
    -- 2. THE NUMBERS AGREE NOW, for the account that had the orphans. The
    --    canonical readers honour the flag, so the total and the per-chapter
    --    and per-subject sums must be the same number.
    SELECT user_id INTO _uid FROM _before WHERE still_counted > 0 ORDER BY still_counted DESC LIMIT 1;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _pa := public.rpc_student_practice_analytics();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    _effort  := (_pa->'effort'->>'attempts')::int;
    SELECT coalesce(sum((e->>'attempts')::int), 0) INTO _by_chap
      FROM jsonb_array_elements(_pa->'by_chapter') e;
    SELECT coalesce(sum((e->>'attempts')::int), 0) INTO _by_subj
      FROM jsonb_array_elements(_pa->'by_subject') e;

    IF _effort <> _by_chap OR _effort <> _by_subj THEN
      RAISE EXCEPTION 'the counts still disagree for %: effort %, by_chapter %, by_subject %',
        _uid, _effort, _by_chap, _by_subj;
    END IF;
    RAISE NOTICE 'repaired % attempt(s); % now reads % everywhere (effort, by_chapter, by_subject)',
      _repaired, _uid, _effort;
  END IF;

  -- 3. THE TRIGGER, on a real question with a real attempt on it, rolled back.
  --    The control is the second assertion: an attempt on a DIFFERENT question
  --    must not be touched, so this cannot pass by flagging everything.
  BEGIN
    SELECT NULLIF(qa.generated_question->>'upload_question_id', '')::uuid, qa.id
      INTO _uq, _att
      FROM public.question_attempts qa
     WHERE qa.source = 'upload'
       AND NOT qa.excluded_from_accuracy
       AND EXISTS (
         SELECT 1 FROM public.student_upload_questions q
          WHERE q.id = NULLIF(qa.generated_question->>'upload_question_id', '')::uuid)
     LIMIT 1;

    IF _uq IS NULL THEN
      RAISE WARNING 'the trigger is UNPROVEN here: no attempt on a surviving upload question to withdraw.';
    ELSE
      SELECT qa.id INTO _other
        FROM public.question_attempts qa
       WHERE qa.id <> _att AND NOT qa.excluded_from_accuracy
         AND (qa.source <> 'upload'
              OR NULLIF(qa.generated_question->>'upload_question_id', '')::uuid IS DISTINCT FROM _uq)
       LIMIT 1;

      DELETE FROM public.student_upload_questions WHERE id = _uq;

      SELECT excluded_from_accuracy INTO _flagged FROM public.question_attempts WHERE id = _att;
      IF NOT _flagged THEN
        RAISE EXCEPTION 'withdrawing a question did not stop its attempt counting';
      END IF;
      IF _other IS NOT NULL THEN
        SELECT excluded_from_accuracy INTO _control FROM public.question_attempts WHERE id = _other;
        IF _control THEN
          RAISE EXCEPTION 'CONTROL: an unrelated attempt was flagged too — the trigger is too wide';
        END IF;
      ELSE
        RAISE WARNING 'CONTROL SKIPPED: there was no unrelated attempt to check the trigger against.';
      END IF;
      RAISE EXCEPTION 'WITHDRAWAL_PROVEN';
    END IF;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'WITHDRAWAL_PROVEN' THEN RAISE; END IF;
    RAISE NOTICE 'the trigger was proven on a real attempt and rolled back';
  END;

  -- 4. The trigger is where it says it is.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.student_upload_questions'::regclass
       AND t.tgname = 'upload_question_withdrawn'
       AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'the trigger is not on student_upload_questions';
  END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261116000000_a_withdrawn_upload_question_leaves_an_honest_record')
ON CONFLICT (version) DO NOTHING;

COMMIT;
