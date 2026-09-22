-- ════════════════════════════════════════════════════════════════════════════
-- REVISION STOPS WAITING FOR RECOVERY, AND THE CLOCK STOPS BEING UNREACHABLE
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT WAS MEASURED, 2026-09-15, on production
--
--     students who have practised .................. 42
--     chapter_state rows ............................ 1
--     chapters ever recovered ....................... 0
--     chapters with a revision date ................. 0
--     recovery sessions ever created ................ 0
--     revision sessions ever created ................ 0
--     concept_mastery rows (all 42 students) ...... 447
--
-- The loop has never fired once, for anybody, since it was built. Not a bug in
-- the arithmetic — the arithmetic was fixed over the preceding six migrations.
-- Two gates, both unreachable:
--
--   1. RECOVERY_TRIGGER_COUNT = 5 open mistakes in one chapter.
--      Every open mistake in the database, grouped by student and chapter:
--        1 mistake: 5 students · 2 mistakes: 3 students · 6 mistakes: 1 student
--      One student has ever reached five.
--
--   2. REVISION_ENGAGEMENT_MIN = 10 questions attempted in one chapter in one
--      session, read from chapter_tally. Every tally row ever written:
--        rows 11 · mean attempted 2.3 · max attempted 5 · rows at 10+: ZERO
--      Nobody has ever reached ten, so no revision clock has ever started.
--
-- AND A THIRD PROBLEM THAT IS NOT A THRESHOLD
--
-- Revision was reachable only through recovery: a chapter had to accumulate
-- mistakes, be recovered, and only then did it get a date. That inverts the
-- feature. Forgetting is not caused by failing. A student who scores 90% in a
-- chapter never triggers recovery, so under the old flow the app never asked
-- him about that chapter again — the students whose good work most deserves
-- protecting were the only ones getting nothing.
--
-- So: a revision is booked off the PRACTICE SESSION itself, for every chapter
-- the student really worked in, whether or not there is anything to recover
-- and whether or not any recovery was done.
--
-- WHAT THIS MIGRATION CHANGES
--   1. recovery_constants — the new schedule and the per-mistake ladder's
--      inputs. The four old RECOVERY_TIER* rows are NOT removed here; the
--      ladder still reads them until the next migration rewrites it, and
--      _recovery_const RAISES on a missing key, so removing them now would
--      break every recovery plan between the two migrations.
--   2. _revision_interval_days — weekly three times, then every 30 days for
--      ever, instead of 7/21/60-then-NULL.
--   3. _apply_chapter_state — books revision off engagement alone, does not
--      reset a stage the student has already earned, and no longer pretends a
--      chapter is at 'has_mistakes' when the reason it is here is that the
--      student practised it well.
--
-- ROLLBACK: supabase/migrations/rollback/20261006000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The constants ───────────────────────────────────────────────────────
--
-- Mirrors src/academic/recovery/constants.ts, and `npm run
-- check:recovery-constants` fails if the two homes disagree on any key.

UPDATE public.recovery_constants SET
  value = 1,
  rationale = 'ONE. Five was measured on 2026-09-15 to exclude 8 of the 9 students who had anything to recover; one student in the whole database had ever reached it, and zero recovery sessions existed. The "a one-mistake chapter is a false sense of progress" worry is answered by the session being four questions laddered off that one mistake, not by refusing to build one.',
  updated_at = now()
WHERE key = 'RECOVERY_TRIGGER_COUNT';

UPDATE public.recovery_constants SET
  value = 3,
  rationale = 'THREE. Ten was the second off switch: every chapter_tally row ever written averages 2.3 attempted and peaks at 5, so no chapter had ever reached ten and no revision clock had ever started. Three rather than one because a real 20-question session spans ~9 chapters at ~2 questions each, and at one this would book nine revisions off a single sitting.',
  updated_at = now()
WHERE key = 'REVISION_ENGAGEMENT_MIN';

UPDATE public.recovery_constants SET
  value = 7,
  rationale = 'Weekly. Tripling (7/21/60) is the right shape for a deck a student owns for years and the wrong one for a school term: the 21-day check lands after the chapter has been taught past, and the 60-day check spends most of a board candidate''s runway.',
  updated_at = now()
WHERE key IN ('REVISION_INTERVAL_2', 'REVISION_INTERVAL_3');

INSERT INTO public.recovery_constants (key, value, spec_ref, rationale) VALUES
  ('REVISION_INTERVAL_SOLID', 30, '§5.3',
   'After REVISION_STAGES_TO_SOLID passes the chapter keeps a check at this interval INDEFINITELY. The old behaviour returned NULL past stage 3, dropping the chapter out of the schedule for ever — the same mistake as gating revision on recovery, one level down. A guess, and the first number to revisit once checks are actually being completed.'),
  ('REVISION_MISTAKE_MAX', 5, '§5.4',
   'Open mistakes from the chapter carried into a revision check ON TOP of the fresh questions. Fresh-only cannot tell the student whether the specific things they got wrong have stuck; mistakes-only tests those questions rather than the chapter. Counted separately so "you still miss the same two" and "you have lost the chapter" stay distinguishable.'),
  ('RECOVERY_DEEP_MAX_MISTAKES', 2, '§4.2',
   'At or below this many open mistakes, every mistake gets the full four-rung ladder.'),
  ('RECOVERY_WIDE_MAX_MISTAKES', 8, '§4.2',
   'Above DEEP and up to this, every mistake gets tiers 0, 1 and 2. Tier 3 is dropped: a student with six open mistakes in one chapter is not yet at the transfer question.'),
  ('RECOVERY_RELEARN_ABOVE', 8, '§4.2',
   'Above this, a recovery session is the wrong answer and is not offered. Nine or more mistakes in one chapter means the chapter was not learned; twenty-seven variant questions is punishment, not recovery. A refusal to DRILL, never a refusal to help, and never silent.'),
  ('RECOVERY_DEEP_TIER0', 1, '§4.2', 'DEEP mode, questions per mistake at tier 0 (the original).'),
  ('RECOVERY_DEEP_TIER1', 1, '§4.2', 'DEEP mode, per mistake at tier 1 (same question, new values).'),
  ('RECOVERY_DEEP_TIER2', 1, '§4.2', 'DEEP mode, per mistake at tier 2 (same idea, new structure).'),
  ('RECOVERY_DEEP_TIER3', 1, '§4.2', 'DEEP mode, per mistake at tier 3 (far application).'),
  ('RECOVERY_WIDE_TIER0', 1, '§4.2', 'WIDE mode, per mistake at tier 0.'),
  ('RECOVERY_WIDE_TIER1', 1, '§4.2', 'WIDE mode, per mistake at tier 1.'),
  ('RECOVERY_WIDE_TIER2', 1, '§4.2',
   'WIDE mode, per mistake at tier 2. One per mistake rather than zero: §4.2b needs a conceptual rate, and at three mistakes this is what keeps that rate above RECOVERY_MIN_CONCEPTUAL_TO_OFFER.'),
  ('RECOVERY_WIDE_TIER3', 0, '§4.2', 'WIDE mode drops tier 3 entirely.')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      spec_ref = EXCLUDED.spec_ref,
      rationale = EXCLUDED.rationale,
      updated_at = now();

-- A typo in any key above would leave the ladder reading a constant that does
-- not exist, and _recovery_const raises only when something finally calls it.
-- Assert now, in the transaction that wrote them.
DO $check$
DECLARE _missing text;
BEGIN
  SELECT string_agg(k, ', ') INTO _missing
    FROM unnest(ARRAY[
      'RECOVERY_TRIGGER_COUNT','REVISION_ENGAGEMENT_MIN','REVISION_INTERVAL_1',
      'REVISION_INTERVAL_2','REVISION_INTERVAL_3','REVISION_INTERVAL_SOLID',
      'REVISION_MISTAKE_MAX','REVISION_STAGES_TO_SOLID',
      'RECOVERY_DEEP_MAX_MISTAKES','RECOVERY_WIDE_MAX_MISTAKES','RECOVERY_RELEARN_ABOVE',
      'RECOVERY_DEEP_TIER0','RECOVERY_DEEP_TIER1','RECOVERY_DEEP_TIER2','RECOVERY_DEEP_TIER3',
      'RECOVERY_WIDE_TIER0','RECOVERY_WIDE_TIER1','RECOVERY_WIDE_TIER2','RECOVERY_WIDE_TIER3'
    ]) AS k
   WHERE NOT EXISTS (SELECT 1 FROM public.recovery_constants rc WHERE rc.key = k);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'recovery_constants is missing: %', _missing;
  END IF;

  IF public._recovery_const('REVISION_INTERVAL_2')::int <> 7
     OR public._recovery_const('RECOVERY_TRIGGER_COUNT')::int <> 1
     OR public._recovery_const('REVISION_ENGAGEMENT_MIN')::int <> 3 THEN
    RAISE EXCEPTION 'the UPDATEs above did not take — a WHERE clause matched nothing';
  END IF;
END $check$;


-- ── 2. The interval ladder ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._revision_interval_days(_stage integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE _solid int;
BEGIN
  -- Stage 0 and below is not a stage; there is no interval to give.
  IF _stage IS NULL OR _stage <= 0 THEN RETURN NULL; END IF;

  -- Stages 1..3: weekly.
  IF _stage <= public._recovery_const('REVISION_STAGES_TO_SOLID')::int THEN
    RETURN public._recovery_const('REVISION_INTERVAL_' || _stage::text)::int;
  END IF;

  -- Past the last numbered stage the chapter is SOLID, and solid is not
  -- finished. The old body returned NULL here, which dropped the chapter out
  -- of the schedule permanently — a student who proved they knew a chapter
  -- three times was never asked about it again.
  _solid := public._recovery_const('REVISION_INTERVAL_SOLID')::int;
  IF _solid IS NULL OR _solid <= 0 THEN
    RAISE EXCEPTION 'REVISION_INTERVAL_SOLID must be a positive number of days, got %', _solid;
  END IF;
  RETURN _solid;
END;
$fn$;

COMMENT ON FUNCTION public._revision_interval_days(integer) IS
  'Days until the next revision check at a given stage. Weekly for the first REVISION_STAGES_TO_SOLID checks, then REVISION_INTERVAL_SOLID for ever. Never returns NULL for a real stage: a chapter leaving the schedule permanently is the bug this replaced.';


-- ── 3. The state machine ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._apply_chapter_state(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
  _interval_1    := public._revision_interval_days(1);

  IF _trigger_count IS NULL OR _engage_min IS NULL OR _interval_1 IS NULL THEN
    RAISE EXCEPTION 'recovery constants missing — refusing to run the state machine on defaults';
  END IF;

  ------------------------------------------------------------------
  -- The trigger: chapters that now have >= RECOVERY_TRIGGER_COUNT open
  -- mistakes. At one, that is any chapter with an open mistake.
  ------------------------------------------------------------------
  -- Counted over the whole mistake book for the chapter, not just this
  -- session: a mistake made two sessions ago is still open and still the
  -- student's. The trigger is a level, not an event.
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
      -- A chapter already being worked on is not dragged backwards. Recovery
      -- and revision own their own transitions.
      SET state = CASE WHEN public.chapter_state.state IN ('untouched', 'has_mistakes')
                       THEN 'has_mistakes' ELSE public.chapter_state.state END,
          updated_at = now();
    _triggered := _triggered + 1;
  END LOOP;

  ------------------------------------------------------------------
  -- The clock: every chapter this session really worked in.
  ------------------------------------------------------------------
  -- NOT gated on recovery, on mistakes, or on the chapter's state. A student
  -- who practised a chapter and got everything right is exactly the student
  -- whose revision matters, and under the previous design he was the one who
  -- never got one.
  FOR _r IN
    SELECT ct.chapter_id, ct.attempted
      FROM public.chapter_tally ct
     WHERE ct.session_id = _session_id
       AND ct.attempted >= _engage_min
  LOOP
    INSERT INTO public.chapter_state (
      user_id, student_id, school_id, chapter_id, state, next_revision_at, revision_stage)
    VALUES (
      _ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id,
      -- 'untouched' is the honest state for a chapter whose only claim on the
      -- engine is that it was practised. The old body wrote 'has_mistakes'
      -- here, which labelled a student who scored 20/20 as having mistakes.
      'untouched',
      now() + (_interval_1 || ' days')::interval, 1)
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      -- §5.2: re-engaging RESETS the clock — a student actively working on
      -- something does not need reminding to revise it. So the DATE moves.
      --
      -- The STAGE does not. The old body reset revision_stage to 1 here,
      -- which meant a student who kept practising a chapter could never reach
      -- solid: every visit threw away checks they had already passed. A pass
      -- is earned; practising afterwards does not un-earn it.
      SET next_revision_at = now() + (_interval_1 || ' days')::interval,
          updated_at       = now();
    _scheduled := _scheduled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'chapters_at_trigger', _triggered,
    'chapters_scheduled', _scheduled
  );
END;
$fn$;

COMMENT ON FUNCTION public._apply_chapter_state(uuid) IS
  'Run at the end of a practice session. Marks chapters that hold open mistakes, and books a revision for every chapter the session really worked in — independently of recovery, of mistakes, and of the chapter''s state. Moves the revision date on re-engagement; never resets a stage the student has already passed.';

COMMIT;
