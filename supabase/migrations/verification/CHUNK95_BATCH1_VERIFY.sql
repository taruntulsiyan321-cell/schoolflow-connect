-- ---------------------------------------------------------------------
-- CHUNK 9.5 BATCH 1 VERIFICATION
--
-- The chunk is explicit that "a revoke that breaks a teacher's attendance
-- screen is worse than the exposure it closed", so this file spends more of
-- itself proving nothing broke than proving the hole closed.
--
--   1. the 18 are refused — as the authenticated ROLE, not via a JWT claim
--   2. service_role still reaches them
--   3. the two TRIGGER functions still fire
--   4. rpc_recovery_session_plan still works for a student — the two helpers
--      excluded from the batch were excluded correctly
--   5. ALTER DEFAULT PRIVILEGES holds for a brand-new function
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo    uuid := '00000000-0000-4000-8000-000000000001';
  _student uuid;
  _chap    uuid;
  _battle  uuid;
  _code    text;
  _denied  int := 0;
  _ran     int := 0;
  _sig     text;
  _sigs    text[] := ARRAY[
    '_academic_label_match_key(text)',
    '_battles_set_code()',
    '_classify_mistake_error(jsonb,jsonb,jsonb,integer,integer)',
    '_compute_mastery_score(integer,integer,integer,integer,integer,timestamp with time zone)',
    '_concept_severity(numeric)',
    '_eie_attendance_risk_band(numeric)',
    '_eie_band_severity(text)',
    '_eie_homework_consistency_band(numeric)',
    '_enforce_duel_capacity()',
    '_fix_academic_display_text(text)',
    '_fix_utf8_content(text)',
    '_generate_battle_code()',
    '_humanize_template_type(text)',
    '_normalize_cp1252_mojibake_to_latin1(text)',
    '_normalize_subject_label(text)',
    '_recovery_question_count(text)',
    '_repair_utf8_mojibake(text)',
    '_rule_improvement_plan(text,text,text,numeric,integer,integer)'
  ];
  _svc     int := 0;
  _plan    jsonb;
  _newfn   boolean;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text;
BEGIN
  SELECT s.user_id INTO _student FROM public.students s
   WHERE s.school_id = _demo AND s.user_id IS NOT NULL AND s.deleted_at IS NULL
   ORDER BY s.id LIMIT 1;
  IF _student IS NULL THEN
    RAISE EXCEPTION 'CHUNK95: no linked demo student. A skipped check is not a passing check.';
  END IF;

  ------------------------------------------------------------------
  -- 1. Refused for authenticated, still reachable by service_role
  ------------------------------------------------------------------
  -- has_function_privilege asks the question directly and needs no role switch.
  -- It is checked against `authenticated`, never `public`: 290 of the 305
  -- functions on this surface hold an EXPLICIT authenticated grant, so a
  -- `public` check would report success on a revoke that changed nothing.
  FOREACH _sig IN ARRAY _sigs LOOP
    IF NOT has_function_privilege('authenticated', ('public.' || _sig)::regprocedure, 'EXECUTE')
       AND NOT has_function_privilege('anon', ('public.' || _sig)::regprocedure, 'EXECUTE')
       AND NOT has_function_privilege('public', ('public.' || _sig)::regprocedure, 'EXECUTE') THEN
      _denied := _denied + 1;
    END IF;
    IF has_function_privilege('service_role', ('public.' || _sig)::regprocedure, 'EXECUTE') THEN
      _svc := _svc + 1;
    END IF;
  END LOOP;

  _r1 := format('%s of %s closed to authenticated/anon/PUBLIC; %s of %s still open to service_role',
                _denied, array_length(_sigs, 1), _svc, array_length(_sigs, 1))
      || CASE WHEN _denied = array_length(_sigs, 1) AND _svc = array_length(_sigs, 1)
              THEN ' — the hole closed AND the background path survived (PASS)'
              WHEN _denied < array_length(_sigs, 1)
              THEN ' — a function is still reachable (FAIL)'
              ELSE ' — the revoke also cut service_role (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. A real call, as the real role, with a control
  ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public._generate_battle_code();
    _ran := _ran + 1;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN NULL;
  END;
  -- Control: something the role IS meant to reach must still run, or "denied"
  -- above could just mean SET LOCAL ROLE broke everything.
  BEGIN
    PERFORM public.get_my_role();
    _r2 := 'called _generate_battle_code() as authenticated: ' ||
           CASE WHEN _ran = 0 THEN 'refused' ELSE 'RAN' END ||
           '; control get_my_role() still runs';
  EXCEPTION WHEN OTHERS THEN
    _r2 := '*** control failed: get_my_role() also denied, so nothing here is meaningful ***';
  END;
  RESET ROLE;
  _r2 := _r2 || CASE WHEN _ran = 0 AND _r2 NOT LIKE '%control failed%'
                     THEN ' (PASS)' ELSE ' (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. The trigger functions still fire
  ------------------------------------------------------------------
  -- _battles_set_code was revoked. Postgres does not check EXECUTE when firing
  -- a trigger — expected, so asserted rather than assumed. If this fails, the
  -- revoke silently broke battle creation for everyone.
  -- battle_code is NOT NULL with NO DEFAULT, and _battles_set_code() is what
  -- fills it. So this is a sharper test than intended: if the revoke had broken
  -- trigger firing, the INSERT would not return a null code, it would fail
  -- outright on the not-null constraint.
  INSERT INTO public.battles (creator_user_id, title, subject, source)
  VALUES (_student, 'CHUNK95 trigger probe', 'Mathematics', 'solo')
  RETURNING id, battle_code INTO _battle, _code;

  _r3 := format('battle inserted after revoking _battles_set_code; battle_code = %s', coalesce(_code, 'NULL'))
      || CASE WHEN _code IS NOT NULL AND length(_code) > 0
              THEN ' — the trigger still fires; revoking EXECUTE does not affect trigger invocation (PASS)'
              ELSE ' — the trigger did not set a code, so the revoke broke battle creation (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. The two EXCLUDED helpers were excluded correctly
  ------------------------------------------------------------------
  -- rpc_recovery_session_plan is SECURITY INVOKER and calls
  -- _recovery_chapter_is_mine and _recovery_variant_pool, so its calls are
  -- privilege-checked against the student. Had those two been swept into this
  -- batch, recovery would be dead for every student and nothing else in this
  -- file would have noticed.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _student, 'role', 'authenticated')::text, true);
  SELECT c.id INTO _chap FROM public.chapters c
   WHERE public._recovery_chapter_is_mine(c.id) LIMIT 1;

  IF _chap IS NULL THEN
    _r4 := 'no reachable chapter for this student — item 4 could not run (FAIL, not a skip)';
  ELSE
    SET LOCAL ROLE authenticated;
    BEGIN
      _plan := public.rpc_recovery_session_plan(_chap);
      RESET ROLE;
      _r4 := format('rpc_recovery_session_plan ran as authenticated and returned session_size %s',
                    _plan->>'session_size')
          || ' — the two excluded helpers are still reachable by the INVOKER path (PASS)';
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      _r4 := 'rpc_recovery_session_plan FAILED as authenticated: ' || left(SQLERRM, 90)
          || ' — batch 1 broke recovery (FAIL)';
    END;
  END IF;

  ------------------------------------------------------------------
  -- 5. The default privilege holds for a NEW function
  ------------------------------------------------------------------
  -- Without ALTER DEFAULT PRIVILEGES the surface regrows with every migration,
  -- so this creates a throwaway function and asks the same question of it.
  EXECUTE 'CREATE FUNCTION public._chunk95_throwaway() RETURNS int LANGUAGE sql IMMUTABLE AS $f$ SELECT 1 $f$';
  _newfn := has_function_privilege('authenticated', 'public._chunk95_throwaway()'::regprocedure, 'EXECUTE')
         OR has_function_privilege('public', 'public._chunk95_throwaway()'::regprocedure, 'EXECUTE');
  EXECUTE 'DROP FUNCTION public._chunk95_throwaway()';

  _r5 := format('a brand-new function is executable by authenticated/PUBLIC: %s', _newfn)
      || CASE WHEN _newfn IS FALSE
              THEN ' — the default holds, so the surface does not regrow with the next migration (PASS)'
              ELSE ' — new functions are still exposed by default (FAIL)' END;

  RAISE EXCEPTION E'CHUNK95 BATCH 1\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5;
END $verify$;
