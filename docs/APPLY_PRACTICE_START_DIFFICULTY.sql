-- =============================================================================
-- APPLY_PRACTICE_START_DIFFICULTY.sql
-- Persist difficulty on rpc_start_practice_session (resume / Difficulty mode).
-- Apply after APPLY_SAVED_PRACTICE_SESSIONS.sql (difficulty column required).
-- =============================================================================

DROP FUNCTION IF EXISTS public.rpc_start_practice_session(text, text, int);
DROP FUNCTION IF EXISTS public.rpc_start_practice_session(text, text, int, text);
DROP FUNCTION IF EXISTS public.rpc_start_practice_session(text, text, int, text, text);

CREATE OR REPLACE FUNCTION public.rpc_start_practice_session(
  _subject text,
  _chapter text,
  _count int DEFAULT 10,
  _practice_mode text DEFAULT NULL,
  _difficulty text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid;
  _student uuid;
  _school uuid;
  _class int;
  _board text;
  _stream text;
  _label text;
  _diff text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT s.id, s.school_id INTO _student, _school
  FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  IF _school IS NULL THEN
    SELECT school_id INTO _school FROM public.profiles WHERE id = _uid;
  END IF;

  IF _school IS NOT NULL THEN
    BEGIN
      SELECT lower(COALESCE(board, 'rbse')), stream
        INTO _board, _stream
      FROM public.schools WHERE id = _school;
    EXCEPTION WHEN others THEN
      SELECT lower(COALESCE(board, 'rbse')) INTO _board
      FROM public.schools WHERE id = _school;
      _stream := NULL;
    END;
  END IF;

  SELECT COALESCE(c.display_name, c.name) INTO _label
  FROM public.students st
  JOIN public.classes c ON c.id = st.class_id
  WHERE st.user_id = _uid
  LIMIT 1;

  IF _label IS NOT NULL THEN
    _class := NULLIF(substring(_label from '([0-9]{1,2})'), '')::int;
  END IF;

  _diff := lower(nullif(trim(coalesce(_difficulty, '')), ''));
  IF _diff IN ('', 'mixed', 'any', 'all') THEN
    _diff := NULL;
  END IF;

  INSERT INTO public.practice_sessions (
    student_id, user_id, school_id, subject, chapter, question_count,
    practice_mode, class_level, board, stream, difficulty
  ) VALUES (
    _student, _uid, _school, _subject, _chapter, _count,
    NULLIF(trim(_practice_mode), ''), _class, _board, _stream, _diff
  )
  RETURNING id INTO _sid;
  RETURN _sid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_start_practice_session(text, text, int, text, text) TO authenticated;
