-- ═══════════════════════════════════════════════════════════════════════════
-- HOTFIX ahead of Chunk 9.5's batches — the three _backfill_* maintenance
-- functions, which any signed-in student could call.
--
-- MEASURED, not inferred. Called as a real demo student inside a rolled-back
-- transaction, with tuple writes counted by pg_stat_xact_user_tables:
--
--   _backfill_battle_question_concepts()   749 tuples written
--   _backfill_question_bank_concepts()       6 tuples written
--   _backfill_template_concepts()            0 tuples written
--
-- All three take NO ARGUMENTS, are SECURITY DEFINER, and are called from
-- nowhere in the client — the only occurrences in src/ are the three generated
-- type declarations in integrations/supabase/types.ts, which are declarations
-- and not calls. So a student can run them, repeatedly, at will, and nothing in
-- the product needs them to be reachable.
--
-- ── Why the third one is included ─────────────────────────────────────────
--
-- _backfill_template_concepts() wrote 0 tuples in the probe. That is not a
-- reason to leave it: it is the same function shape, the same grants, the same
-- absence of a caller, and it wrote nothing only because there was nothing left
-- to backfill AT THAT MOMENT. Excluding it would leave an identical hole open
-- on the strength of when the probe happened to run.
--
-- ── REVOKING FROM PUBLIC ALONE WOULD HAVE CHANGED NOTHING ─────────────────
--
-- This is the important part, and it applies to all of Chunk 9.5 rather than
-- just these three.
--
-- anon and authenticated hold EXPLICIT EXECUTE grants on these functions, not
-- privileges inherited through PUBLIC. Verified per function with
-- aclexplode(proacl), not assumed.
--
-- So `REVOKE EXECUTE ... FROM PUBLIC` would have:
--   * left every signed-in user able to call them exactly as before, AND
--   * made has_function_privilege('public', oid, 'EXECUTE') return FALSE,
--     so the chunk's verification item 1 -- "zero functions EXECUTE-able by
--     PUBLIC" -- would have reported success.
--
-- A revoke that reports success while changing nothing is the exact G15 shape:
-- the construct that silently does nothing. Across the whole surface it is
-- 290 of 305 functions with an explicit `authenticated` grant and 276 with an
-- explicit `anon` grant, so the batches must revoke from all three grantees and
-- must verify against `authenticated`, never against `public`.
--
-- service_role and postgres KEEP their grants. These are maintenance functions
-- and a background job or an operator is exactly who should be able to run
-- them; the bug is that a fifteen-year-old could.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $revoke$
DECLARE
  _fn text;
  _fns text[] := ARRAY[
    '_backfill_battle_question_concepts',
    '_backfill_question_bank_concepts',
    '_backfill_template_concepts'
  ];
  _n int;
BEGIN
  FOREACH _fn IN ARRAY _fns LOOP
    -- Fail loudly if the function is not there. A REVOKE naming a function that
    -- does not exist raises, but the SAME migration replayed after a rename
    -- would abort halfway; better to say which one and why.
    SELECT count(*) INTO _n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = _fn AND p.pronargs = 0;
    IF _n <> 1 THEN
      RAISE EXCEPTION 'expected exactly one zero-argument public.%(), found % — refusing to guess which to revoke', _fn, _n;
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM PUBLIC', _fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM anon', _fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM authenticated', _fn);
  END LOOP;
END
$revoke$;

-- ── Assert the OUTCOME, and assert it against the role that matters ───────
DO $verify$
DECLARE
  _fn text;
  _fns text[] := ARRAY[
    '_backfill_battle_question_concepts',
    '_backfill_question_bank_concepts',
    '_backfill_template_concepts'
  ];
  _oid oid;
BEGIN
  FOREACH _fn IN ARRAY _fns LOOP
    SELECT p.oid INTO _oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = _fn AND p.pronargs = 0;

    -- The three that must now be false. `authenticated` is the one that would
    -- have stayed true under a PUBLIC-only revoke, so it is checked first and
    -- named explicitly in the error.
    IF has_function_privilege('authenticated', _oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.%() is STILL executable by authenticated — the explicit grant survived the revoke', _fn;
    END IF;
    IF has_function_privilege('anon', _oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.%() is STILL executable by anon', _fn;
    END IF;
    IF has_function_privilege('public', _oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.%() is STILL executable by PUBLIC', _fn;
    END IF;

    -- And the one that must still be TRUE. A revoke that also cut the
    -- background path would have closed the hole by breaking the feature, which
    -- this chunk is explicit is the worse outcome.
    IF NOT has_function_privilege('service_role', _oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.%() is no longer executable by service_role — the revoke went too far', _fn;
    END IF;
  END LOOP;
END
$verify$;

COMMIT;
