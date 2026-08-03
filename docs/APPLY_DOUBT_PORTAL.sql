-- =============================================================================
-- APPLY_DOUBT_PORTAL.sql
-- Paste into Supabase SQL Editor as UTF-8. Idempotent.
-- Evolves community_doubts: first-answer atomic solve, subject_id, multi-attachments,
-- teacher RLS via teacher_classes (class+subject), student class-only visibility.
-- Canonical mirror of supabase/migrations/20260803180000_doubt_portal_evolve.sql
-- =============================================================================

-- =============================================================================
-- Doubt Portal - evolve community_doubts (class feed, first-answer solve)
-- Canonical teacher mapping: public.teacher_classes (class_id + subject/subject_id)
-- No teacher_subjects. No parallel doubts tables. No Nova changes.
-- =============================================================================

-- 1. Teacher class+subject helper (mirrors teacherAssignedToClassSubject)
-- Drop unused overloads only. Do NOT DROP (uuid,uuid,text,uuid) — RLS policies
-- depend on it (2BP01). Replace body in place via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.teacher_teaches_class_subject(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.teacher_teaches_class_subject(uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.teacher_teaches_class_subject(
  _user_id uuid,
  _class_id uuid,
  _subject text DEFAULT NULL,
  _subject_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
    WHERE t.user_id = _user_id
      AND tc.class_id = _class_id
      AND (
        (_subject_id IS NOT NULL AND tc.subject_id IS NOT NULL AND tc.subject_id = _subject_id)
        OR (
          _subject IS NOT NULL
          AND NULLIF(trim(_subject), '') IS NOT NULL
          AND lower(trim(COALESCE(tc.subject, ''))) = lower(trim(_subject))
        )
        OR (
          _subject_id IS NOT NULL
          AND tc.subject_id IS NULL
          AND NULLIF(trim(COALESCE(tc.subject, '')), '') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.subjects s
            WHERE s.id = _subject_id
              AND lower(trim(s.name)) = lower(trim(tc.subject))
          )
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.teacher_teaches_class_subject(uuid, uuid, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.teacher_teaches_class_subject(uuid, uuid, text, uuid) IS
  'True when teacher_classes maps this user to class_id + subject/subject_id. Class-teacher-only does not unlock every subject.';

-- 2. Evolve community_doubts columns
ALTER TABLE public.community_doubts
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS solved_at timestamptz,
  ADD COLUMN IF NOT EXISTS solved_by_answer_id uuid;

UPDATE public.community_doubts d
SET subject_id = s.id
FROM public.subjects s
WHERE d.subject_id IS NULL
  AND NULLIF(trim(d.subject), '') IS NOT NULL
  AND d.school_id IS NOT NULL
  AND s.school_id = d.school_id
  AND lower(trim(s.name)) = lower(trim(d.subject));

UPDATE public.community_doubts d
SET subject_id = s.id
FROM public.subjects s
WHERE d.subject_id IS NULL
  AND NULLIF(trim(d.subject), '') IS NOT NULL
  AND lower(trim(s.name)) = lower(trim(d.subject))
  AND s.id = (
    SELECT s2.id FROM public.subjects s2
    WHERE lower(trim(s2.name)) = lower(trim(d.subject))
    ORDER BY s2.created_at ASC NULLS LAST
    LIMIT 1
  );

DO $$
BEGIN
  ALTER TABLE public.community_doubts DROP CONSTRAINT IF EXISTS community_doubts_status_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE public.community_doubts
  DROP CONSTRAINT IF EXISTS community_doubts_status_check;

ALTER TABLE public.community_doubts
  ADD CONSTRAINT community_doubts_status_check
  CHECK (status IN ('open', 'solved', 'unsolved', 'teacher_answered', 'community_solved'));

UPDATE public.community_doubts
SET status = 'open'
WHERE status = 'unsolved';

UPDATE public.community_doubts
SET status = 'solved',
    solved_at = COALESCE(solved_at, last_activity_at, updated_at, created_at),
    solved_by_answer_id = COALESCE(solved_by_answer_id, accepted_answer_id)
WHERE status IN ('teacher_answered', 'community_solved', 'solved')
   OR (COALESCE(answer_count, 0) > 0 AND status = 'open' AND accepted_answer_id IS NOT NULL);

UPDATE public.community_doubts d
SET status = 'solved',
    solved_at = COALESCE(d.solved_at, d.last_activity_at, d.created_at),
    solved_by_answer_id = COALESCE(
      d.solved_by_answer_id,
      d.accepted_answer_id,
      (
        SELECT a.id
        FROM public.community_doubt_answers a
        WHERE a.doubt_id = d.id
        ORDER BY a.created_at ASC
        LIMIT 1
      )
    )
WHERE COALESCE(d.answer_count, 0) > 0
  AND d.status = 'open';

CREATE INDEX IF NOT EXISTS community_doubts_subject_id_idx
  ON public.community_doubts (subject_id);

CREATE INDEX IF NOT EXISTS community_doubts_class_subject_idx
  ON public.community_doubts (class_id, subject);

CREATE INDEX IF NOT EXISTS community_doubts_status_open_idx
  ON public.community_doubts (class_id, status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_doubts_solved_by_answer_id_fkey'
  ) THEN
    ALTER TABLE public.community_doubts
      ADD CONSTRAINT community_doubts_solved_by_answer_id_fkey
      FOREIGN KEY (solved_by_answer_id)
      REFERENCES public.community_doubt_answers(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'solved_by_answer_id FK deferred/skipped: %', SQLERRM;
END $$;

ALTER TABLE public.community_doubt_answers
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE;

-- 3. Multi-attachment tables
CREATE TABLE IF NOT EXISTS public.community_doubt_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  doubt_id uuid NOT NULL REFERENCES public.community_doubts(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  file_size_bytes bigint,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.community_doubt_answer_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  answer_id uuid NOT NULL REFERENCES public.community_doubt_answers(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  file_size_bytes bigint,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.community_doubt_attachments
  ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.community_doubt_answer_attachments
  ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE INDEX IF NOT EXISTS community_doubt_attachments_doubt_idx
  ON public.community_doubt_attachments (doubt_id);
CREATE INDEX IF NOT EXISTS community_doubt_answer_attachments_answer_idx
  ON public.community_doubt_answer_attachments (answer_id);

ALTER TABLE public.community_doubt_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_doubt_answer_attachments ENABLE ROW LEVEL SECURITY;

-- 4. RPCs (DROP old signatures first; trigger created AFTER this so it is not wiped)
DROP FUNCTION IF EXISTS public.rpc_create_community_doubt(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.rpc_create_community_doubt(text, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.rpc_add_community_answer(uuid, text, text);
DROP FUNCTION IF EXISTS public.rpc_teacher_doubt_dashboard();

CREATE OR REPLACE FUNCTION public.rpc_create_community_doubt(
  _subject text,
  _chapter text,
  _concept text,
  _title text,
  _body text,
  _image_url text DEFAULT NULL,
  _subject_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _student record;
  _id uuid;
  _school uuid;
  _resolved_subject_id uuid;
  _subject_label text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT s.id, s.class_id, s.full_name, s.school_id, c.name, c.section, c.display_name
  INTO _student
  FROM public.students s
  LEFT JOIN public.classes c ON c.id = s.class_id
  WHERE s.user_id = _uid
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'Student record required to ask a doubt'; END IF;
  IF _student.class_id IS NULL THEN RAISE EXCEPTION 'Student must be assigned to a class'; END IF;

  _school := COALESCE(_student.school_id, public.get_my_school_id(), public.default_school_id());
  _subject_label := COALESCE(NULLIF(trim(_subject), ''), 'General');
  _resolved_subject_id := _subject_id;

  IF _resolved_subject_id IS NULL THEN
    SELECT s.id INTO _resolved_subject_id
    FROM public.subjects s
    WHERE s.school_id = _school
      AND lower(trim(s.name)) = lower(_subject_label)
    LIMIT 1;
  END IF;

  INSERT INTO public.community_doubts(
    user_id, student_id, class_id, school_id, student_name, class_label,
    subject, subject_id, chapter, concept, title, body, image_url, status
  )
  VALUES (
    _uid, _student.id, _student.class_id, _school,
    COALESCE(_student.full_name, 'Student'),
    COALESCE(_student.display_name, concat('Class ', _student.name, '-', _student.section), 'Class'),
    _subject_label,
    _resolved_subject_id,
    COALESCE(NULLIF(trim(_chapter), ''), ''),
    COALESCE(NULLIF(trim(_concept), ''), ''),
    COALESCE(NULLIF(trim(_title), ''), left(trim(_body), 80)),
    trim(_body),
    NULLIF(trim(COALESCE(_image_url, '')), ''),
    'open'
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _name text;
  _id uuid;
  _d record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT id, class_id, subject, subject_id, school_id, user_id
  INTO _d
  FROM public.community_doubts
  WHERE id = _doubt_id;

  IF _d.id IS NULL THEN RAISE EXCEPTION 'Doubt not found'; END IF;

  _role := public._community_user_role(_uid);

  IF _role = 'student' THEN
    IF public.student_class_id(_uid) IS DISTINCT FROM _d.class_id THEN
      RAISE EXCEPTION 'Not allowed to answer this doubt';
    END IF;
  ELSIF _role = 'teacher' THEN
    IF NOT public.teacher_teaches_class_subject(_uid, _d.class_id, _d.subject, _d.subject_id) THEN
      RAISE EXCEPTION 'Not assigned to this class and subject';
    END IF;
  ELSIF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'principal')) THEN
    RAISE EXCEPTION 'Not allowed to answer this doubt';
  END IF;

  IF NULLIF(trim(_body), '') IS NULL THEN RAISE EXCEPTION 'Answer body required'; END IF;

  _name := public._community_author_name(_uid, _role);

  INSERT INTO public.community_doubt_answers(
    doubt_id, user_id, school_id, author_name, author_role, body, image_url, is_teacher_verified
  )
  VALUES (
    _doubt_id, _uid, _d.school_id, _name, _role, trim(_body),
    NULLIF(trim(COALESCE(_image_url, '')), ''),
    _role IN ('teacher', 'admin', 'principal')
  )
  RETURNING id INTO _id;

  PERFORM public._community_refresh_reputation(_uid);
  RETURN _id;
END $$;

-- 5. Atomic first-answer -> solved trigger (AFTER RPC drops so function is not wiped)
DROP TRIGGER IF EXISTS community_answers_first_solves ON public.community_doubt_answers;
DROP TRIGGER IF EXISTS community_doubt_answers_first_solves ON public.community_doubt_answers;
DROP FUNCTION IF EXISTS public.tg_community_doubt_first_answer_solves();

CREATE OR REPLACE FUNCTION public.tg_community_doubt_first_answer_solves()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _first_solve boolean := false;
  _author uuid;
BEGIN
  UPDATE public.community_doubts
  SET
    status = 'solved',
    solved_at = COALESCE(solved_at, now()),
    solved_by_answer_id = COALESCE(solved_by_answer_id, NEW.id),
    accepted_answer_id = COALESCE(accepted_answer_id, NEW.id),
    answer_count = GREATEST(COALESCE(answer_count, 0), 0) + 1,
    teacher_answered = teacher_answered OR (NEW.author_role IN ('teacher', 'admin', 'principal')),
    last_activity_at = now(),
    updated_at = now()
  WHERE id = NEW.doubt_id
    AND status IN ('open', 'unsolved');

  IF FOUND THEN
    _first_solve := true;
  ELSE
    UPDATE public.community_doubts
    SET
      answer_count = GREATEST(COALESCE(answer_count, 0), 0) + 1,
      teacher_answered = teacher_answered OR (NEW.author_role IN ('teacher', 'admin', 'principal')),
      last_activity_at = now(),
      updated_at = now()
    WHERE id = NEW.doubt_id;
  END IF;

  IF _first_solve THEN
    SELECT user_id INTO _author FROM public.community_doubts WHERE id = NEW.doubt_id;
    IF _author IS NOT NULL AND _author IS DISTINCT FROM NEW.user_id THEN
      BEGIN
        PERFORM public._notify(
          _author,
          'doubt',
          'Your doubt was answered',
          left(NEW.body, 120),
          'message-circle',
          '/student/doubts'
        );
      EXCEPTION WHEN undefined_function OR others THEN
        NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER community_answers_first_solves
  AFTER INSERT ON public.community_doubt_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_community_doubt_first_answer_solves();

-- 6. RLS — student class-only; teacher class+subject; NO client UPDATE/DELETE
DROP POLICY IF EXISTS "community doubts read" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts school read" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts student class read" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts teacher subject read" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts teacher assignment read" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts staff school read" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts insert student" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts student insert" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts owner update" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts no delete" ON public.community_doubts;

CREATE POLICY "community doubts student class read" ON public.community_doubts
  FOR SELECT TO authenticated
  USING (
    class_id = public.student_class_id(auth.uid())
    OR public.teacher_teaches_class_subject(auth.uid(), class_id, subject, subject_id)
    OR (
      public.same_school(school_id)
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
    )
  );

CREATE POLICY "community doubts insert student" ON public.community_doubts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND class_id = public.student_class_id(auth.uid())
    AND public.has_role(auth.uid(), 'student'::public.app_role)
  );

DROP POLICY IF EXISTS "community answers read" ON public.community_doubt_answers;
DROP POLICY IF EXISTS "community answers school read" ON public.community_doubt_answers;
DROP POLICY IF EXISTS "community answers visible read" ON public.community_doubt_answers;
DROP POLICY IF EXISTS "community answers insert" ON public.community_doubt_answers;
DROP POLICY IF EXISTS "community answers insert visible" ON public.community_doubt_answers;
DROP POLICY IF EXISTS "community answers owner update" ON public.community_doubt_answers;

CREATE POLICY "community answers school read" ON public.community_doubt_answers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_doubts d
      WHERE d.id = community_doubt_answers.doubt_id
        AND (
          d.class_id = public.student_class_id(auth.uid())
          OR public.teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id)
          OR (
            public.same_school(d.school_id)
            AND (
              public.has_role(auth.uid(), 'admin'::public.app_role)
              OR public.has_role(auth.uid(), 'principal'::public.app_role)
            )
          )
        )
    )
  );

CREATE POLICY "community answers insert" ON public.community_doubt_answers
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.community_doubts d
      WHERE d.id = doubt_id
        AND (
          d.class_id = public.student_class_id(auth.uid())
          OR public.teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id)
        )
    )
  );

DROP POLICY IF EXISTS "doubt attachments read" ON public.community_doubt_attachments;
DROP POLICY IF EXISTS "doubt attachments insert" ON public.community_doubt_attachments;
DROP POLICY IF EXISTS "community doubt attachments read" ON public.community_doubt_attachments;
DROP POLICY IF EXISTS "community doubt attachments insert" ON public.community_doubt_attachments;

CREATE POLICY "doubt attachments read" ON public.community_doubt_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_doubts d
      WHERE d.id = community_doubt_attachments.doubt_id
        AND (
          d.class_id = public.student_class_id(auth.uid())
          OR public.teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id)
          OR (
            public.same_school(d.school_id)
            AND (
              public.has_role(auth.uid(), 'admin'::public.app_role)
              OR public.has_role(auth.uid(), 'principal'::public.app_role)
            )
          )
        )
    )
  );

CREATE POLICY "doubt attachments insert" ON public.community_doubt_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.community_doubts d
      WHERE d.id = doubt_id
        AND d.user_id = auth.uid()
        AND d.class_id = public.student_class_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "doubt answer attachments read" ON public.community_doubt_answer_attachments;
DROP POLICY IF EXISTS "doubt answer attachments insert" ON public.community_doubt_answer_attachments;
DROP POLICY IF EXISTS "community answer attachments read" ON public.community_doubt_answer_attachments;
DROP POLICY IF EXISTS "community answer attachments insert" ON public.community_doubt_answer_attachments;

CREATE POLICY "doubt answer attachments read" ON public.community_doubt_answer_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.community_doubt_answers a
      JOIN public.community_doubts d ON d.id = a.doubt_id
      WHERE a.id = community_doubt_answer_attachments.answer_id
        AND (
          d.class_id = public.student_class_id(auth.uid())
          OR public.teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id)
          OR (
            public.same_school(d.school_id)
            AND (
              public.has_role(auth.uid(), 'admin'::public.app_role)
              OR public.has_role(auth.uid(), 'principal'::public.app_role)
            )
          )
        )
    )
  );

CREATE POLICY "doubt answer attachments insert" ON public.community_doubt_answer_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.community_doubt_answers a
      JOIN public.community_doubts d ON d.id = a.doubt_id
      WHERE a.id = answer_id
        AND a.user_id = auth.uid()
        AND (
          d.class_id = public.student_class_id(auth.uid())
          OR public.teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id)
        )
    )
  );

-- 7. Storage: private doubt-attachments bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'doubt-attachments',
  'doubt-attachments',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "doubt attachments storage read" ON storage.objects;
DROP POLICY IF EXISTS "doubt attachments storage upload" ON storage.objects;
DROP POLICY IF EXISTS "doubt attachments storage update" ON storage.objects;
DROP POLICY IF EXISTS "doubt attachments storage delete" ON storage.objects;

CREATE POLICY "doubt attachments storage read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'doubt-attachments'
    AND (storage.foldername(name))[1] = public.get_my_school_id()::text
    AND (
      (storage.foldername(name))[2] = public.student_class_id(auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.teacher_classes tc
        JOIN public.teachers t ON t.id = tc.teacher_id
        WHERE t.user_id = auth.uid()
          AND tc.class_id::text = (storage.foldername(name))[2]
      )
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

CREATE POLICY "doubt attachments storage upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'doubt-attachments'
    AND (storage.foldername(name))[1] = public.get_my_school_id()::text
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND (
      (storage.foldername(name))[2] = public.student_class_id(auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.teacher_classes tc
        JOIN public.teachers t ON t.id = tc.teacher_id
        WHERE t.user_id = auth.uid()
          AND tc.class_id::text = (storage.foldername(name))[2]
      )
    )
  );

DROP POLICY IF EXISTS "doubt images read" ON storage.objects;
CREATE POLICY "doubt images read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'doubt-images');

DROP POLICY IF EXISTS "doubt images upload own" ON storage.objects;
CREATE POLICY "doubt images upload own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'doubt-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 8. Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'community_doubts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_doubts;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'community_doubt_answers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_doubt_answers;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_teacher_doubt_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
       OR public.teacher_teaches_class_subject(_uid, d.class_id, d.subject, d.subject_id)
  ),
  concepts AS (
    SELECT COALESCE(NULLIF(concept, ''), NULLIF(chapter, ''), subject, 'General') AS label,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status IN ('open', 'unsolved')) AS unresolved
    FROM visible
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'unanswered', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC) FROM (SELECT * FROM visible WHERE status IN ('open','unsolved') ORDER BY created_at DESC LIMIT 20) v), '[]'::jsonb),
    'attention', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.view_count DESC, v.created_at ASC) FROM (SELECT * FROM visible WHERE status IN ('open','unsolved') ORDER BY view_count DESC, created_at ASC LIMIT 12) v), '[]'::jsonb),
    'concepts', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM concepts c), '[]'::jsonb),
    'totals', jsonb_build_object(
      'open', (SELECT COUNT(*) FROM visible WHERE status IN ('open','unsolved')),
      'teacher_answered', (SELECT COUNT(*) FROM visible WHERE teacher_answered),
      'solved', (SELECT COUNT(*) FROM visible WHERE status = 'solved')
    )
  ) INTO _result;

  RETURN _result;
END $$;

GRANT EXECUTE ON FUNCTION public.rpc_create_community_doubt(text, text, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_add_community_answer(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_teacher_doubt_dashboard() TO authenticated;
