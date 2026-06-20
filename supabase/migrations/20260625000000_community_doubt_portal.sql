-- Community Doubt Portal
-- A school-friendly discussion system for student doubts, peer answers, teacher guidance,
-- helpful votes, accepted answers, and reputation.

CREATE TABLE IF NOT EXISTS public.community_doubts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  student_id uuid,
  class_id uuid,
  student_name text NOT NULL DEFAULT 'Student',
  class_label text NOT NULL DEFAULT 'Class',
  subject text NOT NULL DEFAULT '',
  chapter text NOT NULL DEFAULT '',
  concept text NOT NULL DEFAULT '',
  title text NOT NULL,
  body text NOT NULL,
  image_url text,
  status text NOT NULL DEFAULT 'unsolved' CHECK (status IN ('unsolved', 'teacher_answered', 'community_solved', 'solved')),
  answer_count integer NOT NULL DEFAULT 0,
  upvote_count integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  teacher_answered boolean NOT NULL DEFAULT false,
  accepted_answer_id uuid,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.community_doubt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doubt_id uuid NOT NULL REFERENCES public.community_doubts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  author_name text NOT NULL DEFAULT 'Contributor',
  author_role text NOT NULL DEFAULT 'student' CHECK (author_role IN ('student', 'teacher', 'admin', 'principal')),
  body text NOT NULL,
  image_url text,
  is_teacher_verified boolean NOT NULL DEFAULT false,
  is_accepted boolean NOT NULL DEFAULT false,
  upvote_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.community_doubt_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  doubt_id uuid REFERENCES public.community_doubts(id) ON DELETE CASCADE,
  answer_id uuid REFERENCES public.community_doubt_answers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((doubt_id IS NOT NULL AND answer_id IS NULL) OR (doubt_id IS NULL AND answer_id IS NOT NULL)),
  UNIQUE (user_id, doubt_id),
  UNIQUE (user_id, answer_id)
);

CREATE TABLE IF NOT EXISTS public.community_doubt_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  doubt_id uuid NOT NULL REFERENCES public.community_doubts(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, doubt_id)
);

CREATE TABLE IF NOT EXISTS public.community_reputation (
  user_id uuid PRIMARY KEY,
  points integer NOT NULL DEFAULT 0,
  answer_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  upvote_count integer NOT NULL DEFAULT 0,
  badges text[] NOT NULL DEFAULT '{}',
  top_subject text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('doubt-images', 'doubt-images', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.community_doubts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_doubt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_doubt_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_doubt_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reputation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community doubts read" ON public.community_doubts;
CREATE POLICY "community doubts read" ON public.community_doubts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "community doubts owner update" ON public.community_doubts;
CREATE POLICY "community doubts owner update" ON public.community_doubts
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.teacher_teaches_class(auth.uid(), class_id)
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.teacher_teaches_class(auth.uid(), class_id)
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  );

DROP POLICY IF EXISTS "community answers read" ON public.community_doubt_answers;
CREATE POLICY "community answers read" ON public.community_doubt_answers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "community answers owner update" ON public.community_doubt_answers;
CREATE POLICY "community answers owner update" ON public.community_doubt_answers
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.community_doubts d
      WHERE d.id = community_doubt_answers.doubt_id
        AND (public.teacher_teaches_class(auth.uid(), d.class_id) OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal'))
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.community_doubts d
      WHERE d.id = community_doubt_answers.doubt_id
        AND (public.teacher_teaches_class(auth.uid(), d.class_id) OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal'))
    )
  );

DROP POLICY IF EXISTS "community votes own read" ON public.community_doubt_votes;
CREATE POLICY "community votes own read" ON public.community_doubt_votes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "community views own read" ON public.community_doubt_views;
CREATE POLICY "community views own read" ON public.community_doubt_views
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "community reputation read" ON public.community_reputation;
CREATE POLICY "community reputation read" ON public.community_reputation
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "doubt images read" ON storage.objects;
CREATE POLICY "doubt images read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'doubt-images');

DROP POLICY IF EXISTS "doubt images upload own" ON storage.objects;
CREATE POLICY "doubt images upload own" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'doubt-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE INDEX IF NOT EXISTS idx_community_doubts_class_activity ON public.community_doubts(class_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_doubts_status ON public.community_doubts(status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_doubts_subject_concept ON public.community_doubts(subject, chapter, concept);
CREATE INDEX IF NOT EXISTS idx_community_answers_doubt_rank ON public.community_doubt_answers(doubt_id, is_accepted DESC, is_teacher_verified DESC, upvote_count DESC, created_at ASC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    DROP TRIGGER IF EXISTS community_doubts_set_updated ON public.community_doubts;
    CREATE TRIGGER community_doubts_set_updated BEFORE UPDATE ON public.community_doubts
      FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
    DROP TRIGGER IF EXISTS community_answers_set_updated ON public.community_doubt_answers;
    CREATE TRIGGER community_answers_set_updated BEFORE UPDATE ON public.community_doubt_answers
      FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._community_user_role(_uid uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role::text FROM public.user_roles WHERE user_id = _uid ORDER BY
      CASE role::text WHEN 'principal' THEN 1 WHEN 'admin' THEN 2 WHEN 'teacher' THEN 3 WHEN 'student' THEN 4 ELSE 5 END
      LIMIT 1),
    'student'
  )
$$;

CREATE OR REPLACE FUNCTION public._community_author_name(_uid uuid, _role text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    CASE WHEN _role = 'teacher' THEN (SELECT full_name FROM public.teachers WHERE user_id = _uid LIMIT 1) END,
    CASE WHEN _role = 'student' THEN (SELECT full_name FROM public.students WHERE user_id = _uid LIMIT 1) END,
    (SELECT full_name FROM public.profiles WHERE id = _uid LIMIT 1),
    'Contributor'
  )
$$;

CREATE OR REPLACE FUNCTION public._community_refresh_reputation(_uid uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _answers int;
  _accepted int;
  _upvotes int;
  _points int;
  _badges text[] := '{}';
  _top_subject text;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(CASE WHEN is_accepted THEN 1 ELSE 0 END), 0), COALESCE(SUM(upvote_count), 0)
  INTO _answers, _accepted, _upvotes
  FROM public.community_doubt_answers
  WHERE user_id = _uid;

  _points := (_answers * 20) + (_upvotes * 5) + (_accepted * 80);

  IF _answers >= 1 THEN _badges := array_append(_badges, 'Doubt Solver'); END IF;
  IF _answers >= 5 THEN _badges := array_append(_badges, 'Helpful Mentor'); END IF;
  IF _accepted >= 2 THEN _badges := array_append(_badges, 'Problem Master'); END IF;
  IF _upvotes >= 10 THEN _badges := array_append(_badges, 'Top Contributor'); END IF;
  IF _accepted >= 5 THEN _badges := array_append(_badges, 'Concept Expert'); END IF;

  SELECT d.subject INTO _top_subject
  FROM public.community_doubt_answers a
  JOIN public.community_doubts d ON d.id = a.doubt_id
  WHERE a.user_id = _uid AND COALESCE(d.subject, '') <> ''
  GROUP BY d.subject
  ORDER BY COUNT(*) DESC, d.subject ASC
  LIMIT 1;

  INSERT INTO public.community_reputation(user_id, points, answer_count, accepted_count, upvote_count, badges, top_subject, updated_at)
  VALUES (_uid, _points, _answers, _accepted, _upvotes, _badges, _top_subject, now())
  ON CONFLICT (user_id) DO UPDATE SET
    points = EXCLUDED.points,
    answer_count = EXCLUDED.answer_count,
    accepted_count = EXCLUDED.accepted_count,
    upvote_count = EXCLUDED.upvote_count,
    badges = EXCLUDED.badges,
    top_subject = EXCLUDED.top_subject,
    updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.rpc_create_community_doubt(
  _subject text,
  _chapter text,
  _concept text,
  _title text,
  _body text,
  _image_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _student record;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT s.id, s.class_id, s.full_name, c.name, c.section, c.display_name
  INTO _student
  FROM public.students s
  LEFT JOIN public.classes c ON c.id = s.class_id
  WHERE s.user_id = _uid
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'Student record required to ask a doubt'; END IF;

  INSERT INTO public.community_doubts(
    user_id, student_id, class_id, student_name, class_label,
    subject, chapter, concept, title, body, image_url
  )
  VALUES (
    _uid, _student.id, _student.class_id, COALESCE(_student.full_name, 'Student'),
    COALESCE(_student.display_name, concat('Class ', _student.name, '-', _student.section), 'Class'),
    COALESCE(NULLIF(trim(_subject), ''), 'General'),
    COALESCE(NULLIF(trim(_chapter), ''), ''),
    COALESCE(NULLIF(trim(_concept), ''), ''),
    trim(_title), trim(_body), NULLIF(trim(COALESCE(_image_url, '')), '')
  )
  RETURNING id INTO _id;

  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_add_community_answer(
  _doubt_id uuid,
  _body text,
  _image_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _name text;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_doubts WHERE id = _doubt_id) THEN
    RAISE EXCEPTION 'Doubt not found';
  END IF;

  _role := public._community_user_role(_uid);
  _name := public._community_author_name(_uid, _role);

  INSERT INTO public.community_doubt_answers(doubt_id, user_id, author_name, author_role, body, image_url, is_teacher_verified)
  VALUES (_doubt_id, _uid, _name, _role, trim(_body), NULLIF(trim(COALESCE(_image_url, '')), ''), _role IN ('teacher', 'admin', 'principal'))
  RETURNING id INTO _id;

  UPDATE public.community_doubts
  SET answer_count = answer_count + 1,
      teacher_answered = teacher_answered OR (_role IN ('teacher', 'admin', 'principal')),
      status = CASE
        WHEN status = 'solved' THEN status
        WHEN _role IN ('teacher', 'admin', 'principal') THEN 'teacher_answered'
        WHEN status = 'unsolved' THEN 'community_solved'
        ELSE status
      END,
      last_activity_at = now()
  WHERE id = _doubt_id;

  PERFORM public._community_refresh_reputation(_uid);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_vote_community_doubt(_doubt_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF EXISTS (SELECT 1 FROM public.community_doubt_votes WHERE user_id = _uid AND doubt_id = _doubt_id) THEN
    DELETE FROM public.community_doubt_votes WHERE user_id = _uid AND doubt_id = _doubt_id;
  ELSE
    INSERT INTO public.community_doubt_votes(user_id, doubt_id) VALUES (_uid, _doubt_id);
  END IF;

  SELECT COUNT(*) INTO _count FROM public.community_doubt_votes WHERE doubt_id = _doubt_id;
  UPDATE public.community_doubts SET upvote_count = _count WHERE id = _doubt_id;
  RETURN _count;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_vote_community_answer(_answer_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _count int;
  _author uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF EXISTS (SELECT 1 FROM public.community_doubt_votes WHERE user_id = _uid AND answer_id = _answer_id) THEN
    DELETE FROM public.community_doubt_votes WHERE user_id = _uid AND answer_id = _answer_id;
  ELSE
    INSERT INTO public.community_doubt_votes(user_id, answer_id) VALUES (_uid, _answer_id);
  END IF;

  SELECT COUNT(*) INTO _count FROM public.community_doubt_votes WHERE answer_id = _answer_id;
  UPDATE public.community_doubt_answers SET upvote_count = _count WHERE id = _answer_id RETURNING user_id INTO _author;
  IF _author IS NOT NULL THEN PERFORM public._community_refresh_reputation(_author); END IF;
  RETURN _count;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_mark_best_community_answer(_answer_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _answer record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT a.id, a.doubt_id, a.user_id AS answer_user_id, d.user_id AS doubt_user_id
  INTO _answer
  FROM public.community_doubt_answers a
  JOIN public.community_doubts d ON d.id = a.doubt_id
  WHERE a.id = _answer_id;

  IF _answer.id IS NULL THEN RAISE EXCEPTION 'Answer not found'; END IF;
  IF _answer.doubt_user_id <> _uid AND NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal') THEN
    RAISE EXCEPTION 'Only the doubt author can accept an answer';
  END IF;

  UPDATE public.community_doubt_answers SET is_accepted = false WHERE doubt_id = _answer.doubt_id;
  UPDATE public.community_doubt_answers SET is_accepted = true WHERE id = _answer_id;
  UPDATE public.community_doubts SET accepted_answer_id = _answer_id, status = 'solved', last_activity_at = now() WHERE id = _answer.doubt_id;
  PERFORM public._community_refresh_reputation(_answer.answer_user_id);
END $$;

CREATE OR REPLACE FUNCTION public.rpc_record_community_doubt_view(_doubt_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  INSERT INTO public.community_doubt_views(user_id, doubt_id)
  VALUES (_uid, _doubt_id)
  ON CONFLICT (user_id, doubt_id) DO UPDATE SET viewed_at = now();

  SELECT COUNT(*) INTO _count FROM public.community_doubt_views WHERE doubt_id = _doubt_id;
  UPDATE public.community_doubts SET view_count = _count WHERE id = _doubt_id;
  RETURN _count;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_teacher_doubt_dashboard()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(_uid, 'teacher') AND NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal') THEN
    RAISE EXCEPTION 'Teacher access required';
  END IF;

  WITH visible AS (
    SELECT *
    FROM public.community_doubts d
    WHERE public.has_role(_uid, 'admin')
       OR public.has_role(_uid, 'principal')
       OR public.teacher_teaches_class(_uid, d.class_id)
  ),
  concepts AS (
    SELECT COALESCE(NULLIF(concept, ''), NULLIF(chapter, ''), subject, 'General') AS label,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'unsolved') AS unresolved
    FROM visible
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'unanswered', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC) FROM (SELECT * FROM visible WHERE status = 'unsolved' ORDER BY created_at DESC LIMIT 20) v), '[]'::jsonb),
    'attention', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.view_count DESC, v.created_at ASC) FROM (SELECT * FROM visible WHERE status IN ('unsolved','community_solved') ORDER BY view_count DESC, created_at ASC LIMIT 12) v), '[]'::jsonb),
    'concepts', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM concepts c), '[]'::jsonb),
    'totals', jsonb_build_object(
      'open', (SELECT COUNT(*) FROM visible WHERE status = 'unsolved'),
      'teacher_answered', (SELECT COUNT(*) FROM visible WHERE teacher_answered),
      'solved', (SELECT COUNT(*) FROM visible WHERE status = 'solved'),
      'total', (SELECT COUNT(*) FROM visible)
    )
  )
  INTO _result;

  RETURN _result;
END $$;

GRANT EXECUTE ON FUNCTION public.rpc_create_community_doubt(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_add_community_answer(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_vote_community_doubt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_vote_community_answer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mark_best_community_answer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_record_community_doubt_view(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_teacher_doubt_dashboard() TO authenticated;
