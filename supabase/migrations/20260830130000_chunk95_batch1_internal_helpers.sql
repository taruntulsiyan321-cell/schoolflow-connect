-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9.5 BATCH 1 — the underscore-prefixed helpers, plus the default
--
-- 18 functions. These are internal helpers: nothing in the client calls them,
-- and they were never meant to be reachable from outside.
--
-- ── REVOKING FROM PUBLIC ALONE CLOSES ALMOST NOTHING ──────────────────────
--
-- The chunk's step 3 says REVOKE ... FROM PUBLIC. Measured against this
-- database, that would have been close to a no-op that reported success:
--
--   290 of the 305 PUBLIC-executable functions have an EXPLICIT grant to
--   `authenticated`, and 276 have an explicit grant to `anon`.
--
-- Explicit grants are not inherited through PUBLIC and are not removed by
-- revoking from it. So a PUBLIC-only revoke would leave every signed-in user
-- calling these exactly as before, while making
-- has_function_privilege('public', oid, 'EXECUTE') return FALSE -- which is
-- precisely what verification item 1 asks. The gate would go green and nothing
-- would have changed. That is G15's shape: the construct that silently does
-- nothing.
--
-- Every batch therefore revokes from PUBLIC, anon AND authenticated, and every
-- assertion is written against `authenticated`, never against `public`.
--
-- ── TWO FUNCTIONS ARE DELIBERATELY NOT IN THIS BATCH ──────────────────────
--
--   _recovery_chapter_is_mine(uuid)
--   _recovery_variant_pool(uuid, smallint, text)
--
-- Both are called by rpc_recovery_session_plan, which is SECURITY INVOKER on
-- purpose (7C-C part 1: question_bank's board filter lives in an RLS policy, and
-- a definer there would bypass it the way rpc_dpp_pick_from_bank did). An
-- INVOKER function's calls are privilege-checked against the END USER, so
-- revoking these two from `authenticated` would break recovery for every
-- student. "A revoke that breaks a teacher's attendance screen is worse than
-- the exposure it closed" — this is that, and the answer is to leave them and
-- record why, not to revoke and discover it later.
--
-- Their exposure is bounded and worth stating: both are STABLE, so Postgres
-- guarantees they cannot write. _recovery_chapter_is_mine is a self-scoped
-- entitlement check, and _recovery_variant_pool reads question_bank as the
-- caller under RLS.
--
-- ── The two trigger functions ARE in this batch ───────────────────────────
--
-- _battles_set_code and _enforce_duel_capacity are attached as triggers.
-- Postgres does not check EXECUTE privilege when firing a trigger, so revoking
-- is expected to be invisible to them. Expected, not assumed: the verification
-- file inserts a battle as `authenticated` and asserts the code still gets set.
--
-- ── ALTER DEFAULT PRIVILEGES, and what it will cost ───────────────────────
--
-- Without it the surface regrows with the next migration that creates a
-- function. With it, a NEW function is not executable by anon or authenticated
-- unless its migration grants it explicitly — and a migration that forgets will
-- ship an RPC that fails with "permission denied" the first time a student
-- touches that screen. That is a real new failure mode, traded deliberately for
-- one that is loud and immediate over one that is silent and permanent.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $revoke$
DECLARE
  _sig  text;
  _sigs text[] := ARRAY[
    '_academic_label_match_key(text)',
    '_battles_set_code()',
    '_classify_mistake_error(jsonb,jsonb,jsonb,integer,integer)',
    '_compute_mastery_score(integer,integer,integer,integer,integer,timestamp with time zone)',
    '_concept_severity(numeric)',
    '_eie_attendance_risk_band(numeric)',
    '_eie_band_severity(text)',
    '_eie_homework_consistency_band(numeric)',
    '_enforce_duel_capacity()',
    '_fix_academic_display_text(text)',
    '_fix_utf8_content(text)',
    '_generate_battle_code()',
    '_humanize_template_type(text)',
    '_normalize_cp1252_mojibake_to_latin1(text)',
    '_normalize_subject_label(text)',
    '_recovery_question_count(text)',
    '_repair_utf8_mojibake(text)',
    '_rule_improvement_plan(text,text,text,numeric,integer,integer)'
  ];
  _n int;
BEGIN
  FOREACH _sig IN ARRAY _sigs LOOP
    -- Resolve by full signature. Four names in this database carry two
    -- signatures with different reach, so revoking by NAME would hit an
    -- overload nobody reviewed (G13's rule: key on the signature).
    SELECT count(*) INTO _n FROM pg_proc p
     WHERE p.oid = ('public.' || _sig)::regprocedure;
    IF _n <> 1 THEN
      RAISE EXCEPTION 'could not resolve public.% to exactly one function', _sig;
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', _sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', _sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM authenticated', _sig);
  END LOOP;

  -- Assert the outcome against the role that a PUBLIC-only revoke would have
  -- left untouched.
  FOREACH _sig IN ARRAY _sigs LOOP
    IF has_function_privilege('authenticated', ('public.' || _sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% is still executable by authenticated', _sig;
    END IF;
    IF has_function_privilege('anon', ('public.' || _sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% is still executable by anon', _sig;
    END IF;
    IF NOT has_function_privilege('service_role', ('public.' || _sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% is no longer executable by service_role — the revoke went too far', _sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'batch 1: % functions revoked from PUBLIC, anon and authenticated', array_length(_sigs, 1);
END
$revoke$;

-- ── The default, so the surface does not regrow ───────────────────────────
-- Migrations run as `postgres`, and ALTER DEFAULT PRIVILEGES applies to objects
-- created by the role that sets it, so this covers every function a future
-- migration creates.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $assert_default$
DECLARE _acl text;
BEGIN
  SELECT array_to_string(defaclacl, ',') INTO _acl
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'f';

  -- A default-privilege row must now EXIST for functions in this schema. If the
  -- ALTER were a no-op there would simply be no row, and nothing else in this
  -- migration would have noticed.
  IF _acl IS NULL THEN
    RAISE EXCEPTION 'no default ACL row for functions in schema public — the ALTER DEFAULT PRIVILEGES did nothing';
  END IF;
  IF _acl LIKE '%=X/%' AND _acl ~ '(^|,)=X/' THEN
    RAISE EXCEPTION 'the default ACL still grants EXECUTE to PUBLIC: %', _acl;
  END IF;
  RAISE NOTICE 'default ACL for new functions in public: %', _acl;
END
$assert_default$;

COMMIT;
