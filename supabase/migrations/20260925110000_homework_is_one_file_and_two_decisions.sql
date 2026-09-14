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
--   * RULED the same day, on being asked: MISSING HOMEWORK COSTS THE STUDENT XP.
--     Missing means not given when the homework closes — never handed in, or
--     rejected and not handed in again — and a hand-in rejected after the
--     homework has closed, when it can no longer be handed in again.
--
-- Assumptions proceeded on, as the brief allowed, and stated here so they are
-- not mistaken for rulings:
--   * A student may replace their file, or resubmit after a rejection, only
--     while the deadline has not passed. An ACCEPTED submission is final.
--   * A decision is taken on a submission awaiting review. Rejected work goes
--     back to the student; resubmitting it puts it back in front of the teacher.
--   * XP for homework is awarded when the teacher ACCEPTS it, not when it is
--     handed in (see §6). The missed-homework cost is the progression engine's
--     own rule `homework.missed`; its amount lives there, and disabling it stops
--     the cost without touching this code.
--   * Homework ALREADY RELEASED to its class when this migration runs — closed
--     or still open — costs nobody XP: it was set, and handed in, before the
--     rule existed, and its typed hand-ins become not_submitted below, so the
--     cost would fall on students who did hand in (§5b, `missed_costs_xp`).
--   * Accepting awards XP and a rejection after closure costs it on ANY
--     homework the rule applies to, whenever the decision is taken.
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
--   `missed_costs_xp`, `deleted_at` and `deleted_by` are the server's.
--
-- CLOSURE — `resolve_closed_homework()`, pg_cron every minute. For published,
--   undeleted homework past its deadline and not yet resolved, it writes a
--   `not_submitted` row for every current student of the class without one and
--   stamps `resolved_at`. Once only: `resolved_at` freezes the roster, so a
--   student who joins the class after the deadline is not counted as having
--   missed work set before they arrived. Idempotent: a second run finds nothing.
--   Every current student with an account who has not given it pays
--   `homework.missed`, once per submission row (the idempotency key is the
--   row), unless the homework is marked `missed_costs_xp = false`. A homework
--   whose cost cannot be applied is left unresolved and retried the next
--   minute, with a WARNING — never resolved without it.
--   Closed homework stays closed (`tg_homework_lifecycle`): its deadline, class
--   and release cannot change — it may be archived, never taken back to draft
--   or scheduled. Nobody signed in can publish or schedule homework whose
--   deadline has already passed, or move a released homework's deadline to a
--   moment that has — closing it early would charge the class for work it still
--   had time to do. Nor does the scheduler release homework whose deadline
--   passed before it ran (`publish_due_scheduled_work`): the class would be
--   told of work nobody can hand in, and charged for it. It stays scheduled,
--   and the teacher can give it a new deadline.
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
--   * published or archived homework is marked `missed_costs_xp = false` (§5b).
--     The closure job still resolves it — every current student given a final
--     row — and charges nobody. Measured on live 2026-09-13: all 19 published
--     homework had closed, and the closure job's first run would otherwise have
--     charged 12 students for up to 19 homework each, handed in under the old
--     rules; on the replica, one open homework holds two typed hand-ins.
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

-- ── 5b. Homework released before this ruling costs nothing ───────────────
--
-- Missing homework costs XP from this migration on. Homework already released
-- to its class — published, or archived after it was — was set and handed in
-- under rules with no such cost, and its typed hand-ins became not_submitted
-- above: charging it would charge students who did hand in. It is resolved like
-- any other when it closes, and costs nobody. Drafts and scheduled homework
-- reach the class under the new rules, and cost. The emitters and updated_at are
-- still disabled, so marking the rows is not an edit (the rollback tells
-- untouched rows by it, and the column goes with it).
ALTER TABLE public.homework ADD COLUMN missed_costs_xp boolean NOT NULL DEFAULT true;

DO $legacy_released$
DECLARE _n int;
BEGIN
  UPDATE public.homework SET missed_costs_xp = false WHERE status IN ('published', 'archived');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'legacy homework: % already released, and missing it costs no XP', _n;
END
$legacy_released$;

COMMENT ON COLUMN public.homework.missed_costs_xp IS
  'Whether a student who has not given this homework when it closes pays the missed-homework XP (rule homework.missed). False only for homework already released when that rule was made (20260925110000): it was set and handed in without the cost, typed hand-ins included. Server-owned: no grant lets a teacher write it.';

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

  -- The student row is the caller's row IN THIS HOMEWORK'S CLASS. An account
  -- can hold more than one student row (a membership per school); taking any
  -- one of them would refuse a student their own class's homework whenever the
  -- other row came first.
  -- FOR SHARE holds the homework against the closure job, which locks it FOR
  -- UPDATE: a hand-in and the closure never interleave. Were they to, a
  -- rejected student resubmitting as the job read their row would be charged
  -- for work they had just handed in.
  SELECT * INTO _hw FROM public.homework WHERE id = _homework_id FOR SHARE;
  IF FOUND THEN
    SELECT * INTO _student FROM public.students
     WHERE user_id = _uid AND deleted_at IS NULL
       AND class_id = _hw.class_id AND school_id = _hw.school_id
     LIMIT 1;
  END IF;
  IF _hw.id IS NULL OR _student.id IS NULL
     OR _hw.status <> 'published'
     OR _hw.deleted_at IS NOT NULL THEN
    -- One message for every case, so the refusal does not reveal whether a
    -- homework the caller may not see exists.
    RAISE EXCEPTION 'This homework is not open to you' USING ERRCODE = '42501';
  END IF;

  -- `now()` is when this call began. A call that began before the deadline and
  -- waited on the lock above while the closure job resolved the homework must
  -- not hand in behind it, so a resolved homework is closed whatever the clock.
  IF now() >= _hw.closes_at OR _hw.resolved_at IS NOT NULL THEN
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
  _student_gone timestamptz;
  _row public.homework_submissions%ROWTYPE;
BEGIN
  IF _decision NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'A submission is either accepted or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _sub FROM public.homework_submissions WHERE id = _submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a submission you can decide on' USING ERRCODE = '42501';
  END IF;
  -- FOR SHARE, as in rpc_homework_submit: a decision and the closure job never
  -- interleave. Were they to, a rejection taken as the job resolved the homework
  -- would read it unresolved and charge nothing, while the job read the
  -- submission still awaiting review and charged nothing either.
  SELECT * INTO _hw FROM public.homework WHERE id = _sub.homework_id FOR SHARE;

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

  -- XP FOLLOWS THE DECISION, in the same transaction as the decision.
  --
  -- Accepted: the two homework rules. They used to be awarded by the client the
  -- moment a file was handed in, so a rejected submission kept its XP and its
  -- place in homework_submitted_count — the count the homework_hero and
  -- homework_100 badges are awarded from. The idempotency keys are the ones the
  -- client used, so a submission already paid at hand-in is not paid twice.
  -- Every submission is before its deadline now, so both rules apply.
  --
  -- Rejected AFTER the homework was resolved: the work can no longer be handed
  -- in again, so it is missed, and costs what missing it costs — on the same
  -- terms as the closure job: homework the cost applies to, a current student.
  -- A rejection before then costs nothing yet — the closure job charges it if it
  -- is still rejected when it resolves the homework. The key is the submission
  -- row, the same key the closure job uses, so the cost is taken once whichever
  -- path gets there.
  --
  -- A failure applying XP fails the decision, loudly, so the teacher can try
  -- again: an accepted submission is final and a swallowed failure would lose the
  -- award for good. A rule an admin has disabled is not a failure — it applies
  -- nothing, which is what disabling it means.
  SELECT user_id, deleted_at INTO _student_user, _student_gone
    FROM public.students WHERE id = _row.student_id;
  IF _student_user IS NOT NULL THEN
    IF _decision = 'accepted' THEN
      IF EXISTS (SELECT 1 FROM public.progression_xp_rules WHERE code = 'homework.submit' AND enabled) THEN
        PERFORM public.rpc_apply_progression('homework.submit', 'homework_submission', _row.id::text,
          'homework.submit:' || _row.id::text, NULL, jsonb_build_object('homework_id', _row.homework_id),
          _student_user);
      END IF;
      IF EXISTS (SELECT 1 FROM public.progression_xp_rules WHERE code = 'homework.before_deadline' AND enabled) THEN
        PERFORM public.rpc_apply_progression('homework.before_deadline', 'homework_submission', _row.id::text,
          'homework.before:' || _row.id::text, NULL, jsonb_build_object('homework_id', _row.homework_id),
          _student_user);
      END IF;
    ELSIF _hw.resolved_at IS NOT NULL AND _hw.missed_costs_xp AND _student_gone IS NULL
      AND EXISTS (SELECT 1 FROM public.progression_xp_rules WHERE code = 'homework.missed' AND enabled) THEN
      PERFORM public.rpc_apply_progression('homework.missed', 'homework_submission', _row.id::text,
        'homework.missed:' || _row.id::text, NULL, jsonb_build_object('homework_id', _row.homework_id),
        _student_user);
    END IF;
  END IF;

  RETURN to_jsonb(_row);
END;
$$;

COMMENT ON FUNCTION public.rpc_homework_decide(uuid, text) IS
  'A teacher of the class (or an admin of the school) accepts or rejects a submission awaiting review. The only two actions. Accepting awards the homework XP; rejecting sends the work back, and it counts as not given — and once the homework has been resolved, it costs a current student the missed-homework XP (where missed_costs_xp), since it can no longer be handed in again.';

CREATE OR REPLACE FUNCTION public.resolve_closed_homework()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hw record;
  _missed record;
  _charge boolean;
  _n int := 0;
BEGIN
  FOR _hw IN
    SELECT id, school_id, class_id, missed_costs_xp
      FROM public.homework
     WHERE status = 'published'
       AND deleted_at IS NULL
       AND resolved_at IS NULL
       AND closes_at <= now()
     ORDER BY closes_at
     FOR UPDATE SKIP LOCKED
  LOOP
    -- One homework at a time, in its own savepoint: its final rows, its
    -- missed-homework costs and its resolved_at stand or fall together. If a
    -- cost cannot be applied, THIS homework stays unresolved and is tried again
    -- the next minute — resolving it without the cost would lose it for good,
    -- and letting the error escape would stop every other homework closing.
    -- A homework a hand-in or a decision holds (FOR SHARE) is skipped, and
    -- resolved on the next run from what that call left.
    BEGIN
      INSERT INTO public.homework_submissions (homework_id, student_id, school_id, status)
      SELECT _hw.id, s.id, _hw.school_id, 'not_submitted'
        FROM public.students s
       WHERE s.class_id = _hw.class_id
         AND s.school_id = _hw.school_id
         AND s.deleted_at IS NULL
      ON CONFLICT (homework_id, student_id) DO NOTHING;

      -- Missing homework costs XP: every current student with an account who
      -- has not given it — nothing handed in, or rejected and not handed in
      -- again. Keyed on the submission row, so a second run, or a rejection
      -- decided after closure, never charges it twice. Homework released before
      -- the rule existed, and a rule an admin has disabled, charge nothing.
      _charge := _hw.missed_costs_xp
             AND EXISTS (SELECT 1 FROM public.progression_xp_rules WHERE code = 'homework.missed' AND enabled);
      IF _charge THEN
        FOR _missed IN
          SELECT hs.id, s.user_id
            FROM public.homework_submissions hs
            JOIN public.students s ON s.id = hs.student_id
           WHERE hs.homework_id = _hw.id
             AND hs.status IN ('not_submitted', 'rejected')
             AND s.user_id IS NOT NULL
             AND s.deleted_at IS NULL
        LOOP
          PERFORM public.rpc_apply_progression('homework.missed', 'homework_submission', _missed.id::text,
            'homework.missed:' || _missed.id::text, NULL, jsonb_build_object('homework_id', _hw.id),
            _missed.user_id);
        END LOOP;
      END IF;

      UPDATE public.homework SET resolved_at = now() WHERE id = _hw.id;
      _n := _n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'resolve_closed_homework: homework % left unresolved, to be retried: %', _hw.id, SQLERRM;
    END;
  END LOOP;

  RETURN _n;
END;
$$;

COMMENT ON FUNCTION public.resolve_closed_homework() IS
  'pg_cron job resolve-closed-homework, every minute. Gives every current student of a closed homework''s class a final row — not_submitted where they handed nothing in — charges each current student with an account who has not given it the missed-homework XP (rule homework.missed, where missed_costs_xp), and stamps resolved_at, once, all together per homework; a homework that cannot be charged stays unresolved and is retried. Returns how many homework it resolved. Only the scheduler and service_role may execute it.';

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

  -- Nothing is released to a class after its deadline, and a released
  -- homework's deadline is not moved to a moment that has already passed. A
  -- person doing either is refused: releasing it would announce work nobody can
  -- hand in, and pulling the deadline into the past would close it at once and
  -- charge the class the missed-homework XP for work it still had time to do.
  -- Extending a deadline, or shortening it to a later moment, is allowed. The
  -- rule is for people: the scheduler keeps it by releasing only homework whose
  -- deadline is still ahead (publish_due_scheduled_work, below), and the server
  -- writing a row directly — a seed, this migration's proof — is not refused.
  IF auth.uid() IS NOT NULL
     AND NEW.status IN ('published', 'scheduled')
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM NEW.status
          OR NEW.closes_at IS DISTINCT FROM OLD.closes_at)
     AND NEW.closes_at <= now() THEN
    RAISE EXCEPTION 'That deadline has already passed. Set a later deadline for work the class is given.'
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

-- The publisher 20260925100000 wrote, with one condition added now that
-- `closes_at` is the deadline: homework whose deadline passed before the
-- scheduler reached it is not released. Released late it would tell the class
-- "New homework" nobody can hand in, and the closure job would charge every
-- student for it a minute later. It stays scheduled, where its teacher sees it,
-- and giving it a later deadline releases it on the next run. Tests are
-- released exactly as before.
CREATE OR REPLACE FUNCTION public.publish_due_scheduled_work()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Inside SECURITY DEFINER, `current_user` is the owner for every caller.
  -- The session role is what tells a PostgREST request (`anon`,
  -- `authenticated`) from the scheduler (`postgres` under pg_cron, reporting
  -- 'none') or a service-role worker.
  _session_role text := coalesce(nullif(current_setting('role', true), ''), 'none');
  _uid uuid := auth.uid();
  _school uuid := NULL;
  _n_hw int := 0;
  _n_test int := 0;
BEGIN
  IF _session_role IN ('anon', 'authenticated') THEN
    IF _uid IS NULL OR NOT (
         public.has_role(_uid, 'teacher'::public.app_role)
      OR public.has_role(_uid, 'admin'::public.app_role)
      OR public.has_role(_uid, 'principal'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'Only school staff may publish scheduled work'
        USING ERRCODE = '42501';
    END IF;
    _school := public.get_my_school_id();
    IF _school IS NULL THEN
      RAISE EXCEPTION 'publish_due_scheduled_work: no school context for this caller'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.homework
     SET status = 'published',
         published_at = coalesce(published_at, now()),
         updated_at = now()
   WHERE status = 'scheduled'
     AND scheduled_publish_at IS NOT NULL
     AND scheduled_publish_at <= now()
     AND closes_at > now()
     AND deleted_at IS NULL
     AND (_school IS NULL OR school_id = _school);
  GET DIAGNOSTICS _n_hw = ROW_COUNT;

  UPDATE public.tests
     SET status = 'published',
         published_at = coalesce(published_at, now()),
         updated_at = now()
   WHERE status = 'scheduled'
     AND scheduled_publish_at IS NOT NULL
     AND scheduled_publish_at <= now()
     AND deleted_at IS NULL
     AND (_school IS NULL OR school_id = _school);
  GET DIAGNOSTICS _n_test = ROW_COUNT;

  RETURN _n_hw + _n_test;
END;
$$;

COMMENT ON FUNCTION public.publish_due_scheduled_work() IS
  'Publishes homework and tests whose scheduled_publish_at has passed — homework only while its deadline (closes_at) is still ahead; homework whose deadline passed first stays scheduled for its teacher to re-date. Run every minute by pg_cron job publish-due-scheduled-work across all schools; a signed-in teacher, admin or principal may run it for their own school; any other caller is refused (42501). Never publishes a deleted row. Replaces publish_due_scheduled_homework, which any signed-in session — a student''s included — could run, and which page loads called in place of a scheduler.';

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

  -- The decision events keep the names the notification router already routes
  -- to the student and their parents: accepting is `homework.reviewed`,
  -- rejecting `homework.returned`. What the family READS is the router's, and
  -- 20260925150000 changes it to "Homework accepted" / "Homework rejected".
  -- Renaming the events instead would silently stop those notifications. The
  -- decision itself is in the payload. (The router is named in words, not by
  -- identifier: the definer inventory reads a body's identifiers as calls, and
  -- this function calls no event processor.)
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
  _hw uuid; _closed uuid; _rej uuid; _gone uuid; _legacy uuid; _free uuid; _late uuid; _due uuid; _draft uuid;
  _sub uuid; _out jsonb;
  _sub_u1c uuid; _sub_u2c uuid; _sub_u2r uuid; _sub_u1r uuid; _sub_u1g uuid; _sub_u2g uuid; _sub_u2l uuid;
  _sub_u1f uuid; _sub_u2f uuid;
  _p1 text; _p2 text; _err text; _n int; _total int; _refused boolean;
  _xp_before int; _xp_after int;
BEGIN
  -- 0. Every homework already released when this migration ran — published or
  --    archived, open or closed — costs nobody for missing it (§5b); every
  --    other row does. Read against the snapshot, which holds the status each
  --    row had before anything here touched it.
  SELECT count(*) INTO _n
    FROM public.homework h
    JOIN public.homework_pre_20260925110000 p ON p.id = h.id
   WHERE h.missed_costs_xp IS DISTINCT FROM (coalesce(p.status, '') NOT IN ('published', 'archived'));
  IF _n > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % homework row(s) are marked to cost missed-homework XP, or not, against when they were released', _n;
  END IF;

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

  -- The proof needs the three homework rules on, whatever an admin has set;
  -- the savepoint puts them back.
  UPDATE public.progression_xp_rules SET enabled = true
   WHERE code IN ('homework.submit', 'homework.before_deadline', 'homework.missed');
  IF (SELECT count(*) FROM public.progression_xp_rules
       WHERE code IN ('homework.submit', 'homework.before_deadline', 'homework.missed')) <> 3 THEN
    RAISE EXCEPTION 'ROLLED BACK: the progression engine does not hold the three homework rules this model applies';
  END IF;

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
  --    …nor excuse the class from the missed-homework cost.
  _refused := false;
  BEGIN
    UPDATE public.homework SET missed_costs_xp = false WHERE id = _hw;
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a teacher excused their class from the missed-homework cost'; END IF;
  RESET ROLE;

  IF (SELECT created_by FROM public.homework WHERE id = _hw) IS DISTINCT FROM _teacher
     OR (SELECT published_at FROM public.homework WHERE id = _hw) IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the server did not set created_by and published_at';
  END IF;
  IF (SELECT missed_costs_xp FROM public.homework WHERE id = _hw) IS NOT TRUE THEN
    RAISE EXCEPTION 'ROLLED BACK: homework a teacher set today does not cost the class for missing it';
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
  --    the two ways. (A rejection before the deadline applies no XP, so the
  --    progression engine's own check on who may award a student XP cannot be
  --    what refuses it: this proves the decision's fence alone.)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _other_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_decide(_sub, 'rejected');
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

  -- 9. A teacher cannot release homework whose deadline has already passed —
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

  --    Nor pull a released homework's deadline into the past — that would close
  --    it at once and charge the class — though extending it is allowed.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    UPDATE public.homework SET closes_at = now() - interval '1 minute' WHERE id = _hw;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a teacher pulled a released homework''s deadline into the past'; END IF;
  UPDATE public.homework SET closes_at = now() + interval '2 days' WHERE id = _hw;
  RESET ROLE;
  IF (SELECT closes_at FROM public.homework WHERE id = _hw) < now() + interval '2 days' THEN
    RAISE EXCEPTION 'ROLLED BACK: a teacher could not extend a released homework''s deadline';
  END IF;

  -- 10. The scheduler releases scheduled homework only while its deadline is
  --     ahead. Both are written by the server, due for release a minute ago.
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, scheduled_publish_at, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] missed its release', 'q',
          now() + interval '2 hours', 'scheduled', now() + interval '1 hour', _teacher),
         (_school, _class, 'Mathematics', '[verify 20260925110000] due for release', 'q',
          now() + interval '2 hours', 'scheduled', now() + interval '1 hour', _teacher);
  SELECT id INTO _late FROM public.homework WHERE title = '[verify 20260925110000] missed its release';
  SELECT id INTO _due FROM public.homework WHERE title = '[verify 20260925110000] due for release';
  UPDATE public.homework SET scheduled_publish_at = now() - interval '2 minutes', closes_at = now() - interval '1 minute'
   WHERE id = _late;
  UPDATE public.homework SET scheduled_publish_at = now() - interval '1 minute' WHERE id = _due;
  PERFORM public.publish_due_scheduled_work();
  IF (SELECT status FROM public.homework WHERE id = _late) <> 'scheduled' THEN
    RAISE EXCEPTION 'ROLLED BACK: the scheduler released homework whose deadline had already passed';
  END IF;
  IF (SELECT status FROM public.homework WHERE id = _due) <> 'published' THEN
    RAISE EXCEPTION 'ROLLED BACK: the scheduler did not release homework whose deadline is ahead';
  END IF;

  --     A released homework takes hand-ins; once resolved it takes none, even
  --     with its deadline still ahead — a hand-in that waited on the closure
  --     job does not land behind it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_homework_submit(_due, jsonb_build_object('path', _p2, 'name', 'w.png', 'mime', 'image/png'));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.homework SET resolved_at = now() WHERE id = _due;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_submit(_due, jsonb_build_object('path', _p2, 'name', 'w2.png', 'mime', 'image/png'));
  EXCEPTION WHEN object_not_in_prerequisite_state THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a hand-in went in behind the closure job on resolved homework'; END IF;

  -- 11. Missing homework costs XP. Four homework the class stands differently
  --     on when they close. The server writes them open, the students act
  --     before the deadline, and then the deadline passes — written by the
  --     server, the only writer that may.
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] closed', 'q', now() + interval '1 day', 'published', _teacher)
  RETURNING id INTO _closed;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] rejected', 'q', now() + interval '1 day', 'published', _teacher)
  RETURNING id INTO _rej;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] students gone', 'q', now() + interval '1 day', 'published', _teacher)
  RETURNING id INTO _gone;
  -- As every homework released before this migration is marked (§5b).
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, created_by, missed_costs_xp)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] released before the rule', 'q', now() + interval '1 day', 'published', _teacher, false)
  RETURNING id INTO _legacy;

  -- Student 1 hands in the first and is still awaiting review at the deadline;
  -- hands in the third and is rejected; hands in nothing else.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _sub_u1c := (public.rpc_homework_submit(_closed, jsonb_build_object('path', _p1, 'name', 'w.pdf', 'mime', 'application/pdf'))->>'id')::uuid;
  _sub_u1g := (public.rpc_homework_submit(_gone, jsonb_build_object('path', _p1, 'name', 'w.pdf', 'mime', 'application/pdf'))->>'id')::uuid;
  RESET ROLE;
  -- Student 2 hands in the second and is rejected, and does not hand in again;
  -- hands in the third and the fourth, and is awaiting review on both.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _sub_u2r := (public.rpc_homework_submit(_rej, jsonb_build_object('path', _p2, 'name', 'w.png', 'mime', 'image/png'))->>'id')::uuid;
  _sub_u2g := (public.rpc_homework_submit(_gone, jsonb_build_object('path', _p2, 'name', 'w.png', 'mime', 'image/png'))->>'id')::uuid;
  _sub_u2l := (public.rpc_homework_submit(_legacy, jsonb_build_object('path', _p2, 'name', 'w.png', 'mime', 'image/png'))->>'id')::uuid;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_homework_decide(_sub_u2r, 'rejected');
  PERFORM public.rpc_homework_decide(_sub_u1g, 'rejected');
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.progression_history WHERE idempotency_key = 'homework.missed:' || _sub_u2r) THEN
    RAISE EXCEPTION 'ROLLED BACK: a rejection before the deadline charged missed-homework XP while the work could still be handed in again';
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.homework SET closes_at = now() - interval '1 minute' WHERE id IN (_closed, _rej, _legacy);

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

  -- A charge that cannot be applied leaves its homework unresolved, to be tried
  -- again — never resolved without the charge, never half written. Forced here
  -- by refusing the history row every charge writes.
  -- (The second homework is the one watched: student 2's rejection there is
  -- charged whatever else the job writes.)
  PERFORM set_config('request.jwt.claims', '', true);
  ALTER TABLE public.progression_history ADD CONSTRAINT verify_20260925110000_refuse_missed
    CHECK (rule_code IS DISTINCT FROM 'homework.missed') NOT VALID;
  PERFORM public.resolve_closed_homework();
  IF (SELECT resolved_at FROM public.homework WHERE id = _rej) IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: closure resolved homework whose missed-homework charge could not be applied';
  END IF;
  IF EXISTS (SELECT 1 FROM public.homework_submissions WHERE homework_id = _rej AND status = 'not_submitted') THEN
    RAISE EXCEPTION 'ROLLED BACK: a closure that could not charge kept the final rows it wrote';
  END IF;
  ALTER TABLE public.progression_history DROP CONSTRAINT verify_20260925110000_refuse_missed;

  -- Tried again, it resolves the class exactly once.
  PERFORM public.resolve_closed_homework();
  SELECT count(*) INTO _n FROM public.homework_submissions WHERE homework_id = _closed AND status = 'not_submitted';
  IF _n = 0 OR _n <> (SELECT count(*) FROM public.students WHERE class_id = _class AND school_id = _school AND deleted_at IS NULL) - 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: closure resolved % students as not handed in; the class has %, one of whom handed in', _n,
      (SELECT count(*) FROM public.students WHERE class_id = _class AND school_id = _school AND deleted_at IS NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM public.homework_submissions WHERE homework_id = _closed AND student_id = _s3) THEN
    RAISE EXCEPTION 'ROLLED BACK: closure resolved a deleted student';
  END IF;
  IF (SELECT resolved_at FROM public.homework WHERE id = _closed) IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: closure did not stamp resolved_at';
  END IF;

  -- Missing homework costs XP — nothing handed in, or rejected and not handed in
  -- again — and work awaiting review at the deadline costs nothing.
  SELECT id INTO _sub_u2c FROM public.homework_submissions WHERE homework_id = _closed AND student_id = _s2;
  SELECT id INTO _sub_u1r FROM public.homework_submissions WHERE homework_id = _rej AND student_id = _s1;
  IF (SELECT count(*) FROM public.progression_history WHERE user_id = _u2 AND rule_code = 'homework.missed'
        AND idempotency_key = 'homework.missed:' || _sub_u2c AND xp_delta < 0) <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: closure did not charge missed-homework XP to a student who handed nothing in';
  END IF;
  IF (SELECT count(*) FROM public.progression_history WHERE user_id = _u2 AND rule_code = 'homework.missed'
        AND idempotency_key = 'homework.missed:' || _sub_u2r AND xp_delta < 0) <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: closure did not charge missed-homework XP to a student whose work stood rejected';
  END IF;
  IF (SELECT count(*) FROM public.progression_history WHERE user_id = _u1 AND rule_code = 'homework.missed'
        AND idempotency_key = 'homework.missed:' || _sub_u1r AND xp_delta < 0) <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: closure did not charge the second student who handed nothing in';
  END IF;
  IF EXISTS (SELECT 1 FROM public.progression_history WHERE idempotency_key = 'homework.missed:' || _sub_u1c) THEN
    RAISE EXCEPTION 'ROLLED BACK: closure charged missed-homework XP for work handed in and awaiting review';
  END IF;

  -- Homework released before the rule is resolved like any other, and costs
  -- nobody — student 1 handed nothing in.
  IF (SELECT resolved_at FROM public.homework WHERE id = _legacy) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.homework_submissions
                     WHERE homework_id = _legacy AND student_id = _s1 AND status = 'not_submitted') THEN
    RAISE EXCEPTION 'ROLLED BACK: closure did not resolve homework released before the rule';
  END IF;
  IF EXISTS (SELECT 1 FROM public.progression_history ph
               JOIN public.homework_submissions hs ON ph.idempotency_key = 'homework.missed:' || hs.id
              WHERE hs.homework_id = _legacy) THEN
    RAISE EXCEPTION 'ROLLED BACK: closure charged missed-homework XP for homework released before the rule';
  END IF;

  -- Resolution freezes who the homework was set to: a student who (re)joins the
  -- class afterwards is not counted as having missed it, however often the job runs.
  SELECT count(*) INTO _total FROM public.homework_submissions WHERE homework_id = _closed;
  UPDATE public.students SET deleted_at = NULL WHERE id = _s3;
  PERFORM public.resolve_closed_homework();
  IF (SELECT count(*) FROM public.homework_submissions WHERE homework_id = _closed) <> _total THEN
    RAISE EXCEPTION 'ROLLED BACK: a second closure run wrote more rows';
  END IF;
  IF (SELECT resolved_at FROM public.homework WHERE id = _hw) IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: closure resolved homework whose deadline has not passed';
  END IF;

  -- A hand-in rejected AFTER the homework closed can no longer be handed in
  -- again: it is missed, and charged once.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_homework_decide(_sub_u1c, 'rejected');
  --     …but not on homework released before the rule.
  PERFORM public.rpc_homework_decide(_sub_u2l, 'rejected');
  RESET ROLE;
  IF (SELECT count(*) FROM public.progression_history WHERE user_id = _u1 AND rule_code = 'homework.missed'
        AND idempotency_key = 'homework.missed:' || _sub_u1c AND xp_delta < 0) <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: a hand-in rejected after the homework closed was not charged as missed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.progression_history WHERE idempotency_key = 'homework.missed:' || _sub_u2l) THEN
    RAISE EXCEPTION 'ROLLED BACK: a rejection after closure charged missed-homework XP on homework released before the rule';
  END IF;

  -- A student no longer in the school is nobody's missing work, at closure or
  -- after it: both students are removed, then the third homework closes with
  -- student 1's work rejected, and student 2's is rejected after.
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.homework SET closes_at = now() - interval '1 minute' WHERE id = _gone;
  UPDATE public.students SET deleted_at = now() WHERE id IN (_s1, _s2);
  PERFORM public.resolve_closed_homework();
  IF (SELECT resolved_at FROM public.homework WHERE id = _gone) IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: closure did not resolve homework whose rejected students had left';
  END IF;
  IF EXISTS (SELECT 1 FROM public.progression_history WHERE idempotency_key = 'homework.missed:' || _sub_u1g) THEN
    RAISE EXCEPTION 'ROLLED BACK: closure charged missed-homework XP to a student no longer in the school';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_homework_decide(_sub_u2g, 'rejected');
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.progression_history WHERE idempotency_key = 'homework.missed:' || _sub_u2g) THEN
    RAISE EXCEPTION 'ROLLED BACK: a rejection after closure charged missed-homework XP to a student no longer in the school';
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.students SET deleted_at = NULL WHERE id IN (_s1, _s2);

  -- A rule an admin has disabled applies nothing, and nothing fails for it:
  -- homework still closes, and the teacher still accepts and rejects.
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925110000] rules off', 'q', now() + interval '1 day', 'published', _teacher)
  RETURNING id INTO _free;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _sub_u1f := (public.rpc_homework_submit(_free, jsonb_build_object('path', _p1, 'name', 'w.pdf', 'mime', 'application/pdf'))->>'id')::uuid;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _sub_u2f := (public.rpc_homework_submit(_free, jsonb_build_object('path', _p2, 'name', 'w.png', 'mime', 'image/png'))->>'id')::uuid;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.progression_xp_rules SET enabled = false
   WHERE code IN ('homework.submit', 'homework.before_deadline', 'homework.missed');
  UPDATE public.homework SET closes_at = now() - interval '1 minute' WHERE id = _free;
  PERFORM public.resolve_closed_homework();
  IF (SELECT resolved_at FROM public.homework WHERE id = _free) IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: homework did not close while the missed-homework rule was disabled';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_homework_decide(_sub_u1f, 'accepted');
  PERFORM public.rpc_homework_decide(_sub_u2f, 'rejected');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF EXISTS (SELECT 1 FROM public.progression_history ph
               JOIN public.homework_submissions hs ON ph.source_type = 'homework_submission' AND ph.source_id = hs.id::text
              WHERE hs.homework_id = _free) THEN
    RAISE EXCEPTION 'ROLLED BACK: a disabled homework rule still applied XP';
  END IF;

  -- 12. A closed homework's deadline is history, and so is its release: the
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

  -- 13. Nobody outside the server holds a privilege the model does not use:
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

  -- 14. The dead paths are gone and the jobs exist.
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

  RAISE NOTICE 'verify OK: released homework marked against the snapshot; text xor file; server columns refused; no direct submission writes; one own image/PDF only; two decisions only, by the class teacher; resubmit after rejection; XP on acceptance; accepted is final; nothing released, re-dated into the past or handed in after the deadline; closure resolves every student once and charges missed homework — not work awaiting review, not homework released before the rule, not students who left, not a disabled rule, and not at all when a charge fails; a rejection after closure is charged once; closed homework stays closed — and nothing it did survived';
END
$verify$;
