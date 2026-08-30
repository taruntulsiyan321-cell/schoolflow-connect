-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260830130000_chunk95_batch1_internal_helpers.sql
--
-- Restores EXECUTE on the 18 internal helpers to PUBLIC, anon and
-- authenticated, and restores the schema-scoped default privilege.
--
-- WHAT THIS REOPENS. All 18 are internal helpers with no client caller, so
-- nothing needs them to be reachable. Running this makes them callable by every
-- signed-in user again for no benefit.
--
-- The ONE case where this file is the right answer: if a screen turns out to
-- break because something calls one of these through a path the caller survey
-- missed — a dynamic .rpc(name) built from a variable, or an edge function the
-- grep did not read. Then restore, identify the real caller, and re-revoke with
-- an explicit grant-back to just that role. Do not leave it rolled back.
--
-- NOT restored here: the database-wide default privilege, which lives in
-- 20260830140000 and has its own rollback. Undoing it from this file would make
-- one migration's rollback silently change another's, and the two are separable
-- — the batch can be reverted while new functions stay unexposed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
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
BEGIN
  FOREACH _sig IN ARRAY _sigs LOOP
    IF to_regprocedure('public.' || _sig) IS NULL THEN
      RAISE EXCEPTION 'public.% does not exist; refusing to half-restore', _sig;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO PUBLIC', _sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon', _sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', _sig);
  END LOOP;

  FOREACH _sig IN ARRAY _sigs LOOP
    IF NOT has_function_privilege('authenticated', ('public.' || _sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'rollback did not restore the authenticated grant on public.%', _sig;
    END IF;
  END LOOP;
END
$restore$;

-- The schema-scoped default from the forward migration. It never had any effect
-- (see 20260830140000 — schema-scoped defaults are ADDED to the global ones, so
-- a REVOKE there cannot remove the built-in PUBLIC grant), but it is undone
-- here so the catalog matches the code.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

COMMIT;
