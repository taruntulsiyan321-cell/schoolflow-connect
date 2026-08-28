-- ---------------------------------------------------------------------
-- CHUNK 7B VERIFICATION — batch 2d (the definers batch 2c did not reach)
--
-- This is verification item 5: "No RPC, view, function or edge path exposes
-- practice data to another role." Batch 2c satisfied it for POLICIES and
-- failed it for DEFINERS, which is the whole reason this batch exists — RLS
-- does not run inside a SECURITY DEFINER body, so every check below calls the
-- function as the role rather than reading the table as the role.
--
-- G11, the checks call the real RPCs as real roles. Asserting that a body no
-- longer contains a string would prove only that a substitution ran; item 1
-- calls rpc_get_battle_report as a teacher and requires it to RAISE.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE,
-- which is what lets item 6 reopen a door without production seeing it.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo uuid := '00000000-0000-4000-8000-000000000001';

  _uid_student uuid; _uid_teacher uuid; _uid_parent uuid;
  _uid_principal uuid; _uid_admin uuid;
  _sid_student uuid;

  _pid uuid;                                            -- a battle participant
  _owner_ok text; _teacher_blocked text;                -- 1
  _mon jsonb; _mon_bad text;                            -- 2
  _snap jsonb; _snap_bad text;                          -- 3
  _alerts bigint; _profiles bigint;                     -- 4
  _tbr jsonb; _tbr_bad text;                            -- 5
  _nc_before text; _nc_after text;                      -- 6
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text;
BEGIN
  SELECT id INTO _uid_student   FROM auth.users WHERE email='arjun.mehta@wisdomcampus.com';
  SELECT id INTO _uid_teacher   FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';
  SELECT id INTO _uid_parent    FROM auth.users WHERE email='mehta.parent@wisdomcampus.com';
  SELECT id INTO _uid_principal FROM auth.users WHERE email='principal@wisdomcampus.com';
  SELECT id INTO _uid_admin     FROM auth.users WHERE email='admin@wisdomcampus.com';
  SELECT id INTO _sid_student   FROM public.students WHERE user_id=_uid_student AND deleted_at IS NULL LIMIT 1;

  ------------------------------------------------------------------
  -- 1. rpc_get_battle_report — owner yes, everyone else RAISES
  ------------------------------------------------------------------
  -- Seed a report owned by the student so the checks below run against a real
  -- row. A "not authorized" against a row that does not exist would pass for
  -- the wrong reason (the function returns NULL before it ever authorises).
  SELECT bp.id INTO _pid
    FROM public.battle_participants bp
   WHERE bp.user_id = _uid_student
   ORDER BY bp.joined_at DESC LIMIT 1;

  IF _pid IS NULL THEN
    _r1 := 'SKIPPED — no battle participation for the demo student to test against. '
        || 'A skipped check is not a passing check: re-run after seeding a battle.';
  ELSE
    INSERT INTO public.battle_reports (participant_id, battle_id, user_id, school_id, display_name, report, expires_at)
    SELECT _pid, bp.battle_id, _uid_student, _demo, 'Arjun',
           jsonb_build_object(
             'summary', jsonb_build_object('score', 10, 'rank', 1, 'accuracy_pct', 80),
             'topics',  jsonb_build_object('weak', jsonb_build_array('Trigonometry')),
             'questions', jsonb_build_array(jsonb_build_object('correct_index', 2, 'selected_index', 1))
           ),
           now() + interval '20 hours'
      FROM public.battle_participants bp WHERE bp.id = _pid
    ON CONFLICT (participant_id) DO UPDATE
      SET expires_at = now() + interval '20 hours',
          report = EXCLUDED.report;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
      BEGIN
        PERFORM public.rpc_get_battle_report(_pid);
        _owner_ok := 'owner read OK';
      EXCEPTION WHEN others THEN _owner_ok := 'owner BLOCKED (' || SQLERRM || ')';
      END;
    RESET ROLE;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
      BEGIN
        PERFORM public.rpc_get_battle_report(_pid);
        _teacher_blocked := 'teacher READ IT';
      EXCEPTION WHEN others THEN _teacher_blocked := 'teacher refused';
      END;
    RESET ROLE;

    _r1 := _owner_ok || ', ' || _teacher_blocked
        || CASE WHEN _owner_ok = 'owner read OK' AND _teacher_blocked = 'teacher refused'
                THEN ' — the definer gate is the owner, not the class (PASS)'
                ELSE ' — (FAIL)' END;
  END IF;

  ------------------------------------------------------------------
  -- 2. rpc_battle_monitor — no per-participant correctness
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    BEGIN
      SELECT public.rpc_battle_monitor((SELECT battle_id FROM public.battle_participants WHERE id = _pid))
        INTO _mon;
    EXCEPTION WHEN others THEN _mon := NULL;
    END;
  RESET ROLE;

  _mon_bad := '';
  IF _mon IS NOT NULL AND jsonb_array_length(COALESCE(_mon->'participants','[]'::jsonb)) > 0 THEN
    IF (_mon->'participants'->0) ? 'correct_count'  THEN _mon_bad := _mon_bad || 'correct_count '; END IF;
    IF (_mon->'participants'->0) ? 'answered_count' THEN _mon_bad := _mon_bad || 'answered_count '; END IF;
    IF (_mon->'participants'->0) ? 'accuracy'       THEN _mon_bad := _mon_bad || 'accuracy '; END IF;
    IF (_mon->'participants'->0) ? 'struggling'     THEN _mon_bad := _mon_bad || 'struggling '; END IF;
    _r2 := 'monitor participant keys: ' || (SELECT string_agg(k, ',') FROM jsonb_object_keys(_mon->'participants'->0) k)
        || CASE WHEN _mon_bad = '' THEN ' — no per-participant correctness (PASS)'
                ELSE ' — still exposes: ' || _mon_bad || '(FAIL)' END;
  ELSE
    _r2 := 'monitor returned no participants — cannot prove the narrowing (SKIPPED, not passed)';
  END IF;

  ------------------------------------------------------------------
  -- 3. rpc_parent_child_snapshot — no practice keys reach a parent
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    BEGIN
      SELECT public.rpc_parent_child_snapshot(NULL) INTO _snap;
    EXCEPTION WHEN others THEN _snap := NULL;
    END;
  RESET ROLE;

  _snap_bad := '';
  IF _snap IS NOT NULL AND _snap ? 'snapshot' THEN
    IF (_snap->'snapshot') ? 'weak_topics'   THEN _snap_bad := _snap_bad || 'weak_topics '; END IF;
    IF (_snap->'snapshot') ? 'strong_topics' THEN _snap_bad := _snap_bad || 'strong_topics '; END IF;
    IF (_snap->'snapshot') ? 'mistake_count' THEN _snap_bad := _snap_bad || 'mistake_count '; END IF;
    _r3 := 'parent snapshot keys: ' || (SELECT string_agg(k, ',') FROM jsonb_object_keys(_snap->'snapshot') k)
        || CASE WHEN _snap_bad = '' THEN ' — practice withheld, and ABSENT rather than zeroed (PASS)'
                ELSE ' — still returns: ' || _snap_bad || '(FAIL)' END;
  ELSE
    _r3 := 'parent snapshot returned nothing — cannot prove withholding (SKIPPED, not passed)';
  END IF;

  ------------------------------------------------------------------
  -- 4. What the writer already wrote is gone
  ------------------------------------------------------------------
  SELECT count(*) INTO _alerts FROM public.parent_academic_alerts
   WHERE kind = 'weakness' AND title = 'Mistakes need revision';
  SELECT count(*) INTO _profiles FROM public.student_academic_profiles
   WHERE metrics ?| ARRAY['weakTopics','strongTopics'];

  _r4 := 'durable mistake-book alerts=' || _alerts || ', profiles carrying weak/strong topics=' || _profiles
      || CASE WHEN _alerts = 0 AND _profiles = 0
              THEN ' — closing the writer without purging what it wrote would not have been a closure (PASS)'
              ELSE ' — residue survives (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. rpc_teacher_battle_reports — public standings only
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    BEGIN
      SELECT public.rpc_teacher_battle_reports((SELECT battle_id FROM public.battle_participants WHERE id = _pid))
        INTO _tbr;
    EXCEPTION WHEN others THEN _tbr := NULL;
    END;
  RESET ROLE;

  _tbr_bad := '';
  IF _tbr IS NOT NULL AND jsonb_typeof(_tbr) = 'array' AND jsonb_array_length(_tbr) > 0 THEN
    IF (_tbr->0->'summary') ? 'accuracy_pct'   THEN _tbr_bad := _tbr_bad || 'accuracy_pct '; END IF;
    IF (_tbr->0->'summary') ? 'correct_count'  THEN _tbr_bad := _tbr_bad || 'correct_count '; END IF;
    IF (_tbr->0->'summary') ? 'skipped_count'  THEN _tbr_bad := _tbr_bad || 'skipped_count '; END IF;
    _r5 := 'teacher report summary keys: ' || (SELECT string_agg(k, ',') FROM jsonb_object_keys(_tbr->0->'summary') k)
        || CASE WHEN _tbr_bad = '' THEN ' — §10.16 public half only (PASS)'
                ELSE ' — still exposes: ' || _tbr_bad || '(FAIL)' END;
  ELSE
    _r5 := 'teacher battle reports returned nothing — cannot prove the narrowing (SKIPPED, not passed)';
  END IF;

  ------------------------------------------------------------------
  -- 6. Negative control — would item 1 notice if the door reopened?
  ------------------------------------------------------------------
  _nc_before := _teacher_blocked;

  CREATE OR REPLACE FUNCTION public.rpc_get_battle_report(_participant_id uuid)
   RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $negctl$
  DECLARE _r record;
  BEGIN
    SELECT br.* INTO _r FROM public.battle_reports br WHERE br.participant_id = _participant_id;
    IF _r IS NULL THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('report', _r.report);   -- deliberately ungated
  END $negctl$;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.rpc_get_battle_report(_pid);
      _nc_after := 'teacher READ IT';
    EXCEPTION WHEN others THEN _nc_after := 'teacher refused';
    END;
  RESET ROLE;

  _r6 := 'fenced: ' || COALESCE(_nc_before,'n/a') || ' | ungated: ' || _nc_after
      || CASE WHEN _nc_before = 'teacher refused' AND _nc_after = 'teacher READ IT'
              THEN ' — item 1 detects a real reopening, so its refusal is meaningful (PASS)'
              ELSE ' — the control did not move, so item 1 proves nothing (FAIL)' END;

  RAISE EXCEPTION E'CHUNK7B_BATCH2D\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6;
END $verify$;
