-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Chunk 7B batch 1 (20260828170000_chunk7b_batch1_practice_tables)
--
-- Reverses the structure. Read the two limits below before running it; they
-- are properties of the change, not omissions in this script.
--
-- LIMIT 1 — the 7 forbidden rows do not come back, by design.
--   question_records held 7 rows recording that a student answered correctly,
--   which the storage rule forbids outright. The table is recreated empty.
--   There is no version of this rollback that restores them without
--   re-introducing the violation the migration existed to remove.
--
-- LIMIT 2 — the 3 migrated mistakes are deliberately NOT removed.
--   They were carried into student_mistakes because question_records was the
--   only place they lived. Deleting them here would lose them entirely, since
--   question_records comes back empty. They stay. Re-applying the migration is
--   safe: its INSERT is guarded by NOT EXISTS on (user_id, question_id).
--
-- Bookmarks and skips: 0 rows existed at apply time, so nothing is stranded in
-- practice_bookmarks / practice_skipped by dropping them here. If this is run
-- after the app has written new bookmarks, those ARE lost — check first:
--   SELECT count(*) FROM public.practice_bookmarks;
--   SELECT count(*) FROM public.practice_skipped;
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Drop the three tables added by the migration ─────────────────────────
DROP TABLE IF EXISTS public.chapter_tally;
DROP TABLE IF EXISTS public.practice_skipped;
DROP TABLE IF EXISTS public.practice_bookmarks;

-- ── 2. Recreate question_records (structure only — see LIMIT 1) ─────────────
CREATE TABLE IF NOT EXISTS public.question_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  student_id          uuid,
  school_id           uuid,
  question_id         uuid NOT NULL,
  current_status      text NOT NULL,
  bookmarked          boolean NOT NULL DEFAULT false,
  attempt_count       integer NOT NULL DEFAULT 0,
  correct_count       integer NOT NULL DEFAULT 0,
  wrong_count         integer NOT NULL DEFAULT 0,
  skipped_count       integer NOT NULL DEFAULT 0,
  question_source     text NOT NULL DEFAULT 'practice',
  last_practice_mode  text,
  last_session_id     uuid,
  last_time_taken_ms  integer,
  last_selected_option jsonb,
  last_practiced_date timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_records_user_question_unique UNIQUE (user_id, question_id)
);

ALTER TABLE public.question_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qrec self" ON public.question_records
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY question_records_tenant_fence ON public.question_records
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR same_school(school_id))
  WITH CHECK (school_id IS NULL OR same_school(school_id));

-- ── 3. Restore _upsert_question_record ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._upsert_question_record(
  _uid uuid,
  _sid uuid,
  _school uuid,
  _question_id uuid,
  _status text,
  _source text DEFAULT 'practice',
  _practice_mode text DEFAULT NULL,
  _session_id uuid DEFAULT NULL,
  _time_taken_ms int DEFAULT NULL,
  _selected_option jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.question_records (
    user_id, student_id, school_id, question_id, current_status,
    question_source, attempt_count, correct_count, wrong_count, skipped_count,
    last_practice_mode, last_session_id, last_time_taken_ms,
    last_selected_option, last_practiced_date, updated_at
  ) VALUES (
    _uid, _sid, _school, _question_id, _status,
    _source, 1,
    CASE WHEN _status = 'correct' THEN 1 ELSE 0 END,
    CASE WHEN _status = 'wrong'   THEN 1 ELSE 0 END,
    CASE WHEN _status = 'skipped' THEN 1 ELSE 0 END,
    _practice_mode, _session_id, _time_taken_ms,
    _selected_option, now(), now()
  )
  ON CONFLICT (user_id, question_id) DO UPDATE SET
    current_status       = EXCLUDED.current_status,
    attempt_count        = public.question_records.attempt_count + 1,
    correct_count        = public.question_records.correct_count
                           + CASE WHEN _status = 'correct' THEN 1 ELSE 0 END,
    wrong_count          = public.question_records.wrong_count
                           + CASE WHEN _status = 'wrong' THEN 1 ELSE 0 END,
    skipped_count        = public.question_records.skipped_count
                           + CASE WHEN _status = 'skipped' THEN 1 ELSE 0 END,
    last_practice_mode   = EXCLUDED.last_practice_mode,
    last_session_id      = EXCLUDED.last_session_id,
    last_time_taken_ms   = EXCLUDED.last_time_taken_ms,
    last_selected_option = EXCLUDED.last_selected_option,
    last_practiced_date  = now(),
    updated_at           = now();
END;
$function$;

GRANT EXECUTE ON FUNCTION public._upsert_question_record(
  uuid, uuid, uuid, uuid, text, text, text, uuid, int, jsonb
) TO authenticated;

-- ── 4. Restore rpc_toggle_question_bookmark to the question_records form ────
CREATE OR REPLACE FUNCTION public.rpc_toggle_question_bookmark(
  _question_id uuid,
  _bookmarked boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid;
  _school uuid;
  _rows int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  UPDATE public.question_records
  SET bookmarked = _bookmarked, updated_at = now()
  WHERE user_id = _uid AND question_id = _question_id;

  GET DIAGNOSTICS _rows = ROW_COUNT;
  IF _rows > 0 THEN RETURN _bookmarked; END IF;

  IF _bookmarked THEN
    SELECT id, school_id INTO _sid, _school
    FROM public.students WHERE user_id = _uid LIMIT 1;

    INSERT INTO public.question_records (
      user_id, student_id, school_id, question_id,
      current_status, attempt_count, correct_count, wrong_count, skipped_count,
      bookmarked
    ) VALUES (
      _uid, _sid, _school, _question_id,
      'skipped', 0, 0, 0, 0,
      true
    )
    ON CONFLICT (user_id, question_id) DO UPDATE
      SET bookmarked = true, updated_at = now();
  END IF;

  RETURN _bookmarked;
END;
$function$;

-- ── 5. NOTE on the two patched functions ────────────────────────────────────
-- rpc_record_question_attempt and _recompute_concept_confidence_for_session
-- were patched in place by the migration (textual surgery on their live
-- definitions), so their pre-migration bodies are not reproduced here. After
-- running this rollback, re-apply the migration that last defined them:
--   supabase/migrations/20260822100000_practice_attempt_template_path_idempotency.sql
--   supabase/migrations/20260805090000_fix_double_upsert_concept_mastery_bug11.sql
-- Without that step question_records exists but nothing writes to it, which is
-- inert rather than broken — no code path reads it once the client repoint in
-- this chunk is also reverted.

COMMIT;
