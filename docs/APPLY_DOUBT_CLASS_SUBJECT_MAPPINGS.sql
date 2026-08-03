-- =============================================================================
-- APPLY_DOUBT_CLASS_SUBJECT_MAPPINGS.sql
-- Paste into Supabase SQL Editor as UTF-8. Idempotent.
--
-- Problem: student Doubt Portal subject dropdown is empty when a class has
-- students but zero teacher_classes rows (canonical class→subject source).
--
-- Fix: for every class that has ≥1 student and 0 teacher_classes mappings,
-- seed teacher_classes using real teachers in the same school + subject names
-- derived from class category (Commerce / Science) or available teacher subjects.
-- Also ensures public.subjects catalog rows exist for those names.
--
-- Does NOT hardcode a single class/account. Safe to re-run.
-- Mirror: supabase/migrations/20260803190000_seed_teacher_classes_unmapped.sql
-- =============================================================================

-- Optional: ensure doubt attachment bucket exists (harmless if already present).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'doubt-attachments',
  'doubt-attachments',
  false,
  20971520,
  ARRAY[
    'image/png','image/jpeg','image/gif','image/webp','image/heic',
    'application/pdf','text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public._doubt_norm_subject(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(COALESCE(raw, '')))
    WHEN 'maths' THEN 'Mathematics'
    WHEN 'math' THEN 'Mathematics'
    WHEN 'mathematics' THEN 'Mathematics'
    WHEN 'eng' THEN 'English'
    WHEN 'english' THEN 'English'
    WHEN 'english core' THEN 'English'
    WHEN 'hindi' THEN 'Hindi'
    WHEN 'hindi core' THEN 'Hindi'
    WHEN 'accounts' THEN 'Accountancy'
    WHEN 'accountancy' THEN 'Accountancy'
    WHEN 'accounting' THEN 'Accountancy'
    WHEN 'bst' THEN 'Business Studies'
    WHEN 'business studies' THEN 'Business Studies'
    WHEN 'eco' THEN 'Economics'
    WHEN 'economics' THEN 'Economics'
    WHEN 'physics' THEN 'Physics'
    WHEN 'chemistry' THEN 'Chemistry'
    WHEN 'biology' THEN 'Biology'
    WHEN 'science' THEN 'Science'
    WHEN 'social studies' THEN 'Social Studies'
    WHEN 'sst' THEN 'Social Studies'
    ELSE NULLIF(trim(COALESCE(raw, '')), '')
  END;
$$;

DO $$
DECLARE
  r_class record;
  r_subj text;
  v_subjects text[];
  v_teacher_id uuid;
  v_subject_id uuid;
  v_school uuid;
  v_inserted int := 0;
BEGIN
  FOR r_class IN
    SELECT c.id AS class_id,
           c.school_id,
           c.name,
           c.section,
           c.display_name,
           c.category
    FROM public.classes c
    WHERE c.school_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.students s WHERE s.class_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.teacher_classes tc WHERE tc.class_id = c.id)
  LOOP
    v_school := r_class.school_id;

    -- Subject set from class stream/category, else secondary defaults from teacher roster.
    IF lower(COALESCE(r_class.category, '') || ' ' || COALESCE(r_class.display_name, '')) LIKE '%commerce%' THEN
      v_subjects := ARRAY[
        'Accountancy', 'Business Studies', 'Economics',
        'Mathematics', 'English', 'Hindi'
      ];
    ELSIF lower(COALESCE(r_class.category, '') || ' ' || COALESCE(r_class.display_name, '')) LIKE '%science%'
          AND COALESCE(r_class.name, '') IN ('11', '12') THEN
      v_subjects := ARRAY[
        'Physics', 'Chemistry', 'Biology',
        'Mathematics', 'English', 'Hindi'
      ];
    ELSE
      SELECT COALESCE(
        (SELECT array_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT public._doubt_norm_subject(t.subject) AS x
           FROM public.teachers t
           WHERE t.school_id = v_school
             AND public._doubt_norm_subject(t.subject) IS NOT NULL
         ) q),
        ARRAY['Mathematics', 'English', 'Hindi', 'Science']::text[]
      )
      INTO v_subjects;
    END IF;

    FOREACH r_subj IN ARRAY v_subjects
    LOOP
      IF r_subj IS NULL OR length(trim(r_subj)) = 0 THEN
        CONTINUE;
      END IF;

      -- Ensure subjects catalog row
      SELECT s.id INTO v_subject_id
      FROM public.subjects s
      WHERE s.school_id = v_school
        AND lower(trim(s.name)) = lower(trim(r_subj))
      LIMIT 1;

      IF v_subject_id IS NULL THEN
        INSERT INTO public.subjects (school_id, name, is_active)
        VALUES (v_school, r_subj, true)
        RETURNING id INTO v_subject_id;
      END IF;

      -- Prefer teacher whose subject matches; prefer @wisdomcampus.com then portal-linked
      SELECT t.id INTO v_teacher_id
      FROM public.teachers t
      WHERE t.school_id = v_school
        AND public._doubt_norm_subject(t.subject) = r_subj
      ORDER BY
        CASE WHEN lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com' THEN 0 ELSE 1 END,
        (t.user_id IS NOT NULL) DESC,
        t.created_at ASC NULLS LAST
      LIMIT 1;

      -- Else: class teacher of this class
      IF v_teacher_id IS NULL THEN
        SELECT t.id INTO v_teacher_id
        FROM public.teachers t
        WHERE t.school_id = v_school
          AND t.class_teacher_of = r_class.class_id
        ORDER BY
          CASE WHEN lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com' THEN 0 ELSE 1 END,
          (t.user_id IS NOT NULL) DESC,
          t.created_at ASC NULLS LAST
        LIMIT 1;
      END IF;

      -- Else: any portal-linked teacher in school
      IF v_teacher_id IS NULL THEN
        SELECT t.id INTO v_teacher_id
        FROM public.teachers t
        WHERE t.school_id = v_school
          AND t.user_id IS NOT NULL
        ORDER BY
          CASE WHEN lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com' THEN 0 ELSE 1 END,
          t.created_at ASC NULLS LAST
        LIMIT 1;
      END IF;

      -- Else: any teacher in school
      IF v_teacher_id IS NULL THEN
        SELECT t.id INTO v_teacher_id
        FROM public.teachers t
        WHERE t.school_id = v_school
        ORDER BY
          CASE WHEN lower(trim(coalesce(t.email, ''))) LIKE '%@wisdomcampus.com' THEN 0 ELSE 1 END,
          t.created_at ASC NULLS LAST
        LIMIT 1;
      END IF;

      IF v_teacher_id IS NULL THEN
        RAISE NOTICE 'No teachers in school % — skip class % subject %',
          v_school, r_class.class_id, r_subj;
        CONTINUE;
      END IF;

      -- Idempotent: one mapping per class+subject (any teacher)
      IF NOT EXISTS (
        SELECT 1 FROM public.teacher_classes tc
        WHERE tc.class_id = r_class.class_id
          AND lower(trim(COALESCE(tc.subject, ''))) = lower(trim(r_subj))
      ) THEN
        INSERT INTO public.teacher_classes (school_id, teacher_id, class_id, subject, subject_id)
        VALUES (v_school, v_teacher_id, r_class.class_id, r_subj, v_subject_id);
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'APPLY_DOUBT_CLASS_SUBJECT_MAPPINGS inserted % teacher_classes rows', v_inserted;
END $$;

DROP FUNCTION IF EXISTS public._doubt_norm_subject(text);

-- Verification (optional — inspect in SQL editor):
-- SELECT c.display_name, c.name, c.section, c.category,
--        COUNT(DISTINCT s.id) AS students,
--        COUNT(DISTINCT tc.id) AS mappings,
--        string_agg(DISTINCT tc.subject, ', ' ORDER BY tc.subject) AS subjects
-- FROM public.classes c
-- LEFT JOIN public.students s ON s.class_id = c.id
-- LEFT JOIN public.teacher_classes tc ON tc.class_id = c.id
-- WHERE EXISTS (SELECT 1 FROM public.students sx WHERE sx.class_id = c.id)
-- GROUP BY c.id
-- ORDER BY c.name, c.section;
