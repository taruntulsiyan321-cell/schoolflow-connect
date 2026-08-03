-- =============================================================================
-- APPLY_DOUBT_REMAP_LOGINABLE_TEACHERS.sql
-- Paste into Supabase SQL Editor as UTF-8. Idempotent.
--
-- Critical: prior seed mapped class subjects onto teachers whose auth emails
-- cannot sign in with demo credentials (e.g. *@school.edu, personal gmail).
-- Students could post, but no loginable teacher could answer those subjects.
--
-- Fix: for each class+subject, prefer a teacher whose email ends with
-- @wisdomcampus.com (portal demo accounts). Remap existing rows when the
-- current teacher is not wisdomcampus-linked. Does not invent subjects.
-- Mirror: supabase/migrations/20260803200000_doubt_remap_loginable_teachers.sql
-- =============================================================================

DO $$
DECLARE
  r record;
  v_preferred uuid;
  v_school uuid;
  v_updated int := 0;
  v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT tc.id,
           tc.school_id,
           tc.class_id,
           tc.subject,
           tc.subject_id,
           tc.teacher_id,
           lower(trim(coalesce(t.email, ''))) AS teacher_email
    FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
    WHERE NULLIF(trim(coalesce(tc.subject, '')), '') IS NOT NULL
  LOOP
    -- Already on a wisdomcampus teacher — keep
    IF r.teacher_email LIKE '%@wisdomcampus.com' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_school := r.school_id;

    -- Prefer subject-match among wisdomcampus teachers
    SELECT t.id INTO v_preferred
    FROM public.teachers t
    WHERE t.school_id = v_school
      AND lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com'
      AND (
        lower(trim(coalesce(t.subject, ''))) = lower(trim(r.subject))
        OR (
          lower(trim(r.subject)) IN ('mathematics', 'maths', 'math')
          AND lower(trim(coalesce(t.subject, ''))) LIKE '%math%'
        )
        OR (
          lower(trim(r.subject)) IN ('business studies', 'bst')
          AND (
            lower(trim(coalesce(t.subject, ''))) LIKE '%business%'
            OR lower(trim(coalesce(t.subject, ''))) = 'bst'
          )
        )
      )
    ORDER BY t.created_at ASC NULLS LAST
    LIMIT 1;

    -- Else any wisdomcampus teacher in the school
    IF v_preferred IS NULL THEN
      SELECT t.id INTO v_preferred
      FROM public.teachers t
      WHERE t.school_id = v_school
        AND lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com'
      ORDER BY t.created_at ASC NULLS LAST
      LIMIT 1;
    END IF;

    IF v_preferred IS NULL OR v_preferred = r.teacher_id THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Avoid unique (teacher_id, class_id, subject) collisions: delete dup then update
    DELETE FROM public.teacher_classes x
    WHERE x.teacher_id = v_preferred
      AND x.class_id = r.class_id
      AND lower(trim(coalesce(x.subject, ''))) = lower(trim(r.subject))
      AND x.id IS DISTINCT FROM r.id;

    UPDATE public.teacher_classes
    SET teacher_id = v_preferred
    WHERE id = r.id;

    v_updated := v_updated + 1;
  END LOOP;

  RAISE NOTICE
    'APPLY_DOUBT_REMAP_LOGINABLE_TEACHERS: remapped=% kept=%',
    v_updated,
    v_skipped;
END $$;

-- Prefer wisdomcampus teachers in future empty-class seeds (patch helper preference).
-- Safe no-op if migration seed already ran; documents the ordering rule for operators.
