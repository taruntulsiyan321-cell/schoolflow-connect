-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7C-A — the recovery/revision tables, and a writer for chapter_tally
--
-- 7C is a CONVERGENCE, not a greenfield build, and the grain is the whole
-- reason:
--
--   revision_queue          206 rows   subject, chapter TEXT, topic
--   recovery_assignments      3 rows   subject, chapter TEXT, concept, subconcept
--   spec §2                            "All triggers, thresholds and scheduling
--                                       operate on chapter_id"
--
-- Measured before deciding anything: **6 of the 206 revision_queue rows
-- resolve to a real chapter.** 200 of them were written in a single bulk run
-- on 2026-08-28 and NONE of those resolve — they carry placeholder strings
-- like 'Chapter 3'. `_rebuild_revision_queue` sources from
-- `_weak_topics_for_user` and matches rows by string comparison
-- (COALESCE(chapter,'') = COALESCE(...)), which is exactly the free-text
-- triggering §10.10 forbids, doing exactly what it was built to do on labels
-- that point at nothing.
--
-- So the migration everyone feared is small: carry the handful that resolve,
-- and the rest were never pointing anywhere. That is evidence FOR the
-- chapter_id rule, not a cost of adopting it.
--
-- This migration adds the new tables only. The old ones stay live and are
-- dropped LAST, after the readers are repointed — the 7.5 ordering, for the
-- same reason: removing them first takes the feature with them.
--
-- ── chapter_tally has no writer ───────────────────────────────────────────
--
-- It was built in 7B and holds 0 rows; nothing in the database or the client
-- writes one. §3.1 is unambiguous — "Every accuracy figure, every trend, and
-- every 'is this improving' answer comes from this table. Without it, analysis
-- cannot be built." So §6 is currently unbuildable and 7C verification item 1
-- tests a table nothing populates. Section 4 below gives it a writer.
--
-- ── Naming, reconciled against the live schema ────────────────────────────
--
--   spec `practice_mistakes`  -> `student_mistakes` (7B's nominated authority)
--   spec `institution_id`     -> `school_id` (project-wide convention)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. chapter_state — one row per student per chapter ────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_state (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id                 uuid REFERENCES public.students(id) ON DELETE CASCADE,
  school_id                  uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  chapter_id                 uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  state                      text NOT NULL DEFAULT 'untouched',
  recovered_at               timestamptz,
  next_revision_at           timestamptz,
  revision_stage             integer NOT NULL DEFAULT 0 CHECK (revision_stage >= 0),
  consecutive_revision_passes integer NOT NULL DEFAULT 0 CHECK (consecutive_revision_passes >= 0),
  last_recovery_readiness    numeric CHECK (last_recovery_readiness IS NULL
                                            OR (last_recovery_readiness >= 0 AND last_recovery_readiness <= 1)),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chapter_state_one_per_student_chapter UNIQUE (user_id, chapter_id),
  CONSTRAINT chapter_state_state_check CHECK (state = ANY (ARRAY[
    'untouched', 'has_mistakes', 'in_recovery', 'recovered', 'revision_due', 'revision_failed'])),
  -- G4: last_recovery_readiness is NULLABLE and stays null when no recovery
  -- session has been taken. A student who cleared without one has no readiness,
  -- which is a different statement from a readiness of 0. §4.4 relies on the
  -- difference: "cleared at 52% readiness, failed revision" is only honest if
  -- "cleared with no session at all" reads differently.
  CONSTRAINT chapter_state_recovered_has_timestamp
    CHECK ((state = 'recovered') <= (recovered_at IS NOT NULL))
);

-- ── 2. recovery_sessions — FOUR tier results, never one score ─────────────
-- The build doc is explicit: "Per-tier counts, never one total. The diagnostic
-- value is entirely in the split — procedural passing while conceptual fails
-- is the most common real result." A single `score` column here would destroy
-- the only thing the feature detects that a percentage cannot.
CREATE TABLE IF NOT EXISTS public.recovery_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id       uuid REFERENCES public.students(id) ON DELETE CASCADE,
  school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  chapter_id       uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  round            integer NOT NULL DEFAULT 1 CHECK (round >= 1),
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,

  tier0_correct    integer NOT NULL DEFAULT 0 CHECK (tier0_correct >= 0),
  tier0_total      integer NOT NULL DEFAULT 0 CHECK (tier0_total >= 0),
  tier1_correct    integer NOT NULL DEFAULT 0 CHECK (tier1_correct >= 0),
  tier1_total      integer NOT NULL DEFAULT 0 CHECK (tier1_total >= 0),
  tier2_correct    integer NOT NULL DEFAULT 0 CHECK (tier2_correct >= 0),
  tier2_total      integer NOT NULL DEFAULT 0 CHECK (tier2_total >= 0),
  tier3_correct    integer NOT NULL DEFAULT 0 CHECK (tier3_correct >= 0),
  tier3_total      integer NOT NULL DEFAULT 0 CHECK (tier3_total >= 0),

  -- Stored rather than derived, because §4.4 needs the readiness AS IT WAS at
  -- the moment the student cleared. Recomputing it later from the tier counts
  -- would silently change history if a threshold is ever tuned — and §10 says
  -- these thresholds are expected to be tuned.
  procedural_rate  numeric CHECK (procedural_rate IS NULL OR (procedural_rate >= 0 AND procedural_rate <= 1)),
  conceptual_rate  numeric CHECK (conceptual_rate IS NULL OR (conceptual_rate >= 0 AND conceptual_rate <= 1)),
  readiness        numeric CHECK (readiness IS NULL OR (readiness >= 0 AND readiness <= 1)),
  outcome          text CHECK (outcome IS NULL OR outcome = ANY (ARRAY['ready', 'not_ready', 'abandoned'])),

  CONSTRAINT recovery_sessions_tier_totals CHECK (
    tier0_correct <= tier0_total AND tier1_correct <= tier1_total AND
    tier2_correct <= tier2_total AND tier3_correct <= tier3_total)
);

-- ── 3. revision_sessions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.revision_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id    uuid REFERENCES public.students(id) ON DELETE CASCADE,
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  chapter_id    uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  stage         integer NOT NULL CHECK (stage >= 1),
  correct       integer NOT NULL DEFAULT 0 CHECK (correct >= 0),
  total         integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  passed        boolean,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  -- §5.2: the two paths differ only in what failure costs, so which one started
  -- the clock has to be recorded or the failure cannot be handled correctly.
  triggered_by  text NOT NULL CHECK (triggered_by = ANY (ARRAY['recovery', 'engagement'])),
  CONSTRAINT revision_sessions_correct_le_total CHECK (correct <= total)
);

CREATE INDEX IF NOT EXISTS chapter_state_user_idx      ON public.chapter_state (user_id);
CREATE INDEX IF NOT EXISTS chapter_state_due_idx       ON public.chapter_state (next_revision_at)
  WHERE next_revision_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS recovery_sessions_user_idx  ON public.recovery_sessions (user_id, chapter_id);
CREATE INDEX IF NOT EXISTS revision_sessions_user_idx  ON public.revision_sessions (user_id, chapter_id);

-- ── 4. RLS — practice-private, the 6.6/6.7 pattern ────────────────────────
-- All three are practice data under §10.8: readable by the student and nobody
-- else. Not teacher, parent, principal, admin, or any aggregate. school_id is
-- NOT NULL on all three, so no fence carries an `IS NULL` arm.
ALTER TABLE public.chapter_state      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revision_sessions  ENABLE ROW LEVEL SECURITY;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chapter_state', 'recovery_sessions', 'revision_sessions'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated
         USING      (school_id IN (SELECT public.my_accessible_school_ids()))
         WITH CHECK (school_id IN (SELECT public.my_accessible_school_ids()))',
      t || '_tenant_fence', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING      (user_id = (SELECT auth.uid()))
         WITH CHECK (user_id = (SELECT auth.uid()))',
      t || '_self', t);
  END LOOP;
END $rls$;

-- ── 5. A writer for chapter_tally ─────────────────────────────────────────
-- §3.1: "one row per chapter per session, not per question. A session covering
-- three chapters writes three rows." That is 7C verification item 1, and until
-- now nothing wrote a single row.
--
-- Appended to rpc_finish_practice_session, immediately before it returns, and
-- matched literally rather than by regex — this chunk produced four
-- substitution traps and a lazy quantifier that ate a function's closing END.
CREATE OR REPLACE FUNCTION public._write_chapter_tally(_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _n integer := 0;
BEGIN
  -- One row per DISTINCT chapter in the session. The grain is the whole point:
  -- per-question storage is what this table exists to make unnecessary, and a
  -- per-question row would also be per-question correctness, which §10.8
  -- forbids for practice.
  --
  -- chapter_id comes from the question bank, never from the free-text chapter
  -- label — that label is what filled revision_queue with 'Chapter 3'.
  INSERT INTO public.chapter_tally (user_id, student_id, school_id, chapter_id, session_id, attempted, correct)
  SELECT ps.user_id, ps.student_id, ps.school_id, qb.chapter_id, ps.id,
         count(*)::int,
         count(*) FILTER (WHERE qa.is_correct IS TRUE)::int
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps ON ps.id = qa.session_id
    JOIN public.question_bank qb     ON qb.id = qa.bank_question_id
   WHERE qa.session_id = _session_id
     AND qb.chapter_id IS NOT NULL
   GROUP BY ps.user_id, ps.student_id, ps.school_id, qb.chapter_id, ps.id
  ON CONFLICT (session_id, chapter_id) DO UPDATE
    SET attempted = EXCLUDED.attempted,
        correct   = EXCLUDED.correct;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

-- Internal: called by rpc_finish_practice_session, never by a client.
REVOKE ALL ON FUNCTION public._write_chapter_tally(uuid) FROM PUBLIC, anon, authenticated;

DO $wire$
DECLARE _def text; _new text; _nl text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_practice_session';
  IF _def IS NULL THEN
    RAISE EXCEPTION '7C-A: rpc_finish_practice_session not found';
  END IF;

  IF _def ~ '_write_chapter_tally' THEN
    RAISE NOTICE '7C-A: rpc_finish_practice_session already writes the tally';
  ELSE
    -- Inserted BEFORE the RETURN, not before END. The function's last
    -- statement is `RETURN jsonb_build_object(...)` at line 150 of 164, so
    -- anything appended ahead of END; would sit after the return and never
    -- run — a tally write that silently never fires, which is the failure
    -- this chunk keeps producing (G15).
    --
    -- The body uses CRLF, so the newline is chr(13)||chr(10). Matching on
    -- chr(10) alone found nothing and the guard below caught it; that is the
    -- third time CRLF has cost a substitution in this chunk.
    _nl := chr(13) || chr(10);
    _new := replace(_def,
      '  RETURN jsonb_build_object(' || _nl,
      '  -- §3.1: the denominator. Eight open mistakes in Cash Flow means' || _nl ||
      '  -- something entirely different out of 20 questions than out of 200.' || _nl ||
      '  BEGIN' || _nl ||
      '    PERFORM public._write_chapter_tally(_session_id);' || _nl ||
      '  EXCEPTION WHEN OTHERS THEN' || _nl ||
      '    RAISE WARNING ''rpc_finish_practice_session(%): chapter tally failed: %'', _session_id, SQLERRM;' || _nl ||
      '  END;' || _nl || _nl ||
      '  RETURN jsonb_build_object(' || _nl);

    IF _new = _def THEN
      RAISE EXCEPTION '7C-A: could not append the tally write to rpc_finish_practice_session';
    END IF;
    EXECUTE _new;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='rpc_finish_practice_session'
       AND p.prosrc ~ '_write_chapter_tally'
  ) THEN
    RAISE EXCEPTION '7C-A: the tally write is not present after the rewrite';
  END IF;
END
$wire$;

COMMIT;
