-- ═══════════════════════════════════════════════════════════════════════════
-- THE SNAPSHOT ONLY READS; A JOB KEEPS NOVA'S WORKLIST (docs/TODO.md E2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- rpc_student_academic_snapshot — Home, Analysis, the Practice hub and the
-- Battleground — ended every read with PERFORM _rebuild_revision_queue, which
-- UPDATEs (and sometimes INSERTs) the student's rows in revision_queue, the
-- weak-topic worklist Nova reads (supabase/functions/_shared/aiRouter.ts,
-- fetchEie/probeEie) and no student screen does.
--
-- A read that writes holds row locks until it commits, so every other read
-- of the same student waits for it. Measured 2026-10-13 on live, nine
-- simultaneous loads of one student after 20261157000000: six snapshots
-- logged "still waiting for ExclusiveLock on tuple" in
-- _rebuild_revision_queue line 28, the longest 3.9 s, 16 s in all, while the
-- recovery queue beside them, which writes nothing, never waited.
--
-- So the snapshot stops writing (it is otherwise unchanged: the live text
-- with that one call removed), and the worklist is kept by a job instead:
--
--   public.refresh_revision_worklists(window) rebuilds, through the same
--   _rebuild_revision_queue, the worklist of every student who answered a
--   practice question, answered in a battle or got something wrong within
--   the window. Two schedules:
--     * every 15 minutes, over the last 20 — Nova's list is at most that far
--       behind the student's last answer;
--     * daily, over WEAK_WINDOW_DAYS + 1 — _weak_topics_for_user counts
--       answers within WEAK_WINDOW_DAYS, so a list moves as answers age out
--       of the window even when the student is away.
--   rpc_post_assessment_concept_analysis still rebuilds after an assessment,
--   which is a write path.
--
-- ROLLBACK: rollback/20261158000000_the_snapshot_only_reads.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── What the snapshot answers, and does, before it changes ─────────────────
-- Plain temp tables dropped at the end (not ON COMMIT DROP), so the proof reads
-- the same way applied statement by statement as in one transaction.
CREATE TEMP TABLE e3_snap (uid uuid PRIMARY KEY, out jsonb);
CREATE TEMP TABLE e3_fact (k text PRIMARY KEY, v jsonb);

CREATE FUNCTION pg_temp.e3_writes() RETURNS bigint
LANGUAGE sql AS $w$
  -- rows this transaction has inserted, updated or deleted so far, in any table
  SELECT COALESCE(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint FROM pg_stat_xact_user_tables
$w$;

CREATE FUNCTION pg_temp.e3_worklist(_uid uuid) RETURNS jsonb
LANGUAGE sql AS $w$
  -- a student's worklist, everything but the row id
  SELECT COALESCE(jsonb_agg(to_jsonb(rq) - 'id' ORDER BY rq.subject, rq.chapter, rq.topic, rq.reason, rq.completed, rq.created_at), '[]'::jsonb)
    FROM public.revision_queue rq WHERE rq.user_id = _uid
$w$;

DO $before$
DECLARE
  _u     record;
  _out   jsonb;
  _heavy uuid;
  _w0    bigint;
  _w1    bigint;
  _list  jsonb;
BEGIN
  -- every student who has a snapshot worth comparing: anyone with a student
  -- row, a mistake or a practice answer. Each read is undone (P9E03), so
  -- the rebuild the old snapshot does leaves nothing behind.
  FOR _u IN SELECT user_id FROM public.students_current WHERE user_id IS NOT NULL
            UNION SELECT user_id FROM public.student_mistakes
            UNION SELECT user_id FROM public.question_attempts LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _u.user_id, 'role', 'authenticated')::text, true);
    _out := NULL;
    BEGIN
      _out := public.rpc_student_academic_snapshot();
      RAISE EXCEPTION USING ERRCODE = 'P9E03';
    EXCEPTION WHEN SQLSTATE 'P9E03' THEN NULL;
    END;
    INSERT INTO e3_snap VALUES (_u.user_id, _out);
  END LOOP;

  -- the student with the most open weak-topic rows: the old snapshot must
  -- visibly write for them (the control), and what it leaves is what the job
  -- must leave.
  SELECT rq.user_id INTO _heavy FROM public.revision_queue rq
   WHERE NOT rq.completed AND rq.reason = 'weak_topic'
   GROUP BY rq.user_id ORDER BY count(*) DESC, rq.user_id LIMIT 1;
  IF _heavy IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: no student has an open weak-topic row to prove with';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _heavy, 'role', 'authenticated')::text, true);
  BEGIN
    _w0 := pg_temp.e3_writes();
    PERFORM public.rpc_student_academic_snapshot();
    _w1 := pg_temp.e3_writes();
    _list := pg_temp.e3_worklist(_heavy);
    RAISE EXCEPTION USING ERRCODE = 'P9E03';
  EXCEPTION WHEN SQLSTATE 'P9E03' THEN NULL;
  END;
  INSERT INTO e3_fact VALUES ('heavy', to_jsonb(_heavy)),
                             ('old_snapshot_writes', to_jsonb(_w1 - _w0)),
                             ('worklist_after_old_snapshot', _list);
END $before$;

-- ── 1. The job that keeps the worklist ─────────────────────────────────────
CREATE FUNCTION public.refresh_revision_worklists(_active_within interval)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _u record;
  _n int := 0;
BEGIN
  IF _active_within IS NULL OR _active_within <= interval '0' THEN
    RAISE EXCEPTION 'refresh_revision_worklists needs a positive window, not %', _active_within;
  END IF;

  -- Everyone whose weak topics can have moved: _weak_topics_for_user counts
  -- practice answers and battle answers, and lists chapters with mistakes.
  -- The student row is found as the snapshot found it.
  FOR _u IN
    SELECT a.user_id,
           (SELECT s.id FROM public.students_current s WHERE s.user_id = a.user_id LIMIT 1) AS student_id
      FROM (
        SELECT qa.user_id FROM public.question_attempts qa
         WHERE qa.created_at >= now() - _active_within
        UNION
        SELECT bp.user_id FROM public.battle_participants bp
          JOIN public.battle_answers ba ON ba.participant_id = bp.id
         WHERE ba.created_at >= now() - _active_within
        UNION
        SELECT sm.user_id FROM public.student_mistakes sm
         WHERE sm.last_wrong_at >= now() - _active_within
      ) a
     WHERE a.user_id IS NOT NULL
     ORDER BY a.user_id
  LOOP
    PERFORM public._rebuild_revision_queue(_u.user_id, _u.student_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END
$$;

REVOKE ALL ON FUNCTION public.refresh_revision_worklists(interval) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('refresh-revision-worklists-recent', '*/15 * * * *',
  $$SELECT public.refresh_revision_worklists(interval '20 minutes');$$);
SELECT cron.schedule('refresh-revision-worklists-daily', '40 20 * * *',
  $$SELECT public.refresh_revision_worklists(make_interval(days => public._recovery_const('WEAK_WINDOW_DAYS')::int + 1));$$);

-- ── 2. The snapshot, without the rebuild ───────────────────────────────────
-- Exactly as it was live, less the one PERFORM.
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _test_open int := 0; _test_done int := 0;
  _weak jsonb; _mistakes int;
  _recovery_pending int := 0; _mastery_summary jsonb; _practice_sessions int := 0;
  _revision_due int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _s FROM public.students_current WHERE user_id = _uid LIMIT 1;
  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _uid;

  IF _s.id IS NOT NULL THEN
    -- completed: given (submitted or accepted). pending: not given and the
    -- deadline has not passed, so there is still something to do — rejected
    -- work included. homework_student_status is the one place both are decided.
    SELECT count(*) FILTER (WHERE hss.given),
           count(*) FILTER (WHERE NOT hss.given AND NOT hss.closed)
      INTO _hw_done, _hw_pending
    FROM public.homework_student_status hss
    WHERE hss.student_id = _s.id;

    SELECT count(*) FILTER (WHERE att.status = 'submitted'),
           count(*) FILTER (WHERE att.status IS DISTINCT FROM 'submitted')
      INTO _test_done, _test_open
    FROM public.tests d
    LEFT JOIN public.test_attempts att ON att.test_id = d.id AND att.user_id = _uid
    WHERE d.status = 'published' AND d.section_subject_id IN (SELECT ss.id FROM public.section_subjects ss WHERE ss.section_id = _s.class_id);
  END IF;

  -- "Finished" is not "answered": a session the loader could not fill is
  -- auto-finished with zero attempts (20260925000000).
  SELECT count(*)::int INTO _practice_sessions
  FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL
    AND public._practice_session_attempted(correct_count, wrong_count, skipped_count);

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy ASC), '[]'::jsonb)
    INTO _weak FROM public._weak_topics_for_user(_uid) w WHERE w.is_weak LIMIT 5;

  SELECT count(*) INTO _mistakes FROM public.student_mistakes
    WHERE user_id = _uid AND status = 'open';

  -- §4.1. The chapters Recovery offers a session for, read from the queue
  -- itself. This used to restate the queue's rule, and the restatement
  -- drifted (no relearn boundary, no question_id filter), so Home said 19
  -- chapters were ready to recover while Recovery offered 15. One rule, one
  -- home: rpc_student_recovery_queue decides `ready` (20261045000000).
  SELECT count(*)::int INTO _recovery_pending
    FROM jsonb_array_elements(public.rpc_student_recovery_queue()) q
   WHERE (q->>'startable')::boolean;

  -- §5.3. A chapter is due when its scheduled date has arrived. A chapter that
  -- reached REVISION_STAGES_TO_SOLID has next_revision_at NULL and is counted
  -- by neither branch, which is what removes it from the student's list.
  SELECT count(*)::int INTO _revision_due
  FROM public.chapter_state cs
  WHERE cs.user_id = _uid
    AND cs.next_revision_at IS NOT NULL
    AND cs.next_revision_at <= now();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'concept', concept, 'mastery_score', mastery_score
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _mastery_summary
  FROM public.concept_mastery WHERE user_id = _uid AND mastery_score < 60 LIMIT 5;

  -- PREMIUM (20261112000000): topic-level analysis only when the plan has it.
  RETURN public._premium_topic_analysis(_uid, jsonb_build_object(
    'student', CASE WHEN _s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _s.id, 'full_name', _s.full_name, 'class_id', _s.class_id,
      'roll_number', _s.roll_number, 'admission_number', _s.admission_number
    ) END,
    'xp', CASE WHEN _xp IS NULL THEN NULL ELSE to_jsonb(_xp) END,
    'homework', jsonb_build_object('pending', _hw_pending, 'completed', _hw_done),
    'test', jsonb_build_object('open', _test_open, 'completed', _test_done),
    'self_practice', jsonb_build_object('sessions_completed', _practice_sessions),
    'weak_topics', _weak,
    'revision_due', _revision_due,
    'mistake_count', _mistakes,
    'recovery_pending', _recovery_pending,
    'weak_concepts', _mastery_summary,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  ), ARRAY['weak_topics']);
END; $function$;

-- ── PROOF ───────────────────────────────────────────────────────────────────
DO $proof$
DECLARE
  _u      record;
  _out    jsonb;
  _heavy  uuid := (SELECT (v #>> '{}')::uuid FROM e3_fact WHERE k = 'heavy');
  _w0     bigint;
  _w1     bigint;
  _n      int;
  _want   int;
  _list   jsonb;
  _err    text;
BEGIN
  -- 0. The comparison has something in it.
  IF (SELECT count(*) FROM e3_snap WHERE out IS NOT NULL) < 3 THEN
    RAISE EXCEPTION 'VERIFY FAILED: fewer than 3 snapshots recorded — the comparison would prove nothing';
  END IF;
  -- CONTROL: the measurement sees a write — the old snapshot's rebuild.
  IF (SELECT (v #>> '{}')::bigint FROM e3_fact WHERE k = 'old_snapshot_writes') < 1 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the old snapshot wrote nothing that could be seen, so "writes nothing" below would prove nothing';
  END IF;

  -- 1. Every student's snapshot answers exactly what it did, and writes nothing.
  FOR _u IN SELECT uid, out FROM e3_snap LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _u.uid, 'role', 'authenticated')::text, true);
    _w0 := pg_temp.e3_writes();
    _out := public.rpc_student_academic_snapshot();
    _w1 := pg_temp.e3_writes();
    IF _out IS DISTINCT FROM _u.out THEN
      RAISE EXCEPTION 'VERIFY FAILED: the snapshot for % changed', _u.uid;
    END IF;
    IF _w1 <> _w0 THEN
      RAISE EXCEPTION 'VERIFY FAILED: the snapshot for % still wrote % rows', _u.uid, _w1 - _w0;
    END IF;
  END LOOP;
  -- and as the signed-in student, through the grant the app uses
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _heavy, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _out := public.rpc_student_academic_snapshot();
  RESET ROLE;
  IF _out IS DISTINCT FROM (SELECT out FROM e3_snap WHERE uid = _heavy) THEN
    RAISE EXCEPTION 'VERIFY FAILED: as the student, the snapshot answered differently';
  END IF;

  -- 2. The job leaves the worklist exactly as the snapshot used to, and
  --    reaches everyone with an answer or a mistake in its window (undone).
  SELECT count(*) INTO _want FROM (
    SELECT user_id FROM public.question_attempts
    UNION SELECT bp.user_id FROM public.battle_participants bp JOIN public.battle_answers ba ON ba.participant_id = bp.id
    UNION SELECT user_id FROM public.student_mistakes WHERE last_wrong_at IS NOT NULL) a
   WHERE a.user_id IS NOT NULL;
  BEGIN
    _n := public.refresh_revision_worklists(interval '100 years');
    _list := pg_temp.e3_worklist(_heavy);
    RAISE EXCEPTION USING ERRCODE = 'P9E03';
  EXCEPTION WHEN SQLSTATE 'P9E03' THEN NULL;
  END;
  IF _n IS DISTINCT FROM _want OR _n < 1 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the job refreshed % students, % have answers or mistakes', _n, _want;
  END IF;
  IF _list IS DISTINCT FROM (SELECT v FROM e3_fact WHERE k = 'worklist_after_old_snapshot') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the job left a different worklist than the snapshot did';
  END IF;
  -- a window that is not one is refused, not read as "everyone"
  BEGIN
    PERFORM public.refresh_revision_worklists(interval '0');
    _err := 'none';
  EXCEPTION WHEN raise_exception THEN
    _err := SQLERRM;
  END;
  IF _err NOT LIKE 'refresh_revision_worklists needs a positive window%' THEN
    RAISE EXCEPTION 'VERIFY FAILED: a zero window gave %', _err;
  END IF;

  -- 3. Nobody but the scheduler can run it; students keep their snapshot.
  IF has_function_privilege('anon', 'public.refresh_revision_worklists(interval)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.refresh_revision_worklists(interval)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_student_academic_snapshot()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: grants';
  END IF;

  -- 4. Both schedules are there, running what they say.
  SELECT count(*) INTO _n FROM cron.job j
   WHERE (j.jobname, j.schedule, j.command) IN (
     ('refresh-revision-worklists-recent', '*/15 * * * *',
      $c$SELECT public.refresh_revision_worklists(interval '20 minutes');$c$),
     ('refresh-revision-worklists-daily', '40 20 * * *',
      $c$SELECT public.refresh_revision_worklists(make_interval(days => public._recovery_const('WEAK_WINDOW_DAYS')::int + 1));$c$));
  IF _n <> 2 THEN RAISE EXCEPTION 'VERIFY FAILED: % of 2 refresh schedules', _n; END IF;

  -- 5. And the snapshot no longer names the rebuild at all.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.rpc_student_academic_snapshot()'::regprocedure
                AND prosrc LIKE '%_rebuild_revision_queue%') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the snapshot still calls the rebuild';
  END IF;
END $proof$;

DROP TABLE e3_snap, e3_fact;
DROP FUNCTION pg_temp.e3_writes();
DROP FUNCTION pg_temp.e3_worklist(uuid);

COMMIT;
