-- Rollback for 20260921000000.
--
-- Puts the attempt id back into student_mistakes.question_id and removes the
-- chapter derivation.
--
-- READ THIS FIRST — what applying this rollback restores is three defects,
-- measured on the live database on 2026-09-13:
--
--   · "Incorrect Questions" loads an empty session, because the ids it hands
--     question_bank are attempt ids (17 of the 20 rows that had one).
--   · times_wrong is frozen at 1. The upsert keys on
--     (user_id, source, question_id) and an attempt id is unique per attempt,
--     so the conflict arm is unreachable and each repeat writes a new row.
--     §6.3's REPEATED_MISTAKE_PIN can never fire.
--   · The 7C engine goes blind again: _apply_chapter_state counts open
--     mistakes per chapter_id, and rpc_recovery_session_plan draws tier 0
--     from student_mistakes WHERE chapter_id = _chapter_id.
--
-- Section 3's repair is NOT undone, deliberately. Those rows now point at the
-- question the mistake was actually made on, which is true regardless of this
-- rollback, and the attempt ids they replaced are not recoverable from here.
-- The pre-change rows were captured before the migration ran; restore from
-- that capture if they are genuinely needed.

BEGIN;

DROP TRIGGER IF EXISTS student_mistakes_set_chapter_id ON public.student_mistakes;
DROP FUNCTION IF EXISTS public.tg_student_mistakes_set_chapter_id();

DO $undo$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_question_attempt';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_record_question_attempt not found';
  END IF;

  _new := replace(_def,
    '''practice'', _session_id, _bank_id,',
    '''practice'', _session_id, _aid,');

  IF _new = _def THEN
    RAISE NOTICE 'already recording the attempt id; nothing to undo';
  ELSE
    EXECUTE _new;
    RAISE WARNING 'student_mistakes.question_id will again hold attempt ids. Incorrect Questions is empty and times_wrong is frozen at 1.';
  END IF;
END
$undo$;

COMMIT;
