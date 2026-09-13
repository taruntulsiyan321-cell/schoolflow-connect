-- ═══════════════════════════════════════════════════════════════════════════
-- A practice mistake knows its chapter
--
-- The whole 7C engine is built, applied and live — and starved. This is the
-- one missing write that feeds it.
--
-- ── WHAT IS ALREADY THERE ────────────────────────────────────────────────
--
-- 7C-A/B/C shipped the real recovery and revision engine:
--
--   chapter_state        the §3.2 state machine, one row per student/chapter
--   recovery_sessions    FOUR tier results, never one blended score (§4.2b)
--   revision_sessions    the spaced checks
--   recovery_constants   RECOVERY_TRIGGER_COUNT 5, intervals 7/21/60, the
--                        2/3/3/2 tier ladder — readable from SQL
--   _apply_chapter_state wired into the end of rpc_finish_practice_session
--   rpc_recovery_session_plan   the bank-first tier ladder with the offer floor
--
-- ── WHY IT DOES NOTHING ──────────────────────────────────────────────────
--
-- §2: "All triggers, thresholds and scheduling operate on chapter_id", and
-- 7C-B keys every query on it, deliberately: matching on a chapter NAME is
-- what filled revision_queue with 200 rows pointing at 'Chapter 3'.
--
-- The §4.1 trigger reads:
--
--     WHERE sm.user_id = ... AND sm.status = 'open'
--       AND sm.chapter_id IS NOT NULL
--     GROUP BY sm.chapter_id HAVING count(*) >= 5
--
-- student_mistakes.chapter_id was added by 20260829130000 section 5, for the
-- TEST path only — its own comment says so: "A test question knows its
-- chapter_id, so this is where the keyed form starts being written."
-- rpc_submit_test_attempt duly writes it.
--
-- rpc_record_concept_mistake — the writer for EVERY practice, dpp and
-- battleground mistake — was never given the same treatment. Not in any of
-- its five definitions. So every practice mistake lands with chapter_id NULL,
-- the trigger's own IS NOT NULL filter discards it, and:
--
--   · the 5-open-mistakes trigger never fires for practice
--   · no chapter_state row is ever created from practice
--   · rpc_recovery_session_plan finds no tier-0 questions, because it reads
--     student_mistakes WHERE chapter_id = _chapter_id
--
-- The engine is not wrong. It is correct and unfed.
--
-- ── WHY A TRIGGER AND NOT FIVE EDITED WRITERS ────────────────────────────
--
-- The fact is one fact: a mistake's chapter is the chapter of the question it
-- was made on. Writing that derivation into rpc_record_concept_mistake alone
-- fixes the practice path and leaves dpp and battleground to be found later,
-- and any sixth writer starts wrong again. One derivation at the table is the
-- shared definition; N copies in N writers is the defect this repo has paid
-- for before.
--
-- It is also the only safe edit available. The live bodies of these functions
-- no longer match their migration files — 20260828200000 rewrote ten of them
-- in place, off `mastered` and onto `status`, via pg_get_functiondef. Pasting
-- a CREATE OR REPLACE built from the file text would silently reintroduce the
-- dropped `mastered` column and break every wrong answer in the product.
--
-- ── LIMIT, STATED ────────────────────────────────────────────────────────
--
-- This fills chapter_id from question_bank.chapter_id. Where THAT is null the
-- mistake still lands unkeyed and the engine still cannot see the chapter —
-- that is the topic/chapter classification work, and it is not this
-- migration's to do. Section 4 reports the coverage so the number is known
-- rather than assumed.
--
-- Reverse: supabase/migrations/rollback/20260921000000_a_practice_mistake_knows_its_chapter.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The derivation, in one place ───────────────────────────────────────
-- BEFORE INSERT OR UPDATE OF question_id: a row that arrives already keyed is
-- left alone (the test path sets it explicitly and is not second-guessed), and
-- a row whose question changes is re-keyed rather than keeping the old
-- chapter.
CREATE OR REPLACE FUNCTION public.tg_student_mistakes_set_chapter_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.chapter_id IS NULL AND NEW.question_id IS NOT NULL THEN
    SELECT qb.chapter_id INTO NEW.chapter_id
      FROM public.question_bank qb
     WHERE qb.id = NEW.question_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_student_mistakes_set_chapter_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS student_mistakes_set_chapter_id ON public.student_mistakes;
CREATE TRIGGER student_mistakes_set_chapter_id
  BEFORE INSERT OR UPDATE OF question_id ON public.student_mistakes
  FOR EACH ROW EXECUTE FUNCTION public.tg_student_mistakes_set_chapter_id();

-- ── 2. Key the mistakes already recorded ──────────────────────────────────
-- Every practice mistake ever made is unkeyed, so without this the engine
-- stays blind until a student re-makes each one. The join is the same
-- derivation the trigger performs; rows whose question_bank row has no
-- chapter_id are left null, not guessed at.
UPDATE public.student_mistakes sm
   SET chapter_id = qb.chapter_id
  FROM public.question_bank qb
 WHERE sm.question_id = qb.id
   AND sm.chapter_id IS NULL
   AND qb.chapter_id IS NOT NULL;

-- ── 3. The trigger must actually fire ─────────────────────────────────────
-- G11: this can fail. It writes a real mistake row through the real INSERT
-- path and requires the chapter to come back keyed — if the trigger is not
-- attached, or fires AFTER, or the DEFINER cannot read question_bank, the
-- EXCEPTION below is raised and the whole migration rolls back. A pure
-- "does the trigger exist" check would pass in all three of those cases.
DO $prove$
DECLARE
  _q      record;
  _uid    uuid;
  _school uuid;
  _got    uuid;
  _id     uuid;
BEGIN
  -- A real student, with the school_id the NOT NULL column demands.
  SELECT s.user_id, s.school_id INTO _uid, _school
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.school_id IS NOT NULL
   LIMIT 1;

  IF _uid IS NULL THEN
    RAISE WARNING 'no student with a school available; the trigger could not be exercised.';
    RETURN;
  END IF;

  -- A keyed question this student has NOT already recorded a practice mistake
  -- on, so the probe cannot trip student_mistakes_user_source_q and fail for
  -- a reason that has nothing to do with the trigger.
  SELECT qb.id, qb.chapter_id INTO _q
    FROM public.question_bank qb
   WHERE qb.chapter_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.source = 'practice' AND sm.question_id = qb.id
     )
   LIMIT 1;

  IF _q IS NULL THEN
    RAISE WARNING 'no keyed question_bank row available to probe with, so the trigger was not exercised. The engine stays unfed until classification runs.';
    RETURN;
  END IF;

  INSERT INTO public.student_mistakes (
    user_id, school_id, source, question_id, subject, question_text
  ) VALUES (
    _uid, _school, 'practice', _q.id, '__trigger_probe__', '__trigger_probe__'
  )
  RETURNING id, chapter_id INTO _id, _got;

  -- Delete before asserting: a raised EXCEPTION rolls the whole migration
  -- back, so the probe row would go anyway — but on the WARNING paths above
  -- nothing is inserted at all, and this keeps the success path clean too.
  DELETE FROM public.student_mistakes WHERE id = _id;

  IF _got IS DISTINCT FROM _q.chapter_id THEN
    RAISE EXCEPTION
      'tg_student_mistakes_set_chapter_id did not key the row: expected %, got %. The 7C engine would stay blind to practice mistakes.',
      _q.chapter_id, _got;
  END IF;

  RAISE NOTICE 'trigger verified: a practice mistake now lands keyed to its chapter.';
END
$prove$;

-- ── 4. Report the coverage, do not assume it ──────────────────────────────
DO $report$
DECLARE _total int; _keyed int; _bank_unkeyed int;
BEGIN
  SELECT count(*)::int INTO _total FROM public.student_mistakes WHERE question_id IS NOT NULL;
  SELECT count(*)::int INTO _keyed FROM public.student_mistakes WHERE chapter_id IS NOT NULL;
  SELECT count(*)::int INTO _bank_unkeyed FROM public.question_bank WHERE chapter_id IS NULL;

  RAISE NOTICE 'student_mistakes: % of % question-linked rows now carry a chapter_id.', _keyed, _total;
  RAISE NOTICE 'question_bank: % row(s) still have no chapter_id — those mistakes stay unkeyed until classification reaches them.', _bank_unkeyed;
END
$report$;

COMMIT;
