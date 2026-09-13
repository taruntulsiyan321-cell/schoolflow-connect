-- ═══════════════════════════════════════════════════════════════════════════
-- Homework is one question, one file back, and two decisions
--
-- The product owner's specification, 2026-09-13 (docs/gurukul-spec-rules.md,
-- "Homework — RULED 2026-09-13"):
--
--   * The teacher gives a title and the usual fields, and the question is
--     EITHER typed text OR one uploaded file (image, document or PDF).
--   * The teacher chooses the class, sets a DEADLINE, and may schedule it.
--   * THERE IS NO TYPED SUBMISSION. The student attaches ONE FILE — an image or
--     a PDF. Not several.
--   * The homework closes AUTOMATICALLY at the deadline and every student is
--     resolved to submitted or not submitted. Nothing can be submitted after.
--   * The teacher can do EXACTLY TWO things with a submission: accept or
--     reject. No marks, no grades, no remarks. A rejected submission counts as
--     not given.
--
-- Assumptions proceeded on, as the brief allowed, and stated here so they are
-- not mistaken for rulings:
--   * A student may replace their file, or resubmit after a rejection, only
--     while the deadline has not passed. An ACCEPTED submission is final.
--   * A decision is taken on a submission awaiting review. Rejected work goes
--     back to the student; resubmitting it puts it back in front of the teacher.
--   * XP for homework is awarded when the teacher ACCEPTS it, not when it is
--     handed in (see §6).
--
-- ── WHAT THE TABLES HELD, MEASURED ON A REPLICA BUILT FROM EVERY MIGRATION ──
--
-- homework_submissions carried SEVEN statuses (pending, submitted, late,
-- reviewed, returned, graded, completed), four review timestamps, an `is_late`
-- boolean that is only `submitted_at > due`, TWO marks (`grade` text and
-- `marks_obtained` numeric), `teacher_remarks`, a typed `content`, a
-- `version`, and an array of attachments plus external links. Students held an
-- ALL policy on their own row, so the whole review model could be written
-- straight from the browser: a student could set their own status to 'graded'.
--
-- Beside it sat a SECOND digital submission path — `homework_questions` and
-- `homework_answers`, with an autograde trigger — and a THIRD status system,
-- `homework_completions` (completed / not_completed / absent, plus a `comment`
-- remark field), filled by `rpc_close_homework`. None of the three tables has a
-- caller in src/, in any edge function, or in any script. They are deleted,
-- and the migration refuses to run if any of them holds rows.
--
-- The deadline lived in THREE columns: `due_date`, `due_time` and `closes_at`.
-- `closes_at` was read by the lock trigger and `rpc_close_homework` and
-- written by nothing in the app; it had been backfilled as `(due_date + 1)` cast
-- to timestamptz in the SESSION zone, which is UTC on the live project — so
-- homework "due 15 Sep" really closed at 05:30 IST on the 16th, and `due_time`
-- was ignored entirely. The lock trigger also fired only on
-- `UPDATE OF submitted_at, homework_id`, so a student could swap the file after
-- the deadline by updating `attachments`.
--
-- ── THE MODEL ─────────────────────────────────────────────────────────────
--
-- DEADLINE — `closes_at` IS the deadline, timestamptz NOT NULL. Chosen over
--   deleting it: a deadline is an instant, and the one column that already
--   meant "when this closes" is the right home for it. `due_date` becomes a
--   GENERATED column, the deadline's date in school-local time, so the twenty
--   routines and screens that group by date keep reading the column they read.
--   `due_time` is folded in and dropped. The school-local zone has ONE home:
--   `school_local_date()`.
--
-- QUESTION — `description` is the typed question, `question_file` the one
--   uploaded file, and a CHECK enforces one or the other (a draft may have
--   neither yet). `attachments`, `attachment_url` and `instructions` are gone.
--
-- USUAL FIELDS — §10.22 governs them, and it is explicit: "Chapter is picked,
--   never typed", from a list filtered to the teacher's class and subject; the
--   topic is picked from that chapter's topics or added; homework may carry a
--   free-text label where no chapter fits; and the chapter–topic pairing is
--   enforced. So `chapter_id`, `topic_id`, `topics` and
--   `trg_homework_topic_matches_chapter` STAY. They looked dead — nothing wrote
--   them — but they are §10.22's schema, and what was missing was the screen.
--   `topic` stays too, and it is not a duplicate of `topic_id` despite the
--   name: its comment has always said it is the free-text CHAPTER fallback.
--   The class is `class_id` and the subject is `subject`. `section_subject_id`
--   and `subject_id` named those same facts a second and third time, and no
--   homework screen ever wrote either; the chapter list resolves from class and
--   subject through the curriculum tree, as §10.22 says it should.
--
-- SUBMISSION — four statuses, and a CHECK makes each one mean one thing:
--     not_submitted   no file, no submitted_at, no decision
--     submitted       one file, submitted_at, no decision yet
--     accepted        one file, submitted_at, decided_at
--     rejected        one file, submitted_at, decided_at
--   `file` is a single jsonb OBJECT, so two files cannot be stored — that is
--   the structural enforcement, not a length check on an array. Lateness is not
--   stored: nothing can be submitted after `closes_at`, so there is no late.
--
-- WRITES — only through three SECURITY DEFINER functions, and RLS on
--   homework_submissions is now read-only for every role:
--     rpc_homework_submit(homework, file)   the student, before the deadline
--     rpc_homework_decide(submission, accepted|rejected)   a teacher of the class
--     rpc_homework_delete(homework)         soft delete, see 20260925130000
--   Teachers keep writing homework rows directly, but only the columns a
--   teacher sets: `created_by`, `published_at`, `archived_at`, `resolved_at`,
--   `deleted_at` and `deleted_by` are the server's.
--
-- CLOSURE — `resolve_closed_homework()`, pg_cron every minute. For published,
--   undeleted homework past its deadline and not yet resolved, it writes a
--   `not_submitted` row for every current student of the class without one and
--   stamps `resolved_at`. Once only: `resolved_at` freezes the roster, so a
--   student who joins the class after the deadline is not counted as having
--   missed work set before they arrived. Idempotent: a second run finds nothing.
--   Closed homework stays closed (`tg_homework_lifecycle`): its deadline, class
--   and release cannot change — it may be archived, never taken back to draft
--   or scheduled — and nobody signed in can publish or schedule homework whose
--   deadline has already passed.
--
-- ── LEGACY ROWS ───────────────────────────────────────────────────────────
--
-- Every existing row is copied first into `homework_pre_20260925110000` and
-- `homework_submissions_pre_20260925110000`, so the rollback restores data
-- rather than recreating empty columns. Then, deterministically:
--   * a submission with an image/PDF attachment keeps the FIRST one, and its
--     status maps submitted|late → submitted, reviewed|graded|completed →
--     accepted, returned → rejected, pending → not_submitted.
--   * a submission with NO such file becomes not_submitted. Typed submissions
--     do not exist in the specification. Measured: every seeded submission in
--     this database is typed (the demo migrations write `content` and a grade,
--     never a file), so this is where the seeded grades go.
--   * homework with both typed text and a file keeps the TEXT; the file stays
--     in the snapshot.
--   * published or scheduled homework with neither takes its title as the
--     question text — the teacher's own words, not invented ones.
-- The counts of each are raised as NOTICEs when this applies.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Refuse to drop anything that holds data ────────────────────────────

DO $measure$
DECLARE _q int; _a int; _c int; _sched int;
BEGIN
  SELECT count(*) INTO _q FROM public.homework_questions;
  SELECT count(*) INTO _a FROM public.homework_answers;
  SELECT count(*) INTO _c FROM public.homework_completions;
  IF _q + _a + _c > 0 THEN
    RAISE EXCEPTION 'ABORT: tables believed dead hold rows (homework_questions=%, homework_answers=%, homework_completions=%). Re-measure before deleting them.', _q, _a, _c;
  END IF;

  -- A scheduled row whose release is not before its deadline cannot be
  -- represented; picking a deadline for the teacher is not this migration's
  -- decision.
  SELECT count(*) INTO _sched
    FROM public.homework
   WHERE status = 'scheduled' AND scheduled_publish_at IS NOT NULL
     AND scheduled_publish_at >= ((due_date + coalesce(due_time, '23:59:59'::time)) AT TIME ZONE 'Asia/Kolkata');
  IF _sched > 0 THEN
    RAISE EXCEPTION 'ABORT: % scheduled homework row(s) go out on or after their own deadline. Fix the dates, then apply.', _sched;
  END IF;
END
$measure$;

-- ── 1. Snapshots, so the rollback has something to restore ────────────────

CREATE TABLE public.homework_pre_20260925110000 AS SELECT * FROM public.homework;
CREATE TABLE public.homework_submissions_pre_20260925110000 AS SELECT * FROM public.homework_submissions;
-- `CREATE TABLE AS` keeps the enum type, and the enum is dropped below. As
-- text the value is identical and the snapshot no longer holds the type alive.
ALTER TABLE public.homework_pre_20260925110000
  ALTER COLUMN submission_mode TYPE text USING submission_mode::text;
ALTER TABLE public.homework_pre_20260925110000 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submissions_pre_20260925110000 ENABLE ROW LEVEL SECURITY;
-- A new table in public is granted ALL to anon and authenticated by default.
REVOKE ALL ON public.homework_pre_20260925110000 FROM anon, authenticated;
REVOKE ALL ON public.homework_submissions_pre_20260925110000 FROM anon, authenticated;
COMMENT ON TABLE public.homework_pre_20260925110000 IS
  'Rollback source for 20260925110000: every homework row as it was before the one-file model. No policy and no grant to anon or authenticated — no signed-in user reads it. Drop once that deployment is accepted.';
COMMENT ON TABLE public.homework_submissions_pre_20260925110000 IS
  'Rollback source for 20260925110000: every submission as it was, including the typed content, grades and remarks the new model has no place for. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

-- The data transformation below must not fan out an event, an audit row and a
-- notification per legacy row; both emitters are rewritten further down.
-- Nor is reshaping a row an edit: `updated_at` keeps meaning "last changed by a
-- person or a job", and the rollback relies on it — a row whose `updated_at`
-- still equals its snapshot's has not been touched since, and comes back
-- exactly as it was.
ALTER TABLE public.homework DISABLE TRIGGER trg_emit_homework_event;
ALTER TABLE public.homework DISABLE TRIGGER homework_set_updated;
ALTER TABLE public.homework_submissions DISABLE TRIGGER trg_emit_homework_submission_event;
ALTER TABLE public.homework_submissions DISABLE TRIGGER hw_sub_set_updated;

-- ── 2. The dead paths go ──────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.rpc_close_homework(uuid, boolean);
DROP TABLE public.homework_answers;
DROP TABLE public.homework_questions;
DROP TABLE public.homework_completions;
DROP TYPE public.homework_completion_status;
DROP FUNCTION IF EXISTS public.tg_homework_answer_autograde();
DROP FUNCTION IF EXISTS public.tg_homework_answer_topic_matches_chapter();
DROP FUNCTION IF EXISTS public.tg_homework_compute_is_late();

DROP TRIGGER IF EXISTS trg_homework_submission_lock ON public.homework_submissions;
DROP FUNCTION IF EXISTS public.tg_homework_submission_lock_at_due();
DROP TRIGGER IF EXISTS trg_homework_submission_student_guard ON public.homework_submissions;
DROP FUNCTION IF EXISTS public.tg_homework_submission_student_guard();

-- ── 3. Homework: the deadline ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.school_local_date(_at timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT (_at AT TIME ZONE 'Asia/Kolkata')::date $$;

COMMENT ON FUNCTION public.school_local_date(timestamptz) IS
  'The calendar date of an instant in school-local time. The single home for the school time zone: schools carry no zone column, and every school on this platform keeps IST. Change the zone here and every generated date follows.';

UPDATE public.homework
   SET closes_at = ((due_date + coalesce(due_time, '23:59:59'::time)) AT TIME ZONE 'Asia/Kolkata');
ALTER TABLE public.homework ALTER COLUMN closes_at SET NOT NULL;

-- Three indexes led with due_date: `homework_due_date_idx` and
-- `idx_homework_school_due` were the same (school_id, due_date) index twice, and
-- `idx_homework_due` indexed the date across every school, which no query does.
-- Dropping the column takes all three; one (school_id, due_date) comes back.
DROP INDEX IF EXISTS public.homework_due_date_idx;
ALTER TABLE public.homework DROP COLUMN due_date;
ALTER TABLE public.homework DROP COLUMN due_time;
ALTER TABLE public.homework
  ADD COLUMN due_date date GENERATED ALWAYS AS (public.school_local_date(closes_at)) STORED;
CREATE INDEX homework_due_date_idx ON public.homework (school_id, due_date);

ALTER TABLE public.homework ADD COLUMN resolved_at timestamptz;
CREATE INDEX homework_awaiting_resolution_idx ON public.homework (closes_at)
  WHERE resolved_at IS NULL AND deleted_at IS NULL AND status = 'published';

COMMENT ON COLUMN public.homework.closes_at IS
  'THE deadline. Nothing can be submitted at or after it, and resolve_closed_homework() resolves every student once it has passed.';
COMMENT ON COLUMN public.homework.due_date IS
  'Generated: the deadline''s date in school-local time. Read it; write closes_at.';
COMMENT ON COLUMN public.homework.resolved_at IS
  'When resolve_closed_homework() gave every student of the class a final row. NULL until then. Freezes who the homework was set to.';

-- ── 4. Homework: the question, and the usual fields ───────────────────────

-- What a file may be has ONE home each: the teacher's question may be an image,
-- a Word document or a PDF; a student's hand-in an image or a PDF. Each CHECK
-- below, and the legacy mapping, call these — no list is written twice. A
-- missing type is refused: `NULL IN (…)` is NULL, and a CHECK lets NULL through.
CREATE FUNCTION public.homework_question_file_ok(_f jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(jsonb_typeof(_f) = 'object', false)
     AND coalesce(_f->>'path', '') <> ''
     AND coalesce(_f->>'name', '') <> ''
     AND coalesce(_f->>'mime', '') IN ('application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                                       'image/heic', 'application/msword',
                                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
$$;

CREATE FUNCTION public.homework_hand_in_ok(_f jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(jsonb_typeof(_f) = 'object', false)
     AND coalesce(_f->>'path', '') <> ''
     AND coalesce(_f->>'name', '') <> ''
     AND coalesce(_f->>'mime', '') IN ('application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                                       'image/heic')
$$;

COMMENT ON FUNCTION public.homework_question_file_ok(jsonb) IS
  'THE definition of a homework question file: {path, name, mime} with mime an image, a Word document or a PDF. homework_question_file_shape is this function.';
COMMENT ON FUNCTION public.homework_hand_in_ok(jsonb) IS
  'THE definition of a hand-in: {path, name, mime} with mime an image or a PDF. homework_submissions_file_shape is this function; rpc_homework_submit reports its refusal.';

-- A CHECK runs with the privileges of whoever writes the row, and teachers
-- write homework directly. Hand-ins are written only by SECURITY DEFINER
-- functions, so that validator needs no grant.
GRANT EXECUTE ON FUNCTION public.homework_question_file_ok(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.legacy_file(_a jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _a IS NULL OR jsonb_typeof(_a) <> 'object' THEN NULL
    WHEN substring(_a->>'url' from '(?:^academic-files/|/academic-files/)([^?]+)') IS NULL THEN NULL
    ELSE jsonb_build_object(
      'path', substring(_a->>'url' from '(?:^academic-files/|/academic-files/)([^?]+)'),
      'name', coalesce(nullif(_a->>'name', ''), 'file'),
      'mime', coalesce(nullif(lower(_a->>'mimeType'), ''),
                CASE lower(substring(_a->>'name' from '\.([A-Za-z0-9]+)$'))
                  WHEN 'pdf' THEN 'application/pdf'
                  WHEN 'jpg' THEN 'image/jpeg' WHEN 'jpeg' THEN 'image/jpeg'
                  WHEN 'png' THEN 'image/png' WHEN 'gif' THEN 'image/gif'
                  WHEN 'webp' THEN 'image/webp' WHEN 'heic' THEN 'image/heic'
                  WHEN 'doc' THEN 'application/msword'
                  WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                END),
      'size', CASE WHEN jsonb_typeof(_a->'sizeBytes') = 'number' THEN (_a->>'sizeBytes')::bigint END
    )
  END
$$;

ALTER TABLE public.homework ADD COLUMN question_file jsonb;

DO $legacy_question$
DECLARE _both int; _neither int;
BEGIN
  UPDATE public.homework h
     SET question_file = (
       SELECT f FROM (
         SELECT pg_temp.legacy_file(a) AS f, ord
           FROM jsonb_array_elements(coalesce(h.attachments, '[]'::jsonb)) WITH ORDINALITY AS x(a, ord)
       ) files
       WHERE public.homework_question_file_ok(f)
       ORDER BY ord LIMIT 1);

  SELECT count(*) INTO _both FROM public.homework
   WHERE coalesce(btrim(description), '') <> '' AND question_file IS NOT NULL;
  UPDATE public.homework SET question_file = NULL
   WHERE coalesce(btrim(description), '') <> '' AND question_file IS NOT NULL;

  SELECT count(*) INTO _neither FROM public.homework
   WHERE status <> 'draft' AND coalesce(btrim(description), '') = '' AND question_file IS NULL;
  UPDATE public.homework SET description = title
   WHERE status <> 'draft' AND coalesce(btrim(description), '') = '' AND question_file IS NULL;

  RAISE NOTICE 'legacy homework: % kept their typed question over an attachment (the file is in the snapshot); % had no question and took their title', _both, _neither;
END
$legacy_question$;

ALTER TABLE public.homework
  DROP COLUMN submission_mode,
  DROP COLUMN max_marks,
  DROP COLUMN attachment_url,
  DROP COLUMN attachments,
  DROP COLUMN instructions,
  DROP COLUMN estimated_minutes,
  DROP COLUMN tags,
  DROP COLUMN external_links,
  DROP COLUMN difficulty,
  DROP COLUMN assigned_date,
  DROP COLUMN academic_year_id,
  DROP COLUMN section_subject_id,
  DROP COLUMN subject_id;
DROP TYPE public.homework_submission_mode;

ALTER TABLE public.homework
  ADD CONSTRAINT homework_question_file_shape CHECK (
    question_file IS NULL OR public.homework_question_file_ok(question_file)
  ),
  ADD CONSTRAINT homework_question_is_text_or_file CHECK (
    NOT (coalesce(btrim(description), '') <> '' AND question_file IS NOT NULL)
    AND (status = 'draft' OR coalesce(btrim(description), '') <> '' OR question_file IS NOT NULL)
  ),
  ADD CONSTRAINT homework_scheduled_has_a_release CHECK (
    status <> 'scheduled' OR scheduled_publish_at IS NOT NULL
  ),
  ADD CONSTRAINT homework_releases_before_its_deadline CHECK (
    status <> 'scheduled' OR scheduled_publish_at < closes_at
  );

COMMENT ON COLUMN public.homework.description IS
  'The typed question. Empty when the question is question_file instead — never both (homework_question_is_text_or_file).';
COMMENT ON COLUMN public.homework.question_file IS
  'The question as ONE uploaded file: {path, name, mime, size}, an image, a Word document or a PDF in academic-files. NULL when the question is typed.';
COMMENT ON COLUMN public.homework.topic_id IS
  'The structured topic, picked from the chapter''s topics or added (§10.22). trg_homework_topic_matches_chapter keeps it inside chapter_id.';

-- ── 5. Submissions: one file, four states ─────────────────────────────────

ALTER TABLE public.homework_submissions
  ADD COLUMN file jsonb,
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.homework_submissions DROP CONSTRAINT homework_submissions_status_check;

DO $legacy_submissions$
DECLARE _no_file int; _kept int;
BEGIN
  UPDATE public.homework_submissions hs
     SET file = (
       SELECT f FROM (
         SELECT pg_temp.legacy_file(a) AS f, ord
           FROM jsonb_array_elements(coalesce(hs.attachments, '[]'::jsonb)) WITH ORDINALITY AS x(a, ord)
       ) files
       WHERE public.homework_hand_in_ok(f)
       ORDER BY ord LIMIT 1);

  SELECT count(*) INTO _no_file FROM public.homework_submissions
   WHERE file IS NULL AND status <> 'pending';
  SELECT count(*) INTO _kept FROM public.homework_submissions
   WHERE file IS NOT NULL AND status <> 'pending';

  UPDATE public.homework_submissions
     SET status = CASE
           WHEN file IS NULL THEN 'not_submitted'
           WHEN status IN ('submitted', 'late') THEN 'submitted'
           WHEN status IN ('reviewed', 'graded', 'completed') THEN 'accepted'
           WHEN status = 'returned' THEN 'rejected'
           ELSE 'not_submitted'
         END;

  UPDATE public.homework_submissions
     SET file = CASE WHEN status = 'not_submitted' THEN NULL ELSE file END,
         submitted_at = CASE WHEN status = 'not_submitted' THEN NULL
                             ELSE coalesce(submitted_at, updated_at, created_at) END,
         decided_at = CASE WHEN status IN ('accepted', 'rejected')
                           THEN coalesce(reviewed_at, graded_at, returned_at, updated_at, created_at) END;

  RAISE NOTICE 'legacy submissions: % handed-in rows had no image or PDF and are now not_submitted (content, grade and remark are in the snapshot); % kept their file', _no_file, _kept;
END
$legacy_submissions$;

ALTER TABLE public.homework_submissions
  DROP COLUMN content,
  DROP COLUMN grade,
  DROP COLUMN teacher_remarks,
  DROP COLUMN marks_obtained,
  DROP COLUMN is_late,
  DROP COLUMN version,
  DROP COLUMN attachments,
  DROP COLUMN external_links,
  DROP COLUMN graded_at,
  DROP COLUMN returned_at,
  DROP COLUMN reviewed_at;

ALTER TABLE public.homework_submissions ALTER COLUMN status SET DEFAULT 'not_submitted';
ALTER TABLE public.homework_submissions
  ADD CONSTRAINT homework_submissions_status_check CHECK (
    status IN ('not_submitted', 'submitted', 'accepted', 'rejected')
  ),
  ADD CONSTRAINT homework_submissions_file_shape CHECK (
    file IS NULL OR public.homework_hand_in_ok(file)
  ),
  ADD CONSTRAINT homework_submissions_state CHECK (
       (status = 'not_submitted' AND file IS NULL AND submitted_at IS NULL AND decided_at IS NULL)
    OR (status = 'submitted' AND file IS NOT NULL AND submitted_at IS NOT NULL AND decided_at IS NULL)
    OR (status IN ('accepted', 'rejected') AND file IS NOT NULL AND submitted_at IS NOT NULL AND decided_at IS NOT NULL)
  );

COMMENT ON COLUMN public.homework_submissions.status IS
  'not_submitted | submitted | accepted | rejected. Rejected is presented and counted as NOT GIVEN. homework_submissions_state makes each state mean one thing.';
COMMENT ON COLUMN public.homework_submissions.file IS
  'The ONE file handed in: {path, name, mime, size}, an image or a PDF under the student''s own folder in academic-files. A single object, so a second file cannot be stored.';

-- ── 6. The only ways to write a submission ────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_homework_submit(_homework_id uuid, _file jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _student public.students%ROWTYPE;
  _hw public.homework%ROWTYPE;
  _path text := _file->>'path';
  _existing public.homework_submissions%ROWTYPE;
  _row public.homework_submissions%ROWTYPE;
  _constraint text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to hand in homework' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _student FROM public.students
   WHERE user_id = _uid AND deleted_at IS NULL LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a student can hand in homework' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _hw FROM public.homework WHERE id = _homework_id;
  IF NOT FOUND
     OR _hw.school_id IS DISTINCT FROM _student.school_id
     OR _hw.class_id IS DISTINCT FROM _student.class_id
     OR _hw.status <> 'published'
     OR _hw.deleted_at IS NOT NULL THEN
    -- One message for every case, so the refusal does not reveal whether a
    -- homework the student may not see exists.
    RAISE EXCEPTION 'This homework is not open to you' USING ERRCODE = '42501';
  END IF;

  IF now() >= _hw.closes_at THEN
    RAISE EXCEPTION 'The deadline has passed. Nothing can be handed in after it.' USING ERRCODE = '55000';
  END IF;

  -- The file must really be in storage — which a missing path, or anything
  -- that is not one file object, never is — and it must be this student's:
  -- uploads land under {auth.uid()}/… (the academic-files INSERT policy), so a
  -- path under anyone else's folder is not their work.
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'academic-files' AND o.name = _path) THEN
    RAISE EXCEPTION 'Attach the one image or PDF you uploaded' USING ERRCODE = '22023';
  END IF;
  IF split_part(_path, '/', 1) <> _uid::text THEN
    RAISE EXCEPTION 'The file must be one you uploaded' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _existing FROM public.homework_submissions
   WHERE homework_id = _homework_id AND student_id = _student.id
   FOR UPDATE;
  IF FOUND AND _existing.status = 'accepted' THEN
    RAISE EXCEPTION 'Your teacher has accepted this homework. It can no longer be replaced.' USING ERRCODE = '55000';
  END IF;

  -- What a hand-in may be is decided once, by homework_hand_in_ok() through
  -- homework_submissions_file_shape. Its refusal is reported here in words; any
  -- other constraint is re-raised as it is.
  BEGIN
    INSERT INTO public.homework_submissions
      (homework_id, student_id, school_id, status, file, submitted_at, decided_at, decided_by)
    VALUES
      (_homework_id, _student.id, _hw.school_id, 'submitted',
       jsonb_build_object('path', _path, 'name', _file->>'name', 'mime', lower(_file->>'mime'),
                          'size', CASE WHEN jsonb_typeof(_file->'size') = 'number' THEN (_file->>'size')::bigint END),
       now(), NULL, NULL)
    ON CONFLICT (homework_id, student_id) DO UPDATE
       SET status = 'submitted',
           file = EXCLUDED.file,
           submitted_at = now(),
           decided_at = NULL,
           decided_by = NULL,
           updated_at = now()
    RETURNING * INTO _row;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS _constraint = CONSTRAINT_NAME;
    IF _constraint IS DISTINCT FROM 'homework_submissions_file_shape' THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'Hand in exactly one image or PDF' USING ERRCODE = '22023';
  END;

  RETURN to_jsonb(_row);
END;
$$;

COMMENT ON FUNCTION public.rpc_homework_submit(uuid, jsonb) IS
  'The student hands in ONE image or PDF they uploaded, for a published homework of their own class, before its deadline. Replacing the file, or resubmitting after a rejection, is the same call and allowed until the deadline; an accepted submission is final. The only way a submission becomes submitted.';

CREATE OR REPLACE FUNCTION public.rpc_homework_decide(_submission_id uuid, _decision text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _sub public.homework_submissions%ROWTYPE;
  _hw public.homework%ROWTYPE;
  _student_user uuid;
  _row public.homework_submissions%ROWTYPE;
BEGIN
  IF _decision NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'A submission is either accepted or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _sub FROM public.homework_submissions WHERE id = _submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a submission you can decide on' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _hw FROM public.homework WHERE id = _sub.homework_id;

  IF _uid IS NULL OR NOT (
       public.teacher_teaches_class(_uid, _hw.class_id)
    OR (public.has_role(_uid, 'admin'::public.app_role) AND public.same_school(_hw.school_id))
  ) THEN
    RAISE EXCEPTION 'Not a submission you can decide on' USING ERRCODE = '42501';
  END IF;
  IF _hw.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This homework has been deleted' USING ERRCODE = '55000';
  END IF;
  IF _sub.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only work awaiting review can be accepted or rejected — this one is %', _sub.status
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.homework_submissions
     SET status = _decision, decided_at = now(), decided_by = _uid, updated_at = now()
   WHERE id = _submission_id
  RETURNING * INTO _row;

  -- XP ON ACCEPTANCE. The two homework rules used to be awarded by the client
  -- the moment a file was handed in, so a rejected submission kept its XP and
  -- its place in homework_submitted_count — the count the homework_hero and
  -- homework_100 badges are awarded from. Awarded here, rejected work earns
  -- nothing, exactly like work never handed in. The idempotency keys are the
  -- ones the client used, so a submission already paid at hand-in is not paid
  -- twice. Every submission is before its deadline now, so both rules apply.
  --
  -- A failure here must not undo the decision, which is the fact that matters;
  -- it is raised as a WARNING rather than swallowed silently.
  IF _decision = 'accepted' THEN
    SELECT user_id INTO _student_user FROM public.students WHERE id = _row.student_id;
    IF _student_user IS NOT NULL THEN
      BEGIN
        PERFORM public.rpc_apply_progression('homework.submit', 'homework_submission', _row.id::text,
          'homework.submit:' || _row.id::text, NULL, jsonb_build_object('homework_id', _row.homework_id),
          _student_user);
        PERFORM public.rpc_apply_progression('homework.before_deadline', 'homework_submission', _row.id::text,
          'homework.before:' || _row.id::text, NULL, '{}'::jsonb, _student_user);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'rpc_homework_decide: XP for accepted submission % was not awarded: %', _row.id, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN to_jsonb(_row);
END;
$$;

COMMENT ON FUNCTION public.rpc_homework_decide(uuid, text) IS
  'A teacher of the class (or an admin of the school) accepts or rejects a submission awaiting review. The only two actions. Accepting awards the homework XP; rejecting sends the work back, and it counts as not given.';

CREATE OR REPLACE FUNCTION public.resolve_closed_homework()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hw record;
  _n int := 0;
BEGIN
  FOR _hw IN
    SELECT id, school_id, class_id
      FROM public.homework
     WHERE status = 'published'
       AND deleted_at IS NULL
       AND resolved_at IS NULL
       AND closes_at <= now()
     ORDER BY closes_at
     FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.homework_submissions (homework_id, student_id, school_id, status)
    SELECT _hw.id, s.id, _hw.school_id, 'not_submitted'
      FROM public.students s
     WHERE s.class_id = _hw.class_id
       AND s.school_id = _hw.school_id
       AND s.deleted_at IS NULL
    ON CONFLICT (homework_id, student_id) DO NOTHING;

    UPDATE public.homework SET resolved_at = now() WHERE id = _hw.id;
    _n := _n + 1;
  END LOOP;

  RETURN _n;
END;
$$;

COMMENT ON FUNCTION public.resolve_closed_homework() IS
  'pg_cron job resolve-closed-homework, every minute. Gives every current student of a closed homework''s class a final row — not_submitted where they handed nothing in — and stamps resolved_at, once. Returns how many homework it resolved. Only the scheduler and service_role may execute it.';

-- A function created in public executes for service_role alone by default
-- (pg_default_acl, measured on the live project), which is exactly who may run
-- the closure. The student and the teacher each need their one function.
GRANT EXECUTE ON FUNCTION public.rpc_homework_submit(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_homework_decide(uuid, text) TO authenticated;
-- A GENERATED column's expression runs with the privileges of whoever writes
-- the row, so every role that inserts or edits homework needs EXECUTE on the
-- function behind `due_date`. Without this line the first teacher to set
-- homework got "permission denied for function school_local_date" — measured
-- by this migration's own proof before the grant was added.
GRANT EXECUTE ON FUNCTION public.school_local_date(timestamptz) TO authenticated;

DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: cron.schedule(text,text,text) does not exist, so homework would never close. Install pg_cron, then apply this migration.';
  END IF;
  PERFORM cron.schedule('resolve-closed-homework', '* * * * *', 'SELECT public.resolve_closed_homework()');
END
$cron$;

-- ── 7. Read-only RLS on submissions; server-owned columns on homework ─────

DROP POLICY "hw_sub student own" ON public.homework_submissions;
DROP POLICY "hw_sub teacher manage" ON public.homework_submissions;
DROP POLICY "hw_sub admin all" ON public.homework_submissions;
DROP POLICY "hw_sub principal read" ON public.homework_submissions;

CREATE POLICY "hw_sub student read own" ON public.homework_submissions
  FOR SELECT TO authenticated USING (public.is_my_student_record(student_id));
CREATE POLICY "hw_sub teacher read" ON public.homework_submissions
  FOR SELECT TO authenticated USING (public.can_manage_homework(homework_id));
CREATE POLICY "hw_sub admin read" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.same_school(school_id));
CREATE POLICY "hw_sub principal read" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'principal'::public.app_role) AND public.same_school(school_id));

-- The live project granted ALL on both tables to anon and authenticated —
-- TRUNCATE, REFERENCES and TRIGGER included, none of which RLS governs. Every
-- privilege goes; what comes back is exactly what the model uses.
REVOKE ALL ON public.homework_submissions FROM anon, authenticated;
GRANT SELECT ON public.homework_submissions TO authenticated;

-- Homework: nobody hard-deletes through the API, and the server's columns are
-- the server's. INSERT and UPDATE are granted per column.
REVOKE ALL ON public.homework FROM anon, authenticated;
GRANT SELECT ON public.homework TO authenticated;
GRANT INSERT (school_id, class_id, subject, title, description, question_file, chapter_id, topic_id, topic,
              closes_at, priority, work_kind, status, scheduled_publish_at)
   ON public.homework TO authenticated;
GRANT UPDATE (subject, title, description, question_file, chapter_id, topic_id, topic,
              closes_at, priority, work_kind, status, scheduled_publish_at)
   ON public.homework TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_homework_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    NEW.resolved_at := NULL;
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
  ELSE
    -- Closed homework is history. Its deadline and class cannot move, and it
    -- cannot go back to draft or scheduled — republishing would tell the class
    -- "New homework" about work nobody can hand in. Archiving it is allowed.
    IF OLD.resolved_at IS NOT NULL
       AND (NEW.closes_at IS DISTINCT FROM OLD.closes_at
            OR NEW.class_id IS DISTINCT FROM OLD.class_id
            OR NEW.status IN ('draft', 'scheduled')) THEN
      RAISE EXCEPTION 'This homework has closed. Its deadline, class and release are history and cannot change.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Nothing is released to a class after its deadline. A person publishing or
  -- scheduling homework whose deadline has passed is refused; the scheduler,
  -- which has no signed-in user, still releases what was scheduled before it.
  IF auth.uid() IS NOT NULL
     AND NEW.status IN ('published', 'scheduled')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.closes_at <= now() THEN
    RAISE EXCEPTION 'The deadline has already passed. Set a later deadline before this goes to the class.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    NEW.published_at := coalesce(NEW.published_at, now());
  ELSIF NEW.status <> 'published' AND NEW.status <> 'archived' THEN
    NEW.published_at := NULL;
  END IF;

  IF NEW.status = 'archived' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'archived') THEN
    NEW.archived_at := now();
  ELSIF NEW.status <> 'archived' THEN
    NEW.archived_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_homework_lifecycle
  BEFORE INSERT OR UPDATE ON public.homework
  FOR EACH ROW EXECUTE FUNCTION public.tg_homework_lifecycle();

-- ── 8. The emitters, rewritten for the model ──────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_emit_homework_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _etype text;
  _row public.homework%ROWTYPE;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  IF TG_OP = 'DELETE' THEN
    _etype := 'homework.deleted';
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- A soft delete fans out to the class like a hard one did, so every stored
    -- count for every student of the class drops together.
    _etype := 'homework.deleted';
  ELSIF TG_OP = 'UPDATE' AND (
          (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
       OR (OLD.resolved_at IS NULL AND NEW.resolved_at IS NOT NULL)) THEN
    -- Restored from the trash, or just closed by the scheduler: recount the
    -- class. Completion is measured at the deadline, so a closure changes every
    -- student's stored completion; and a restore must not tell every student
    -- "New homework" a second time.
    _etype := 'homework.class.refresh_chunk';
  ELSIF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    _etype := 'homework.published';
  ELSIF NEW.status = 'scheduled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'scheduled') THEN
    _etype := 'homework.scheduled';
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'published' AND NEW.status = 'draft' THEN
    _etype := 'homework.unpublished';
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    _etype := 'homework.archived';
  ELSIF TG_OP = 'INSERT' THEN
    _etype := 'homework.created';
  ELSE
    _etype := 'homework.updated';
  END IF;

  PERFORM public.emit_academic_event(
    _etype, 'homework', _row.id, _row.school_id, NULL, _row.class_id, NULL,
    jsonb_build_object(
      'title', _row.title,
      'subject', _row.subject,
      'status', _row.status,
      'work_kind', _row.work_kind,
      'closes_at', _row.closes_at,
      'due_date', _row.due_date,
      'created_by', _row.created_by,
      'priority', _row.priority,
      'scheduled_publish_at', _row.scheduled_publish_at
    )
  );

  PERFORM public.write_academic_audit(
    'homework', _row.id, lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    _row.school_id
  );
  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_emit_homework_submission_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _etype text;
  _row public.homework_submissions%ROWTYPE;
  _hw record;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  -- A not_submitted row is written by the closure job for every student who
  -- handed nothing in. It is a derived state, not an action: no event, no
  -- audit row, and certainly no notification per student.
  IF TG_OP <> 'DELETE' AND NEW.status = 'not_submitted' THEN
    RETURN NULL;
  END IF;

  SELECT id, title, class_id, school_id INTO _hw FROM public.homework WHERE id = _row.homework_id;

  -- The decision events keep the names the notification router already
  -- routes to the student and their parents ('Work reviewed', 'Work
  -- returned'). The router is the academic event processor, whose latest
  -- definition could not be applied to the local replica this was verified
  -- against, so it is not replaced here; renaming the events without it would
  -- silently stop those notifications. The decision itself is in the payload.
  -- (Named in words, not by identifier: the definer inventory reads a body's
  -- identifiers as calls, and this function calls no event processor.)
  IF TG_OP = 'DELETE' THEN
    _etype := 'homework.submission.deleted';
  ELSIF NEW.status = 'submitted' AND (TG_OP = 'INSERT' OR OLD.status = 'not_submitted') THEN
    _etype := 'homework.submitted';
  ELSIF NEW.status = 'submitted' THEN
    _etype := 'homework.resubmitted';
  ELSIF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    _etype := 'homework.reviewed';
  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    _etype := 'homework.returned';
  ELSE
    _etype := 'homework.updated';
  END IF;

  PERFORM public.emit_academic_event(
    _etype, 'homework_submission', _row.id,
    coalesce(_row.school_id, _hw.school_id), _row.student_id, _hw.class_id, NULL,
    jsonb_build_object(
      'homework_id', _row.homework_id,
      'status', _row.status,
      'decision', CASE WHEN _row.status IN ('accepted', 'rejected') THEN _row.status END,
      'title', _hw.title
    )
  );

  PERFORM public.write_academic_audit(
    'homework_submission', _row.id, lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    coalesce(_row.school_id, _hw.school_id)
  );
  RETURN NULL;
END;
$$;

ALTER TABLE public.homework ENABLE TRIGGER trg_emit_homework_event;
ALTER TABLE public.homework ENABLE TRIGGER homework_set_updated;
ALTER TABLE public.homework_submissions ENABLE TRIGGER trg_emit_homework_submission_event;
ALTER TABLE public.homework_submissions ENABLE TRIGGER hw_sub_set_updated;

-- ── 9. Proof ──────────────────────────────────────────────────────────────

-- Everything below runs inside ONE savepoint that always ends by raising
-- P0999, so nothing it does survives: not the fixture homework, not the
-- notifications publishing it sends to a real class, not the XP accepting it
-- awards a real student. PL/pgSQL variables keep their values across the
-- rollback, and every assertion raises a DIFFERENT error, which escapes the
-- handler and rolls the whole migration back as it should.
DO $verify$
DECLARE
  _school uuid; _class uuid; _teacher uuid; _other_teacher uuid; _other_tid uuid;
  _s1 uuid; _u1 uuid; _s2 uuid; _u2 uuid; _s3 uuid;
  _hw uuid; _closed uuid; _draft uuid; _sub uuid; _out jsonb;
  _p1 text; _p2 text; _err text; _n int; _refused boolean;
  _xp_before int; _xp_after int;
BEGIN
BEGIN
  SELECT s.school_id, s.class_id, t.user_id
    INTO _school, _class, _teacher
    FROM public.students s
    JOIN public.teacher_classes tc ON tc.class_id = s.class_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = s.school_id
   WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
     AND (SELECT count(*) FROM public.students x
           WHERE x.class_id = s.class_id AND x.user_id IS NOT NULL AND x.deleted_at IS NULL) >= 2
     AND (SELECT count(*) FROM public.students x
           WHERE x.class_id = s.class_id AND x.deleted_at IS NULL) >= 3
   LIMIT 1;
  SELECT id, user_id INTO _s1, _u1 FROM public.students
   WHERE class_id = _class AND user_id IS NOT NULL AND deleted_at IS NULL ORDER BY id LIMIT 1;
  SELECT id, user_id INTO _s2, _u2 FROM public.students
   WHERE class_id = _class AND user_id IS NOT NULL AND deleted_at IS NULL AND id <> _s1 ORDER BY id LIMIT 1;
  SELECT id INTO _s3 FROM public.students
   WHERE class_id = _class AND deleted_at IS NULL AND id NOT IN (_s1, _s2) ORDER BY id LIMIT 1;
  IF _s3 IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a section of three students, two of them signed in, with a signed-in teacher';
  END IF;

  -- A teacher of the SAME school who does not teach this class. A seed can
  -- easily have none (every seeded teacher here teaches 10-A), and a check that
  -- is skipped when its fixture is missing reads exactly like one that passed.
  -- So the fixture is made: a second teacher of the school has their assignment
  -- to this class removed, inside the savepoint that undoes everything below.
  -- Chosen structurally — `teacher_teaches_class` is session-dependent and is
  -- false for everyone when there is no caller.
  SELECT t.id, t.user_id INTO _other_tid, _other_teacher
    FROM public.teachers t
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = _school
   WHERE t.user_id IS NOT NULL AND t.user_id <> _teacher AND t.deleted_at IS NULL
   LIMIT 1;
  IF _other_teacher IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a second signed-in teacher in the school to prove the class fence';
  END IF;
  DELETE FROM public.teacher_classes WHERE teacher_id = _other_tid AND class_id = _class;
  UPDATE public.teachers SET class_teacher_of = NULL WHERE id = _other_tid AND class_teacher_of = _class;

  _p1 := _u1::text || '/verify-20260925110000-work.pdf';
  _p2 := _u2::text || '/verify-20260925110000-work.png';
  INSERT INTO storage.objects (bucket_id, name) VALUES ('academic-files', _p1), ('academic-files', _p2);

  -- The teacher sets a typed question, published, due tomorrow.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] open', 'Solve Q1-5',
          now() + interval '1 day', 'published')
  RETURNING id INTO _hw;

  -- 1. Text AND a file is refused; that same teacher's text-only row went in.
  _refused := false;
  BEGIN
    INSERT INTO public.homework (school_id, class_id, subject, title, description, question_file, closes_at, status)
    VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] both', 'typed',
            jsonb_build_object('path', _teacher::text || '/q.pdf', 'name', 'q.pdf', 'mime', 'application/pdf'),
            now() + interval '1 day', 'published');
  EXCEPTION WHEN check_violation THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: homework held typed text and a file at once'; END IF;

  --    …and a question file that does not say what type it is.
  _refused := false;
  BEGIN
    INSERT INTO public.homework (school_id, class_id, subject, title, question_file, closes_at, status)
    VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] untyped',
            jsonb_build_object('path', _teacher::text || '/q.bin', 'name', 'q.bin'),
            now() + interval '1 day', 'published');
  EXCEPTION WHEN check_violation THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a question file with no type was accepted'; END IF;

  -- 2. The teacher cannot write a server column. (`created_by`: `deleted_at`
  --    is fenced by RLS as well as by the grant, so it cannot show the grant.)
  _refused := false;
  BEGIN
    UPDATE public.homework SET created_by = _other_teacher WHERE id = _hw;
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a teacher wrote created_by directly'; END IF;
  RESET ROLE;

  IF (SELECT created_by FROM public.homework WHERE id = _hw) IS DISTINCT FROM _teacher
     OR (SELECT published_at FROM public.homework WHERE id = _hw) IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the server did not set created_by and published_at';
  END IF;
  IF (SELECT due_date FROM public.homework WHERE id = _hw) <> public.school_local_date(now() + interval '1 day') THEN
    RAISE EXCEPTION 'ROLLED BACK: due_date is not the deadline''s school-local date';
  END IF;

  -- 3. A student cannot write a submission row directly.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    INSERT INTO public.homework_submissions (homework_id, student_id, school_id, status, file, submitted_at, decided_at)
    VALUES (_hw, _s1, _school, 'accepted',
            jsonb_build_object('path', _p1, 'name', 'w.pdf', 'mime', 'application/pdf'), now(), now());
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a student wrote their own submission as accepted'; END IF;

  -- 4. Two files, a Word document, and someone else's file are all refused.
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_submit(_hw, jsonb_build_array(
      jsonb_build_object('path', _p1, 'name', 'a.pdf', 'mime', 'application/pdf'),
      jsonb_build_object('path', _p1, 'name', 'b.pdf', 'mime', 'application/pdf')));
  EXCEPTION WHEN invalid_parameter_value THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: two files were accepted as a submission'; END IF;

  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_submit(_hw, jsonb_build_object('path', _p1, 'name', 'w.docx',
      'mime', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  EXCEPTION WHEN invalid_parameter_value THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a Word document was handed in'; END IF;

  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_submit(_hw, jsonb_build_object('path', _p1, 'name', 'work'));
  EXCEPTION WHEN invalid_parameter_value THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a file with no type was handed in'; END IF;

  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_submit(_hw, jsonb_build_object('path', _p2, 'name', 'w.png', 'mime', 'image/png'));
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a student handed in a classmate''s file'; END IF;

  -- 5. POSITIVE CONTROL: one PDF of their own is handed in.
  _out := public.rpc_homework_submit(_hw, jsonb_build_object('path', _p1, 'name', 'work.pdf', 'mime', 'application/pdf', 'size', 1200));
  RESET ROLE;
  _sub := (_out->>'id')::uuid;
  IF _out->>'status' <> 'submitted' OR (_out->'file'->>'path') <> _p1 THEN
    RAISE EXCEPTION 'ROLLED BACK: a valid hand-in came back as %', _out;
  END IF;

  -- 6. Another teacher cannot decide; the teacher of the class can, and only
  --    the two ways.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _other_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_decide(_sub, 'accepted');
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a teacher of another class decided on this submission'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_decide(_sub, 'graded');
  EXCEPTION WHEN invalid_parameter_value THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a third decision was accepted'; END IF;

  _out := public.rpc_homework_decide(_sub, 'rejected');
  RESET ROLE;
  IF _out->>'status' <> 'rejected' OR _out->>'decided_at' IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: rejecting came back as %', _out;
  END IF;

  -- 7. After a rejection the student may resubmit before the deadline, and the
  --    decision is cleared.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _out := public.rpc_homework_submit(_hw, jsonb_build_object('path', _p1, 'name', 'work-v2.pdf', 'mime', 'application/pdf'));
  RESET ROLE;
  IF _out->>'status' <> 'submitted' OR _out->>'decided_at' IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: a resubmission after rejection came back as %', _out;
  END IF;

  -- 8. Accepting awards the homework XP; accepted is final for the student.
  SELECT coalesce(xp, 0) INTO _xp_before FROM public.student_xp WHERE user_id = _u1;
  _xp_before := coalesce(_xp_before, 0);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_homework_decide(_sub, 'accepted');
  RESET ROLE;
  SELECT coalesce(xp, 0) INTO _xp_after FROM public.student_xp WHERE user_id = _u1;
  IF coalesce(_xp_after, 0) <= _xp_before THEN
    RAISE EXCEPTION 'ROLLED BACK: accepting did not award homework XP (before %, after %)', _xp_before, _xp_after;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_submit(_hw, jsonb_build_object('path', _p1, 'name', 'late-swap.pdf', 'mime', 'application/pdf'));
  EXCEPTION WHEN object_not_in_prerequisite_state THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: an accepted submission was replaced'; END IF;

  -- 9. Past the deadline nothing goes in, and the closure job resolves the
  --    class exactly once.
  --    A teacher cannot release homework whose deadline has already passed —
  --    neither set straight out, nor a draft published afterwards. (The
  --    teacher's future-deadline homework above is the positive control.)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
    VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] released late', 'q', now() - interval '1 minute', 'published');
  EXCEPTION WHEN object_not_in_prerequisite_state THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a teacher published homework whose deadline had passed'; END IF;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] late draft', 'q', now() - interval '1 minute', 'draft')
  RETURNING id INTO _draft;
  _refused := false;
  BEGIN
    UPDATE public.homework SET status = 'published' WHERE id = _draft;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a teacher published a draft whose deadline had passed'; END IF;

  -- The server, with nobody signed in, can hold published homework that has
  -- closed — the scheduler releasing work scheduled before its deadline.
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] closed', 'q', now() - interval '1 minute', 'published', _teacher)
  RETURNING id INTO _closed;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_submit(_closed, jsonb_build_object('path', _p2, 'name', 'w.png', 'mime', 'image/png'));
  EXCEPTION WHEN object_not_in_prerequisite_state THEN _refused := true;
  END;
  -- …and the student cannot run the closure job.
  BEGIN
    PERFORM public.resolve_closed_homework();
    RAISE EXCEPTION 'ROLLED BACK: a student ran the closure job';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a submission went in after the deadline'; END IF;

  -- A student deleted before the deadline passed is nobody's missing work.
  UPDATE public.students SET deleted_at = now() WHERE id = _s3;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.resolve_closed_homework();
  SELECT count(*) INTO _n FROM public.homework_submissions WHERE homework_id = _closed AND status = 'not_submitted';
  IF _n = 0 OR _n <> (SELECT count(*) FROM public.students WHERE class_id = _class AND school_id = _school AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'ROLLED BACK: closure resolved % students, the class has %', _n,
      (SELECT count(*) FROM public.students WHERE class_id = _class AND school_id = _school AND deleted_at IS NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM public.homework_submissions WHERE homework_id = _closed AND student_id = _s3) THEN
    RAISE EXCEPTION 'ROLLED BACK: closure resolved a deleted student';
  END IF;
  IF (SELECT resolved_at FROM public.homework WHERE id = _closed) IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: closure did not stamp resolved_at';
  END IF;
  -- Resolution freezes who the homework was set to: a student who (re)joins the
  -- class afterwards is not counted as having missed it, however often the job runs.
  UPDATE public.students SET deleted_at = NULL WHERE id = _s3;
  PERFORM public.resolve_closed_homework();
  IF (SELECT count(*) FROM public.homework_submissions WHERE homework_id = _closed) <> _n THEN
    RAISE EXCEPTION 'ROLLED BACK: a second closure run wrote more rows';
  END IF;
  IF (SELECT resolved_at FROM public.homework WHERE id = _hw) IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: closure resolved homework whose deadline has not passed';
  END IF;

  -- 10. A closed homework's deadline is history, and so is its release: the
  --     teacher cannot take it back to draft, but can still archive it.
  _refused := false;
  BEGIN
    UPDATE public.homework SET closes_at = now() + interval '3 days' WHERE id = _closed;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a closed homework''s deadline moved'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    UPDATE public.homework SET status = 'draft' WHERE id = _closed;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a closed homework went back to draft'; END IF;
  UPDATE public.homework SET status = 'archived' WHERE id = _closed;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF (SELECT status FROM public.homework WHERE id = _closed) <> 'archived' THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher could not archive closed homework';
  END IF;

  -- 11. Nobody outside the server holds a privilege the model does not use:
  --     anon holds nothing on either table, and authenticated reads them and
  --     writes only homework's teacher columns.
  IF has_any_column_privilege('anon', 'public.homework', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_any_column_privilege('anon', 'public.homework_submissions', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_table_privilege('anon', 'public.homework', 'DELETE, TRUNCATE, TRIGGER')
     OR has_table_privilege('anon', 'public.homework_submissions', 'DELETE, TRUNCATE, TRIGGER')
     OR has_table_privilege('authenticated', 'public.homework', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_any_column_privilege('authenticated', 'public.homework_submissions', 'INSERT, UPDATE, REFERENCES')
     OR has_table_privilege('authenticated', 'public.homework_submissions', 'DELETE, TRUNCATE, TRIGGER')
     OR has_column_privilege('authenticated', 'public.homework', 'deleted_at', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.homework_submissions', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.homework', 'closes_at', 'UPDATE') THEN
    RAISE EXCEPTION 'ROLLED BACK: the homework tables grant something beyond reads and the teacher''s columns';
  END IF;

  -- 12. The dead paths are gone and the jobs exist.
  IF to_regclass('public.homework_answers') IS NOT NULL OR to_regclass('public.homework_completions') IS NOT NULL
     OR to_regprocedure('public.rpc_close_homework(uuid,boolean)') IS NOT NULL
     OR to_regprocedure('public.tg_homework_compute_is_late()') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: a removed homework path survived';
  END IF;
  -- …and §10.22's schema did not go with them. An earlier draft of this
  -- migration dropped it as dead.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_homework_topic_matches_chapter'
                  AND tgrelid = 'public.homework'::regclass)
     OR to_regclass('public.topics') IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the §10.22 chapter/topic pairing was removed with the dead paths';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resolve-closed-homework'
                  AND command LIKE '%resolve_closed_homework()%') THEN
    RAISE EXCEPTION 'ROLLED BACK: no scheduler job closes homework';
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
EXCEPTION WHEN SQLSTATE 'P0999' THEN
  NULL;
END;

  IF EXISTS (SELECT 1 FROM public.homework WHERE title LIKE '[verify 20260925110000]%') THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  -- The rollback tells a row nobody has touched by its unchanged updated_at.
  IF EXISTS (SELECT 1 FROM public.homework h JOIN public.homework_pre_20260925110000 p ON p.id = h.id
              WHERE h.updated_at IS DISTINCT FROM p.updated_at)
     OR EXISTS (SELECT 1 FROM public.homework_submissions hs JOIN public.homework_submissions_pre_20260925110000 p ON p.id = hs.id
              WHERE hs.updated_at IS DISTINCT FROM p.updated_at) THEN
    RAISE EXCEPTION 'ROLLED BACK: reshaping legacy rows stamped updated_at, so the rollback could not tell them from rows edited since';
  END IF;

  RAISE NOTICE 'verify OK: text xor file; server columns refused; no direct submission writes; one own image/PDF only; two decisions only, by the class teacher; resubmit after rejection; XP on acceptance; accepted is final; nothing handed in or released after the deadline; closure resolves every student once; closed homework stays closed — and nothing it did survived';
END
$verify$;
