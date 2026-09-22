-- ═══════════════════════════════════════════════════════════════════════════
-- A CHAPTER YOU PRACTISED IS YOURS TO REVISE (KNOWN_ISSUES 58)
--
-- Practice and the engines it feeds answered "is this chapter the student's?"
-- with two different rules, and the Practice tab sat on the seam.
--
--   * Practice serves the student's CLASS and board — question_bank is keyed by
--     class level — and finishing a session writes the chapter tally and starts
--     the revision clock for every chapter it touched.
--   * Revision and recovery ask _recovery_chapter_is_for, which required the
--     chapter's subject to be taught to the student's own SECTION
--     (section_subjects), and raised otherwise.
--
-- So the Revision screen booked checks that could never start. Measured
-- 2026-09-22 as arjun.mehta: section 10-A is mapped to Mathematics and Physics;
-- Practice offered him eight Class 10 subjects; 14 of the 23 chapters on his
-- revision schedule failed the guard, and pressing any of them returned
--
--     400 "chapter … is not taught to this student's section"
--
-- The same guard refused "Start recovery" for the mistakes those chapters hold.
--
-- ── THE RULING THIS MAKES ───────────────────────────────────────────────────
--
-- A chapter is the student's if it is taught to their section OR they have
-- practised it. Practice is self-directed (§10.8) and serves only the
-- student's own class, so a practised chapter can never be another class's
-- content — the guard's purpose ("a Class 5 student is never served Class 8
-- content") holds exactly as before. What it no longer does is refuse to
-- revise what the app itself let the student practise. A chapter the student
-- has neither been taught nor touched is refused, as it always was.
--
-- Callers, all unchanged: _recovery_chapter_is_mine (→ rpc_revision_session_plan)
-- and _recovery_session_plan_for (→ rpc_start_recovery_session,
-- _ensure_recovery_session, rpc_recovery_session_plan).
--
-- Rollback: rollback/20261044000000_a_chapter_you_practised_is_yours_to_revise.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.routines_pre_20261044000000 (
  object text PRIMARY KEY,
  definition text NOT NULL,
  applied text
);
ALTER TABLE public.routines_pre_20261044000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261044000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261044000000 IS
  'Rollback source for 20261044000000: _recovery_chapter_is_for exactly as it was before it, and as it left it. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

INSERT INTO public.routines_pre_20261044000000 (object, definition)
VALUES ('public._recovery_chapter_is_for(uuid,uuid)',
        pg_get_functiondef('public._recovery_chapter_is_for(uuid,uuid)'::regprocedure));

-- Refuse to replace a guard that is not the one this was written against.
DO $pre$
DECLARE _def text := (SELECT definition FROM public.routines_pre_20261044000000);
BEGIN
  IF position('JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id' IN _def) = 0
     OR position('question_attempts' IN _def) > 0 THEN
    RAISE EXCEPTION 'ABORT: _recovery_chapter_is_for is not the section-only guard this migration replaces. Re-read it first.';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public._recovery_chapter_is_for(_uid uuid, _chapter_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Taught to the student's own section...
  SELECT EXISTS (
    SELECT 1
      FROM public.chapters ch
      JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
      JOIN public.students st        ON st.class_id = ss.section_id
     WHERE ch.id = _chapter_id
       AND st.user_id = _uid
  )
  -- ...or practised by them. Practice serves only the student's own class, so
  -- this admits nothing of another class's; it stops the engines refusing to
  -- revise and recover what the app itself let the student practise
  -- (20261044000000, KNOWN_ISSUES 58).
  OR EXISTS (
    SELECT 1
      FROM public.question_attempts qa
      JOIN public.question_bank qb ON qb.id = qa.bank_question_id
     WHERE qa.user_id = _uid
       AND qb.chapter_id = _chapter_id
  )
$function$;

UPDATE public.routines_pre_20261044000000
   SET applied = pg_get_functiondef(object::regprocedure);

-- ── Proof ──────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  _arjun uuid := 'd1000003-0001-4000-8000-000000000001';
  _n int; _m int;
  _practised_untaught uuid; _taught uuid; _foreign uuid;
  _raised boolean; _err text;
BEGIN
  -- 1. Every chapter on his revision schedule is now his to revise.
  SELECT count(*) FILTER (WHERE NOT public._recovery_chapter_is_for(_arjun, cs.chapter_id)), count(*)
    INTO _n, _m
    FROM public.chapter_state cs
   WHERE cs.user_id = _arjun AND cs.next_revision_at IS NOT NULL;
  IF _m = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): the student has no revision schedule, so nothing was proved';
  END IF;
  IF _n > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of % scheduled chapters are still refused', _n, _m;
  END IF;

  -- Fixtures: one practised-but-untaught chapter (the case that broke), one
  -- taught chapter, and one neither taught nor practised.
  SELECT qb.chapter_id INTO _practised_untaught
    FROM public.question_attempts qa JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE qa.user_id = _arjun AND qb.chapter_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.chapters ch
                       JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
                       JOIN public.students st ON st.class_id = ss.section_id
                      WHERE ch.id = qb.chapter_id AND st.user_id = _arjun)
   LIMIT 1;
  SELECT ch.id INTO _taught
    FROM public.chapters ch
    JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
    JOIN public.students st ON st.class_id = ss.section_id
   WHERE st.user_id = _arjun LIMIT 1;
  SELECT ch.id INTO _foreign
    FROM public.chapters ch
   WHERE NOT EXISTS (SELECT 1 FROM public.section_subjects ss JOIN public.students st ON st.class_id = ss.section_id
                      WHERE ss.curriculum_subject_id = ch.curriculum_subject_id AND st.user_id = _arjun)
     AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa JOIN public.question_bank qb ON qb.id = qa.bank_question_id
                      WHERE qa.user_id = _arjun AND qb.chapter_id = ch.id)
   LIMIT 1;
  IF _practised_untaught IS NULL OR _taught IS NULL OR _foreign IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: fixtures missing (practised-untaught %, taught %, foreign %)', _practised_untaught, _taught, _foreign;
  END IF;

  IF NOT public._recovery_chapter_is_for(_arjun, _taught) THEN
    RAISE EXCEPTION 'ROLLED BACK: a chapter taught to the section is no longer the student''s';
  END IF;
  IF public._recovery_chapter_is_for(_arjun, _foreign) THEN
    RAISE EXCEPTION 'ROLLED BACK: a chapter neither taught nor practised is now the student''s — the guard stopped guarding';
  END IF;

  -- 2. As the student, signed in: the check that used to refuse now builds,
  --    and a chapter he never touched is still refused.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _raised := false;
  BEGIN
    PERFORM public.rpc_revision_session_plan(_practised_untaught);
  EXCEPTION WHEN others THEN _raised := true; _err := SQLERRM;
  END;
  RESET ROLE;
  IF _raised THEN
    RAISE EXCEPTION 'ROLLED BACK: the revision check for a chapter he practised still refuses: %', _err;
  END IF;

  SET LOCAL ROLE authenticated;
  _raised := false;
  BEGIN
    PERFORM public.rpc_revision_session_plan(_foreign);
  EXCEPTION WHEN others THEN _raised := true; _err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT _raised THEN
    RAISE EXCEPTION 'ROLLED BACK (control): a chapter he never touched was planned without objection';
  END IF;

  RAISE NOTICE 'verify OK: all % scheduled chapters are the student''s to revise; a practised-but-untaught chapter plans as the student, a taught one still counts, and one neither taught nor practised is still refused (%)', _m, _err;
END
$verify$;

COMMIT;
