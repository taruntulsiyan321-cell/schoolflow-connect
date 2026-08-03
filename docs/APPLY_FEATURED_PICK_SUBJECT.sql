-- =============================================================================
-- APPLY_FEATURED_PICK_SUBJECT.sql
-- Hotfix: refresh APPLY called this helper but it was never created on live DB.
-- Paste into Supabase SQL Editor (UTF-8). Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._pick_featured_subject(_class_id uuid, _grade int)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _stream text;
  _subj text;
BEGIN
  SELECT lower(nullif(trim(s.stream), '')) INTO _stream
  FROM public.classes c
  JOIN public.schools s ON s.id = c.school_id
  WHERE c.id = _class_id;

  IF _stream = 'commerce' THEN
    SELECT q.subject INTO _subj
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) IN ('accountancy', 'business studies', 'economics', 'mathematics', 'english', 'hindi')
      AND (_grade IS NULL OR q.class_level IS NULL OR q.class_level = _grade)
    GROUP BY q.subject
    ORDER BY
      CASE lower(q.subject)
        WHEN 'accountancy' THEN 1
        WHEN 'business studies' THEN 2
        WHEN 'economics' THEN 3
        WHEN 'mathematics' THEN 4
        WHEN 'english' THEN 5
        ELSE 6
      END,
      count(*) DESC
    LIMIT 1;
  ELSIF _stream = 'science' THEN
    SELECT q.subject INTO _subj
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) IN ('physics', 'chemistry', 'biology', 'mathematics', 'english', 'hindi')
      AND (_grade IS NULL OR q.class_level IS NULL OR q.class_level = _grade)
    GROUP BY q.subject
    ORDER BY
      CASE lower(q.subject)
        WHEN 'physics' THEN 1
        WHEN 'chemistry' THEN 2
        WHEN 'mathematics' THEN 3
        WHEN 'biology' THEN 4
        ELSE 5
      END,
      count(*) DESC
    LIMIT 1;
  END IF;

  IF _subj IS NOT NULL THEN
    RETURN _subj;
  END IF;

  SELECT q.subject INTO _subj
  FROM public.question_bank q
  WHERE q.is_approved
    AND (_grade IS NULL OR q.class_level IS NULL OR q.class_level = _grade)
  GROUP BY q.subject
  ORDER BY count(*) DESC
  LIMIT 1;

  RETURN COALESCE(_subj, 'Mathematics');
END;
$$;

REVOKE ALL ON FUNCTION public._pick_featured_subject(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._pick_featured_subject(uuid, int) TO authenticated;
