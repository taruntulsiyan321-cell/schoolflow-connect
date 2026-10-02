-- ═══════════════════════════════════════════════════════════════════════════
-- A STUDENT MARKS WHY A QUESTION WENT WRONG
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ruled by the owner 2026-10-02. After a practice session the student can mark
-- any question — wrong, skipped or right-by-a-guess — with tags saying why
-- ("Conceptual gap", "Formula error", "Recall", …), a text note of up to 500
-- characters and a voice note of up to 60 seconds. A question they forgot to
-- mark there can be marked, re-marked or unmarked from the Mistake Book, and a
-- screen of its own groups every marked question by tag.
--
--   public.mark_tags       the tags a student can choose, in groups. Rows,
--                          not code: a tag is added with an INSERT, retired
--                          with active = false (never deleted — a mark that
--                          carries it keeps it, but nobody can newly pick it).
--   public.question_marks  ONE mark per student per question. The question is
--                          a bank question, an uploaded one or a captured one —
--                          exactly one — and question_ref is whichever it is,
--                          so the result screen and the Mistake Book find the
--                          same mark for the same question.
--   question-voice-notes   a private bucket, one folder per account.
--
-- REMOVED: student_mistakes.error_type. It was this feature's first draft — one
-- value per mistake, from concept_error / calculation_error / careless_mistake /
-- time_pressure_error / misinterpretation_error — and nothing ever wrote it:
-- NULL on all 351 rows (measured 2026-10-02). One value cannot carry several
-- reasons, and a question answered right by a guess has no mistake row to put
-- it on. Its one reader, rpc_refresh_academic_brain, filed every mistake under
-- "unknown" in mistake_classification_trends and again under
-- mistake_history.by_error_type; it now reads the tags students actually chose,
-- once, and by_error_type (a copy of the same count) is gone.
--
-- The limits live here and in src/lib/questionMarks.ts (NOTE_MAX_CHARS,
-- VOICE_MAX_SECONDS); questionMarks.test.ts reads this file and fails if the two
-- disagree.
--
-- ROLLBACK: rollback/20261137000000_a_student_marks_why_a_question_went_wrong.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The tags ────────────────────────────────────────────────────────────
CREATE TABLE public.mark_tags (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z_]{1,39}$'),
  label       text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  group_label text NOT NULL CHECK (char_length(btrim(group_label)) BETWEEN 1 AND 40),
  position    smallint NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.mark_tags IS
  'Tags a student can put on a question (20261137000000). Groups appear in the order of their first tag. Retire a tag with active = false; never delete one.';

INSERT INTO public.mark_tags (key, label, group_label, position) VALUES
  ('conceptual_gap',    'Conceptual gap',       'Understanding',   1),
  ('wrong_approach',    'Wrong approach',       'Understanding',   2),
  ('recall',            'Recall',               'Memory',          3),
  ('formula_error',     'Formula error',        'Memory',          4),
  ('calculation_error', 'Calculation error',    'Working it out',  5),
  ('misread_question',  'Misread the question', 'Working it out',  6),
  ('silly_mistake',     'Silly mistake',        'Working it out',  7),
  ('time_pressure',     'Time pressure',        'Exam conditions', 8),
  ('guessed',           'Guessed',              'Exam conditions', 9);

ALTER TABLE public.mark_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY mark_tags_read ON public.mark_tags
  FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON public.mark_tags FROM anon, authenticated;
GRANT SELECT ON public.mark_tags TO authenticated;

-- ── 2. The marks ───────────────────────────────────────────────────────────
CREATE TABLE public.question_marks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_question_id    uuid REFERENCES public.question_bank(id) ON DELETE CASCADE,
  upload_question_id  uuid REFERENCES public.student_upload_questions(id) ON DELETE CASCADE,
  capture_question_id uuid REFERENCES public.student_capture_questions(id) ON DELETE CASCADE,
  question_ref        uuid GENERATED ALWAYS AS (COALESCE(bank_question_id, upload_question_id, capture_question_id)) STORED,
  -- What the student saw, so the tag screen can list it without three lookups.
  question_text       text NOT NULL CHECK (char_length(btrim(question_text)) BETWEEN 1 AND 10000),
  subject             text,
  chapter             text,
  tags                text[] NOT NULL DEFAULT '{}',
  note                text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  voice_path          text,
  voice_seconds       smallint CHECK (voice_seconds IS NULL OR voice_seconds BETWEEN 1 AND 60),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_marks_one_question
    CHECK (num_nonnulls(bank_question_id, upload_question_id, capture_question_id) = 1),
  CONSTRAINT question_marks_voice_pair
    CHECK ((voice_path IS NULL) = (voice_seconds IS NULL)),
  CONSTRAINT question_marks_voice_own_folder
    CHECK (voice_path IS NULL OR split_part(voice_path, '/', 1) = user_id::text),
  -- An empty mark is no mark: unmarking deletes the row.
  CONSTRAINT question_marks_not_empty
    CHECK (cardinality(tags) > 0 OR note IS NOT NULL OR voice_path IS NOT NULL),
  CONSTRAINT question_marks_one_per_question UNIQUE (user_id, question_ref)
);

-- The ON DELETE CASCADE lookups.
CREATE INDEX question_marks_bank_idx    ON public.question_marks (bank_question_id)    WHERE bank_question_id IS NOT NULL;
CREATE INDEX question_marks_upload_idx  ON public.question_marks (upload_question_id)  WHERE upload_question_id IS NOT NULL;
CREATE INDEX question_marks_capture_idx ON public.question_marks (capture_question_id) WHERE capture_question_id IS NOT NULL;

COMMENT ON TABLE public.question_marks IS
  'Why a student says a question went wrong: tags, a note, a voice note (20261137000000). One row per student per question; an empty mark is deleted, not stored.';
COMMENT ON COLUMN public.question_marks.voice_path IS
  'Object key in the private question-voice-notes bucket, {user_id}/{file}. The client removes the file when the mark loses it.';

-- Tags arrive de-duplicated, known, and in the catalogue's order; a blank note
-- is no note. A retired tag may stay on a mark that already has it, but cannot
-- be newly chosen. SECURITY INVOKER: it reads mark_tags as the student.
CREATE FUNCTION public._question_marks_normalise()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  _kept   text[] := CASE WHEN TG_OP = 'UPDATE' THEN OLD.tags ELSE '{}'::text[] END;
  _known  text[];
  _wanted int;
BEGIN
  NEW.note := NULLIF(btrim(NEW.note), '');
  SELECT count(DISTINCT t) INTO _wanted FROM unnest(NEW.tags) t;
  SELECT COALESCE(array_agg(k.key ORDER BY k.position), '{}'::text[])
    INTO _known
    FROM public.mark_tags k
   WHERE k.key = ANY (NEW.tags)
     AND (k.active OR k.key = ANY (_kept));
  IF cardinality(_known) <> _wanted THEN
    RAISE EXCEPTION 'unknown or retired mark tag in %', NEW.tags USING ERRCODE = '22023';
  END IF;
  NEW.tags := _known;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION public._question_marks_normalise() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER question_marks_normalise
  BEFORE INSERT OR UPDATE ON public.question_marks
  FOR EACH ROW EXECUTE FUNCTION public._question_marks_normalise();

ALTER TABLE public.question_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY question_marks_owner ON public.question_marks
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.question_marks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_marks TO authenticated;

-- ── 3. Voice notes: private, one folder per account ─────────────────────────
-- 60 seconds at the 32 kbit/s the app records is ~240 KB; 2 MB is the backstop
-- for a browser that ignores the requested bit rate.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'question-voice-notes',
  'question-voice-notes',
  false,
  2097152,
  ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "question voice notes read own" ON storage.objects;
DROP POLICY IF EXISTS "question voice notes insert own" ON storage.objects;
DROP POLICY IF EXISTS "question voice notes delete own" ON storage.objects;

-- No UPDATE policy: a recording is never changed, only replaced.
CREATE POLICY "question voice notes read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'question-voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "question voice notes insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'question-voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "question voice notes delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'question-voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── 4. The first draft goes ────────────────────────────────────────────────
ALTER TABLE public.student_mistakes DROP COLUMN error_type;

-- ── 5. Its reader reads the marks ───────────────────────────────────────────
-- Unchanged but for two places: mistake_history loses by_error_type, and
-- mistake_classification_trends counts the tags students chose.
CREATE OR REPLACE FUNCTION public.rpc_refresh_academic_brain()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _sid uuid;
  _weak_concepts jsonb;
  _weak_chapters jsonb;
  _weak_subjects jsonb;
  _mistake_hist jsonb; _recovery_hist jsonb; _practice_hist jsonb;
  _mastery_snap jsonb; _class_trends jsonb;
  _recovery_pct numeric; _improve_trend text;
  _total_act int; _prev_score numeric; _curr_score numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'concept', concept, 'subject', subject, 'chapter', chapter,
    'mastery_score', mastery_score, 'mistake_count', mistake_count
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
  INTO _weak_concepts
  FROM public.concept_mastery
  WHERE user_id = _uid AND mastery_score < 60
  LIMIT 15;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY avg_mastery ASC), '[]'::jsonb)
  INTO _weak_chapters
  FROM (
    SELECT jsonb_build_object(
      'chapter', chapter, 'subject', subject,
      'avg_mastery', round(avg(mastery_score)::numeric, 1)
    ) AS row_data, round(avg(mastery_score)::numeric, 1) AS avg_mastery
    FROM public.concept_mastery
    WHERE user_id = _uid AND chapter IS NOT NULL
    GROUP BY chapter, subject
    HAVING avg(mastery_score) < 55
    ORDER BY avg(mastery_score) ASC
    LIMIT 8
  ) wc;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY avg_mastery ASC), '[]'::jsonb)
  INTO _weak_subjects
  FROM (
    SELECT jsonb_build_object(
      'subject', subject, 'avg_mastery', round(avg(mastery_score)::numeric, 1)
    ) AS row_data, round(avg(mastery_score)::numeric, 1) AS avg_mastery
    FROM public.concept_mastery WHERE user_id = _uid
    GROUP BY subject
    HAVING avg(mastery_score) < 55
    ORDER BY avg(mastery_score) ASC
    LIMIT 5
  ) ws;

  SELECT jsonb_build_object(
    'total_mistakes', count(*),
    'unmastered', count(*) FILTER (WHERE status = 'open'),
    'by_subject', COALESCE((
      SELECT jsonb_object_agg(subject, cnt)
      FROM (SELECT subject, count(*) cnt FROM public.student_mistakes
            WHERE user_id = _uid GROUP BY subject) s
    ), '{}'::jsonb),
    'recent_7d', count(*) FILTER (WHERE last_wrong_at >= now() - interval '7 days')
  )
  INTO _mistake_hist FROM public.student_mistakes WHERE user_id = _uid;

  SELECT jsonb_build_object(
    'total_rounds', count(*),
    'cleared', count(*) FILTER (WHERE outcome = 'ready'),
    'open', count(*) FILTER (WHERE completed_at IS NULL),
    'avg_readiness', round(COALESCE(avg(readiness) * 100, 0), 1)
  )
  INTO _recovery_hist FROM public.recovery_sessions WHERE user_id = _uid;

  SELECT jsonb_build_object(
    'total_sessions', count(*),
    'avg_score', round(COALESCE(avg(score), 0), 1),
    'avg_accuracy', round(COALESCE(
      avg(CASE WHEN question_count > 0 THEN correct_count::numeric / question_count * 100 END), 0
    ), 1),
    'last_7d_sessions', count(*) FILTER (WHERE finished_at >= now() - interval '7 days')
  )
  INTO _practice_hist FROM public.practice_sessions
  WHERE user_id = _uid AND finished_at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'concept', concept, 'subject', subject, 'chapter', chapter,
    'mastery_score', mastery_score, 'total_attempts', total_attempts,
    'correct_attempts', correct_attempts, 'mistake_count', mistake_count
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
  INTO _mastery_snap FROM public.concept_mastery WHERE user_id = _uid;

  -- How many of the student's marked questions carry each tag.
  SELECT COALESCE(jsonb_object_agg(tag, cnt), '{}'::jsonb)
  INTO _class_trends
  FROM (
    SELECT t AS tag, count(*) cnt
    FROM public.question_marks qm, unnest(qm.tags) t
    WHERE qm.user_id = _uid
    GROUP BY t
  ) t;

  _recovery_pct := COALESCE((_recovery_hist->>'avg_readiness')::numeric, 0);

  SELECT avg(mastery_score) INTO _curr_score
  FROM public.concept_mastery WHERE user_id = _uid
    AND last_attempt_at >= now() - interval '7 days';
  SELECT avg(mastery_score) INTO _prev_score
  FROM public.concept_mastery WHERE user_id = _uid
    AND last_attempt_at >= now() - interval '14 days'
    AND last_attempt_at < now() - interval '7 days';

  _improve_trend := CASE
    WHEN _curr_score IS NULL OR _prev_score IS NULL THEN 'steady'
    WHEN _curr_score > _prev_score + 3 THEN 'improving'
    WHEN _curr_score < _prev_score - 3 THEN 'slipping'
    ELSE 'steady'
  END;

  SELECT (
    COALESCE((SELECT count(*) FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL), 0) +
    COALESCE((SELECT count(*) FROM public.student_mistakes WHERE user_id = _uid), 0)
  ) INTO _total_act;

  INSERT INTO public.student_academic_brain (
    user_id, student_id,
    weak_subjects, weak_chapters,
    weak_concepts,
    mistake_history, recovery_history, practice_history,
    speed_trend, accuracy_trend, consistency_trend,
    mastery_snapshot, mistake_classification_trends,
    recovery_completion_pct, improvement_trend, total_activities, updated_at
  ) VALUES (
    _uid, _sid,
    COALESCE(_weak_subjects, '[]'::jsonb),
    COALESCE(_weak_chapters, '[]'::jsonb),
    COALESCE(_weak_concepts, '[]'::jsonb),
    COALESCE(_mistake_hist, '{}'::jsonb),
    COALESCE(_recovery_hist, '{}'::jsonb),
    COALESCE(_practice_hist, '{}'::jsonb),
    jsonb_build_object('avg_ms_per_question', (
      SELECT round(avg(time_taken_ms)::numeric, 0)
      FROM public.question_attempts
      WHERE user_id = _uid AND time_taken_ms IS NOT NULL AND NOT skipped
    )),
    jsonb_build_object(
      'last_session', (_practice_hist->>'avg_accuracy')::numeric,
      'rolling_7d', (_practice_hist->>'avg_accuracy')::numeric
    ),
    jsonb_build_object(
      'sessions_7d', (_practice_hist->>'last_7d_sessions')::int,
      'mistakes_7d', (_mistake_hist->>'recent_7d')::int
    ),
    COALESCE(_mastery_snap, '[]'::jsonb),
    COALESCE(_class_trends, '{}'::jsonb),
    _recovery_pct, _improve_trend, _total_act, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    student_id = EXCLUDED.student_id,
    weak_subjects = EXCLUDED.weak_subjects,
    weak_chapters = EXCLUDED.weak_chapters,
    weak_concepts = EXCLUDED.weak_concepts,
    mistake_history = EXCLUDED.mistake_history,
    recovery_history = EXCLUDED.recovery_history,
    practice_history = EXCLUDED.practice_history,
    speed_trend = EXCLUDED.speed_trend,
    accuracy_trend = EXCLUDED.accuracy_trend,
    consistency_trend = EXCLUDED.consistency_trend,
    mastery_snapshot = EXCLUDED.mastery_snapshot,
    mistake_classification_trends = EXCLUDED.mistake_classification_trends,
    recovery_completion_pct = EXCLUDED.recovery_completion_pct,
    improvement_trend = EXCLUDED.improvement_trend,
    total_activities = EXCLUDED.total_activities,
    updated_at = now();

  RETURN (SELECT to_jsonb(b) FROM public.student_academic_brain b WHERE b.user_id = _uid);
END; $function$;

-- ── VERIFY: the shape (must be able to fail) ────────────────────────────────
DO $verify$
DECLARE
  _src text;
BEGIN
  IF (SELECT count(*) FROM public.mark_tags WHERE active) <> 9 THEN
    RAISE EXCEPTION 'VERIFY FAILED: expected the 9 ruled tags';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.question_marks'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mark_tags'::regclass) THEN
    RAISE EXCEPTION 'VERIFY FAILED: row level security is off on a new table';
  END IF;
  IF has_table_privilege('anon', 'public.question_marks', 'SELECT')
     OR has_table_privilege('anon', 'public.mark_tags', 'SELECT')
     OR has_table_privilege('authenticated', 'public.mark_tags', 'INSERT') THEN
    RAISE EXCEPTION 'VERIFY FAILED: a grant is wider than ruled';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.question_marks', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: students cannot keep their own marks';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets
                  WHERE id = 'question-voice-notes' AND public = false AND file_size_limit = 2097152) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the voice-note bucket is missing, public or uncapped';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname LIKE 'question voice notes %'
         AND coalesce(qual, with_check) LIKE '%foldername%auth.uid()%') <> 3 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the voice-note bucket is not fenced to the owner''s folder';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'student_mistakes' AND column_name = 'error_type') THEN
    RAISE EXCEPTION 'VERIFY FAILED: student_mistakes.error_type is still there';
  END IF;
  SELECT prosrc INTO _src FROM pg_proc WHERE oid = 'public.rpc_refresh_academic_brain()'::regprocedure;
  IF _src ~ 'error_type' OR _src !~ 'question_marks' THEN
    RAISE EXCEPTION 'VERIFY FAILED: the academic brain does not read the marks';
  END IF;
END $verify$;

-- ── PROOF: as real students, rolled back ────────────────────────────────────
-- Variables survive the sub-transaction's rollback; the rows do not.
DO $proof$
DECLARE
  _a uuid; _b uuid; _q uuid; _qt text;
  _fail text := '';
  _n int; _tags text[]; _note text; _brain jsonb;
  _sentinel constant text := 'm20261137 proof rolled back';
BEGIN
  -- A: an individual exam account with a practice mistake on a bank question.
  SELECT m.user_id, m.question_id, m.question_text INTO _a, _q, _qt
    FROM public.student_mistakes m
    JOIN public.memberships ms ON ms.account_id = m.user_id
    JOIN public.schools s ON s.id = ms.school_id AND s.kind = 'individual'
   WHERE m.source = 'practice' AND m.question_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.question_bank b WHERE b.id = m.question_id)
   ORDER BY m.last_wrong_at DESC, m.id
   LIMIT 1;
  SELECT ms.account_id INTO _b
    FROM public.memberships ms
    JOIN public.schools s ON s.id = ms.school_id AND s.kind = 'individual'
   WHERE ms.account_id <> _a
   ORDER BY ms.account_id
   LIMIT 1;
  IF _a IS NULL OR _b IS NULL THEN
    RAISE EXCEPTION 'PROOF FAILED: no fixture (an exam account with a bank mistake, and a second exam account)';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- 1. Tags arrive de-duplicated, in the catalogue's order; a blank note is none.
    INSERT INTO public.question_marks (bank_question_id, question_text, tags, note)
    VALUES (_q, _qt, ARRAY['silly_mistake', 'conceptual_gap', 'conceptual_gap'], '   ');
    SELECT tags, note INTO _tags, _note FROM public.question_marks WHERE question_ref = _q;
    IF _tags IS DISTINCT FROM ARRAY['conceptual_gap', 'silly_mistake'] OR _note IS NOT NULL THEN
      _fail := _fail || format(' [1 normalised: %s / %s]', _tags, _note);
    END IF;

    -- 2. The same question again is the same mark, changed.
    INSERT INTO public.question_marks (bank_question_id, question_text, tags, note)
    VALUES (_q, _qt, ARRAY['formula_error'], 'Used the simple-interest formula')
    ON CONFLICT (user_id, question_ref) DO UPDATE SET tags = EXCLUDED.tags, note = EXCLUDED.note;
    SELECT count(*), max(tags::text) INTO _n, _note FROM public.question_marks WHERE question_ref = _q;
    IF _n <> 1 OR _note <> '{formula_error}' THEN
      _fail := _fail || format(' [2 one mark per question: %s rows, %s]', _n, _note);
    END IF;

    -- 3. Refusals, each beside an accepted twin (the positive control).
    BEGIN
      UPDATE public.question_marks SET tags = ARRAY['not_a_tag'] WHERE question_ref = _q;
      _fail := _fail || ' [3a unknown tag accepted]';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
      UPDATE public.question_marks SET tags = '{}', note = NULL WHERE question_ref = _q;
      _fail := _fail || ' [3b empty mark stored]';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      UPDATE public.question_marks SET note = repeat('x', 501) WHERE question_ref = _q;
      _fail := _fail || ' [3c 501-character note stored]';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE public.question_marks SET note = repeat('x', 500) WHERE question_ref = _q;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n <> 1 THEN _fail := _fail || ' [3c control: a 500-character note was refused]'; END IF;
    BEGIN
      UPDATE public.question_marks SET voice_path = _b::text || '/x.webm', voice_seconds = 10 WHERE question_ref = _q;
      _fail := _fail || ' [3d voice note in another student''s folder]';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      UPDATE public.question_marks SET voice_path = _a::text || '/x.webm', voice_seconds = 61 WHERE question_ref = _q;
      _fail := _fail || ' [3e 61-second voice note]';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE public.question_marks SET voice_path = _a::text || '/x.webm', voice_seconds = 60 WHERE question_ref = _q;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n <> 1 THEN _fail := _fail || ' [3e control: a 60-second voice note was refused]'; END IF;
    BEGIN
      UPDATE public.question_marks SET voice_path = NULL WHERE question_ref = _q;
      _fail := _fail || ' [3f seconds kept without a recording]';
    EXCEPTION WHEN check_violation THEN NULL; END;

    -- 4. A retired tag stays where it is, and cannot be newly chosen.
    EXECUTE 'RESET ROLE';
    UPDATE public.mark_tags SET active = false WHERE key IN ('formula_error', 'guessed');
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE public.question_marks SET note = 'still here' WHERE question_ref = _q;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n <> 1 THEN _fail := _fail || ' [4 a retired tag broke its mark]'; END IF;
    BEGIN
      UPDATE public.question_marks SET tags = ARRAY['formula_error', 'guessed'] WHERE question_ref = _q;
      _fail := _fail || ' [4 a retired tag was newly chosen]';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    EXECUTE 'RESET ROLE';
    UPDATE public.mark_tags SET active = true WHERE key IN ('formula_error', 'guessed');
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- 5. The academic brain counts the tags chosen, once.
    _brain := public.rpc_refresh_academic_brain();
    IF _brain->'mistake_classification_trends' IS DISTINCT FROM '{"formula_error": 1}'::jsonb THEN
      _fail := _fail || ' [5 trends: ' || coalesce(_brain->>'mistake_classification_trends', 'null') || ']';
    END IF;
    IF _brain->'mistake_history' ? 'by_error_type' OR NOT (_brain->'mistake_history' ? 'total_mistakes') THEN
      _fail := _fail || ' [5 mistake_history shape]';
    END IF;

    -- 6. The voice-note folder is the student's own.
    INSERT INTO storage.objects (bucket_id, name) VALUES ('question-voice-notes', _a::text || '/proof.webm');
    BEGIN
      INSERT INTO storage.objects (bucket_id, name) VALUES ('question-voice-notes', _b::text || '/proof.webm');
      _fail := _fail || ' [6 wrote into another student''s folder]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;

    -- 7. Another student sees none of it and cannot reach it.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO _n FROM public.question_marks WHERE question_ref = _q;
    IF _n <> 0 THEN _fail := _fail || ' [7 another student reads the mark]'; END IF;
    UPDATE public.question_marks SET note = 'not yours' WHERE question_ref = _q;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n <> 0 THEN _fail := _fail || ' [7 another student changed the mark]'; END IF;
    BEGIN
      INSERT INTO public.question_marks (user_id, bank_question_id, question_text, tags)
      VALUES (_a, _q, _qt, ARRAY['recall']);
      _fail := _fail || ' [7 another student wrote a mark as A]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    SELECT count(*) INTO _n FROM storage.objects
     WHERE bucket_id = 'question-voice-notes' AND name = _a::text || '/proof.webm';
    IF _n <> 0 THEN _fail := _fail || ' [7 another student reads the voice note]'; END IF;
    -- Control: B marks the same question for themself, and sees exactly that.
    INSERT INTO public.question_marks (bank_question_id, question_text, tags) VALUES (_q, _qt, ARRAY['recall']);
    SELECT count(*) INTO _n FROM public.question_marks WHERE question_ref = _q;
    IF _n <> 1 THEN _fail := _fail || format(' [7 control: B sees %s marks, not their own one]', _n); END IF;
    SELECT count(*) INTO _n FROM public.mark_tags;
    IF _n <> 9 THEN _fail := _fail || format(' [7 control: a student reads %s tags]', _n); END IF;

    -- Back to A: their own mark and recording, and not B's.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    SELECT count(*), max(note) INTO _n, _note FROM public.question_marks WHERE question_ref = _q;
    IF _n <> 1 OR _note <> 'still here' THEN _fail := _fail || format(' [7 control: A sees %s / %s]', _n, _note); END IF;
    SELECT count(*) INTO _n FROM storage.objects
     WHERE bucket_id = 'question-voice-notes' AND name = _a::text || '/proof.webm';
    IF _n <> 1 THEN _fail := _fail || ' [7 control: A cannot read their own voice note]'; END IF;

    -- 8. Signed out, nothing.
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM 1 FROM public.question_marks LIMIT 1;
      _fail := _fail || ' [8 anon reads marks]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM 1 FROM public.mark_tags LIMIT 1;
      _fail := _fail || ' [8 anon reads tags]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;

    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION USING MESSAGE = _sentinel;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> _sentinel THEN
      RAISE EXCEPTION 'PROOF FAILED (unexpected %): %', SQLSTATE, SQLERRM;
    END IF;
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'PROOF FAILED:%', _fail;
  END IF;
END $proof$;

COMMIT;
