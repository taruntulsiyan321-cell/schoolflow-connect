-- ═══════════════════════════════════════════════════════════════════════════
-- A practice mistake knows its question, and therefore its chapter
--
-- MEASURED ON THE LIVE DATABASE, 2026-09-13, before writing a line of this:
--
--   student_mistakes, rows carrying a question_id
--   source     with_qid   matches question_bank   matches question_attempts
--   practice         20                       3                         17
--   test              6                       0                          0
--
--   student_mistakes.chapter_id: 0 of 509 rows keyed
--   question_bank:               21,681 of 21,696 rows carry chapter_id
--
-- The bank is classified. The mistake book is not, and the reason is one
-- argument in one call.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────
--
-- rpc_record_question_attempt inserts the attempt, captures the new row's id
-- as _aid, and then does:
--
--     PERFORM public.rpc_record_concept_mistake(
--       'practice', _session_id, _aid,
--                                ^^^^
--
-- The third parameter of rpc_record_concept_mistake is `_question_id`, and it
-- is written straight into student_mistakes.question_id. So the column holds
-- the id of the ATTEMPT, not of the question. The 17-of-20 row above is that,
-- measured. It has no foreign key, so nothing ever objected.
--
-- ── WHAT IT BREAKS ───────────────────────────────────────────────────────
--
-- 1. "Incorrect Questions" practice mode. PracticeService.listMistakeQuestions
--    takes student_mistakes.question_id and looks the ids up in question_bank.
--    Attempt ids match nothing, so the mode loads an empty session.
--
-- 2. times_wrong never increments. The upsert is
--    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL,
--    and an attempt id is unique per attempt by construction — so the conflict
--    arm is unreachable and getting the same question wrong five times writes
--    five rows reading times_wrong = 1. §6.3's REPEATED_MISTAKE_PIN (pin a
--    chapter at three) can therefore never fire, and the Mistake Book shows
--    the same question repeatedly instead of once with a count.
--
-- 3. The whole 7C engine. §2: "All triggers, thresholds and scheduling operate
--    on chapter_id." chapter_state, recovery_sessions, revision_sessions,
--    recovery_constants, _apply_chapter_state and rpc_recovery_session_plan
--    are all built and live — and _apply_chapter_state counts open mistakes
--    per chapter_id, while rpc_recovery_session_plan draws tier 0 from
--    student_mistakes WHERE chapter_id = _chapter_id. With chapter_id null on
--    every row, the 5-mistake trigger never fires, no chapter_state row is
--    ever created from practice, and the tier ladder has no tier 0.
--
-- The engine was never broken. It has never been fed.
--
-- ── THE FIX, IN ORDER ────────────────────────────────────────────────────
--
-- Section 1 passes the bank question id. Section 2 derives chapter_id from it,
-- once, at the table. Section 3 repairs the rows already written. Neither half
-- is useful alone: keying off an attempt id finds no chapter, and passing the
-- bank id without the derivation leaves chapter_id null.
--
-- ── WHY A SUBSTITUTION AND NOT A CREATE OR REPLACE ───────────────────────
--
-- The live bodies no longer match their migration files. 20260828200000
-- rewrote ten functions in place via pg_get_functiondef, off the dropped
-- `mastered` column and onto `status`, and 7B-1/7C-A/7C-B each spliced
-- statements into rpc_record_question_attempt and rpc_finish_practice_session
-- the same way. Rebuilding either from file text would silently revert those.
-- So this edits the live definition and refuses to proceed if the text it
-- expects is not there.
--
-- Reverse: supabase/migrations/rollback/20260921000000_a_practice_mistake_knows_its_question.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Record the question, not the attempt ───────────────────────────────
DO $fix$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_question_attempt';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_record_question_attempt not found';
  END IF;

  IF _def LIKE '%''practice'', _session_id, _bank_id,%' THEN
    RAISE NOTICE 'already passing the bank question id; nothing to do';
    RETURN;
  END IF;

  -- Anchored on the full argument triple, not on the bare token `_aid` — that
  -- name also appears as the RETURNING target and in the early-return paths,
  -- and replacing those would break the function's contract.
  _new := replace(_def,
    '''practice'', _session_id, _aid,',
    '''practice'', _session_id, _bank_id,');

  IF _new = _def THEN
    RAISE EXCEPTION
      'could not find the rpc_record_concept_mistake argument list to repoint. The live body has changed shape — re-read it with pg_get_functiondef before editing.';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'rpc_record_question_attempt now records the bank question id.';
END
$fix$;

-- ── 2. Derive the chapter, once, at the table ─────────────────────────────
-- A trigger rather than an edit to rpc_record_concept_mistake: the fact is one
-- fact — a mistake's chapter is the chapter of its question — and editing the
-- one writer leaves dpp, battleground and any future writer to be found later.
--
-- BEFORE INSERT OR UPDATE OF question_id: a row that arrives already keyed is
-- left alone, and a row whose question changes is re-keyed rather than keeping
-- a stale chapter.
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

-- ── 3. Repair the rows already written ────────────────────────────────────
-- 3a. question_id currently holding an attempt id -> the attempt's bank id.
-- Only where the attempt actually carries one: a template or AI question has
-- no bank row, and inventing a link would be worse than leaving it null.
--
-- Done as an UPDATE of question_id, which is exactly what the trigger in
-- section 2 fires on, so chapter_id follows without a second statement.
--
-- Two guards, because this restores the very unique index it is repairing:
-- skip if a row for that (user, source, bank question) already exists, and
-- among several attempt-id rows for the same bank question carry only the
-- earliest. Everything skipped is folded and removed by 3c.
UPDATE public.student_mistakes sm
   SET question_id = qa.bank_question_id
  FROM public.question_attempts qa
 WHERE qa.id = sm.question_id
   AND qa.bank_question_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.student_mistakes other
      WHERE other.user_id = sm.user_id
        AND other.source = sm.source
        AND other.question_id = qa.bank_question_id
   )
   AND sm.id = (
     SELECT sm2.id
       FROM public.student_mistakes sm2
       JOIN public.question_attempts qa2 ON qa2.id = sm2.question_id
      WHERE sm2.user_id = sm.user_id
        AND sm2.source = sm.source
        AND qa2.bank_question_id = qa.bank_question_id
      ORDER BY sm2.created_at, sm2.id
      LIMIT 1
   );

-- 3b. Rows that already held a real bank id but were written before the
-- trigger existed.
UPDATE public.student_mistakes sm
   SET chapter_id = qb.chapter_id
  FROM public.question_bank qb
 WHERE sm.question_id = qb.id
   AND sm.chapter_id IS NULL
   AND qb.chapter_id IS NOT NULL;

-- 3c. Fold the times_wrong of the rows 3a could not carry into the row it
-- kept, then remove them. Both statements require a surviving row to fold
-- into, so nothing is deleted without its count being preserved first.
WITH leftover AS (
  SELECT sm.id, sm.user_id, sm.source, sm.times_wrong, qa.bank_question_id AS bank_id
    FROM public.student_mistakes sm
    JOIN public.question_attempts qa ON qa.id = sm.question_id
   WHERE qa.bank_question_id IS NOT NULL
), folded AS (
  SELECT l.user_id, l.source, l.bank_id, sum(l.times_wrong)::int AS extra
    FROM leftover l
   GROUP BY 1, 2, 3
)
UPDATE public.student_mistakes keep
   SET times_wrong = keep.times_wrong + f.extra
  FROM folded f
 WHERE keep.user_id = f.user_id
   AND keep.source = f.source
   AND keep.question_id = f.bank_id;

DELETE FROM public.student_mistakes sm
 USING public.question_attempts qa
 WHERE qa.id = sm.question_id
   AND qa.bank_question_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.student_mistakes keep
      WHERE keep.user_id = sm.user_id
        AND keep.source = sm.source
        AND keep.question_id = qa.bank_question_id
   );

-- ── 4. Prove it, against the live table ───────────────────────────────────
-- G11: every assertion here can fail. The first fails if the substitution in
-- section 1 did not take; the second writes a real mistake through the real
-- INSERT path and requires the chapter to come back keyed, which a mere
-- "does the trigger exist" check would not catch if it fired AFTER.
DO $prove$
DECLARE
  _src     text;
  _q       record;
  _uid     uuid;
  _school  uuid;
  _got     uuid;
  _id      uuid;
  _stale   int;
BEGIN
  SELECT prosrc INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_question_attempt';

  IF _src NOT LIKE '%''practice'', _session_id, _bank_id,%' THEN
    RAISE EXCEPTION 'section 1 did not take: the attempt id is still being recorded as the question id';
  END IF;

  -- Only rows that COULD be repaired. An attempt on a template or AI
  -- question carries no bank_question_id, so its mistake keeps the attempt id
  -- and stays unkeyed — a known gap, not a failure of section 3.
  SELECT count(*)::int INTO _stale
    FROM public.student_mistakes sm
    JOIN public.question_attempts qa ON qa.id = sm.question_id
   WHERE qa.bank_question_id IS NOT NULL;
  IF _stale > 0 THEN
    RAISE EXCEPTION 'section 3 left % repairable row(s) whose question_id is still an attempt id', _stale;
  END IF;

  SELECT s.user_id, s.school_id INTO _uid, _school
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.school_id IS NOT NULL
   LIMIT 1;
  IF _uid IS NULL THEN
    RAISE WARNING 'no student with a school; the trigger could not be exercised';
    RETURN;
  END IF;

  SELECT qb.id, qb.chapter_id INTO _q
    FROM public.question_bank qb
   WHERE qb.chapter_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.source = 'practice' AND sm.question_id = qb.id)
   LIMIT 1;
  IF _q IS NULL THEN
    RAISE WARNING 'no free keyed question to probe with; trigger not exercised';
    RETURN;
  END IF;

  INSERT INTO public.student_mistakes (user_id, school_id, source, question_id, subject, question_text)
  VALUES (_uid, _school, 'practice', _q.id, '__probe__', '__probe__')
  RETURNING id, chapter_id INTO _id, _got;

  DELETE FROM public.student_mistakes WHERE id = _id;

  IF _got IS DISTINCT FROM _q.chapter_id THEN
    RAISE EXCEPTION 'the trigger did not key the row: expected %, got %', _q.chapter_id, _got;
  END IF;

  RAISE NOTICE 'verified: a practice mistake now records its bank question and lands keyed to its chapter.';
END
$prove$;

-- ── 5. Report the coverage rather than assuming it ────────────────────────
DO $report$
DECLARE _total int; _withq int; _keyed int; _seed int;
BEGIN
  SELECT count(*)::int, count(question_id)::int, count(chapter_id)::int
    INTO _total, _withq, _keyed FROM public.student_mistakes;
  SELECT count(*)::int INTO _seed
    FROM public.student_mistakes WHERE question_id IS NULL;

  RAISE NOTICE 'student_mistakes: % rows, % with a question, % keyed to a chapter.', _total, _withq, _keyed;
  RAISE NOTICE '% row(s) carry no question at all (the 2026-08-28 bulk seed) and cannot be keyed from here.', _seed;
END
$report$;

COMMIT;
