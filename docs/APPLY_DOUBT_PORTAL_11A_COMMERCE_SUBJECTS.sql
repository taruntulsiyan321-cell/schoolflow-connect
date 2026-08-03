-- =============================================================================
-- APPLY_DOUBT_PORTAL_11A_COMMERCE_SUBJECTS.sql
-- Paste into Supabase SQL Editor as UTF-8. Idempotent.
--
-- Gap: student class 11-A Commerce had ZERO teacher_classes rows, so Doubt Portal
-- Subject dropdown showed "No subjects mapped yet" (honest empty — not a query
-- failure). Seeds Teacher–Class–Subject for RBSE Commerce allowlist subjects.
-- =============================================================================

DO $$
DECLARE
  _school uuid := public.default_school_id();
  _class uuid;
  _subj text;
  _teacher uuid;
  _subject_id uuid;
  _subjects text[] := ARRAY[
    'Accountancy',
    'Business Studies',
    'Economics',
    'Mathematics',
    'English',
    'Hindi'
  ];
  _inserted int := 0;
BEGIN
  -- Resolve live 11-A Commerce class (prefer name/section/category; known id fallback)
  SELECT c.id
  INTO _class
  FROM public.classes c
  WHERE c.school_id = _school
    AND trim(coalesce(c.name, '')) = '11'
    AND upper(trim(coalesce(c.section, ''))) = 'A'
    AND lower(coalesce(c.category, '')) LIKE '%commerce%'
  ORDER BY c.created_at ASC NULLS LAST
  LIMIT 1;

  IF _class IS NULL THEN
    SELECT c.id
    INTO _class
    FROM public.classes c
    WHERE c.id = 'd31a1d5a-82e4-4a42-ad7f-3c10ef73a70a'::uuid
      AND c.school_id = _school;
  END IF;

  IF _class IS NULL THEN
    RAISE EXCEPTION
      'APPLY_DOUBT_PORTAL_11A_COMMERCE_SUBJECTS: class 11-A Commerce not found for school %',
      _school;
  END IF;

  FOREACH _subj IN ARRAY _subjects LOOP
    INSERT INTO public.subjects (school_id, name)
    VALUES (_school, _subj)
    ON CONFLICT (school_id, name) DO UPDATE
      SET is_active = true
    RETURNING id INTO _subject_id;

    IF _subject_id IS NULL THEN
      SELECT s.id INTO _subject_id
      FROM public.subjects s
      WHERE s.school_id = _school AND s.name = _subj
      LIMIT 1;
    END IF;

    -- Prefer teacher whose primary subject matches; then maths; then any in school.
    -- Prefer @wisdomcampus.com emails so teacher panel is reachable with portal demos.
    SELECT t.id
    INTO _teacher
    FROM public.teachers t
    WHERE t.school_id = _school
      AND lower(trim(coalesce(t.subject, ''))) = lower(_subj)
    ORDER BY
      CASE WHEN lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com' THEN 0 ELSE 1 END,
      t.created_at ASC NULLS LAST
    LIMIT 1;

    IF _teacher IS NULL AND lower(_subj) IN ('mathematics', 'maths', 'math') THEN
      SELECT t.id
      INTO _teacher
      FROM public.teachers t
      WHERE t.school_id = _school
        AND lower(trim(coalesce(t.subject, ''))) LIKE '%math%'
      ORDER BY
        CASE WHEN lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com' THEN 0 ELSE 1 END,
        t.created_at ASC NULLS LAST
      LIMIT 1;
    END IF;

    IF _teacher IS NULL AND lower(_subj) = 'business studies' THEN
      SELECT t.id
      INTO _teacher
      FROM public.teachers t
      WHERE t.school_id = _school
        AND (
          lower(trim(coalesce(t.subject, ''))) LIKE '%business%'
          OR lower(trim(coalesce(t.subject, ''))) = 'bst'
        )
      ORDER BY
        CASE WHEN lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com' THEN 0 ELSE 1 END,
        t.created_at ASC NULLS LAST
      LIMIT 1;
    END IF;

    IF _teacher IS NULL THEN
      SELECT t.id
      INTO _teacher
      FROM public.teachers t
      WHERE t.school_id = _school
        AND t.user_id IS NOT NULL
      ORDER BY
        CASE WHEN lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com' THEN 0 ELSE 1 END,
        t.created_at ASC NULLS LAST
      LIMIT 1;
    END IF;

    IF _teacher IS NULL THEN
      SELECT t.id
      INTO _teacher
      FROM public.teachers t
      WHERE t.school_id = _school
      ORDER BY
        CASE WHEN lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com' THEN 0 ELSE 1 END,
        t.created_at ASC NULLS LAST
      LIMIT 1;
    END IF;

    IF _teacher IS NULL THEN
      RAISE NOTICE
        'APPLY_DOUBT_PORTAL_11A_COMMERCE_SUBJECTS: no teacher for subject % — skipped',
        _subj;
      CONTINUE;
    END IF;

    INSERT INTO public.teacher_classes (teacher_id, class_id, subject, subject_id, school_id)
    VALUES (_teacher, _class, _subj, _subject_id, _school)
    ON CONFLICT (teacher_id, class_id, subject) DO UPDATE
      SET school_id = EXCLUDED.school_id,
          subject_id = COALESCE(public.teacher_classes.subject_id, EXCLUDED.subject_id);

    _inserted := _inserted + 1;
  END LOOP;

  RAISE NOTICE
    'APPLY_DOUBT_PORTAL_11A_COMMERCE_SUBJECTS: class=% subjects_mapped=%',
    _class,
    _inserted;
END $$;

-- Sanity: distinct subjects for 11-A Commerce via teacher_classes
-- SELECT subject FROM teacher_classes
-- WHERE class_id = (SELECT id FROM classes WHERE name = '11' AND section = 'A' AND lower(category) LIKE '%commerce%' LIMIT 1)
-- ORDER BY 1;
