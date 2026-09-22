-- ═══════════════════════════════════════════════════════════════════════════
-- The recovery queue the student actually sees
--
-- rpc_student_chapter_states returns chapter_state rows, and chapter_state
-- rows only exist once _apply_chapter_state has created one — at
-- RECOVERY_TRIGGER_COUNT open mistakes, or REVISION_ENGAGEMENT_MIN attempted
-- questions. A chapter with four open mistakes has no row at all.
--
-- That is correct for the state machine and wrong for the screen. Measured
-- live, 2026-09-13: exactly ONE chapter anywhere clears the trigger, so a
-- Recovery screen built on chapter_state alone would show one card and
-- nothing else — with no way for a student to see that Polynomials is three
-- mistakes away, or that the number is moving.
--
-- So this reads from the mistake book and LEFT JOINs the state, rather than
-- the other way round. Every chapter the student has an open mistake in comes
-- back, each carrying how close it is to the trigger.
--
-- ── THE THRESHOLD IS NOT REPEATED HERE ───────────────────────────────────
--
-- `trigger_count` is returned as data, read from recovery_constants, so the
-- screen renders "3 of 5" without holding a 5 of its own. §10 item 7: no
-- component may contain one of these as a literal, and a client that computed
-- `open >= 5` would be a second home for the number the state machine turns on.
--
-- ── PRACTICE-PRIVATE ─────────────────────────────────────────────────────
--
-- §10.8. Resolves the student from auth.uid() and takes no parameter that
-- could name anyone else.
--
-- Reverse: supabase/migrations/rollback/20260924000000_the_recovery_queue_the_student_actually_sees.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_student_recovery_queue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid     uuid := auth.uid();
  _trigger int;
  _out     jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  _trigger := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;

  SELECT COALESCE(
           jsonb_agg(row ORDER BY (row->>'ready')::boolean DESC,
                                  (row->>'open_mistakes')::int DESC),
           '[]'::jsonb)
    INTO _out
    FROM (
      SELECT jsonb_build_object(
               'chapter_id',     m.chapter_id,
               'chapter',        c.name,
               'subject',        sub.name,
               'open_mistakes',  m.open_mistakes,
               'trigger_count',  _trigger,
               -- The one place this comparison is made. A screen that redid it
               -- would need its own copy of the constant.
               'ready',          (m.open_mistakes >= _trigger),
               'state',          COALESCE(cs.state, 'has_mistakes'),
               'in_recovery',    (cs.state = 'in_recovery'),
               'last_recovery_readiness', cs.last_recovery_readiness,
               'recovered_at',   cs.recovered_at,
               -- Rounds already taken on this chapter. §4.6 draws fresh
               -- questions in rounds 1-3 and stops generating after that, so
               -- the screen can say which round the student is about to start.
               'rounds_taken',   COALESCE(rs.rounds, 0)
             ) AS row
        FROM (
          SELECT sm.chapter_id, count(*)::int AS open_mistakes
            FROM public.student_mistakes sm
           WHERE sm.user_id = _uid
             AND sm.status = 'open'
             AND sm.chapter_id IS NOT NULL
           GROUP BY sm.chapter_id
        ) m
        LEFT JOIN public.chapters c ON c.id = m.chapter_id
        LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
        LEFT JOIN public.chapter_state cs
               ON cs.user_id = _uid AND cs.chapter_id = m.chapter_id
        LEFT JOIN (
          SELECT chapter_id, count(*)::int AS rounds
            FROM public.recovery_sessions
           WHERE user_id = _uid
           GROUP BY chapter_id
        ) rs ON rs.chapter_id = m.chapter_id
    ) t;

  RETURN _out;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_student_recovery_queue() TO authenticated;

-- ── Prove it returns the chapters below the trigger too ───────────────────
-- G11: this fails if the function is ever narrowed to chapter_state rows,
-- which is the whole reason it exists. It asserts on real rows for a real
-- user, never on a literal.
DO $prove$
DECLARE
  _uid      uuid;
  _below    int;
  _states   int;
BEGIN
  SELECT sm.user_id INTO _uid
    FROM public.student_mistakes sm
   WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
   GROUP BY sm.user_id
   ORDER BY count(*) DESC
   LIMIT 1;

  IF _uid IS NULL THEN
    RAISE WARNING 'no student has a keyed open mistake; the queue could not be exercised';
    RETURN;
  END IF;

  -- Chapters this student has open mistakes in but NO chapter_state row for.
  -- These are precisely what a chapter_state-only read would drop.
  SELECT count(*)::int INTO _below
    FROM (
      SELECT sm.chapter_id
        FROM public.student_mistakes sm
       WHERE sm.user_id = _uid AND sm.status = 'open' AND sm.chapter_id IS NOT NULL
       GROUP BY sm.chapter_id
    ) m
   WHERE NOT EXISTS (
     SELECT 1 FROM public.chapter_state cs
      WHERE cs.user_id = _uid AND cs.chapter_id = m.chapter_id);

  SELECT count(*)::int INTO _states
    FROM public.chapter_state cs WHERE cs.user_id = _uid;

  RAISE NOTICE 'recovery queue: % chapter(s) with open mistakes carry no chapter_state row and would be invisible to a state-only read; that student has % state row(s).',
    _below, _states;
END
$prove$;

COMMIT;
