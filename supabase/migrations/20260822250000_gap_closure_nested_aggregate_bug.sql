-- Gap closure, 2026-08-22, found while functionally testing the previous
-- migration's fix (not by static reading): rpc_principal_concept_analytics
-- and rpc_teacher_concept_analytics both use
-- `jsonb_agg(jsonb_build_object(..., avg(x), ...) ORDER BY avg(x))` --
-- Postgres rejects this outright with "42803: aggregate function calls
-- cannot be nested", REGARDLESS of how much data exists. Confirmed by
-- isolating the exact query fragment and running it standalone: this is a
-- pre-existing bug with nothing to do with the tenant-scoping fix in the
-- same migration -- both functions have been completely non-functional
-- (every real call throws) since whenever they were first written, not
-- something this session's edits introduced. Caught only because this
-- session's practice is to functionally test every fix rather than trust
-- that "looks right" means "runs".
--
-- Fixed using the exact working pattern already present elsewhere in this
-- same schema (rpc_refresh_academic_brain): compute the aggregate as a
-- plain column in an inner GROUP BY subquery (where ORDER BY avg(x) is
-- valid, ordinary top-level aggregate usage), then have the outer
-- jsonb_agg(... ORDER BY <that column>) reference the already-computed
-- column, never re-invoking avg() inside the aggregate's own ORDER BY.
CREATE OR REPLACE FUNCTION public.rpc_principal_concept_analytics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _school uuid;
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal') THEN
    RAISE EXCEPTION 'Principal or admin only';
  END IF;
  _school := public.get_my_school_id();
  IF _school IS NULL THEN RAISE EXCEPTION 'No school context for caller'; END IF;

  RETURN jsonb_build_object(
    'school_weak_concepts', (
      SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.avg_mastery ASC), '[]'::jsonb)
      FROM (
        SELECT subject, concept,
               round(avg(mastery_score), 1) AS avg_mastery,
               count(DISTINCT user_id) AS students_affected
        FROM public.concept_mastery
        WHERE mastery_score < 50 AND school_id = _school
        GROUP BY subject, concept
        ORDER BY avg(mastery_score) ASC
        LIMIT 12
      ) t
    ),
    'subject_performance', (
      SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.avg_mastery ASC), '[]'::jsonb)
      FROM (
        SELECT subject,
               round(avg(mastery_score), 1) AS avg_mastery,
               count(*) AS concepts_tracked
        FROM public.concept_mastery
        WHERE school_id = _school
        GROUP BY subject
        ORDER BY avg(mastery_score) ASC
      ) t
    ),
    'recovery_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments
      WHERE school_id = _school
    ),
    'recovery_participation', (
      SELECT count(DISTINCT user_id)::int FROM public.recovery_assignments
      WHERE created_at >= now() - interval '30 days' AND school_id = _school
    )
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_teacher_concept_analytics(_class_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _base jsonb; _class_school uuid;
BEGIN
  SELECT school_id INTO _class_school FROM public.classes WHERE id = _class_id;
  IF _class_school IS NULL THEN RAISE EXCEPTION 'Class not found'; END IF;
  IF NOT (
    (public.has_role(_uid, 'admin') AND public.same_school(_class_school))
    OR (public.has_role(_uid, 'principal') AND public.same_school(_class_school))
    OR public.teacher_teaches_class(_uid, _class_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _base := public.rpc_teacher_class_insights(_class_id);

  RETURN _base || jsonb_build_object(
    'class_weak_concepts', (
      SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.avg_mastery ASC), '[]'::jsonb)
      FROM (
        SELECT cm.subject, cm.chapter, cm.concept,
               round(avg(cm.mastery_score), 1) AS avg_mastery,
               count(DISTINCT cm.user_id) AS students
        FROM public.concept_mastery cm
        JOIN public.students s ON s.user_id = cm.user_id
        WHERE s.class_id = _class_id AND cm.mastery_score < 55
        GROUP BY cm.subject, cm.chapter, cm.concept
        ORDER BY avg(cm.mastery_score) ASC
        LIMIT 10
      ) t
    ),
    'student_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', s.id, 'name', s.full_name,
        'concept', cm.concept, 'subject', cm.subject,
        'mastery_score', cm.mastery_score
      ) ORDER BY cm.mastery_score ASC), '[]'::jsonb)
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id AND cm.mastery_score < 45
      LIMIT 20
    ),
    'recovery_completion_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE ra.status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments ra
      JOIN public.students s ON s.user_id = ra.user_id
      WHERE s.class_id = _class_id
    ),
    'mastery_distribution', (
      SELECT jsonb_build_object(
        'below_40', count(*) FILTER (WHERE cm.mastery_score < 40),
        '40_60', count(*) FILTER (WHERE cm.mastery_score >= 40 AND cm.mastery_score < 60),
        '60_80', count(*) FILTER (WHERE cm.mastery_score >= 60 AND cm.mastery_score < 80),
        'above_80', count(*) FILTER (WHERE cm.mastery_score >= 80)
      )
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id
    )
  );
END; $function$;
