-- Phase 5 audit, 2026-08-22, continued.
--
-- 1. `rpc_student_academic_snapshot_internal(_uid, _student_id)` reads a
--    student's full private academic snapshot (weak/strong topics, exam
--    readiness, mistake count, activity heatmap) for WHATEVER _uid is
--    passed in, with no check that it matches the caller. Its "_internal"
--    suffix is a naming convention only -- confirmed live it was directly
--    callable by anon (fully unauthenticated). Its only two real callers
--    (rpc_parent_child_snapshot, rpc_parent_weekly_digest) already validate
--    the parent-child relationship before calling it, so this is safe to
--    lock down the same way as the earlier `_`-prefixed internal helpers.
--    ensure_student_academic_profile/refresh_student_academic_profile are
--    lower severity (they don't leak data to the caller, just let anyone
--    force a recompute) but locked down too for the same least-privilege
--    reason -- both have exactly one legitimate caller path and zero direct
--    external callers (confirmed via grep across src/ and supabase/functions/).
--
-- 2. Separately: rpc_parent_child_snapshot, rpc_parent_concept_analytics,
--    and rpc_parent_weekly_digest all resolve "this parent's children" via
--    `students.parent_user_id = _parent` ONLY -- they never check the
--    parent_students join table. That table exists precisely for parents
--    linked to more than one child or a child with more than one guardian;
--    two other functions in this same schema (chat_can_dm,
--    rpc_get_student_progression) already handle both link mechanisms
--    correctly, so this is a real, if currently dormant, inconsistency
--    (checked live: both real parent accounts today have both links set
--    consistently, so nothing is broken yet) rather than a hypothetical one.
--    A parent linked to a child ONLY via parent_students -- exactly the case
--    the join table exists to support -- would silently get an empty
--    snapshot/digest/analytics response for that child today. Fixed by
--    reusing rpc_get_student_progression's exact join pattern in all three.
--
--    Reconstructed byte-for-byte from the live definitions fetched moments
--    before this migration, changing only the parent-child ownership check.

DO $$
DECLARE
  _fn text;
BEGIN
  FOR _fn IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'rpc_student_academic_snapshot_internal',
      'ensure_student_academic_profile',
      'refresh_student_academic_profile'
    )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', _fn);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_parent_child_snapshot(_student_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _s record; _child_uid uuid;
BEGIN
  IF NOT public.has_role(_uid, 'parent') AND NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;
  SELECT s.* INTO _s FROM public.students s
    WHERE (_student_id IS NULL AND (
             s.parent_user_id = _uid
             OR EXISTS (SELECT 1 FROM public.parents p JOIN public.parent_students ps ON ps.parent_id = p.id WHERE p.user_id = _uid AND ps.student_id = s.id)
           ))
       OR (s.id = _student_id AND (
             s.parent_user_id = _uid
             OR EXISTS (SELECT 1 FROM public.parents p JOIN public.parent_students ps ON ps.parent_id = p.id WHERE p.user_id = _uid AND ps.student_id = s.id)
             OR public.has_role(_uid, 'admin')
           ))
    LIMIT 1;
  IF _s IS NULL THEN RETURN '{}'::jsonb; END IF;
  _child_uid := _s.user_id;
  IF _child_uid IS NULL THEN
    RETURN jsonb_build_object('student', to_jsonb(_s), 'linked', false);
  END IF;
  RETURN jsonb_build_object('student', to_jsonb(_s), 'linked', true,
    'snapshot', (SELECT public.rpc_student_academic_snapshot_internal(_child_uid, _s.id)));
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_parent_concept_analytics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _parent uuid := auth.uid(); _result jsonb := '[]'::jsonb; _child record;
BEGIN
  IF NOT public.has_role(_parent, 'parent') AND NOT public.has_role(_parent, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;

  FOR _child IN
    SELECT s.* FROM public.students s
    WHERE s.parent_user_id = _parent
       OR EXISTS (SELECT 1 FROM public.parents p JOIN public.parent_students ps ON ps.parent_id = p.id WHERE p.user_id = _parent AND ps.student_id = s.id)
  LOOP
    IF _child.user_id IS NULL THEN CONTINUE; END IF;
    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id', _child.id,
      'name', _child.full_name,
      'weak_areas', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'subject', subject, 'concept', concept, 'mastery_score', mastery_score
        ) ORDER BY mastery_score ASC), '[]'::jsonb)
        FROM public.concept_mastery
        WHERE user_id = _child.user_id AND mastery_score < 55
        LIMIT 5
      ),
      'recovery_pending', (
        SELECT count(*)::int FROM public.recovery_assignments
        WHERE user_id = _child.user_id AND status IN ('pending', 'in_progress')
      ),
      'recovery_completed', (
        SELECT count(*)::int FROM public.recovery_assignments
        WHERE user_id = _child.user_id AND status = 'completed'
          AND completed_at >= now() - interval '30 days'
      ),
      'mastery_trend', (
        SELECT round(avg(mastery_score), 1) FROM public.concept_mastery WHERE user_id = _child.user_id
      )
    ));
  END LOOP;

  RETURN jsonb_build_object('children', _result);
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_parent_weekly_digest()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _parent uuid := auth.uid(); _result jsonb := '[]'::jsonb; _child record; _snap jsonb;
  _week_ago date := CURRENT_DATE - 7;
BEGIN
  IF NOT public.has_role(_parent, 'parent') AND NOT public.has_role(_parent, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;

  FOR _child IN
    SELECT s.* FROM public.students s
    WHERE s.parent_user_id = _parent
       OR EXISTS (SELECT 1 FROM public.parents p JOIN public.parent_students ps ON ps.parent_id = p.id WHERE p.user_id = _parent AND ps.student_id = s.id)
  LOOP
    IF _child.user_id IS NOT NULL THEN
      _snap := public.rpc_student_academic_snapshot_internal(_child.user_id, _child.id);

      IF (_snap->'exam_readiness'->>'score')::numeric < 50
         AND NOT EXISTS (
           SELECT 1 FROM public.parent_academic_alerts a
           WHERE a.parent_user_id = _parent AND a.student_id = _child.id
             AND a.kind = 'weakness' AND a.title = 'Needs support in practice'
             AND a.created_at >= now() - interval '7 days'
         ) THEN
        INSERT INTO public.parent_academic_alerts (parent_user_id, student_id, kind, title, body)
        VALUES (_parent, _child.id, 'weakness',
          'Needs support in practice',
          _child.full_name || ' exam readiness is below 50%. Encourage daily DPP and revision.');
      END IF;

      IF COALESCE((_snap->'exam_readiness'->>'active_days_14d')::int, 0) < 3
         AND NOT EXISTS (
           SELECT 1 FROM public.parent_academic_alerts a
           WHERE a.parent_user_id = _parent AND a.student_id = _child.id
             AND a.kind = 'consistency' AND a.title = 'Low study consistency'
             AND a.created_at >= now() - interval '7 days'
         ) THEN
        INSERT INTO public.parent_academic_alerts (parent_user_id, student_id, kind, title, body)
        VALUES (_parent, _child.id, 'consistency',
          'Low study consistency',
          _child.full_name || ' had fewer than 3 active study days in the last two weeks.');
      END IF;

      IF COALESCE((_snap->'mistake_count')::int, 0) > 5
         AND NOT EXISTS (
           SELECT 1 FROM public.parent_academic_alerts a
           WHERE a.parent_user_id = _parent AND a.student_id = _child.id
             AND a.kind = 'weakness' AND a.title = 'Mistakes need revision'
             AND a.created_at >= now() - interval '7 days'
         ) THEN
        INSERT INTO public.parent_academic_alerts (parent_user_id, student_id, kind, title, body)
        VALUES (_parent, _child.id, 'weakness',
          'Mistakes need revision',
          _child.full_name || ' has ' || (_snap->>'mistake_count') || ' topics in their mistake book.');
      END IF;

      IF (_snap->'exam_readiness'->>'score')::numeric >= 70
         AND jsonb_array_length(COALESCE(_snap->'strong_topics', '[]'::jsonb)) >= 1
         AND NOT EXISTS (
           SELECT 1 FROM public.parent_academic_alerts a
           WHERE a.parent_user_id = _parent AND a.student_id = _child.id
             AND a.kind = 'improvement' AND a.title = 'Strong progress this week'
             AND a.created_at >= now() - interval '7 days'
         ) THEN
        INSERT INTO public.parent_academic_alerts (parent_user_id, student_id, kind, title, body)
        VALUES (_parent, _child.id, 'improvement',
          'Strong progress this week',
          _child.full_name || ' exam readiness is ' || (_snap->'exam_readiness'->>'score') || '% with strong topics emerging. Celebrate the momentum!');
      END IF;
    END IF;

    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id', _child.id,
      'name', _child.full_name,
      'class', (SELECT COALESCE(display_name, name || '-' || section) FROM public.classes WHERE id = _child.class_id),
      'snapshot', COALESCE(_snap, '{}'::jsonb),
      'alerts', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body,
          'read', a.read, 'created_at', a.created_at
        ) ORDER BY a.created_at DESC), '[]'::jsonb)
        FROM public.parent_academic_alerts a
        WHERE a.parent_user_id = _parent AND a.student_id = _child.id
          AND a.created_at >= now() - interval '7 days'
      )
    ));
  END LOOP;

  RETURN jsonb_build_object('children', _result, 'generated_at', now());
END; $function$;
