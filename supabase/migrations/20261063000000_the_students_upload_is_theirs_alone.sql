-- ===========================================================================
-- THE STUDENT'S UPLOAD IS THEIRS ALONE
--
-- Binding: docs/custom-practice-upload-spec.md §2, §3, §9.1
-- Ruled 2026-09-24. Custom Practice — the student's own upload.
--
-- §2 Privacy wins: an upload and everything extracted from it belongs to the
-- account that uploaded it and is visible to nobody else. That forbids putting
-- private rows in question_bank (§2.1) or ai_kms_documents (§2.2). Private
-- questions get their own tables, fenced by owner_id = auth.uid() — not
-- same_school(), which would admit every member of a space.
--
-- school_id still sits on every row (house pattern: learning tables are fenced
-- on school_id NOT NULL; an individual's school_id is their tenant of one —
-- see 20261046000000). Access is owner-scoped; the column is inventory, not
-- the read predicate.
--
-- §10.3 (variant_generation_queue second FK) is deliberately NOT in this
-- migration — promotion plumbing comes after the intake path works.
-- ===========================================================================

BEGIN;

-- ── Storage: private bucket, one folder per account (§3.1) ──────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-uploads',
  'student-uploads',
  false,
  20971520, -- 20 MB (§13 leaves exact caps open; match doubt-attachments)
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/gif'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "student uploads read own" ON storage.objects;
DROP POLICY IF EXISTS "student uploads insert own" ON storage.objects;
DROP POLICY IF EXISTS "student uploads update own" ON storage.objects;
DROP POLICY IF EXISTS "student uploads delete own" ON storage.objects;

-- Keys: {auth.uid}/{object} — same split_part / foldername convention as
-- homework_file_is_fixed and academic-files.
CREATE POLICY "student uploads read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'student-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "student uploads insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'student-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "student uploads update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'student-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'student-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "student uploads delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'student-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── student_uploads (§3.2) ──────────────────────────────────────────────────
CREATE TABLE public.student_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id       uuid NOT NULL REFERENCES public.schools(id),
  storage_path    text NOT NULL,
  original_filename text NOT NULL,
  byte_size       bigint NOT NULL CHECK (byte_size > 0),
  mime_type       text NOT NULL,
  page_count      integer CHECK (page_count IS NULL OR page_count > 0),
  -- §4 classification
  verdict         text CHECK (verdict IS NULL OR verdict IN ('questions', 'notes', 'mixed', 'unusable')),
  confidence      numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  refusal_reason  text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'ready', 'unusable', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_uploads_storage_path_unique UNIQUE (storage_path),
  -- Unusable / failed may carry a reason; ready questions/notes/mixed must not
  -- look like a refusal.
  CONSTRAINT student_uploads_refusal_agrees CHECK (
    (status = 'unusable' AND refusal_reason IS NOT NULL)
    OR (status <> 'unusable')
  )
);

CREATE INDEX student_uploads_owner_created_idx
  ON public.student_uploads (owner_id, created_at DESC);
CREATE INDEX student_uploads_school_owner_idx
  ON public.student_uploads (school_id, owner_id);

COMMENT ON TABLE public.student_uploads IS
  'Custom Practice uploads — private to owner_id. docs/custom-practice-upload-spec.md §3.2';

ALTER TABLE public.student_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_uploads_owner ON public.student_uploads
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- ── student_upload_questions (§3.2, §5, §6) ─────────────────────────────────
CREATE TABLE public.student_upload_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id       uuid NOT NULL REFERENCES public.student_uploads(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id       uuid NOT NULL REFERENCES public.schools(id),
  sequence        integer NOT NULL CHECK (sequence >= 1),
  question_text   text NOT NULL,
  options         jsonb, -- array of strings for MCQ; null for non-MCQ
  correct_index   integer,
  correct_answer  text,
  -- §6: file key vs AI-solved
  answer_source   text NOT NULL CHECK (answer_source IN ('file', 'ai')),
  explanation     text,
  difficulty      text, -- same vocabulary as question_bank.difficulty
  chapter_id      uuid REFERENCES public.chapters(id),
  topic_id        uuid REFERENCES public.topics(id),
  -- Tag inheritance from bank match (§5.2). Does NOT make the row shared.
  matched_bank_question_id uuid REFERENCES public.question_bank(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_upload_questions_seq_unique UNIQUE (upload_id, sequence),
  CONSTRAINT student_upload_questions_answer_shape CHECK (
    (options IS NOT NULL AND jsonb_typeof(options) = 'array'
      AND correct_index IS NOT NULL AND correct_index >= 0)
    OR (correct_answer IS NOT NULL AND length(btrim(correct_answer)) > 0)
  )
);

CREATE INDEX student_upload_questions_owner_idx
  ON public.student_upload_questions (owner_id, upload_id);
CREATE INDEX student_upload_questions_chapter_idx
  ON public.student_upload_questions (owner_id, chapter_id)
  WHERE chapter_id IS NOT NULL;

COMMENT ON TABLE public.student_upload_questions IS
  'Questions extracted from a private upload. Never promoted (§10.1). Spec §3.2 §5 §6.';
COMMENT ON COLUMN public.student_upload_questions.answer_source IS
  'file = key from the upload; ai = AI-answered (§6). AI-answered never promotes (§6.2).';
COMMENT ON COLUMN public.student_upload_questions.chapter_id IS
  'NULL when unresolved — still practisable, excluded from recovery/revision (§5.1).';

ALTER TABLE public.student_upload_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_upload_questions_owner ON public.student_upload_questions
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- ── student_upload_notes (§3.2, §7) ─────────────────────────────────────────
CREATE TABLE public.student_upload_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id       uuid NOT NULL REFERENCES public.student_uploads(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id       uuid NOT NULL REFERENCES public.schools(id),
  sequence        integer NOT NULL CHECK (sequence >= 1),
  title           text NOT NULL,
  body            text NOT NULL,
  chapter_id      uuid REFERENCES public.chapters(id),
  topic_id        uuid REFERENCES public.topics(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_upload_notes_seq_unique UNIQUE (upload_id, sequence)
);

CREATE INDEX student_upload_notes_owner_idx
  ON public.student_upload_notes (owner_id, upload_id);

COMMENT ON TABLE public.student_upload_notes IS
  'Notes from a private upload. Never leave the student space (§7.3). Spec §3.2 §7.';

ALTER TABLE public.student_upload_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_upload_notes_owner ON public.student_upload_notes
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- ── Attempts: source = upload (§9.1) ────────────────────────────────────────
ALTER TABLE public.question_attempts DROP CONSTRAINT IF EXISTS question_attempts_source_check;
ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_source_check
  CHECK (source = ANY (ARRAY['battle', 'test', 'practice', 'mistake_book', 'upload']));

-- ── VERIFY (must be able to fail) ───────────────────────────────────────────
DO $$
DECLARE
  _pol text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'student-uploads' AND public = false) THEN
    RAISE EXCEPTION 'VERIFY FAILED: student-uploads bucket missing or public';
  END IF;

  IF to_regclass('public.student_uploads') IS NULL
     OR to_regclass('public.student_upload_questions') IS NULL
     OR to_regclass('public.student_upload_notes') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: one of the three upload tables is missing';
  END IF;

  SELECT polname INTO _pol
    FROM pg_policy
   WHERE polrelid = 'public.student_uploads'::regclass
     AND polcmd = '*'
     AND pg_get_expr(polqual, polrelid) ILIKE '%owner_id%'
     AND pg_get_expr(polqual, polrelid) ILIKE '%auth.uid%'
   LIMIT 1;
  IF _pol IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: student_uploads lacks owner_id = auth.uid() policy';
  END IF;

  -- Positive control: same_school must NOT be the access predicate (§2).
  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.student_uploads'::regclass
       AND pg_get_expr(polqual, polrelid) ILIKE '%same_school%'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: student_uploads policy uses same_school — §2 forbids it';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'question_attempts_source_check'
       AND pg_get_constraintdef(oid) ILIKE '%upload%'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: question_attempts.source does not admit upload';
  END IF;
END $$;

COMMIT;
