-- A CHECK THAT CANNOT BE SUBMITTED IS NOT OFFERED.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- Driven in the live school on 2026-09-17, twice, on two different chapters:
-- the student opened a revision check from the Revision tab, answered every
-- question, scored 80% and 100%, and the server threw the whole sitting away:
--
--   a revision check needs 1 unseen question(s) from this chapter;
--   that sitting answered 0 (plus 5 from your mistake book)
--
-- rpc_revision_session_plan and rpc_submit_revision_session disagree about
-- what a check is. The planner returns a plan whenever it can find ANYTHING —
-- up to REVISION_MISTAKE_MAX mistakes plus up to REVISION_COUNT unseen
-- questions, and it is content with zero of the second. The submit requires at
-- least one unseen question, because §5.4 is explicit:
--
--   "REVISION_COUNT (default 8) fresh questions, same chapter, NEVER SEEN by
--    this student. Never the old questions. Including them would test memory
--    of specific questions, which is precisely what revision exists to rule
--    out."
--
-- The submit is right. The planner is what is wrong: it hands the student a
-- sitting built entirely out of their own mistake book, which is a drill, and
-- then the submit correctly refuses to score a drill as a retention check.
--
-- The student sees none of that reasoning. They see a check, they answer it,
-- and it vanishes.
--
-- ── WHAT THIS DOES ──────────────────────────────────────────────────────────
--
-- The planner raises when there is no unseen question left, so the refusal
-- arrives BEFORE the student answers anything, and in words that say what is
-- actually wrong. The rule stays in one place — the server — and the Revision
-- card disables its button off `revision_fresh_available`, which
-- rpc_student_revision_queue already returns, rather than re-deriving it.
--
-- ── WHAT THIS DOES *NOT* FIX, AND IT MATTERS ────────────────────────────────
--
-- A chapter whose unseen pool is empty still cannot complete the ladder. Three
-- passes need 8 + 8 + 8 = 24 never-seen questions, on top of everything
-- ordinary practice has already consumed. Measured here: Polynomials holds 49
-- approved questions and ran dry after two checks; Arithmetic Progressions
-- holds 45 and ran dry before one.
--
-- So under §5.4 as written, a chapter needs a bank deep enough that a student
-- can practise it AND still meet three untouched sets of eight. That is a
-- content decision (deepen the bank) or a spec decision (let a question the
-- student last saw several intervals ago count as unseen again — which is what
-- spaced repetition normally means). It is NOT a decision this migration takes
-- on its own: §5.4 says "never the old questions" in as many words.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
  _old text := E'  _n_fresh := COALESCE(array_length(_fresh, 1), 0);\n';
  _add text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_revision_session_plan';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_revision_session_plan is not defined on this database';
  END IF;

  _add := _old ||
    E'\n' ||
    E'  -- §5.4: a revision check is made of questions this student has NEVER\n' ||
    E'  -- SEEN. With none left there is no check to give, and building one out\n' ||
    E'  -- of the mistake book alone produces a sitting that\n' ||
    E'  -- rpc_submit_revision_session will refuse to score — measured live on\n' ||
    E'  -- 2026-09-17, twice, after the student had answered every question.\n' ||
    E'  -- Refusing here costs them nothing; refusing there costs them the\n' ||
    E'  -- sitting.\n' ||
    E'  IF _n_fresh = 0 THEN\n' ||
    E'    RAISE EXCEPTION ''there is nothing new left in this chapter to check you on — every question in it has already come up'';\n' ||
    E'  END IF;\n';

  IF position(_old IN _def) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the _n_fresh assignment was not found verbatim in the live body';
  END IF;

  _new := replace(_def, _old, _add);
  IF _new = _def THEN
    RAISE EXCEPTION 'would have failed open: nothing was substituted';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'the planner now refuses a chapter with no unseen questions left';
END $$;

DO $$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_revision_session_plan';
  IF position('IF _n_fresh = 0 THEN' IN _def) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the guard is not in the live body';
  END IF;
END $$;

COMMIT;
