
-- Enums
DO $$ BEGIN
  CREATE TYPE public.dpp_question_kind AS ENUM ('mcq','multi','numerical','short');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dpp_attempt_status AS ENUM ('in_progress','submitted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tables
CREATE TABLE IF NOT EXISTS public.dpps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subject text NOT NULL,
  chapter text,
  topic text,
  class_id uuid NOT NULL,
  created_by uuid NOT NULL,
  difficulty text NOT NULL DEFAULT 'medium',
  instructions text,
  due_at timestamptz,
  duration_sec int NOT NULL DEFAULT 1800,
  total_marks numeric NOT NULL DEFAULT 0,
  negative_marking numeric NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  question_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dpp_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dpp_id uuid NOT NULL REFERENCES public.dpps(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  kind public.dpp_question_kind NOT NULL DEFAULT 'mcq',
  question text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct jsonb NOT NULL DEFAULT '{}'::jsonb,
  marks numeric NOT NULL DEFAULT 1,
  explanation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dpp_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dpp_id uuid NOT NULL REFERENCES public.dpps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  student_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  score numeric NOT NULL DEFAULT 0,
  max_score numeric NOT NULL DEFAULT 0,
  correct_count int NOT NULL DEFAULT 0,
  total_count int NOT NULL DEFAULT 0,
  time_spent_sec int NOT NULL DEFAULT 0,
  status public.dpp_attempt_status NOT NULL DEFAULT 'in_progress',
  UNIQUE(dpp_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.dpp_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.dpp_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.dpp_questions(id) ON DELETE CASCADE,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_correct boolean,
  marks_awarded numeric NOT NULL DEFAULT 0,
  time_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_dpps_class ON public.dpps(class_id);
CREATE INDEX IF NOT EXISTS idx_dpp_q_dpp ON public.dpp_questions(dpp_id, order_index);
CREATE INDEX IF NOT EXISTS idx_dpp_att_user ON public.dpp_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_dpp_att_dpp ON public.dpp_attempts(dpp_id);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_dpps_updated ON public.dpps;
CREATE TRIGGER trg_dpps_updated BEFORE UPDATE ON public.dpps
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- RLS
ALTER TABLE public.dpps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dpp_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dpp_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dpp_answers ENABLE ROW LEVEL SECURITY;

-- dpps policies
CREATE POLICY "dpps admin all" ON public.dpps FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "dpps teacher manage" ON public.dpps FOR ALL
  USING (teacher_teaches_class(auth.uid(), class_id))
  WITH CHECK (teacher_teaches_class(auth.uid(), class_id));
CREATE POLICY "dpps student read published" ON public.dpps FOR SELECT
  USING (is_published AND student_class_id(auth.uid()) = class_id);
CREATE POLICY "dpps principal read" ON public.dpps FOR SELECT
  USING (has_role(auth.uid(),'principal'));

-- dpp_questions policies
CREATE POLICY "dppq admin all" ON public.dpp_questions FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "dppq teacher manage" ON public.dpp_questions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.dpps d WHERE d.id = dpp_id AND teacher_teaches_class(auth.uid(), d.class_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.dpps d WHERE d.id = dpp_id AND teacher_teaches_class(auth.uid(), d.class_id)));
CREATE POLICY "dppq student read" ON public.dpp_questions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.dpps d
    WHERE d.id = dpp_id AND d.is_published AND student_class_id(auth.uid()) = d.class_id
  ));

-- dpp_attempts policies
CREATE POLICY "dppa admin all" ON public.dpp_attempts FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "dppa self all" ON public.dpp_attempts FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "dppa teacher read" ON public.dpp_attempts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.dpps d WHERE d.id = dpp_id AND teacher_teaches_class(auth.uid(), d.class_id)));

-- dpp_answers policies
CREATE POLICY "dppans admin all" ON public.dpp_answers FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "dppans self all" ON public.dpp_answers FOR ALL
  USING (EXISTS (SELECT 1 FROM public.dpp_attempts a WHERE a.id = attempt_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.dpp_attempts a WHERE a.id = attempt_id AND a.user_id = auth.uid()));
CREATE POLICY "dppans teacher read" ON public.dpp_answers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.dpp_attempts a JOIN public.dpps d ON d.id = a.dpp_id
    WHERE a.id = attempt_id AND teacher_teaches_class(auth.uid(), d.class_id)
  ));

-- ===== RPCs =====

CREATE OR REPLACE FUNCTION public.rpc_dpp_pick_from_bank(
  _dpp_id uuid, _count int DEFAULT 5, _difficulty text DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d record; _n int := 0; _start int;
BEGIN
  SELECT * INTO _d FROM public.dpps WHERE id = _dpp_id;
  IF _d IS NULL THEN RAISE EXCEPTION 'DPP not found'; END IF;
  IF NOT (teacher_teaches_class(auth.uid(), _d.class_id) OR has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT COALESCE(MAX(order_index)+1, 0) INTO _start FROM public.dpp_questions WHERE dpp_id = _dpp_id;

  WITH picked AS (
    SELECT question, options, correct_index, explanation
    FROM public.question_bank
    WHERE is_approved
      AND lower(subject) = lower(_d.subject)
      AND (_d.chapter IS NULL OR chapter ILIKE _d.chapter)
      AND (_difficulty IS NULL OR difficulty = _difficulty)
    ORDER BY random() LIMIT GREATEST(_count,1)
  ), ins AS (
    INSERT INTO public.dpp_questions (dpp_id, order_index, kind, question, options, correct, marks, explanation)
    SELECT _dpp_id, _start + (row_number() OVER ()) - 1, 'mcq'::dpp_question_kind,
           question, options, jsonb_build_object('indexes', jsonb_build_array(correct_index)),
           1, explanation
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;

  UPDATE public.dpps SET
    question_count = (SELECT count(*) FROM public.dpp_questions WHERE dpp_id = _dpp_id),
    total_marks = (SELECT COALESCE(SUM(marks),0) FROM public.dpp_questions WHERE dpp_id = _dpp_id)
  WHERE id = _dpp_id;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_dpp_start(_dpp_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _aid uuid; _sid uuid; _max numeric; _cnt int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = auth.uid() LIMIT 1;
  SELECT COALESCE(SUM(marks),0), count(*) INTO _max, _cnt FROM public.dpp_questions WHERE dpp_id = _dpp_id;

  INSERT INTO public.dpp_attempts (dpp_id, user_id, student_id, max_score, total_count)
  VALUES (_dpp_id, auth.uid(), _sid, _max, _cnt)
  ON CONFLICT (dpp_id, user_id) DO UPDATE SET max_score = EXCLUDED.max_score, total_count = EXCLUDED.total_count
  RETURNING id INTO _aid;
  RETURN _aid;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_dpp_submit(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _att record; _q record; _ans record; _correct boolean; _award numeric;
        _score numeric := 0; _correct_n int := 0; _total int := 0; _neg numeric;
        _resp jsonb; _selected jsonb; _val numeric; _tol numeric;
BEGIN
  SELECT * INTO _att FROM public.dpp_attempts WHERE id = _attempt_id;
  IF _att IS NULL OR _att.user_id <> auth.uid() THEN RAISE EXCEPTION 'Not your attempt'; END IF;
  IF _att.status = 'submitted' THEN RETURN; END IF;
  SELECT negative_marking INTO _neg FROM public.dpps WHERE id = _att.dpp_id;

  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    _total := _total + 1;
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;
    _correct := false; _award := 0;
    IF _ans IS NOT NULL THEN
      _resp := _ans.response;
      IF _q.kind IN ('mcq','multi') THEN
        _selected := COALESCE(_resp->'indexes','[]'::jsonb);
        IF (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(_selected) AS value)
           = (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(_q.correct->'indexes') AS value)
        THEN _correct := true; END IF;
      ELSIF _q.kind = 'numerical' THEN
        _val := (_resp->>'value')::numeric;
        _tol := COALESCE((_q.correct->>'tolerance')::numeric, 0);
        IF _val IS NOT NULL AND abs(_val - (_q.correct->>'value')::numeric) <= _tol THEN _correct := true; END IF;
      ELSIF _q.kind = 'short' THEN
        IF lower(trim(COALESCE(_resp->>'text',''))) = lower(trim(COALESCE(_q.correct->>'text',''))) THEN _correct := true; END IF;
      END IF;

      IF _correct THEN
        _award := _q.marks; _correct_n := _correct_n + 1;
      ELSIF _resp <> '{}'::jsonb THEN
        _award := -1 * _neg;
      END IF;

      UPDATE public.dpp_answers SET is_correct = _correct, marks_awarded = _award
        WHERE id = _ans.id;
      _score := _score + _award;
    END IF;
  END LOOP;

  UPDATE public.dpp_attempts SET
    status = 'submitted', submitted_at = now(),
    score = _score, correct_count = _correct_n, total_count = _total,
    time_spent_sec = GREATEST(EXTRACT(EPOCH FROM (now() - started_at))::int, 0)
  WHERE id = _attempt_id;

  -- XP & badges
  INSERT INTO public.student_xp(user_id, xp, level, last_battle_at)
  VALUES (auth.uid(), GREATEST(_score::int,0), 1 + (GREATEST(_score::int,0) / 100), now())
  ON CONFLICT (user_id) DO UPDATE SET
    xp = student_xp.xp + GREATEST(_score::int,0),
    level = 1 + ((student_xp.xp + GREATEST(_score::int,0)) / 100),
    updated_at = now();

  INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'first_dpp','bronze')
    ON CONFLICT (user_id, badge_code) DO NOTHING;
  IF _total > 0 AND _correct_n = _total THEN
    INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'dpp_perfect','gold')
      ON CONFLICT (user_id, badge_code) DO NOTHING;
  END IF;
END $$;
