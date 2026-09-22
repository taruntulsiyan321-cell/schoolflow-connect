-- ═══════════════════════════════════════════════════════════════════════════
-- A COUNT SAYS WHAT THE STUDENT DID
--
-- Three figures on the Recovery, Home and Analysis screens counted something
-- other than what their label claims. Each was measured 2026-09-22 in the
-- browser as arjun.mehta, against the database read as him.
--
-- 1. rpc_student_recovery_queue.rounds_taken counted every recovery_sessions
--    row. Since recovery sessions are PREPARED when a practice session ends
--    (_ensure_recovery_session), each chapter also holds one session nobody
--    has sat. Recovery printed "round 2" on 15 chapters he had never recovered
--    in, "round 7" where he had sat 5, and "Sessions done: 24" for 7 sat.
--    A round is a session completed.
--
-- 2. rpc_student_academic_snapshot.recovery_pending kept its own copy of the
--    queue's `ready` rule — its comment said "the same comparison
--    rpc_student_recovery_queue makes, so the badge and the screen cannot
--    disagree" — and the copy drifted: it has no relearn boundary and no
--    question_id filter. Home said "19 chapters ready to recover" while
--    Recovery offered 15; the other 4 hold 9, 13, 15 and 30 mistakes, where
--    the engine declines to drill (RECOVERY_WIDE_MAX_MISTAKES). The copy is
--    deleted: the snapshot counts the queue's own `ready` rows.
--
-- 3. rpc_student_practice_analytics.by_topic grouped by topic NAME. Topics
--    are per chapter (§10.22), so two topics that share a name became one row
--    under max(chapter) — "Nuclear Energy" in Science's Sources of Energy and
--    in Social Science's Minerals and Energy Resources. Analysis printed
--    "Topics practised 411" for 413. A topic row is a (topic, chapter).
--
-- Callers, all reading the same keys: Recovery.tsx (rounds_taken),
-- Dashboard.tsx / LearningHub.tsx / Analysis.tsx / learningMetrics.ts
-- (recovery_pending), Analysis.tsx (by_topic).
--
-- Rollback: rollback/20261045000000_a_count_says_what_the_student_did.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.routines_pre_20261045000000 (
  object text PRIMARY KEY,
  definition text NOT NULL,
  applied text
);
ALTER TABLE public.routines_pre_20261045000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261045000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261045000000 IS
  'Rollback source for 20261045000000: the three functions exactly as they were before it, and as it left them. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

INSERT INTO public.routines_pre_20261045000000 (object, definition) VALUES
  ('public.rpc_student_recovery_queue()',     pg_get_functiondef('public.rpc_student_recovery_queue()'::regprocedure)),
  ('public.rpc_student_academic_snapshot()',  pg_get_functiondef('public.rpc_student_academic_snapshot()'::regprocedure)),
  ('public.rpc_student_practice_analytics()', pg_get_functiondef('public.rpc_student_practice_analytics()'::regprocedure));

-- Replace one exact passage of a definition, and refuse if it is not there
-- exactly once — a definition that moved since this was written is re-read,
-- never guessed at.
CREATE FUNCTION pg_temp.swap(_def text, _from text, _to text, _what text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF (length(_def) - length(replace(_def, _from, ''))) / length(_from) <> 1 THEN
    RAISE EXCEPTION 'ABORT: the passage for % is not in the live definition exactly once. Re-read it.', _what;
  END IF;
  RETURN replace(_def, _from, _to);
END $$;

DO $rewrite$
DECLARE _def text;
BEGIN
  -- ── 1. A round is a session completed ──────────────────────────────────
  _def := (SELECT definition FROM public.routines_pre_20261045000000 WHERE object = 'public.rpc_student_recovery_queue()');
  _def := pg_temp.swap(_def,
$from$          SELECT chapter_id, count(*)::int AS rounds
            FROM public.recovery_sessions
           WHERE user_id = _uid
           GROUP BY chapter_id$from$,
$to$          -- COMPLETED sessions only. One is prepared, unsat, at the end of
          -- every practice session that crosses the trigger; counting it
          -- printed "round 2" before round 1 was taken (20261045000000).
          SELECT chapter_id, count(*)::int AS rounds
            FROM public.recovery_sessions
           WHERE user_id = _uid
             AND completed_at IS NOT NULL
           GROUP BY chapter_id$to$, 'rounds_taken');
  EXECUTE _def;

  -- ── 2. Recovery pending is the queue's own `ready` ─────────────────────
  _def := (SELECT definition FROM public.routines_pre_20261045000000 WHERE object = 'public.rpc_student_academic_snapshot()');
  _def := pg_temp.swap(_def,
$from$  _revision_due int := 0; _trigger int;$from$,
$to$  _revision_due int := 0;$to$, 'the _trigger declaration');
  _def := pg_temp.swap(_def,
$from$  -- §4.1. The same comparison rpc_student_recovery_queue makes, against the
  -- same constant, so the badge and the screen cannot disagree.
  _trigger := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;

  SELECT count(*)::int INTO _recovery_pending FROM (
    SELECT sm.chapter_id
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.status = 'open' AND sm.chapter_id IS NOT NULL
     GROUP BY sm.chapter_id
    HAVING count(*) >= _trigger
  ) ready_chapters;$from$,
$to$  -- §4.1. The chapters Recovery offers a session for, read from the queue
  -- itself. This used to restate the queue's rule, and the restatement
  -- drifted (no relearn boundary, no question_id filter), so Home said 19
  -- chapters were ready to recover while Recovery offered 15. One rule, one
  -- home: rpc_student_recovery_queue decides `ready` (20261045000000).
  SELECT count(*)::int INTO _recovery_pending
    FROM jsonb_array_elements(public.rpc_student_recovery_queue()) q
   WHERE (q->>'ready')::boolean;$to$, 'recovery_pending');
  EXECUTE _def;

  -- ── 3. A topic row is a (topic, chapter) ───────────────────────────────
  _def := (SELECT definition FROM public.routines_pre_20261045000000 WHERE object = 'public.rpc_student_practice_analytics()');
  _def := pg_temp.swap(_def,
$from$          max(qa.chapter)                                            AS chapter,$from$,
$to$          qa.chapter                                                 AS chapter,$to$, 'by_topic chapter');
  _def := pg_temp.swap(_def,
$from$        WHERE qa.user_id = _uid AND COALESCE(btrim(qa.topic), '') <> ''
        GROUP BY qa.topic$from$,
$to$        WHERE qa.user_id = _uid AND COALESCE(btrim(qa.topic), '') <> ''
        -- Topics are per chapter (§10.22): two that share a name are two
        -- topics. Grouped by name alone they merged under max(chapter)
        -- (20261045000000).
        GROUP BY qa.topic, qa.chapter$to$, 'by_topic grouping');
  EXECUTE _def;
END
$rewrite$;

UPDATE public.routines_pre_20261045000000
   SET applied = pg_get_functiondef(object::regprocedure);

-- ── Proof, as the student ──────────────────────────────────────────────────

DO $verify$
DECLARE
  _arjun uuid := 'd1000003-0001-4000-8000-000000000001';
  _queue jsonb; _snap jsonb; _pa jsonb;
  _prepared int; _wrong_rounds int; _relearn int; _ready int;
  _spanning int; _topic_rows int; _topic_truth int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _queue := public.rpc_student_recovery_queue();
  _snap  := public.rpc_student_academic_snapshot();
  _pa    := public.rpc_student_practice_analytics();
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- 1. Controls first: a check that cannot fail proves nothing.
  SELECT count(*) INTO _prepared FROM public.recovery_sessions
   WHERE user_id = _arjun AND completed_at IS NULL;
  IF _prepared = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): the student has no prepared, unsat session, so the rounds fix was not exercised';
  END IF;
  SELECT count(*) INTO _wrong_rounds
    FROM jsonb_array_elements(_queue) q
   WHERE (q->>'rounds_taken')::int IS DISTINCT FROM (
         SELECT count(*)::int FROM public.recovery_sessions rs
          WHERE rs.user_id = _arjun AND rs.chapter_id = (q->>'chapter_id')::uuid
            AND rs.completed_at IS NOT NULL);
  IF _wrong_rounds > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % queue rows still count rounds that were not sat', _wrong_rounds;
  END IF;

  -- 2. Recovery pending equals the queue's ready rows, and the student has a
  --    relearn chapter, which the old copy of the rule counted.
  SELECT count(*) FILTER (WHERE q->>'mode' = 'relearn'), count(*) FILTER (WHERE (q->>'ready')::boolean)
    INTO _relearn, _ready FROM jsonb_array_elements(_queue) q;
  IF _relearn = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): no relearn chapter, so the old and new rules agree and nothing was proved';
  END IF;
  IF (_snap->>'recovery_pending')::int IS DISTINCT FROM _ready THEN
    RAISE EXCEPTION 'ROLLED BACK: snapshot recovery_pending % but the queue offers % chapters', _snap->>'recovery_pending', _ready;
  END IF;

  -- 3. One topic row per (topic, chapter), and the student has a name that
  --    spans chapters.
  SELECT count(*) INTO _spanning FROM (
    SELECT topic FROM public.question_attempts
     WHERE user_id = _arjun AND COALESCE(btrim(topic), '') <> ''
     GROUP BY topic HAVING count(DISTINCT chapter) > 1) x;
  IF _spanning = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): no topic name spans two chapters, so the grouping fix was not exercised';
  END IF;
  SELECT count(*) INTO _topic_truth FROM (
    SELECT DISTINCT topic, chapter FROM public.question_attempts
     WHERE user_id = _arjun AND COALESCE(btrim(topic), '') <> '') x;
  _topic_rows := jsonb_array_length(_pa->'by_topic');
  IF _topic_rows <> _topic_truth THEN
    RAISE EXCEPTION 'ROLLED BACK: by_topic has % rows for % (topic, chapter) pairs', _topic_rows, _topic_truth;
  END IF;

  RAISE NOTICE 'OK: rounds = sessions sat (% prepared ignored); recovery_pending = % ready (% relearn excluded); by_topic = % rows (% names span chapters)',
    _prepared, _ready, _relearn, _topic_rows, _spanning;
END
$verify$;

COMMIT;
