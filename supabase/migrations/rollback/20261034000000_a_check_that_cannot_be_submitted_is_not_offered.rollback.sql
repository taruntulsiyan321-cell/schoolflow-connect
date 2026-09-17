-- ROLLBACK for 20261034000000_a_check_that_cannot_be_submitted_is_not_offered.
--
-- READ THIS FIRST. This restores a defect in which a student answers a full
-- revision check, scores it, and has the sitting thrown away by
-- rpc_submit_revision_session with an error the Revision screen shows as a
-- toast after the fact.
--
-- Removes the guard by substitution off the live body, failing closed if it
-- is not found.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
  _guard text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_revision_session_plan';

  _guard :=
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

  _new := replace(_def, _guard, '');
  IF _new = _def THEN
    RAISE EXCEPTION 'would have failed open: the guard was not found verbatim';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'the planner will again build a check the submit cannot score';
END $$;

COMMIT;
