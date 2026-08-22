-- Phase 5 (authorization/RLS/tenant isolation) audit, 2026-08-22.
--
-- CRITICAL finding. Every "internal" (`_`-prefixed by convention)
-- SECURITY DEFINER helper function in this schema is directly callable via
-- PostgREST by BOTH `anon` (fully unauthenticated) and `authenticated`
-- (confirmed live via has_function_privilege for all 76 functions checked --
-- every single one came back true for both roles). The underscore prefix is
-- a naming convention only; it grants no actual access control. Since these
-- are SECURITY DEFINER, they bypass RLS entirely, so being callable at all
-- means a caller supplies whatever _uid/_student_id/_class_id argument they
-- want, with the function itself never checking it against auth.uid().
--
-- The worst case, found first: `_demo_upsert_auth_user(_id, _email,
-- _password, _full_name)` directly INSERTs/UPDATEs `auth.users` with a
-- caller-supplied password hash for a caller-supplied id -- a full,
-- unauthenticated account-takeover primitive. Every other migration that
-- ever created this function also DROPped it at the end of the same
-- migration (supabase/migrations/20260604120000_demo_data.sql:497,
-- 20260607033426_..sql:345, 20260626000000_..sql:265,
-- supabase/SEED_DEMO_DATA.sql:529 -- consistent, clearly deliberate
-- "create, use, drop within one transaction" pattern for exactly this
-- reason). 20260805030000_qa_automation_student_account.sql recreated it to
-- work around a migration-history gap but is the one migration that forgot
-- the matching DROP -- that omission is the root cause of this being live
-- and publicly callable today. Checked auth.users for signs of exploitation
-- (20 total rows, all @wisdomcampus.com demo accounts or this session's own
-- developer accounts, no unfamiliar emails, no suspicious created_at burst)
-- -- no evidence found, but this closes the hole regardless.
--
-- Every other flagged function was checked for real client/edge-function
-- callers (grep across src/ and supabase/functions/ for `.rpc("_...`) --
-- zero matches for every one, confirming they are genuinely internal-only
-- (called via PERFORM/SELECT from other SECURITY DEFINER functions, which
-- run nested calls as the definer/owner role, not as anon/authenticated --
-- REVOKE here cannot break that call chain, only direct external calls).
-- Revoking is scoped to the functions whose exposure is a real risk (read or
-- forge another user's academic/gamification data, or send notifications as
-- another identity) -- pure text/number transforms with no table access
-- (_compute_mastery_score, _normalize_subject_label, etc.) are left alone
-- since anon-callability of a pure function exposes nothing.

-- 1. Close the account-takeover hole outright, restoring the pattern every
--    other migration already followed.
DROP FUNCTION IF EXISTS public._demo_upsert_auth_user(uuid, text, text, text);

-- 2. Revoke direct external EXECUTE on the internal helpers that read or
--    write another identity's data without checking auth.uid() themselves.
DO $$
DECLARE
  _fn text;
  _names text[] := ARRAY[
    -- cross-tenant/cross-user READ of private academic data
    '_exam_readiness', '_rebuild_revision_queue', '_revision_recently_completed',
    '_revision_topic_priority', '_dim_consistency', '_dim_evidence_strength',
    '_dim_growth_trend', '_dim_recovery_need', '_dim_retention', '_dim_understanding',
    '_weak_topics_for_user', '_build_concept_recovery_report', '_community_user_role',
    '_class_grade', '_community_author_name',
    -- forgery of another identity's academic/gamification records
    '_upsert_concept_mastery', '_upsert_question_record', '_bump_academic_activity',
    '_progression_bump_study_streak', '_progression_check_milestones',
    '_progression_bump_homework_count', '_award_achievement', '_award_badge',
    '_award_engagement_badges', '_community_refresh_reputation', '_ensure_student_xp',
    '_battle_event', '_capture_battle_mistakes', '_capture_dpp_mistakes',
    '_maybe_finish_battle', '_practice_grade_from_bank',
    '_recompute_concept_confidence_for_session', '_snapshot_battle_report',
    -- send notifications/announcements as an arbitrary identity
    '_notify', '_notify_class_students', '_notify_class_teacher',
    '_notify_school_operators', '_notify_school_students', '_notify_student_circle',
    '_notify_student_parents', '_fanout_announcement_published',
    -- featured-battle system internals (forgery of the featured-content pipeline)
    '_featured_system_creator', '_fill_featured_battle_questions',
    '_peek_teacher_featured_battle', '_pick_featured_subject',
    '_seed_featured_battle_for_class'
  ];
BEGIN
  FOR _fn IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', _fn);
  END LOOP;
END;
$$;

-- 3. Root cause, foundation-level: this whole class of bug exists because
--    Supabase's own project default (checked live via pg_default_acl) grants
--    EXECUTE on every newly created function to `anon` and `authenticated`
--    automatically, for functions created by either `postgres` or
--    `supabase_admin` (both checked, both set this default). That default is
--    why an internal `_`-prefixed helper is publicly callable the moment
--    it's created, with no migration author having to opt into that
--    exposure -- exactly backwards from least-privilege, and exactly how
--    _demo_upsert_auth_user ended up live. Flipping the default closes this
--    for every function this project creates from now on, not just the ones
--    named above.
--
--    Consequence migration authors must know: from this migration forward,
--    a newly CREATE FUNCTIONed rpc_* meant to be called from the client
--    needs an explicit `GRANT EXECUTE ON FUNCTION ... TO authenticated;` (or
--    `anon` for a pre-login RPC) right after creating it, or PostgREST calls
--    to it will fail with a 42501 permission-denied error. This is a
--    deliberate, opt-in-required trade: a forgotten GRANT is a loud, visible
--    failure in the client that gets caught immediately in testing; a
--    forgotten REVOKE (today's actual default) is a silent, invisible
--    security hole that only a dedicated audit like this one catches.
-- (Only the `postgres` role's default is changed here -- confirmed live
-- that the Management API/every migration in this project applies as
-- `postgres`; `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` errors with
-- "permission denied to change default privileges" since postgres can't
-- alter another role's defaults, and that entry appears to govern Supabase's
-- own platform-internal object creation, not this project's migrations.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
