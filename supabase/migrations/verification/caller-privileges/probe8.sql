-- probe8: can a student rank themselves first by writing their own XP row?
--
-- student_xp is written directly by the browser (xpService.ts:132-133) under
-- policy "xp self upsert" -- FOR ALL, WITH CHECK (user_id = auth.uid()) -- and
-- authenticated additionally holds arwdDxtm on the table. Both leaderboard
-- RPCs read student_xp.xp. This asks the database whether that is reachable.
--
-- The assertions are written to the FIXED expectation: the direct write must be
-- refused and the board must not move. Run against the unfixed schema they FAIL,
-- and the observed column reports the rank the attacker actually reached.
--
-- Attacker: Vikram Joshi, xp 10, last of 11 in his class.
-- Victim:   Arjun Mehta,  xp 910, first of 11.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  BEGIN
    EXECUTE _sql INTO _out;
    PERFORM set_config('role','postgres', true);
    RETURN 'OK: ' || coalesce(_out,'null');
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    RETURN 'ERROR: ' || SQLERRM;
  END;
END $fn$;
DO $probe$
DECLARE
  atk uuid := 'd1000003-0005-4000-8000-000000000005';  -- Vikram Joshi, xp 10, rank 11/11
  vic uuid := 'd1000003-0001-4000-8000-000000000001';  -- Arjun Mehta,  xp 910, rank 1/11
  ghost uuid := '00000000-dead-4000-8000-00000000beef';
  r text; r2 text;
  base_rpc text; base_prog text; base_week text;
  post_rpc text; post_prog text; post_week text;
  xp_before int; xp_after int; vic_before int; vic_after int;
  sql_rpc  text := $q$SELECT ord::text FROM (SELECT l.user_id AS uid, row_number() OVER (ORDER BY l.score DESC, l.full_name ASC) AS ord FROM public.rpc_leaderboard('class','xp',NULL,100) l) q WHERE q.uid = %L$q$;
  sql_prog text := $q$SELECT ord::text FROM (SELECT e->>'user_id' AS uid, ordinality AS ord FROM jsonb_array_elements(public.rpc_progression_leaderboard('class','lifetime','xp',NULL,100)->'rows') WITH ORDINALITY AS t(e, ordinality)) q WHERE q.uid = %L$q$;
  sql_week text := $q$SELECT ord::text FROM (SELECT e->>'user_id' AS uid, ordinality AS ord FROM jsonb_array_elements(public.rpc_progression_leaderboard('class','weekly','xp',NULL,100)->'rows') WITH ORDINALITY AS t(e, ordinality)) q WHERE q.uid = %L$q$;
BEGIN
  SELECT xp INTO xp_before FROM public.student_xp WHERE user_id = atk;
  SELECT xp INTO vic_before FROM public.student_xp WHERE user_id = vic;

  -- ---- step 1: baseline position, read as the student themselves ----
  base_rpc  := pg_temp.as_user(atk, format(sql_rpc,  atk));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP baseline rank rpc_leaderboard','student (attacker)','not already first',base_rpc,
     CASE WHEN base_rpc ~ '^OK: [0-9]+$' AND (substring(base_rpc from 5))::int > 1 THEN 'PASS' ELSE 'FAIL' END);

  base_prog := pg_temp.as_user(atk, format(sql_prog, atk));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP baseline rank progression lifetime','student (attacker)','not already first',base_prog,
     CASE WHEN base_prog ~ '^OK: [0-9]+$' AND (substring(base_prog from 5))::int > 1 THEN 'PASS' ELSE 'FAIL' END);

  base_week := pg_temp.as_user(atk, format(sql_week, atk));

  -- ---- step 2: the attack -- write my own row ----
  r := pg_temp.as_user(atk, format($q$WITH upd AS (UPDATE public.student_xp SET xp = 999999, level = 99 WHERE user_id = %L RETURNING 1) SELECT count(*)::text FROM upd$q$, atk));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP direct self-write to student_xp.xp','student (attacker)','ERROR permission denied - XP is engine-owned',r,
     CASE WHEN r LIKE 'ERROR%permission denied%' OR r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  SELECT xp INTO xp_after FROM public.student_xp WHERE user_id = atk;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP value unchanged after direct write','student (attacker)', format('xp stays %s', xp_before), format('xp %s -> %s', xp_before, xp_after),
     CASE WHEN xp_after = xp_before THEN 'PASS' ELSE 'FAIL' END);

  -- ---- step 3: re-read both boards ----
  post_rpc  := pg_temp.as_user(atk, format(sql_rpc,  atk));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP rank after write rpc_leaderboard','student (attacker)', 'unchanged from '||base_rpc, post_rpc,
     CASE WHEN post_rpc = base_rpc THEN 'PASS' ELSE 'FAIL' END);

  post_prog := pg_temp.as_user(atk, format(sql_prog, atk));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP rank after write progression lifetime','student (attacker)', 'unchanged from '||base_prog, post_prog,
     CASE WHEN post_prog = base_prog THEN 'PASS' ELSE 'FAIL' END);

  post_week := pg_temp.as_user(atk, format(sql_week, atk));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP rank after write progression weekly (from history)','student (attacker)', 'unchanged from '||base_week, post_week,
     CASE WHEN post_week = base_week THEN 'PASS' ELSE 'FAIL' END);

  -- restore, so the controls below start from the real baseline
  UPDATE public.student_xp SET xp = xp_before, level = public.progression_level_for_xp(xp_before) WHERE user_id = atk;

  -- ---- positive control: another student's row must be refused ----
  r := pg_temp.as_user(atk, format($q$WITH upd AS (UPDATE public.student_xp SET xp = 999999 WHERE user_id = %L RETURNING 1) SELECT count(*)::text FROM upd$q$, vic));
  SELECT xp INTO vic_after FROM public.student_xp WHERE user_id = vic;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP write to ANOTHER student row (positive control)','student (attacker)','refused AND victim xp untouched',
     format('%s / victim xp %s -> %s', r, vic_before, vic_after),
     CASE WHEN vic_after = vic_before AND (r = 'OK: 0' OR r LIKE 'ERROR%') THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(atk, format($q$WITH ins AS (INSERT INTO public.student_xp (user_id, xp, level) VALUES (%L, 999999, 99) RETURNING 1) SELECT count(*)::text FROM ins$q$, ghost));
  SELECT count(*)::text INTO r2 FROM public.student_xp WHERE user_id = ghost;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP insert a row for a different user (positive control)','student (attacker)','refused AND no row created',
     format('%s / rows now %s', r, r2),
     CASE WHEN r2 = '0' AND r LIKE 'ERROR%' THEN 'PASS' ELSE 'FAIL' END);

  -- ---- positive control: the legitimate engine path still awards XP ----
  SELECT xp INTO xp_before FROM public.student_xp WHERE user_id = atk;
  -- source_type is constrained to an allow-list (progression_history_source_type_check); pass NULL rather than invent one.
  r := pg_temp.as_user(atk, format($q$SELECT (public.rpc_apply_progression('daily.login',NULL,NULL,%L,NULL,'{}'::jsonb,NULL) ->> 'applied')$q$, 'probe8-'||gen_random_uuid()::text));
  SELECT xp INTO xp_after FROM public.student_xp WHERE user_id = atk;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP legitimate award via rpc_apply_progression (positive control)','student','OK: true and xp +5 (daily.login)',
     format('%s / xp %s -> %s', r, xp_before, xp_after),
     CASE WHEN r = 'OK: true' AND xp_after = xp_before + 5 THEN 'PASS' ELSE 'FAIL' END);

  -- ---- positive control: the student can still READ their own row ----
  r := pg_temp.as_user(atk, format($q$SELECT xp::text FROM public.student_xp WHERE user_id = %L$q$, atk));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('XP self read still permitted (positive control)','student','OK: a number',r,
     CASE WHEN r ~ '^OK: [0-9]+$' THEN 'PASS' ELSE 'FAIL' END);

  -- ---- the one client write that survives: badge equip via the RPC ----
  -- vic holds 5 earned badges; atk holds none, so vic is the equipping student.
  r := pg_temp.as_user(vic, $q$WITH x AS (SELECT public.rpc_set_equipped_badge('first_win')) SELECT 'done' FROM x$q$);
  SELECT equipped_badge INTO r2 FROM public.student_xp WHERE user_id = vic;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('badge equip via rpc_set_equipped_badge (positive control)','student (owner of the badge)','OK: done and equipped_badge = first_win',
     format('%s / equipped %s', r, coalesce(r2,'null')),
     CASE WHEN r = 'OK: done' AND r2 = 'first_win' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(vic, $q$WITH x AS (SELECT public.rpc_set_equipped_badge('never_earned_this_one')) SELECT 'done' FROM x$q$);
  SELECT equipped_badge INTO r2 FROM public.student_xp WHERE user_id = vic;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('badge equip refuses an unearned badge','student','ERROR Badge not earned, equip unchanged',
     format('%s / equipped %s', r, coalesce(r2,'null')),
     CASE WHEN r LIKE 'ERROR%Badge not earned%' AND r2 = 'first_win' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(vic, $q$WITH x AS (SELECT public.rpc_set_equipped_badge(NULL)) SELECT 'done' FROM x$q$);
  SELECT equipped_badge INTO r2 FROM public.student_xp WHERE user_id = vic;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('badge unequip clears the column (positive control)','student','OK: done and equipped_badge null',
     format('%s / equipped %s', r, coalesce(r2,'null')),
     CASE WHEN r = 'OK: done' AND r2 IS NULL THEN 'PASS' ELSE 'FAIL' END);
END
$probe$;
SELECT n, area, role_tested, verdict, expected, observed FROM probe ORDER BY n;
ROLLBACK;
