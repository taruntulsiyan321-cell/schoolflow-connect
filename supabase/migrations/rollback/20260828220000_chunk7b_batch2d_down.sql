-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Chunk 7B batch 2d (20260828220000_chunk7b_batch2d_definers)
--
-- ⚠ This rollback REOPENS FIVE PRIVACY LEAKS and cannot restore two sets of
-- deleted rows. Read all three limits before running it.
--
-- LIMIT 1 — the durable parent alerts do not come back.
--   Section 7 deleted every parent_academic_alerts row of kind 'weakness' /
--   title 'Mistakes need revision'. Each said "<child> has N topics in their
--   mistake book" — the size of a child's mistake book, written down where it
--   outlived any read gate. They are gone.
--
-- LIMIT 2 — the residual weak/strong topics do not come back.
--   Section 8 stripped metrics.weakTopics and metrics.strongTopics from
--   student_academic_profiles. Those were written by a version of
--   refresh_student_academic_profile that no longer exists, from
--   concept_mastery rows. Nothing recomputes them, so restoring the readers
--   below simply finds the keys absent — which is the correct outcome.
--
-- LIMIT 3 — the edge-function half is not reversed by SQL.
--   fetchParentSummary's actorRole gate and the removal of weak/strong topics
--   from parentNarrative.ts live in supabase/functions/_shared/. Revert those
--   with git if they genuinely need reverting:
--     git revert <the batch 2d commit> -- supabase/functions/_shared/
--
-- Running this restores: a teacher, principal, admin or battle-creator reading
-- any student's full battle report; per-named-student accuracy and a
-- "struggling" flag on the live monitor; and a parent receiving their child's
-- weak topics, strong topics and mistake-book size. Prefer fixing forward.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. rpc_get_battle_report — back to the five-way authorisation ──────────
CREATE OR REPLACE FUNCTION public.rpc_get_battle_report(_participant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r record; _allowed boolean;
BEGIN
  SELECT br.*, b.creator_user_id, b.class_id
    INTO _r
    FROM public.battle_reports br
    JOIN public.battles b ON b.id = br.battle_id
    WHERE br.participant_id = _participant_id;

  IF _r IS NULL THEN RETURN NULL; END IF;
  IF _r.expires_at < now() THEN
    RETURN jsonb_build_object('expired', true, 'expires_at', _r.expires_at);
  END IF;

  _allowed := _r.user_id = auth.uid()
    OR _r.creator_user_id = auth.uid()
    OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.same_school(_r.school_id))
    OR (public.has_role(auth.uid(), 'principal'::app_role) AND public.same_school(_r.school_id))
    OR (_r.class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), _r.class_id));
  IF NOT _allowed THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN jsonb_build_object(
    'id', _r.id, 'participant_id', _r.participant_id, 'battle_id', _r.battle_id,
    'user_id', _r.user_id, 'display_name', _r.display_name,
    'report', _r.report, 'ai_insights', _r.ai_insights,
    'expires_at', _r.expires_at, 'created_at', _r.created_at, 'expired', false
  );
END $function$;

-- ── 2. rpc_student_academic_snapshot_internal — the parent payload back ────
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot_internal(_uid uuid, _student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object(
    'weak_topics', (SELECT COALESCE(jsonb_agg(row_to_json(w)), '[]'::jsonb) FROM public._weak_topics_for_user(_uid) w WHERE accuracy < 65 LIMIT 5),
    'strong_topics', (SELECT COALESCE(jsonb_agg(row_to_json(w)), '[]'::jsonb) FROM public._weak_topics_for_user(_uid) w WHERE accuracy >= 75 LIMIT 5),
    'exam_readiness', public._exam_readiness(_uid, _student_id),
    'mistake_count', (SELECT count(*) FROM public.student_mistakes WHERE user_id = _uid AND status = 'open'),
    'activity_heatmap', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', activity_date, 'total', dpp_count+homework_count+battle_count) ORDER BY activity_date), '[]'::jsonb)
      FROM public.academic_daily_activity WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14)
  );
END; $function$;

COMMIT;

-- ── 3. The three patched functions — restore by re-applying their source ───
--
-- rpc_teacher_battle_reports, rpc_battle_monitor and rpc_parent_weekly_digest
-- were patched in place by literal substitution on pg_get_functiondef output,
-- so their pre-migration bodies are not reproduced here. Hand-copying a
-- SECURITY DEFINER body risks losing its search_path, volatility or grants,
-- which is how a definer quietly loses its fence.
--
-- Restore each by re-applying the migration that last defined it. Locate with:
--
--   grep -rln "rpc_teacher_battle_reports" supabase/migrations/*.sql | tail -3
--   grep -rln "rpc_battle_monitor"         supabase/migrations/*.sql | tail -3
--   grep -rln "rpc_parent_weekly_digest"   supabase/migrations/*.sql | tail -3
--
-- What each patch removed, so you can confirm the restore landed:
--   rpc_teacher_battle_reports  report->'summary' was narrowed from the whole
--                               object to score / rank / won /
--                               total_participants
--   rpc_battle_monitor          dropped 'correct_count', 'answered_count',
--                               'accuracy' and 'struggling' from the
--                               per-participant object
--   rpc_parent_weekly_digest    dropped the "Mistakes need revision" alert
--                               entirely, and dropped the strong_topics
--                               condition and wording from "Strong progress
--                               this week"
--
-- Note that restoring rpc_parent_weekly_digest is inert on its own: it reads
-- _snapshot->'mistake_count' and ->'strong_topics', which section 2 above must
-- also have restored for those branches to fire again.
