-- CBSE Class 12 Mathematics — parametric question template engine

CREATE TABLE IF NOT EXISTS public.question_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class int NOT NULL,
  subject text NOT NULL,
  chapter text NOT NULL,
  template_type text NOT NULL,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation_template text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_templates_chapter
  ON public.question_templates (class, subject, chapter) WHERE is_active;

CREATE INDEX IF NOT EXISTS question_templates_type
  ON public.question_templates (template_type);

CREATE TABLE IF NOT EXISTS public.practice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  chapter text NOT NULL,
  question_count int NOT NULL DEFAULT 10,
  correct_count int NOT NULL DEFAULT 0,
  score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.question_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.practice_sessions(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.question_templates(id) ON DELETE CASCADE,
  generated_question jsonb NOT NULL,
  selected_answer jsonb,
  correct_answer jsonb NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  is_correct boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_attempts_student
  ON public.question_attempts (student_id, created_at DESC);

ALTER TABLE public.question_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "templates read all" ON public.question_templates;
CREATE POLICY "templates read all" ON public.question_templates
  FOR SELECT TO authenticated USING (is_active);

DROP POLICY IF EXISTS "practice sessions self" ON public.practice_sessions;
CREATE POLICY "practice sessions self" ON public.practice_sessions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "question attempts self" ON public.question_attempts;
CREATE POLICY "question attempts self" ON public.question_attempts
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Randomly pick template IDs for a practice session (generation happens client-side)
CREATE OR REPLACE FUNCTION public.rpc_pick_question_templates(
  _class int,
  _subject text,
  _chapter text,
  _count int DEFAULT 10
)
RETURNS SETOF public.question_templates
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT *
  FROM public.question_templates
  WHERE class = _class
    AND lower(subject) = lower(_subject)
    AND chapter = _chapter
    AND is_active
  ORDER BY random()
  LIMIT GREATEST(_count, 1);
$$;

GRANT EXECUTE ON FUNCTION public.rpc_pick_question_templates(int, text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_start_practice_session(
  _subject text,
  _chapter text,
  _count int DEFAULT 10
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _sid uuid; _student uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _student FROM public.students WHERE user_id = _uid LIMIT 1;
  INSERT INTO public.practice_sessions (student_id, user_id, subject, chapter, question_count)
  VALUES (_student, _uid, _subject, _chapter, _count)
  RETURNING id INTO _sid;
  RETURN _sid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_start_practice_session(text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(
  _session_id uuid,
  _template_id uuid,
  _generated_question jsonb,
  _correct_answer jsonb,
  _selected_answer jsonb DEFAULT NULL,
  _is_correct boolean DEFAULT NULL,
  _score numeric DEFAULT 0
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _student uuid; _aid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _student FROM public.students WHERE user_id = _uid LIMIT 1;
  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id,
    generated_question, selected_answer, correct_answer, score, is_correct
  ) VALUES (
    _session_id, _student, _uid, _template_id,
    _generated_question, _selected_answer, _correct_answer, _score, _is_correct
  ) RETURNING id INTO _aid;

  IF _is_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1, score = score + COALESCE(_score, 1)
      WHERE id = _session_id AND user_id = _uid;
  END IF;
  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_record_question_attempt(uuid, uuid, jsonb, jsonb, jsonb, boolean, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s record;
BEGIN
  UPDATE public.practice_sessions SET finished_at = now()
    WHERE id = _session_id AND user_id = auth.uid()
    RETURNING * INTO _s;
  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  RETURN jsonb_build_object(
    'session_id', _s.id,
    'chapter', _s.chapter,
    'question_count', _s.question_count,
    'correct_count', _s.correct_count,
    'score', _s.score
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_practice_session(uuid) TO authenticated;
