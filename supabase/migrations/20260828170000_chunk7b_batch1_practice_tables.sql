-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7B — BATCH 1: practice tables, and the retirement of question_records
--
-- The governing storage rule (doc, §7B):
--
--   "Only what went wrong is stored per question — wrong, skipped, bookmarked.
--    Never a per-question record of correct answers."
--
-- question_records violated it directly. Measured on production before this
-- migration:
--
--   current_status | wrong | skipped | bookmarked | rows
--   ---------------+-------+---------+------------+-----
--   correct        |     0 |       0 | false      |    7
--   wrong          |     1 |       0 | false      |    3
--
-- 7 of 10 rows existed for no reason except to record that the student had
-- answered correctly. Not a column to drop — rows that should never have been
-- written. `_upsert_question_record` wrote one on EVERY attempt, correct or
-- not, from inside `rpc_record_question_attempt` (SECURITY DEFINER, so no
-- policy could ever have caught it).
--
-- student_mistakes is the nominated authority for the mistake book (G9): it
-- already carries the doc's columns and holds 8 of the 11 call sites,
-- including Nova and the recovery engine. question_records had 3, all in
-- practiceService.ts. So question_records is retired rather than reshaped,
-- and its two legitimate concerns — bookmarks and skips — become the doc's
-- own tables, where they are no longer entangled with correctness.
--
-- NOT in this batch, and why (reported, not silently dropped):
--   * question_attempts.is_correct / .score. Also forbidden per-question
--     correctness, but referenced by 14 SECURITY DEFINER functions including
--     the whole analytics engine (_dim_growth_trend, _exam_readiness,
--     rpc_compute_session_analytics), which is 7C's subject matter. Removing
--     it is an architecture change, not a column drop.
--   * The student_mistakes `mastered` -> `status (open/cleared)` convergence:
--     10 DB functions and 8 client sites read it.
--   * Rewriting the six EXISTING practice tenant fences off per-row
--     same_school() to the 6.6/6.7 pattern. New tables below are born with
--     the correct shape; rewriting the existing ones is a performance change
--     that needs verification item 8's timing run beside it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. practice_bookmarks ───────────────────────────────────────────────────
-- Doc: id · institution_id · student_id · question_id · created_at.
-- institution_id is school_id in this codebase (same concept, live name kept).
-- user_id is carried as well because every practice policy keys on
-- auth.uid(); student_id is the students row the doc names.
--
-- Bookmarks are independent of correctness — that is the point of splitting
-- them out. A bookmark says "come back to this", never "you got this right".
CREATE TABLE IF NOT EXISTS public.practice_bookmarks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id  uuid REFERENCES public.students(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practice_bookmarks_unique UNIQUE (user_id, question_id)
);

-- ── 2. practice_skipped ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.practice_skipped (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id  uuid REFERENCES public.students(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practice_skipped_unique UNIQUE (user_id, question_id)
);

-- ── 3. chapter_tally ────────────────────────────────────────────────────────
-- Doc: "One row per chapter per session, never per question." That is what
-- makes `correct` permissible here — it is a session aggregate, the same
-- class of number as practice_sessions.correct_count, and it cannot be
-- resolved back to which individual questions were right.
--
-- Required by 7C, created here so 7C does not create its own.
CREATE TABLE IF NOT EXISTS public.chapter_tally (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  school_id  uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.practice_sessions(id) ON DELETE CASCADE,
  attempted  integer NOT NULL DEFAULT 0 CHECK (attempted >= 0),
  correct    integer NOT NULL DEFAULT 0 CHECK (correct >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chapter_tally_correct_le_attempted CHECK (correct <= attempted),
  CONSTRAINT chapter_tally_one_per_chapter_session UNIQUE (session_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS practice_bookmarks_user_idx ON public.practice_bookmarks (user_id);
CREATE INDEX IF NOT EXISTS practice_skipped_user_idx   ON public.practice_skipped (user_id);
CREATE INDEX IF NOT EXISTS chapter_tally_user_idx      ON public.chapter_tally (user_id);
CREATE INDEX IF NOT EXISTS chapter_tally_session_idx   ON public.chapter_tally (session_id);

-- ── 4. RLS — the 6.6/6.7 pattern, from birth ────────────────────────────────
-- Fence is RESTRICTIVE (AND'd, narrowing). The self policy is PERMISSIVE.
-- Effective rule per table: own row AND own institution.
--
-- school_id is NOT NULL on all three, so the fence carries no `IS NULL` arm.
-- The existing practice tables all carry `school_id IS NULL OR ...`, which is
-- a latent hole — a NULL-school row would be visible to anon. Zero such rows
-- exist today; these tables make it unrepresentable instead of merely absent.
--
-- IN (SELECT fn()) is uncorrelated, so it becomes a hashed SubPlan evaluated
-- once per statement. Never same_school(school_id), which is 2.73 ms per row.
ALTER TABLE public.practice_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_skipped   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_tally      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['practice_bookmarks', 'practice_skipped', 'chapter_tally'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated
         USING      (school_id IN (SELECT public.my_accessible_school_ids()))
         WITH CHECK (school_id IN (SELECT public.my_accessible_school_ids()))',
      t || '_tenant_fence', t);

    -- §10.8: practice is readable by the student and nobody else. Not teacher,
    -- parent, principal, admin, or any aggregate. There is deliberately no
    -- role dispatch here — there is no other role to dispatch to.
    --
    -- auth.uid() is hoisted into (SELECT ...) so it is a one-time InitPlan
    -- rather than a per-row call. That hoist is safe in a WITH CHECK because
    -- it reads no table; rewriting a write check as IN (SELECT ... FROM the
    -- table being written) is NOT safe and is a recorded dead end.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING      (user_id = (SELECT auth.uid()))
         WITH CHECK (user_id = (SELECT auth.uid()))',
      t || '_self', t);
  END LOOP;
END $$;

-- ── 5. Carry the two legitimate concerns out of question_records ────────────
-- Bookmarks and skips are preserved. Correctness is not carried anywhere.
--
-- school_id is NOT NULL on the new tables, so rows whose source row had no
-- school cannot be migrated; there are none today (verified: 0 of 10), and
-- the WHERE guard makes that explicit rather than letting the INSERT fail.
INSERT INTO public.practice_bookmarks (user_id, student_id, school_id, question_id, created_at)
SELECT qr.user_id, qr.student_id, qr.school_id, qr.question_id, qr.created_at
  FROM public.question_records qr
 WHERE qr.bookmarked IS TRUE
   AND qr.school_id IS NOT NULL
ON CONFLICT (user_id, question_id) DO NOTHING;

INSERT INTO public.practice_skipped (user_id, student_id, school_id, question_id, created_at)
SELECT qr.user_id, qr.student_id, qr.school_id, qr.question_id, qr.created_at
  FROM public.question_records qr
 WHERE qr.skipped_count > 0
   AND qr.school_id IS NOT NULL
ON CONFLICT (user_id, question_id) DO NOTHING;

-- ── 5b. Carry the actual mistakes into the nominated mistake book ───────────
-- The two mistake books had genuinely diverged. Measured before this
-- migration: all 3 `wrong` rows in question_records were absent from
-- student_mistakes. That is the G9 cost made concrete — MistakeBook.tsx
-- (student_mistakes) and practiceService.listMistakeBook (question_records)
-- were showing different mistake books to the same student.
--
-- Dropping question_records without this step would silently lose 3 real
-- mistakes. They are carried across, not recreated: times_wrong and the
-- original timestamps come from the source row.
INSERT INTO public.student_mistakes (
  user_id, student_id, school_id, question_id, source,
  subject, chapter, topic, concept, subconcept, class_level, difficulty,
  question_text, options, correct_answer, explanation,
  times_wrong, last_wrong_at, mastered, created_at
)
SELECT
  qr.user_id, qr.student_id, qr.school_id, qr.question_id, 'practice',
  COALESCE(qb.subject, 'General'), qb.chapter, qb.topic, qb.concept, qb.subconcept,
  qb.class_level, qb.difficulty,
  COALESCE(qb.question, '(question no longer in bank)'),
  qb.options,
  CASE
    WHEN qb.correct_index IS NOT NULL AND jsonb_typeof(qb.options) = 'array'
      THEN qb.options -> qb.correct_index
    ELSE NULL
  END,
  qb.explanation,
  GREATEST(qr.wrong_count, 1),
  qr.last_practiced_date,
  false,
  qr.created_at
FROM public.question_records qr
LEFT JOIN public.question_bank qb ON qb.id = qr.question_id
WHERE qr.current_status = 'wrong'
  AND NOT EXISTS (
    SELECT 1 FROM public.student_mistakes sm
     WHERE sm.user_id = qr.user_id
       AND sm.question_id = qr.question_id
  );

-- ── 6. rpc_toggle_question_bookmark -> practice_bookmarks ───────────────────
-- The old body had to seed a question_records row with current_status
-- 'skipped' and zero attempts just to hang a bookmark on, then filter that
-- fiction back out of Skipped Practice with `attempt_count > 0`. With
-- bookmarks in their own table the fiction is unnecessary.
--
-- The old body also selected the student row with an unordered LIMIT 1 — the
-- same shape as the CHUNK4 intermittent failure. A student with two rows got
-- an arbitrary one. Now ordered and restricted to the active row.
CREATE OR REPLACE FUNCTION public.rpc_toggle_question_bookmark(
  _question_id uuid,
  _bookmarked  boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid    uuid := auth.uid();
  _sid    uuid;
  _school uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT _bookmarked THEN
    DELETE FROM public.practice_bookmarks
     WHERE user_id = _uid AND question_id = _question_id;
    RETURN false;
  END IF;

  -- SECURITY DEFINER bypasses RLS, so this function must re-state for itself
  -- every guarantee the policy would have enforced: the caller's own row, in
  -- the caller's own institution.
  SELECT s.id, s.school_id
    INTO _sid, _school
    FROM public.students s
   WHERE s.user_id = _uid
     AND s.deleted_at IS NULL
   ORDER BY s.created_at DESC
   LIMIT 1;

  IF _school IS NULL THEN
    RAISE EXCEPTION 'no active student record for this user';
  END IF;

  INSERT INTO public.practice_bookmarks (user_id, student_id, school_id, question_id)
  VALUES (_uid, _sid, _school, _question_id)
  ON CONFLICT (user_id, question_id) DO NOTHING;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_toggle_question_bookmark(uuid, boolean) TO authenticated;

-- ── 7. Stop writing question_records ────────────────────────────────────────
-- rpc_record_question_attempt called _upsert_question_record on every attempt.
-- Replace the helper with a no-op-free removal: drop the call by redefining
-- the caller is not possible without restating its whole body, so instead the
-- helper itself is dropped and the caller patched by CASCADE-free surgery
-- below. Dropping the function first would leave the caller broken, so the
-- caller is patched first.
--
-- rpc_record_question_attempt is large and its mastery/mistake block is
-- untouched; only the _upsert_question_record PERFORM is removed. It is
-- reproduced from the live definition with that one statement deleted.
DO $$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO _def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'rpc_record_question_attempt';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_record_question_attempt not found';
  END IF;

  -- Remove the PERFORM public._upsert_question_record( ... ); statement.
  -- Anchored on the call and terminated at the first ");" that closes it.
  _def := regexp_replace(
    _def,
    'PERFORM\s+public\._upsert_question_record\s*\([^;]*?\);',
    '-- Chunk 7B: question_records retired; per-question correctness is not stored.',
    'gs'
  );

  IF _def LIKE '%_upsert_question_record%' THEN
    RAISE EXCEPTION 'failed to strip _upsert_question_record call from rpc_record_question_attempt';
  END IF;

  EXECUTE _def;
END $$;

-- ── 8. _recompute_concept_confidence_for_session off question_records ───────
-- It aggregated `current_status = 'correct'` per concept. The same aggregate
-- is available from question_attempts, which the function already reads for
-- its `touched` CTE — so this is a source change, not a semantic one.
--
-- concept_mastery keeps correct_attempts: that is a per-CONCEPT aggregate,
-- the class of number the doc permits, not a per-question record.
DO $$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO _def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = '_recompute_concept_confidence_for_session';

  IF _def IS NULL THEN
    RAISE EXCEPTION '_recompute_concept_confidence_for_session not found';
  END IF;

  -- Whitespace-tolerant on purpose: pg_get_functiondef returns the body with
  -- CRLF line endings, so an exact-text replace() written with LF silently
  -- matches nothing. The guard below is what caught that.
  --
  -- The alias `qr` is kept so only the source table and the join column
  -- change; every other reference in the CTE stays as it is.
  _def := regexp_replace(
    _def,
    'public\.question_records\s+qr\s+ON\s+qr\.question_id\s*=\s*qb\.id',
    'public.question_attempts qr ON qr.bank_question_id = qb.id',
    'g'
  );

  -- attempted: every attempt on the question, correct or not.
  _def := regexp_replace(
    _def,
    'qr\.current_status\s+IN\s*\(\s*''correct''\s*,\s*''wrong''\s*\)\s+AND\s+qr\.attempt_count\s*>\s*0',
    'true',
    'g'
  );

  -- correct: the per-concept numerator. Reads question_attempts.is_correct,
  -- which is itself forbidden per-question correctness and is scheduled for
  -- removal — see the batch note at the top of this file. This migration
  -- changes where the number comes from, not whether it is stored.
  _def := regexp_replace(
    _def,
    'qr\.current_status\s*=\s*''correct''\s+AND\s+qr\.attempt_count\s*>\s*0',
    'qr.is_correct IS TRUE',
    'g'
  );

  IF _def LIKE '%question_records%' THEN
    RAISE EXCEPTION 'failed to repoint _recompute_concept_confidence_for_session off question_records';
  END IF;

  EXECUTE _def;
END $$;

-- ── 9. Retire question_records ──────────────────────────────────────────────
-- Dropping the table deletes the 7 forbidden correct-only rows as a
-- consequence of the design change rather than as a special-case DELETE.
DROP FUNCTION IF EXISTS public._upsert_question_record(
  uuid, uuid, uuid, uuid, text, text, text, uuid, int, jsonb
);

DROP TABLE IF EXISTS public.question_records;

COMMIT;
