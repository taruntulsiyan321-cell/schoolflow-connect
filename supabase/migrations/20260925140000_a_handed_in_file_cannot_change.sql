-- ═══════════════════════════════════════════════════════════════════════════
-- A handed-in file cannot change after it is handed in
--
-- The product owner's homework specification, 2026-09-13
-- (docs/gurukul-spec-rules.md, "Homework — RULED 2026-09-13"): the student
-- hands in ONE file, nothing can be handed in after the deadline, and (the
-- stated assumption) an accepted submission is final. Builds on 20260925110000.
--
-- ── THE HOLE, MEASURED ON THE LIVE PROJECT ────────────────────────────────
--
-- `rpc_homework_submit` records the PATH of an object in `academic-files`. The
-- bytes live in storage, and the bucket's own policies (20260731160000, still
-- live) let a signed-in user UPDATE and DELETE any object under their folder:
--   "academic files update own"   USING (bucket_id = 'academic-files'
--   "academic files delete own"          AND (storage.foldername(name))[1] = auth.uid()::text)
-- A storage upsert is an UPDATE. So a student could hand in a file and then
-- overwrite it, or delete it — after the deadline, after the teacher accepted
-- it — and the submission would still name a file that is now something else,
-- or nothing. A teacher could do the same to the question file behind
-- published homework.
--
-- ── THE RULE ──────────────────────────────────────────────────────────────
--
-- A file the homework model points at is fixed: no UPDATE and no DELETE through
-- the API, by anyone.
--   * `homework_submissions.file`, whatever the submission's status;
--   * `homework.question_file`, deleted homework included — the trash restores
--     homework, and it must come back with its question.
-- Replacing is still possible exactly where the model allows it. The student
-- uploads a NEW file and hands it in again before the deadline, and
-- `rpc_homework_submit` points the row at the new path; a teacher edits the
-- question to a new file. The old object is then referenced by nothing, and is
-- its owner's to delete again.
--
-- `homework_file_is_fixed(name)` decides it, in one place. SECURITY DEFINER
-- because a storage policy runs as the caller and the question is about rows
-- the caller may not be able to read (a teacher's question file behind
-- homework of a class they no longer teach). It answers only for the caller's
-- own folder, so called directly it reveals nothing about anyone else's files.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX homework_submissions_file_path_idx
  ON public.homework_submissions ((file->>'path')) WHERE file IS NOT NULL;
CREATE INDEX homework_question_file_path_idx
  ON public.homework ((question_file->>'path')) WHERE question_file IS NOT NULL;

CREATE FUNCTION public.homework_file_is_fixed(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT split_part(_object_name, '/', 1) = auth.uid()::text
     AND (EXISTS (SELECT 1 FROM public.homework_submissions WHERE file->>'path' = _object_name)
          OR EXISTS (SELECT 1 FROM public.homework WHERE question_file->>'path' = _object_name))
$$;

COMMENT ON FUNCTION public.homework_file_is_fixed(text) IS
  'True when an object in the caller''s own academic-files folder is a handed-in homework file or a homework question file. The storage UPDATE and DELETE policies refuse such an object, so what was handed in cannot change after it is. Answers false for anyone else''s folder.';

-- A function created in public executes for service_role alone by default
-- (pg_default_acl, measured on the live project). The two policies run as the
-- signed-in caller, so authenticated needs it; anon has no storage write policy.
GRANT EXECUTE ON FUNCTION public.homework_file_is_fixed(text) TO authenticated;

DROP POLICY "academic files update own" ON storage.objects;
CREATE POLICY "academic files update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'academic-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT public.homework_file_is_fixed(name)
  );

DROP POLICY "academic files delete own" ON storage.objects;
CREATE POLICY "academic files delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'academic-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT public.homework_file_is_fixed(name)
  );

-- ── Proof ─────────────────────────────────────────────────────────────────
-- One savepoint that always ends by raising P0999, so nothing below survives.
-- Deletes set `storage.allow_delete_query`, as the Storage API does: the live
-- project refuses any other direct DELETE on storage.objects outright
-- (storage.protect_delete), which would prove nothing about the policy.
DO $verify$
DECLARE
  _school uuid; _class uuid; _teacher uuid; _u uuid;
  _hw uuid; _handed text; _again text; _free text; _q text; _tfree text; _n int;
BEGIN
BEGIN
  SELECT s.school_id, s.class_id, s.user_id, t.user_id
    INTO _school, _class, _u, _teacher
    FROM public.students s
    JOIN public.teacher_classes tc ON tc.class_id = s.class_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = s.school_id
   WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
     AND (SELECT count(*) FROM public.students x WHERE x.user_id = s.user_id AND x.deleted_at IS NULL) = 1
   LIMIT 1;
  IF _u IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a signed-in student with a signed-in teacher of their class';
  END IF;

  _handed := _u::text || '/verify-20260925140000-handed.pdf';
  _again  := _u::text || '/verify-20260925140000-again.pdf';
  _free   := _u::text || '/verify-20260925140000-free.pdf';
  _q      := _teacher::text || '/verify-20260925140000-question.pdf';
  _tfree  := _teacher::text || '/verify-20260925140000-spare.pdf';
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('academic-files', _handed), ('academic-files', _again), ('academic-files', _free),
         ('academic-files', _q), ('academic-files', _tfree);
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  -- The teacher publishes homework whose question is a file.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.homework (school_id, class_id, subject, title, question_file, closes_at, status)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925140000] fixed files',
          jsonb_build_object('path', _q, 'name', 'question.pdf', 'mime', 'application/pdf'),
          now() + interval '1 day', 'published')
  RETURNING id INTO _hw;

  -- 1. The question file behind it cannot be overwritten or deleted…
  UPDATE storage.objects SET metadata = '{"swapped": true}'::jsonb WHERE bucket_id = 'academic-files' AND name = _q;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 0 THEN RAISE EXCEPTION 'ROLLED BACK: a teacher overwrote the question file behind published homework'; END IF;
  DELETE FROM storage.objects WHERE bucket_id = 'academic-files' AND name = _q;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 0 THEN RAISE EXCEPTION 'ROLLED BACK: a teacher deleted the question file behind published homework'; END IF;
  --    …while the teacher's file that nothing points at still can (positive control).
  DELETE FROM storage.objects WHERE bucket_id = 'academic-files' AND name = _tfree;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 1 THEN RAISE EXCEPTION 'ROLLED BACK: a teacher could not delete their own unreferenced file (% rows)', _n; END IF;
  RESET ROLE;

  -- 2. The student hands in one file, and then can neither overwrite it nor
  --    delete it; their own file that nothing points at, they can.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_homework_submit(_hw, jsonb_build_object('path', _handed, 'name', 'work.pdf', 'mime', 'application/pdf'));

  UPDATE storage.objects SET metadata = '{"swapped": true}'::jsonb WHERE bucket_id = 'academic-files' AND name = _handed;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 0 THEN RAISE EXCEPTION 'ROLLED BACK: a student overwrote the file they had handed in'; END IF;
  DELETE FROM storage.objects WHERE bucket_id = 'academic-files' AND name = _handed;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 0 THEN RAISE EXCEPTION 'ROLLED BACK: a student deleted the file they had handed in'; END IF;

  UPDATE storage.objects SET metadata = '{"renamed": true}'::jsonb WHERE bucket_id = 'academic-files' AND name = _free;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 1 THEN RAISE EXCEPTION 'ROLLED BACK: a student could not update their own unreferenced file (% rows)', _n; END IF;
  DELETE FROM storage.objects WHERE bucket_id = 'academic-files' AND name = _free;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 1 THEN RAISE EXCEPTION 'ROLLED BACK: a student could not delete their own unreferenced file (% rows)', _n; END IF;

  -- 3. Handing in again before the deadline fixes the new file and releases
  --    the old one.
  PERFORM public.rpc_homework_submit(_hw, jsonb_build_object('path', _again, 'name', 'work-2.pdf', 'mime', 'application/pdf'));
  DELETE FROM storage.objects WHERE bucket_id = 'academic-files' AND name = _again;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 0 THEN RAISE EXCEPTION 'ROLLED BACK: a student deleted the file they had handed in again'; END IF;
  DELETE FROM storage.objects WHERE bucket_id = 'academic-files' AND name = _handed;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 1 THEN RAISE EXCEPTION 'ROLLED BACK: the file a student replaced stayed fixed (% rows deleted)', _n; END IF;

  -- 4. Called directly, the helper answers for the caller's own file and says
  --    nothing about another person's folder.
  IF NOT public.homework_file_is_fixed(_again) THEN
    RESET ROLE;
    RAISE EXCEPTION 'ROLLED BACK: homework_file_is_fixed did not recognise the caller''s own handed-in file';
  END IF;
  IF public.homework_file_is_fixed(_q) THEN
    RESET ROLE;
    RAISE EXCEPTION 'ROLLED BACK: homework_file_is_fixed answered for a folder that is not the caller''s';
  END IF;
  RESET ROLE;

  IF (SELECT metadata FROM storage.objects WHERE bucket_id = 'academic-files' AND name = _again) IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'academic-files' AND name = _q) THEN
    RAISE EXCEPTION 'ROLLED BACK: a fixed file changed';
  END IF;
  IF has_function_privilege('anon', 'public.homework_file_is_fixed(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLED BACK: anon can execute homework_file_is_fixed';
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
EXCEPTION WHEN SQLSTATE 'P0999' THEN
  NULL;
END;

  IF EXISTS (SELECT 1 FROM public.homework WHERE title LIKE '[verify 20260925140000]%')
     OR EXISTS (SELECT 1 FROM storage.objects WHERE name LIKE '%/verify-20260925140000-%') THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  RAISE NOTICE 'verify OK: a handed-in file and a question file cannot be overwritten or deleted; an unreferenced own file can; handing in again releases the old file; the helper answers only for the caller''s own folder — and nothing it did survived';
END
$verify$;
