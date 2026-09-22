-- ════════════════════════════════════════════════════════════════════════════
-- A REVISION CHECK IS THE QUESTIONS THEY MISSED, PLUS QUESTIONS THEY HAVE
-- NEVER SEEN — AND "NEVER SEEN" IS NOW ENFORCED
-- ════════════════════════════════════════════════════════════════════════════
--
-- TWO DEFECTS, ONE MISSING FUNCTION
--
-- 1. §5.4 says a check is REVISION_COUNT questions "never seen by this
--    student. Never the old questions." Nothing enforced it. A revision check
--    was an ordinary practice session with ?revision=<chapter>, and the
--    ordinary question picker has no concept of "seen". Measured earlier in
--    this work: 2 of 8 questions in a sampled check had already been answered
--    by that student. A check made of questions they answered last week
--    measures last week, not retention.
--
-- 2. The check contained NOTHING the student had got wrong. So it could not
--    answer the one question a student actually asks — "have the things I kept
--    getting wrong stuck?" — and a chapter could pass three checks while every
--    mistake in it stayed open.
--
-- There was no server-side function that decided what a revision check
-- contains at all. This migration adds one, so the decision has a single home
-- that can be verified, rather than living in whatever the practice loader
-- happened to return.
--
-- WHAT A CHECK IS NOW
--
--   up to REVISION_MISTAKE_MAX (5) open mistakes from the chapter
-- + REVISION_COUNT (8) questions from the chapter the student has NEVER
--   attempted and has never had a mistake recorded against
--
-- Scored as one rate for the pass/fail verdict, and reported as two so the
-- student is told which half went wrong. "You still miss the same two" and
-- "you have lost the chapter" are different diagnoses and must not collapse
-- into a single percentage — the same argument §4.2b makes for recovery.
--
-- THE FLOOR MOVES TO THE FRESH HALF. It used to be "answer REVISION_COUNT
-- questions from this chapter", which a student could satisfy entirely out of
-- their own mistake book — a drill handed in as a retention check. The floor
-- is now on the unseen questions specifically, which is what §5.4 actually
-- fixes the length of.
--
-- ROLLBACK: supabase/migrations/rollback/20261008000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. What a revision check contains ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_revision_session_plan(_chapter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid        uuid := auth.uid();
  _want_fresh int;
  _want_miss  int;
  _fresh      uuid[];
  _misses     uuid[];
  _n_fresh    int;
  _n_miss     int;
  _cs         public.chapter_state%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  -- Same curriculum fence as recovery, in the query layer, raising rather than
  -- returning an empty list — an empty list is indistinguishable from "this
  -- chapter has no questions" and would hide a permissions bug as a content
  -- problem.
  IF NOT public._recovery_chapter_is_mine(_chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id;
  END IF;

  SELECT * INTO _cs FROM public.chapter_state
   WHERE user_id = _uid AND chapter_id = _chapter_id;

  _want_fresh := public._recovery_const('REVISION_COUNT')::int;
  _want_miss  := public._recovery_const('REVISION_MISTAKE_MAX')::int;

  -- ── The misses ─────────────────────────────────────────────────────────
  -- Most-repeated first: a question missed four times is the one the check
  -- most needs to ask about.
  SELECT array_agg(qid) INTO _misses FROM (
    SELECT sm.question_id AS qid
      FROM public.student_mistakes sm
      JOIN public.question_bank qb ON qb.id = sm.question_id
     WHERE sm.user_id = _uid
       AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND sm.question_id IS NOT NULL
       AND qb.is_active
       AND qb.replaced_by_question_id IS NULL
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
     LIMIT _want_miss
  ) t;

  -- ── The unseen ─────────────────────────────────────────────────────────
  -- §5.4, enforced. Two exclusions, and both are needed:
  --   * question_attempts — anything they have ever answered, in any session,
  --     including one they abandoned. Having seen it is what disqualifies it,
  --     not having got it right.
  --   * student_mistakes — a question they got wrong. It would otherwise
  --     arrive in the "fresh" half and be counted as new material.
  SELECT array_agg(qid) INTO _fresh FROM (
    SELECT qb.id AS qid
      FROM public.question_bank qb
     WHERE qb.chapter_id = _chapter_id
       AND qb.is_active
       AND qb.is_approved
       AND qb.replaced_by_question_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.question_attempts qa
          WHERE qa.user_id = _uid AND qa.bank_question_id = qb.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.student_mistakes sm
          WHERE sm.user_id = _uid AND sm.question_id = qb.id)
     ORDER BY qb.created_at
     LIMIT _want_fresh
  ) t;

  _n_fresh := COALESCE(array_length(_fresh, 1), 0);
  _n_miss  := COALESCE(array_length(_misses, 1), 0);

  RETURN jsonb_build_object(
    'chapter_id',      _chapter_id,
    'mistake_ids',     to_jsonb(COALESCE(_misses, ARRAY[]::uuid[])),
    'fresh_ids',       to_jsonb(COALESCE(_fresh, ARRAY[]::uuid[])),
    'question_ids',    to_jsonb(COALESCE(_misses, ARRAY[]::uuid[]) || COALESCE(_fresh, ARRAY[]::uuid[])),
    'mistakes',        _n_miss,
    'fresh',           _n_fresh,
    'fresh_wanted',    _want_fresh,
    -- Short is reported, never padded. A chapter whose bank is exhausted for
    -- this student gives a shorter check and says so; filling the gap with
    -- questions they have already seen would quietly turn a retention check
    -- into a recall check.
    'fresh_short',     greatest(0, _want_fresh - _n_fresh),
    'total',           _n_miss + _n_fresh,
    'stage',           COALESCE(_cs.revision_stage, 1),
    'next_revision_at', _cs.next_revision_at,
    'due',             (_cs.next_revision_at IS NOT NULL AND _cs.next_revision_at <= now()),
    'scheduled',       (_cs.user_id IS NOT NULL));
END;
$fn$;

COMMENT ON FUNCTION public.rpc_revision_session_plan(uuid) IS
  'What a revision check for one chapter contains: up to REVISION_MISTAKE_MAX open mistakes plus REVISION_COUNT questions this student has never attempted and never had a mistake against. The single home for §5.4''s "never the old questions" rule, which previously had no enforcer anywhere.';


-- ── 2. Scoring it ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_submit_revision_session(_chapter_id uuid, _practice_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid      uuid := auth.uid();
  _sid      uuid;
  _school   uuid;
  _cs       public.chapter_state%ROWTYPE;
  _correct  int;
  _total    int;
  _m_correct int;
  _m_total   int;
  _f_correct int;
  _f_total   int;
  _stage    int;
  _pass_thr numeric;
  _rate     numeric;
  _passed   boolean;
  _stages   int;
  _next     int;
  _trigger  text;
  _solid    boolean := false;
  _next_at  timestamptz;
  _state    text;
  _sat_at   timestamptz;
  _since    timestamptz;
  _want     int;
  _avail_fresh int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _cs FROM public.chapter_state
   WHERE user_id = _uid AND chapter_id = _chapter_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'this chapter has no revision scheduled'; END IF;

  SELECT ps.created_at INTO _sat_at
    FROM public.practice_sessions ps
   WHERE ps.id = _practice_session_id AND ps.user_id = _uid;
  IF _sat_at IS NULL THEN
    RAISE EXCEPTION 'practice session not found';
  END IF;

  -- THE SITTING MUST BE SINCE THE LAST TIME THIS CHAPTER WAS ASSESSED.
  -- A session finished a year ago could otherwise be handed in as today's
  -- check, so good work could be banked and spent on any future rung. The
  -- bound is the last assessment, never a clock: §5.3 says timing is a
  -- suggestion and is never enforced, so an EARLY check is still allowed; a
  -- stale one is not.
  SELECT GREATEST(
           COALESCE(_cs.recovered_at, _cs.created_at),
           COALESCE((SELECT max(vs.completed_at) FROM public.revision_sessions vs
                      WHERE vs.user_id = _uid AND vs.chapter_id = _chapter_id), _cs.created_at),
           _cs.created_at)
    INTO _since;

  IF _sat_at < _since THEN
    RAISE EXCEPTION 'that sitting is older than this chapter''s last assessment — sit the check now';
  END IF;

  -- One sitting, one check.
  IF EXISTS (
    SELECT 1 FROM public.revision_sessions vs
     WHERE vs.practice_session_id = _practice_session_id
  ) THEN
    RAISE EXCEPTION 'that practice session has already been recorded as a revision check';
  END IF;

  ------------------------------------------------------------------
  -- The score, split into the two halves the check is made of
  ------------------------------------------------------------------
  -- Joined through question_bank rather than trusting question_attempts.chapter,
  -- which is free text copied from the session. A sitting spent on another
  -- chapter contributes nothing here.
  --
  -- A question counts as a MISS if this student has a mistake row against it,
  -- whatever that row's status now. Classifying by `status = 'open'` would
  -- move a question from the miss half to the fresh half the moment §4.5
  -- cleared it, so the same sitting would score differently depending on the
  -- order rows happened to be updated in.
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int,
    count(*) FILTER (WHERE sm.id IS NOT NULL)::int,
    count(*) FILTER (WHERE sm.id IS NOT NULL
                       AND qa.is_correct AND NOT COALESCE(qa.skipped, false))::int,
    count(*) FILTER (WHERE sm.id IS NULL)::int,
    count(*) FILTER (WHERE sm.id IS NULL
                       AND qa.is_correct AND NOT COALESCE(qa.skipped, false))::int
    INTO _total, _correct, _m_total, _m_correct, _f_total, _f_correct
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    LEFT JOIN LATERAL (
      SELECT sm.id FROM public.student_mistakes sm
       WHERE sm.user_id = _uid AND sm.question_id = qa.bank_question_id
       LIMIT 1
    ) sm ON true
   WHERE qa.session_id = _practice_session_id
     AND qa.user_id = _uid
     AND qb.chapter_id = _chapter_id;

  IF _total IS NULL OR _total = 0 THEN
    RAISE EXCEPTION 'that session answered no question in this chapter — a check with no questions is not a result';
  END IF;

  -- THE FLOOR IS ON THE FRESH HALF.
  --
  -- It used to be on the total, which a student could satisfy entirely out of
  -- their own mistake book: a drill handed in as a retention check, passing
  -- the ladder on questions they had already been shown the answers to.
  -- §5.4 fixes the length of the UNSEEN half, so that is what is checked.
  --
  -- The bar bends for a thin chapter, as before: everything the bank can still
  -- offer this student when that is fewer than REVISION_COUNT. A chapter with
  -- three unseen questions left must stay revisable, and saying the check was
  -- short is better than a silent pass on a sample of one.
  _want := public._recovery_const('REVISION_COUNT')::int;
  SELECT count(*)::int INTO _avail_fresh
    FROM public.question_bank qb
   WHERE qb.chapter_id = _chapter_id
     AND qb.is_active AND qb.is_approved
     AND qb.replaced_by_question_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.question_id = qb.id)
     AND NOT EXISTS (
       -- Attempts from THIS sitting do not disqualify a question from the
       -- pool it was drawn from. Without this exclusion the act of sitting
       -- the check would shrink the pool it is measured against, and every
       -- full-length check would report itself as over-long.
       SELECT 1 FROM public.question_attempts qa
        WHERE qa.user_id = _uid AND qa.bank_question_id = qb.id
          AND qa.session_id <> _practice_session_id);

  _want := LEAST(_want, GREATEST(_avail_fresh, 1));

  IF _f_total < _want THEN
    RAISE EXCEPTION
      'a revision check needs % unseen question(s) from this chapter; that sitting answered % (plus % from your mistake book)',
      _want, _f_total, _m_total;
  END IF;

  SELECT s.id, s.school_id INTO _sid, _school
    FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  _stage    := GREATEST(_cs.revision_stage, 1);
  _pass_thr := public._recovery_const('REVISION_PASS_THRESHOLD')::numeric;
  _stages   := public._recovery_const('REVISION_STAGES_TO_SOLID')::int;
  _rate     := round(_correct::numeric / _total, 4);
  _passed   := _rate >= _pass_thr;

  _trigger := CASE WHEN _cs.recovered_at IS NOT NULL THEN 'recovery' ELSE 'engagement' END;

  INSERT INTO public.revision_sessions (
    user_id, student_id, school_id, chapter_id, stage,
    correct, total, passed, completed_at, triggered_by, practice_session_id
  ) VALUES (
    _uid, COALESCE(_sid, _cs.student_id), COALESCE(_school, _cs.school_id),
    _chapter_id, _stage, _correct, _total, _passed, now(), _trigger, _practice_session_id
  );

  IF _passed THEN
    IF (_cs.consecutive_revision_passes + 1) >= _stages THEN
      -- SOLID IS NOT FINISHED. The chapter keeps a check, at
      -- REVISION_INTERVAL_SOLID, for ever. The old body set next_revision_at
      -- to NULL here, which dropped the chapter out of the schedule
      -- permanently — a student who proved three times that they knew a
      -- chapter was never asked about it again, which is the one thing
      -- spaced repetition exists to prevent.
      _solid := true;
      _next  := public._revision_interval_days(_stage + 1);
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage + 1,
        next_revision_at = now() + (_next || ' days')::interval,
        state = 'recovered', updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    ELSE
      _next := public._revision_interval_days(_stage + 1);
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage + 1,
        next_revision_at = now() + (_next || ' days')::interval,
        state = 'recovered', updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    END IF;
  ELSE
    -- §5.5: a failure restarts the ladder and zeroes the streak — three
    -- CONSECUTIVE passes means what it says.
    _next := public._revision_interval_days(1);
    UPDATE public.chapter_state SET
      state = 'revision_failed', consecutive_revision_passes = 0, revision_stage = 1,
      next_revision_at = now() + (_next || ' days')::interval, updated_at = now()
    WHERE user_id = _uid AND chapter_id = _chapter_id;
  END IF;

  SELECT cs.next_revision_at, cs.state INTO _next_at, _state
    FROM public.chapter_state cs
   WHERE cs.user_id = _uid AND cs.chapter_id = _chapter_id;

  RETURN jsonb_build_object(
    'passed', _passed,
    'rate', _rate,
    'correct', _correct,
    'total', _total,
    -- The two halves, reported separately and never blended into the verdict
    -- above. A student who gets every fresh question right and still misses
    -- the two he always misses needs to be told that, not handed a 78%.
    'mistake_correct', _m_correct,
    'mistake_total',   _m_total,
    'fresh_correct',   _f_correct,
    'fresh_total',     _f_total,
    'stage', _stage,
    'solid', _solid,
    'consecutive_passes', CASE WHEN _passed THEN _cs.consecutive_revision_passes + 1 ELSE 0 END,
    'stages_to_solid', _stages,
    'next_revision_at', _next_at,
    'state', _state);
END;
$fn$;


-- ── 3. What the Revision tab sees ──────────────────────────────────────────
-- The tab could say a chapter was due and then hand the student a three
-- question check, because nothing told it how much material was left. It now
-- carries the same two counts the plan would produce.

CREATE OR REPLACE FUNCTION public.rpc_student_chapter_states()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid := auth.uid(); _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'next_revision_at' NULLS LAST), '[]'::jsonb)
    INTO _out
    FROM (
      SELECT jsonb_build_object(
               'chapter_id',       cs.chapter_id,
               'chapter',          c.name,
               'subject',          sub.name,
               'state',            cs.state,
               'revision_stage',   cs.revision_stage,
               'consecutive_passes', cs.consecutive_revision_passes,
               'next_revision_at', cs.next_revision_at,
               'revision_due',     (cs.next_revision_at IS NOT NULL AND cs.next_revision_at <= now()),
               'recovered_at',     cs.recovered_at,
               'last_recovery_readiness', cs.last_recovery_readiness,
               'open_mistakes',    (SELECT count(*) FROM public.student_mistakes sm
                                     WHERE sm.user_id = _uid
                                       AND sm.chapter_id = cs.chapter_id
                                       AND sm.status = 'open'),
               -- How many genuinely unseen questions the chapter can still
               -- offer. Same two exclusions as rpc_revision_session_plan, so
               -- the tab and the check cannot disagree.
               'revision_fresh_available',
                 (SELECT count(*) FROM public.question_bank qb
                   WHERE qb.chapter_id = cs.chapter_id
                     AND qb.is_active AND qb.is_approved
                     AND qb.replaced_by_question_id IS NULL
                     AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa
                                      WHERE qa.user_id = _uid AND qa.bank_question_id = qb.id)
                     AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                                      WHERE sm.user_id = _uid AND sm.question_id = qb.id))
             ) AS row
        FROM public.chapter_state cs
        LEFT JOIN public.chapters c ON c.id = cs.chapter_id
        LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
       WHERE cs.user_id = _uid
    ) t;

  RETURN _out;
END;
$fn$;

COMMIT;
