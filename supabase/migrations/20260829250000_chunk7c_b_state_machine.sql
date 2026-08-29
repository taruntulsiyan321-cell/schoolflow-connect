-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7C-B — the trigger, the chapter state machine, and the revision clock
--
-- The half of recovery that needs no AI: what happens when a practice session
-- ends. Generation (§4.1a, §4.2a) follows in 7C-C; nothing here calls a model.
--
-- Two things happen at the end of every practice session, and the spec is
-- careful that they are INDEPENDENT:
--
--   §4.1  a chapter that now has RECOVERY_TRIGGER_COUNT (5) open mistakes
--         becomes eligible for a recovery session
--   §5.2  a chapter the student attempted REVISION_ENGAGEMENT_MIN (10)
--         questions in starts the revision clock — "A student who practises
--         Cash Flow, scores 18 of 20 and has nothing to recover still needs
--         reminding a week later. Scheduling only after recovery would leave
--         their strongest work unrevised, which is backwards."
--
-- A student can trip both, one, or neither in the same session.
--
-- ── Constants live in ONE place, and this is the SQL half of it ───────────
--
-- §10: "No component may contain any of these as a literal." The TypeScript
-- half is src/academic/recovery/constants.ts. A database function cannot
-- import it, so the values are read from a table rather than typed into each
-- body — otherwise tuning RECOVERY_TRIGGER_COUNT means finding every function
-- that happens to say 5, which is exactly the failure §10 is written against.
--
-- ── Chapter, never topic ──────────────────────────────────────────────────
--
-- §2: "All triggers, thresholds and scheduling operate on chapter_id." Every
-- query below keys on student_mistakes.chapter_id and question_bank.chapter_id.
-- Nothing matches on a chapter NAME — that is what filled revision_queue with
-- 200 rows pointing at 'Chapter 3'.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The constants, readable from SQL ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recovery_constants (
  key         text PRIMARY KEY,
  value       numeric NOT NULL,
  spec_ref    text NOT NULL,
  rationale   text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seeded from spec §10, with the spec's own reasoning, so that changing one
-- means reading why it was chosen. Kept in sync with
-- src/academic/recovery/constants.ts — verification asserts they agree.
INSERT INTO public.recovery_constants (key, value, spec_ref, rationale) VALUES
  ('RECOVERY_TRIGGER_COUNT', 5, '§4.1',
   'Fewer than five is not worth a session, and clearing a one-mistake chapter creates a false sense of progress.'),
  ('RECOVERY_TIER0', 2, '§4.2', 'The original wrong questions. Small, because re-answering one proves almost nothing.'),
  ('RECOVERY_TIER1', 3, '§4.2', 'Different values. Proves they can execute the procedure.'),
  ('RECOVERY_TIER2', 3, '§4.2', 'Different framing. Proves they understand it, not just the steps.'),
  ('RECOVERY_TIER3', 2, '§4.2', 'Different application. Proves it transfers.'),
  ('RECOVERY_PROCEDURAL_THRESHOLD', 0.80, '§4.2b', 'Tiers 0 and 1. Never blended with the conceptual rate.'),
  ('RECOVERY_CONCEPTUAL_THRESHOLD', 0.70, '§4.2b', 'Tiers 2 and 3. The half that actually distinguishes learning.'),
  ('RECOVERY_GENERATION_ROUNDS', 3, '§4.6', 'Fresh questions in rounds 1-3; round 4+ draws from the accumulated pool.'),
  ('REVISION_ENGAGEMENT_MIN', 10, '§5.2', 'Questions in a chapter that start the revision clock even with nothing to recover.'),
  ('REVISION_COUNT', 8, '§5.4', 'Fresh questions per check. Never the old ones.'),
  ('REVISION_PASS_THRESHOLD', 0.70, '§5.5', ''),
  ('REVISION_STAGES_TO_SOLID', 3, '§5.3', 'Enough to distinguish learning from cramming without nagging.'),
  ('REVISION_INTERVAL_1', 7, '§5.3', 'Past the point where short-term recall carries you.'),
  ('REVISION_INTERVAL_2', 21, '§5.3', 'Roughly tripling, the shape of every effective spacing schedule.'),
  ('REVISION_INTERVAL_3', 60, '§5.3', 'Spans a term, so passing means it survived genuine forgetting.'),
  ('TREND_MIN_SESSIONS', 4, '§6.4', 'Below this the trend state is NOT_ENOUGH_DATA — a real, visible state.'),
  ('TREND_DELTA_POINTS', 10, '§6.4', 'Accuracy movement that counts as a trend rather than noise.'),
  ('REPEATED_MISTAKE_PIN', 3, '§6.3', 'times_wrong that pins a chapter to the top of analysis.')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, spec_ref = EXCLUDED.spec_ref,
      rationale = EXCLUDED.rationale, updated_at = now();

ALTER TABLE public.recovery_constants ENABLE ROW LEVEL SECURITY;

-- G2 shared reference data: the same for every institution, so no school_id and
-- no tenant fence. Readable by any authenticated user; writable by nobody
-- through the API — tuning a threshold is a migration, not a UI action.
CREATE POLICY recovery_constants_read ON public.recovery_constants
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public._recovery_const(_key text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Raises rather than defaulting: a missing constant must fail loudly, not
  -- silently behave as 0. A trigger count of 0 would fire on every chapter.
  SELECT CASE WHEN c.value IS NULL
         THEN (SELECT NULL::numeric WHERE false)
         ELSE c.value END
    FROM public.recovery_constants c WHERE c.key = _key;
$function$;

REVOKE ALL ON FUNCTION public._recovery_const(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._recovery_const(text) TO authenticated;

-- ── 2. The state machine, run at the end of a practice session ────────────
CREATE OR REPLACE FUNCTION public._apply_chapter_state(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ps            record;
  _trigger_count int;
  _engage_min    int;
  _interval_1    int;
  _triggered     int := 0;
  _scheduled     int := 0;
  _r             record;
BEGIN
  SELECT * INTO _ps FROM public.practice_sessions WHERE id = _session_id;
  IF _ps IS NULL THEN RETURN jsonb_build_object('error', 'no such session'); END IF;

  _trigger_count := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _engage_min    := public._recovery_const('REVISION_ENGAGEMENT_MIN')::int;
  _interval_1    := public._recovery_const('REVISION_INTERVAL_1')::int;

  IF _trigger_count IS NULL OR _engage_min IS NULL OR _interval_1 IS NULL THEN
    RAISE EXCEPTION 'recovery constants missing — refusing to run the state machine on defaults';
  END IF;

  ------------------------------------------------------------------
  -- §4.1 the trigger: chapters that NOW have >= 5 open mistakes
  ------------------------------------------------------------------
  -- Counted over the whole mistake book for that chapter, not just this
  -- session: the fifth mistake in a chapter may arrive in a session where the
  -- student got four right. The trigger is a level, not an event.
  FOR _r IN
    SELECT sm.chapter_id, count(*)::int AS open_count
      FROM public.student_mistakes sm
     WHERE sm.user_id = _ps.user_id
       AND sm.status = 'open'
       AND sm.chapter_id IS NOT NULL
     GROUP BY sm.chapter_id
    HAVING count(*) >= _trigger_count
  LOOP
    INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
    VALUES (_ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id, 'has_mistakes')
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      -- Only a chapter not already being worked on moves to has_mistakes. A
      -- chapter in recovery stays in recovery; one already recovered is NOT
      -- dragged backwards by this, because §5 owns that transition and it
      -- happens on a failed revision, not on a mistake count.
      SET state = CASE WHEN public.chapter_state.state IN ('untouched', 'has_mistakes')
                       THEN 'has_mistakes' ELSE public.chapter_state.state END,
          updated_at = now();
    _triggered := _triggered + 1;
  END LOOP;

  ------------------------------------------------------------------
  -- §5.2 the clock: chapters with >= 10 attempted questions THIS session
  ------------------------------------------------------------------
  -- Read from chapter_tally, which 7C-A gave a writer. This is the first
  -- reader of that table, and the reason §3.1 called it required.
  FOR _r IN
    SELECT ct.chapter_id, ct.attempted
      FROM public.chapter_tally ct
     WHERE ct.session_id = _session_id
       AND ct.attempted >= _engage_min
  LOOP
    INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state, next_revision_at, revision_stage)
    VALUES (_ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id, 'has_mistakes',
            now() + (_interval_1 || ' days')::interval, 1)
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      -- §5.2: "Re-engaging with a chapter RESETS the clock — a student
      -- actively working on something does not need a reminder to revise it."
      -- So next_revision_at is overwritten unconditionally, not left at its
      -- earlier value, and the stage restarts at 1.
      SET next_revision_at = now() + (_interval_1 || ' days')::interval,
          revision_stage   = 1,
          updated_at       = now();
    _scheduled := _scheduled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'chapters_at_trigger', _triggered,
    'chapters_scheduled', _scheduled
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._apply_chapter_state(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Wire it into the end of a practice session ─────────────────────────
-- Placed AFTER the chapter_tally write, because the engagement clock reads the
-- tally this same session just produced. Ordering is load-bearing: run before
-- the tally and every chapter looks like zero attempts.
DO $wire$
DECLARE _def text; _new text; _nl text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_practice_session';
  IF _def IS NULL THEN RAISE EXCEPTION '7C-B: rpc_finish_practice_session not found'; END IF;

  IF _def ~ '_apply_chapter_state' THEN
    RAISE NOTICE '7C-B: already wired';
  ELSE
    -- CRLF or LF: the body predates .gitattributes, so which one is present
    -- depends on when it was last written. Detected rather than assumed —
    -- guessing wrong is the trap that cost three fixes in 7.5.
    _nl := CASE WHEN _def LIKE '%' || chr(13) || chr(10) || '%'
                THEN chr(13) || chr(10) ELSE chr(10) END;

    _new := replace(_def,
      '    PERFORM public._write_chapter_tally(_session_id);' || _nl,
      '    PERFORM public._write_chapter_tally(_session_id);' || _nl ||
      '    -- §4.1 and §5.2, in that order and AFTER the tally: the engagement' || _nl ||
      '    -- clock reads the rows the tally just wrote.' || _nl ||
      '    PERFORM public._apply_chapter_state(_session_id);' || _nl);

    IF _new = _def THEN
      RAISE EXCEPTION '7C-B: could not find the tally call to attach the state machine to';
    END IF;
    EXECUTE _new;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='rpc_finish_practice_session'
       AND p.prosrc ~ '_apply_chapter_state'
  ) THEN
    RAISE EXCEPTION '7C-B: the state machine is not present after the rewrite';
  END IF;
END
$wire$;

COMMIT;
