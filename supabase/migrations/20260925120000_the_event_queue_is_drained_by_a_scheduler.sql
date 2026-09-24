-- ═══════════════════════════════════════════════════════════════════════════
-- The academic event queue is drained by a scheduler, not by whoever has the
-- app open
--
-- Found building homework (docs/gurukul-spec-rules.md, "Homework — RULED
-- 2026-09-13"): deleting homework, and a deadline passing, must take it out of
-- every student's stored completion at once. Both reach the stored profiles
-- through this queue, and nothing drained it except a browser.
--
-- ── MEASURED ──────────────────────────────────────────────────────────────
--
-- A class-level event (homework published, deleted, closed; an exam finalised)
-- fans out one `student.profile.refresh_requested` row per student.
-- `trg_academic_events_autoprocess` deliberately skips those rows so a large
-- class does not recount inside the teacher's write, and leaves them pending
-- for `process_pending_academic_events` — whose ONLY caller was
-- AcademicLiveProvider: on sign-in, on every window focus, and on a 90-second
-- poll, from every signed-in session of every role. So:
--   * with nobody signed in, no class ever recounted;
--   * a student's browser drained every school's queue — the function has no
--     school filter, by design, because the queue is the platform's;
--   * `process_academic_event` was executable by any signed-in user for any
--     event id, which re-sends that event's notifications — its only client
--     wrapper had no caller at all;
--   * the drain took pending and failed rows in created_at order, so enough
--     permanently failing rows would have starved every new one.
-- It is the same shape 20260925100000 removed from the homework publisher.
--
-- ── WHAT THIS DOES ────────────────────────────────────────────────────────
--
-- * pg_cron job `process-pending-academic-events`, every minute, 500 rows.
-- * `process_pending_academic_events` drains pending rows before it retries
--   failed ones.
-- * Neither it nor `process_academic_event` is executable by anon or
--   authenticated any more; the grant is the fence. The trigger and the drain
--   are SECURITY DEFINER and keep calling `process_academic_event` as its owner.
-- The browser's drain calls are removed in the same change.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.process_pending_academic_events(_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  _n int := 0;
  _lim int := greatest(1, least(coalesce(_limit, 50), 500));
BEGIN
  FOR r IN
    SELECT id FROM public.academic_events
    WHERE status IN ('pending', 'failed')
    -- academic_event_status orders 'pending' before 'failed', so a new row is
    -- never starved behind rows that keep failing; this also walks
    -- academic_events_pending_idx (status, created_at) as it stands.
    ORDER BY status, created_at
    LIMIT _lim
    FOR UPDATE SKIP LOCKED
  LOOP
    IF public.process_academic_event(r.id) THEN
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$function$;

COMMENT ON FUNCTION public.process_pending_academic_events(integer) IS
  'pg_cron job process-pending-academic-events, every minute: processes up to _limit (max 500) queued academic events, pending before failed. The queue is the platform''s, so it has no school filter, and only the scheduler and service_role may execute it.';

-- The whole rule, not the part that differs on one database. The live project
-- holds both for authenticated and service_role (measured 2026-09-13); a
-- database built from the migrations alone holds them for PUBLIC and anon as
-- well (measured on the replica the same day), and revoking authenticated alone
-- left that queue open to every caller — this migration's own proof caught it.
-- After these lines both are postgres's and service_role's, whichever it was.
REVOKE EXECUTE ON FUNCTION public.process_pending_academic_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_academic_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_pending_academic_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_academic_event(uuid) TO service_role;

DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: cron.schedule(text,text,text) does not exist, so class recounts would never run. Install pg_cron, then apply this migration.';
  END IF;
  PERFORM cron.schedule('process-pending-academic-events', '* * * * *',
                        'SELECT public.process_pending_academic_events(500)');
END
$cron$;

-- ── Proof ─────────────────────────────────────────────────────────────────

-- One savepoint that always ends by raising P0999: the fixture events, and the
-- profile refresh they cause, do not survive.
DO $verify$
DECLARE
  _student uuid; _school uuid; _user uuid; _pending uuid; _failed uuid; _refused boolean; _n int;
BEGIN
BEGIN
  -- A signed-in student of a school that sets homework: the recounts this queue
  -- carries. Any student would do for the drain itself, but not every one can be
  -- recounted — the scale-fixture tenant on live stores 330 test attempts scored
  -- above their own maximum, which the profile's 0–100 range refuses
  -- (KNOWN_ISSUES, "The scale fixture's test scores exceed their maximum"). An
  -- arbitrary pick landed there on 2026-09-14 and proved that defect instead of
  -- the drain; the refusal below now names the event's own error either way.
  SELECT s.id, s.school_id, s.user_id INTO _student, _school, _user
    FROM public.students s
   WHERE s.deleted_at IS NULL AND s.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.homework h WHERE h.school_id = s.school_id)
   ORDER BY s.id
   LIMIT 1;
  IF _student IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a signed-in student of a school that sets homework to queue a refresh for';
  END IF;

  -- Both queued as the class fan-out queues them, and both older than any real
  -- row. The failed row is strictly OLDER than the pending one — the case that
  -- used to starve it — so a limit of one takes the pending row only if status
  -- is what decides.
  INSERT INTO public.academic_events (school_id, event_type, entity_type, entity_id, student_id, status, created_at, error)
  VALUES (_school, 'student.profile.refresh_requested', 'student_academic_profile', _student, _student, 'failed', '-infinity', 'verify')
  RETURNING id INTO _failed;
  INSERT INTO public.academic_events (school_id, event_type, entity_type, entity_id, student_id, status, created_at)
  VALUES (_school, 'student.profile.refresh_requested', 'student_academic_profile', _student, _student, 'pending', '1900-01-01')
  RETURNING id INTO _pending;
  IF (SELECT status FROM public.academic_events WHERE id = _pending) <> 'pending' THEN
    RAISE EXCEPTION 'ROLLED BACK: a queued profile refresh was processed on insert, so this proves nothing about the drain';
  END IF;

  -- 1. A signed-in session cannot drain the queue or replay an event; nor can anon.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    PERFORM public.process_pending_academic_events(10);
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a signed-in session drained the event queue'; END IF;
  _refused := false;
  BEGIN
    PERFORM public.process_academic_event(_pending);
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a signed-in session replayed an academic event'; END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  _refused := false;
  BEGIN
    PERFORM public.process_pending_academic_events(10);
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: anon drained the event queue'; END IF;
  IF (SELECT status FROM public.academic_events WHERE id = _pending) <> 'pending' THEN
    RAISE EXCEPTION 'ROLLED BACK: a refused drain still processed the queued refresh';
  END IF;

  -- 2. The scheduler drains, pending before failed, and the profile recounts.
  _n := public.process_pending_academic_events(1);
  IF _n <> 1 OR (SELECT status FROM public.academic_events WHERE id = _pending) <> 'processed' THEN
    RAISE EXCEPTION 'ROLLED BACK: the scheduler''s drain did not process the pending refresh (processed %; the event reads %, %)', _n,
      (SELECT status FROM public.academic_events WHERE id = _pending),
      coalesce((SELECT error FROM public.academic_events WHERE id = _pending), 'no error');
  END IF;
  IF (SELECT status FROM public.academic_events WHERE id = _failed) <> 'failed' THEN
    RAISE EXCEPTION 'ROLLED BACK: the drain took an older failed row before a pending one';
  END IF;
  IF (SELECT refreshed_at FROM public.student_academic_profiles WHERE student_id = _student) IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'ROLLED BACK: draining the refresh did not recount the student''s profile';
  END IF;

  -- 3. A failed row is still retried once nothing is pending ahead of it. The
  --    database may hold real pending rows, which rightly go first; drain as
  --    the scheduler would until the queue stops yielding.
  LOOP
    EXIT WHEN (SELECT status FROM public.academic_events WHERE id = _failed) <> 'failed'
           OR public.process_pending_academic_events(500) = 0;
  END LOOP;
  IF (SELECT status FROM public.academic_events WHERE id = _failed) <> 'processed' THEN
    RAISE EXCEPTION 'ROLLED BACK: a failed row is never retried';
  END IF;

  -- 4. The job exists and calls the function, and the worker role still may.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-pending-academic-events'
                  AND command LIKE '%process_pending_academic_events(%') THEN
    RAISE EXCEPTION 'ROLLED BACK: no scheduler job drains the academic event queue';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.process_pending_academic_events(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.process_academic_event(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLED BACK: service_role lost EXECUTE on the event queue';
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
EXCEPTION WHEN SQLSTATE 'P0999' THEN
  NULL;
END;

  IF EXISTS (SELECT 1 FROM public.academic_events WHERE created_at IN ('-infinity', '1900-01-01')) THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  RAISE NOTICE 'verify OK: only the scheduler drains the event queue, pending before failed, and a drained refresh recounts the profile; signed-in and anon sessions can neither drain nor replay events; service_role still can; the job exists — nothing the proof did survived';
END
$verify$;
