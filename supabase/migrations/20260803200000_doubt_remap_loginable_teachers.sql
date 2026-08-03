-- =============================================================================
-- Remap teacher_classes onto @wisdomcampus.com teachers when current assignee
-- cannot sign in with portal demo credentials.
-- Canonical clipboard: docs/APPLY_DOUBT_REMAP_LOGINABLE_TEACHERS.sql
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
    IF r.teacher_email LIKE '%@wisdomcampus.com' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_school := r.school_id;

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
    'doubt_remap_loginable_teachers: remapped=% kept=%',
    v_updated,
    v_skipped;
END $$;
