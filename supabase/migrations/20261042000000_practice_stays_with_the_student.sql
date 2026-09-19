-- ═══════════════════════════════════════════════════════════════════════════
-- PRACTICE STAYS WITH THE STUDENT
--
-- §10.8: practice is "completely private to the student. No teacher, no
-- parent, no principal, no aggregate, no school-side AI use."
--
-- ── WHAT THE SCHOOL COULD READ, MEASURED 2026-09-18 ─────────────────────────
--
-- Signed in as each real person, through PostgREST, the principal, the admin,
-- a teacher, a parent and a Class 12 student each read three of a Class 10
-- student's practice sessions from school_activity_feed — every question, the
-- option he chose and whether it was right:
--
--     "The degree of the polynomial 5x² − 3x + 1 is:"  chose "1", correct=false
--
-- The path, one hop at a time:
--
--   1. PracticeService.finish emitted practice.session.completed with its own
--      finish arguments as the payload: _attempts, the whole answer sheet
--      (3.1 kB a session, 116 of them). The client no longer sends any
--      payload; this migration cannot reach an old tab, which is why hop 2
--      matters.
--   2. process_academic_event copied EVERY event's payload into
--      school_activity_feed, excepting only two internal refresh types — so
--      practice.session.completed, and the weak-area telemetry that names the
--      student who opened Weak Areas practice, reached the feed.
--      src/academic/events.ts has never listed activity_feed as a target for
--      practice.session.completed; the router did not follow it.
--   3. school_activity_feed is read by admin, principal and teacher
--      (activity_feed_select) and by EVERY student and parent of the school
--      (activity_feed_select_family).
--   4. academic_events itself is read by admin and principal
--      (academic_events_admin_select): the payload, and even with no payload
--      the fact and time of each practice session.
--
-- ── WHAT THIS DOES ──────────────────────────────────────────────────────────
--
--   * The router stops copying any practice.* event into the feed, and its
--     practice branch says why. It is an anchor edit of the live definition,
--     refused if any anchor has moved.
--   * The same edit removes three duplicate profile refreshes. The router
--     refreshes the profile for every event that names a student, first
--     thing; the practice, doubt and xp.updated branches then refreshed it a
--     second time. Their behaviour is otherwise unchanged.
--   * academic_events_admin_select no longer admits practice.* rows. The one
--     reader of practice telemetry, rpc_decision_engine_rollout_summary_v1,
--     is SECURITY DEFINER and owned by the table owner, so it is unaffected.
--   * The leak is purged: every practice.* feed row is deleted, and every
--     practice.session.completed payload is emptied. The weak-area telemetry
--     keeps its payload — {path, count, error_type}, nothing about a student.
--
-- ── NOT HERE, AND WHY ───────────────────────────────────────────────────────
--
-- activity_feed_select_family admits every student and parent to the WHOLE
-- school's feed, not their own family's rows: marks, attendance and homework
-- decisions included. That exposure is not practice, it is wider than this
-- change, and which rows a parent should see is a product decision. It is
-- recorded in KNOWN_ISSUES rather than decided here.
--
-- Rollback: rollback/20261042000000_practice_stays_with_the_student.rollback.sql
-- restores the router and the policy exactly. It cannot restore the purged
-- rows, and should not: they are the leak.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Snapshot, so the rollback restores the definitions exactly ──────────

CREATE TABLE public.routines_pre_20261042000000 (
  object text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('function', 'policy')),
  definition text NOT NULL,
  applied text
);
ALTER TABLE public.routines_pre_20261042000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261042000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261042000000 IS
  'Rollback source for 20261042000000: process_academic_event and the USING expression of academic_events_admin_select exactly as they were before it, and as it left them. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

INSERT INTO public.routines_pre_20261042000000 (object, kind, definition)
VALUES ('public.process_academic_event(uuid)', 'function',
        pg_get_functiondef('public.process_academic_event(uuid)'::regprocedure));

INSERT INTO public.routines_pre_20261042000000 (object, kind, definition)
SELECT 'academic_events_admin_select', 'policy', pg_get_expr(p.polqual, p.polrelid)
  FROM pg_policy p
 WHERE p.polrelid = 'public.academic_events'::regclass
   AND p.polname = 'academic_events_admin_select';

CREATE FUNCTION pg_temp.occurrences(_haystack text, _needle text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$ SELECT (length(_haystack) - length(replace(_haystack, _needle, ''))) / length(_needle) $$;

-- The four edits, as (before, after) in the definition's own line ending, so
-- the edit and its proof use one copy of the text.
CREATE FUNCTION pg_temp.router_edits(_def text)
RETURNS TABLE (n int, before text, after text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  _nl text := CASE WHEN position(E'\r\n' IN _def) > 0 THEN E'\r\n' ELSE E'\n' END;
BEGIN
  -- 1. The feed copy leaves practice out.
  n := 1;
  before := $t$IF e.event_type NOT IN ('student.profile.refresh_requested', 'homework.class.refresh_chunk')$t$;
  after := before || _nl ||
    $t$       AND e.event_type NOT LIKE 'practice.%'  -- §10.8: no practice fact reaches the school's feed$t$;
  RETURN NEXT;

  -- 2. The practice branch: silent, and says why.
  n := 2;
  before := concat_ws(_nl,
    $t$    ELSIF e.event_type = 'practice.session.completed' AND e.student_id IS NOT NULL THEN$t$,
    $t$      -- Profile refresh only. §10.8: practice is private to the student and no$t$,
    $t$      -- practice fact may reach a parent, so there is nothing to notify.$t$,
    $t$      PERFORM public.refresh_student_academic_profile(e.student_id);$t$) || _nl;
  after := concat_ws(_nl,
    $t$    ELSIF e.event_type LIKE 'practice.%' THEN$t$,
    $t$      -- Deliberately silent. §10.8: practice is private to the student, so no$t$,
    $t$      -- practice fact is notified, nor copied into the activity feed below.$t$,
    $t$      -- The profile refresh every student event gets above is all it needs.$t$,
    $t$      NULL;$t$) || _nl;
  RETURN NEXT;

  -- 3. Doubts: the second refresh goes.
  n := 3;
  before := concat_ws(_nl,
    $t$      -- it appears in neither §10.12 nor §10.15.$t$,
    $t$      IF e.student_id IS NOT NULL THEN$t$,
    $t$        PERFORM public.refresh_student_academic_profile(e.student_id);$t$,
    $t$      END IF;$t$) || _nl;
  after := concat_ws(_nl,
    $t$      -- it appears in neither §10.12 nor §10.15. The profile refresh every$t$,
    $t$      -- student event gets above is all a doubt needs.$t$,
    $t$      NULL;$t$) || _nl;
  RETURN NEXT;

  -- 4. xp.updated: a branch that only repeated the refresh above.
  n := 4;
  before := concat_ws(_nl,
    $t$    ELSIF e.event_type = 'xp.updated' AND e.student_id IS NOT NULL THEN$t$,
    $t$      PERFORM public.refresh_student_academic_profile(e.student_id);$t$,
    $t$    END IF;$t$) || _nl;
  after := $t$    END IF;$t$ || _nl;
  RETURN NEXT;
END
$fn$;

-- ── 1. The router keeps practice out of the feed ───────────────────────────

DO $router$
DECLARE
  _def text := pg_get_functiondef('public.process_academic_event(uuid)'::regprocedure);
  _e record;
  _first_refresh constant text :=
    $t$IF e.student_id IS NOT NULL AND e.event_type <> 'student.profile.refresh_requested' THEN$t$;
BEGIN
  -- Edits 2-4 remove refreshes that are duplicates ONLY because this line
  -- refreshes every event naming a student first. If it has moved, stop.
  IF pg_temp.occurrences(_def, _first_refresh) <> 1 THEN
    RAISE EXCEPTION 'ABORT: the router no longer refreshes every student event first; the duplicate refreshes may not be duplicates. Re-read process_academic_event.';
  END IF;
  FOR _e IN SELECT * FROM pg_temp.router_edits(_def) ORDER BY n LOOP
    IF pg_temp.occurrences(_def, _e.before) <> 1 THEN
      RAISE EXCEPTION 'ABORT: edit % of the router found its anchor % time(s), expected once. Re-read process_academic_event before editing it.',
        _e.n, pg_temp.occurrences(_def, _e.before);
    END IF;
  END LOOP;
  FOR _e IN SELECT * FROM pg_temp.router_edits(_def) ORDER BY n LOOP
    _def := replace(_def, _e.before, _e.after);
  END LOOP;
  EXECUTE _def;
END
$router$;

-- ── 2. Admin and principal read no practice event ──────────────────────────

DO $policy$
DECLARE
  _was text := (SELECT definition FROM public.routines_pre_20261042000000
                 WHERE object = 'academic_events_admin_select');
BEGIN
  IF _was IS NULL THEN
    RAISE EXCEPTION 'ABORT: academic_events_admin_select does not exist';
  END IF;
  IF position('practice.' IN _was) > 0 THEN
    RAISE EXCEPTION 'ABORT: academic_events_admin_select already mentions practice: %', _was;
  END IF;
  EXECUTE format(
    'ALTER POLICY academic_events_admin_select ON public.academic_events USING ((%s) AND event_type NOT LIKE %L)',
    _was, 'practice.%');
END
$policy$;

UPDATE public.routines_pre_20261042000000
   SET applied = pg_get_functiondef(object::regprocedure)
 WHERE kind = 'function';
UPDATE public.routines_pre_20261042000000 r
   SET applied = pg_get_expr(p.polqual, p.polrelid)
  FROM pg_policy p
 WHERE r.kind = 'policy'
   AND p.polrelid = 'public.academic_events'::regclass AND p.polname = r.object;

-- ── 3. The leak, purged ────────────────────────────────────────────────────

DO $purge$
DECLARE _feed int; _events int;
BEGIN
  DELETE FROM public.school_activity_feed WHERE action LIKE 'practice.%';
  GET DIAGNOSTICS _feed = ROW_COUNT;
  UPDATE public.academic_events SET payload = '{}'::jsonb
   WHERE event_type = 'practice.session.completed' AND payload <> '{}'::jsonb;
  GET DIAGNOSTICS _events = ROW_COUNT;
  RAISE NOTICE 'purged % practice row(s) from the activity feed and emptied % practice event payload(s)', _feed, _events;
END
$purge$;

-- ── 4. Proof ───────────────────────────────────────────────────────────────

-- The fixtures live in one savepoint that always ends by raising P0999, as in
-- 20260925150000: nothing the proof inserts or refreshes survives it.
DO $verify$
DECLARE
  _was text := (SELECT definition FROM public.routines_pre_20261042000000
                 WHERE object = 'public.process_academic_event(uuid)');
  _now text := pg_get_functiondef('public.process_academic_event(uuid)'::regprocedure);
  _src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.process_academic_event(uuid)'::regprocedure);
  _qual text;
  _expected text;
  _e record;
  _school uuid; _arjun_uid uuid; _arjun uuid;
  _principal uuid; _admin uuid; _teacher uuid; _parent uuid; _peer uuid;
  _practice_entity uuid := gen_random_uuid();
  _control_entity uuid := gen_random_uuid();
  _ev uuid; _status text;
  _who record;
  _n int; _m int;
BEGIN
  -- 0. The router is the old one with exactly the four edits, and nothing else
  --    moved: applying them to the snapshot gives what is live, character for
  --    character.
  _expected := _was;
  FOR _e IN SELECT * FROM pg_temp.router_edits(_was) ORDER BY n LOOP
    _expected := replace(_expected, _e.before, _e.after);
    IF _e.n IN (1, 2, 3) AND pg_temp.occurrences(_now, _e.after) <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: router edit % is not in the live definition', _e.n;
    END IF;
    IF _e.n IN (2, 3, 4) AND position(_e.before IN _now) > 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: router edit % left the old text behind', _e.n;
    END IF;
  END LOOP;
  IF _now IS DISTINCT FROM _expected THEN
    RAISE EXCEPTION 'ROLLED BACK: the router changed by more than its four edits';
  END IF;
  IF pg_temp.occurrences(_src, 'PERFORM public.refresh_student_academic_profile(e.student_id);') <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: expected the router to refresh a profile in exactly two places (every student event, and an explicit refresh request), found %',
      pg_temp.occurrences(_src, 'PERFORM public.refresh_student_academic_profile(e.student_id);');
  END IF;
  IF position(E'\r' IN _src) > 0
     AND pg_temp.occurrences(_src, E'\r\n') <> pg_temp.occurrences(_src, E'\n') THEN
    RAISE EXCEPTION 'ROLLED BACK: the router''s line endings were mixed by the edit';
  END IF;

  -- 1. The policy is the old expression, narrowed, and nothing else.
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _qual FROM pg_policy p
   WHERE p.polrelid = 'public.academic_events'::regclass AND p.polname = 'academic_events_admin_select';
  IF position($t$event_type !~~ 'practice.%'::text$t$ IN _qual) = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: academic_events_admin_select does not exclude practice: %', _qual;
  END IF;

  -- 2. The purge held.
  SELECT count(*) INTO _n FROM public.school_activity_feed WHERE action LIKE 'practice.%';
  IF _n > 0 THEN RAISE EXCEPTION 'ROLLED BACK: % practice row(s) remain in the activity feed', _n; END IF;
  SELECT count(*) INTO _n FROM public.academic_events
   WHERE event_type = 'practice.session.completed' AND payload <> '{}'::jsonb;
  IF _n > 0 THEN RAISE EXCEPTION 'ROLLED BACK: % practice event(s) still carry a payload', _n; END IF;
  -- control: the telemetry the rollout summary reads kept its payload
  IF EXISTS (SELECT 1 FROM public.academic_events WHERE event_type = 'practice.weak_areas.path_used')
     AND NOT EXISTS (SELECT 1 FROM public.academic_events
                      WHERE event_type = 'practice.weak_areas.path_used' AND payload ? 'path') THEN
    RAISE EXCEPTION 'ROLLED BACK: the weak-area telemetry lost its path';
  END IF;

BEGIN
  -- The Class 10 student the leak was measured on, and one signed-in person of
  -- every other kind in his school, each chosen by an ACTIVE membership:
  -- active_membership_role() and has_role() resolve through it, and a fixture
  -- without one "is nobody", which would make every refusal below vacuous.
  SELECT s.school_id, s.user_id, s.id INTO _school, _arjun_uid, _arjun
    FROM public.students s
   WHERE s.user_id = 'd1000003-0001-4000-8000-000000000001' AND s.deleted_at IS NULL;
  IF _arjun IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the measured student is not in this database';
  END IF;
  SELECT m.account_id INTO _principal FROM public.memberships m
   WHERE m.school_id = _school AND m.role = 'principal' AND m.status = 'active' LIMIT 1;
  SELECT m.account_id INTO _admin FROM public.memberships m
   WHERE m.school_id = _school AND m.role = 'admin' AND m.status = 'active' LIMIT 1;
  SELECT m.account_id INTO _teacher FROM public.memberships m
   WHERE m.school_id = _school AND m.role = 'teacher' AND m.status = 'active' LIMIT 1;
  SELECT m.account_id INTO _parent FROM public.memberships m
   WHERE m.school_id = _school AND m.role = 'parent' AND m.status = 'active' LIMIT 1;
  SELECT m.account_id INTO _peer FROM public.memberships m
   WHERE m.school_id = _school AND m.role = 'student' AND m.status = 'active'
     AND m.account_id <> _arjun_uid LIMIT 1;
  IF _principal IS NULL OR _admin IS NULL OR _teacher IS NULL OR _parent IS NULL OR _peer IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: fixtures missing (principal %, admin %, teacher %, parent %, peer %)',
      _principal, _admin, _teacher, _parent, _peer;
  END IF;

  -- 3. A tab still running the old client sends the whole answer sheet. The
  --    insert trigger routes it at once, as it routes every event.
  INSERT INTO public.academic_events (school_id, event_type, entity_type, entity_id, actor_user_id, student_id, payload)
  VALUES (_school, 'practice.session.completed', 'practice', _practice_entity, _arjun_uid, _arjun,
          jsonb_build_object('_session_id', _practice_entity,
                             '_attempts', jsonb_build_array(jsonb_build_object('verify', '20261042000000'))))
  RETURNING id INTO _ev;
  SELECT status::text INTO _status FROM public.academic_events WHERE id = _ev;
  IF _status IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'ROLLED BACK: a practice event was not processed by the router (status %)', _status;
  END IF;
  SELECT count(*) INTO _n FROM public.school_activity_feed
   WHERE entity_id = _practice_entity OR metadata::text LIKE '%20261042000000%';
  IF _n > 0 THEN RAISE EXCEPTION 'ROLLED BACK: a practice event still reached the activity feed'; END IF;

  -- control: a school event still does, so the check above can fail.
  INSERT INTO public.academic_events (school_id, event_type, entity_type, entity_id, payload)
  VALUES (_school, 'verify.feed_control', 'verify', _control_entity, '{}'::jsonb);
  SELECT count(*) INTO _n FROM public.school_activity_feed WHERE entity_id = _control_entity;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): a school event reached the feed % time(s), expected once — the feed check proves nothing', _n;
  END IF;

  -- 4. As each person, signed in.
  FOR _who IN
    SELECT * FROM (VALUES ('principal', _principal), ('admin', _admin), ('teacher', _teacher),
                          ('parent', _parent), ('another student', _peer)) AS w(label, uid)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _who.uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) FILTER (WHERE action LIKE 'practice.%'),
           count(*) FILTER (WHERE entity_id = _control_entity)
      INTO _n, _m FROM public.school_activity_feed;
    RESET ROLE;
    IF _n > 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: the % reads % practice row(s) in the activity feed', _who.label, _n;
    END IF;
    IF _m <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK (control): the % cannot read the feed at all (% control rows) — the refusal above proves nothing', _who.label, _m;
    END IF;
  END LOOP;

  FOR _who IN SELECT * FROM (VALUES ('principal', _principal), ('admin', _admin)) AS w(label, uid) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _who.uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) FILTER (WHERE event_type LIKE 'practice.%'),
           count(*) FILTER (WHERE event_type NOT LIKE 'practice.%')
      INTO _n, _m FROM public.academic_events WHERE school_id = _school;
    RESET ROLE;
    IF _n > 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: the % reads % practice event(s)', _who.label, _n;
    END IF;
    IF _m = 0 THEN
      RAISE EXCEPTION 'ROLLED BACK (control): the % reads no school event at all — the refusal above proves nothing', _who.label;
    END IF;
  END LOOP;
  -- ...while there ARE practice events to be refused.
  IF NOT EXISTS (SELECT 1 FROM public.academic_events
                  WHERE school_id = _school AND event_type LIKE 'practice.%') THEN
    RAISE EXCEPTION 'ROLLED BACK (control): the school has no practice events, so their refusal was not tested';
  END IF;

  -- 5. The student still has his own practice.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _arjun_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.practice_sessions WHERE user_id = _arjun_uid AND finished_at IS NOT NULL;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF _n = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: the student can no longer read his own practice sessions';
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
EXCEPTION WHEN SQLSTATE 'P0999' THEN
  NULL;
END;

  IF EXISTS (SELECT 1 FROM public.academic_events
              WHERE entity_id IN (_practice_entity, _control_entity) OR event_type = 'verify.feed_control')
     OR EXISTS (SELECT 1 FROM public.school_activity_feed
                 WHERE entity_id IN (_practice_entity, _control_entity) OR action = 'verify.feed_control') THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  RAISE NOTICE 'verify OK: the router is the old one with its four edits and nothing else; no practice row is left in the feed and no practice event carries a payload; an old client''s answer sheet is routed and reaches no feed while a school event still does; the principal, admin, a teacher, a parent and another student read no practice from the feed, admin and principal read no practice event while still reading school events; the student still reads his own sessions — and nothing the proof did survived';
END
$verify$;

COMMIT;
