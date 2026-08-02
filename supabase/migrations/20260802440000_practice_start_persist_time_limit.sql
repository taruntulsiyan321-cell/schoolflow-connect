-- Persist timed-practice clock on session start so resume never invents 15 minutes.

ALTER TABLE public.practice_sessions
  ADD COLUMN IF NOT EXISTS time_limit_sec int;

COMMENT ON COLUMN public.practice_sessions.time_limit_sec IS
  'Original timed/mock limit in seconds; null = untimed. Resume uses remaining = limit - elapsed.';

DROP FUNCTION IF EXISTS public.rpc_start_practice_session(text, text, int);
DROP FUNCTION IF EXISTS public.rpc_start_practice_session(text, text, int, text);
DROP FUNCTION IF EXISTS public.rpc_start_practice_session(text, text, int, text, text);
DROP FUNCTION IF EXISTS public.rpc_start_practice_session(text, text, int, text, text, int);

CREATE OR REPLACE FUNCTION public.rpc_start_practice_session(
  _subject text,
  _chapter text,
  _count int DEFAULT 10,
  _practice_mode text DEFAULT NULL,
  _difficulty text DEFAULT NULL,
  _time_limit_sec int DEFAULT NULL
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
  _limit int;
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

  _limit := NULLIF(_time_limit_sec, 0);
  IF _limit IS NOT NULL AND _limit < 0 THEN
    _limit := NULL;
  END IF;

  INSERT INTO public.practice_sessions (
    student_id, user_id, school_id, subject, chapter, question_count,
    practice_mode, class_level, board, stream, difficulty, time_limit_sec
  ) VALUES (
    _student, _uid, _school, _subject, _chapter, _count,
    NULLIF(trim(_practice_mode), ''), _class, _board, _stream, _diff, _limit
  )
  RETURNING id INTO _sid;
  RETURN _sid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_start_practice_session(text, text, int, text, text, int) TO authenticated;
