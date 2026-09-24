-- Rollback for 20260925220000_riverside_public_school_awaits_its_people.
--
-- Removes Riverside Public School (00000000-0000-4000-8000-000000000003) entirely:
-- every row of every public table that belongs to it — the structure the migration
-- wrote AND everything added into it since through the app (its teachers, students
-- and parents, their links, homework and hand-ins, attendance, tests, exams and marks,
-- notices, notifications, events, XP) — and then its accounts: account rows and
-- identifiers, profiles, auth identities and users.
--
-- NEVER ANOTHER SCHOOL. Rows are chosen by this school's id; an account is removed
-- only when it holds no membership in any other school; and the proof compares every
-- other school's rows before and after.
--
-- WHAT IT CANNOT REMOVE: files handed in stay in storage — `storage.objects` refuses a
-- SQL delete (`protect_objects_delete`). The RBSE curriculum classes 8–12 the migration
-- ensures are the curriculum's, not the school's, and stay.
--
-- `npm run db:seed:e2e-school:remove` applies this file and then deletes the ledger row.

-- Every other school's rows, to prove afterwards that none of them moved.
CREATE TEMP TABLE rps_rollback_others AS
SELECT c.table_name, 0::bigint AS n
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
 WHERE c.table_schema = 'public' AND c.column_name = 'school_id';

DO $count_others$
DECLARE _t record; _n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = '00000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'ABORT: Riverside Public School is not in this database, so there is nothing to roll back';
  END IF;
  FOR _t IN SELECT table_name FROM rps_rollback_others LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id IS DISTINCT FROM $1', _t.table_name)
      INTO _n USING '00000000-0000-4000-8000-000000000003'::uuid;
    UPDATE rps_rollback_others SET n = _n WHERE table_name = _t.table_name;
  END LOOP;
END
$count_others$;

DO $rollback$
DECLARE
  _school constant uuid := '00000000-0000-4000-8000-000000000003';
  _uids uuid[];
  _t record;
  _n bigint;
  _pass int;
  _blocked int;
  _deleted bigint;
BEGIN
  -- Its accounts: every Riverside login and member, and no one who belongs anywhere else.
  SELECT coalesce(array_agg(DISTINCT u.id), ARRAY[]::uuid[]) INTO _uids
    FROM (
      SELECT account_id AS id FROM public.memberships WHERE school_id = _school
      UNION
      SELECT id FROM auth.users WHERE email LIKE '%@rps.e2e.test'
    ) u
   WHERE NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.account_id = u.id AND m.school_id <> _school);

  -- A student with homework, attendance or marks cannot be deleted
  -- (tg_students_prevent_orphan_history), so that history goes first.
  DELETE FROM public.homework_submissions WHERE school_id = _school;
  DELETE FROM public.attendance WHERE school_id = _school;
  DELETE FROM public.marks WHERE school_id = _school;

  -- Every table carrying school_id, pass after pass: a foreign key between two of
  -- them only decides the order, and a delete that fires an event (homework does)
  -- leaves a row the next pass collects. Done when a whole pass removes nothing and
  -- nothing refuses.
  FOR _pass IN 1..15 LOOP
    _blocked := 0;
    _deleted := 0;
    FOR _t IN
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = 'school_id' AND c.table_name <> 'schools'
       ORDER BY c.table_name
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE school_id = $1', _t.table_name) USING _school;
        GET DIAGNOSTICS _n = ROW_COUNT;
        _deleted := _deleted + _n;
      EXCEPTION WHEN foreign_key_violation THEN
        _blocked := _blocked + 1;
      END;
    END LOOP;
    EXIT WHEN _blocked = 0 AND _deleted = 0;
  END LOOP;

  DELETE FROM public.schools WHERE id = _school;

  -- The accounts' own rows that carry no school: sessions, identifiers, tokens,
  -- notifications written without one. user_roles is frozen read-only and never
  -- held a Riverside row.
  IF cardinality(_uids) > 0 THEN
    FOR _pass IN 1..8 LOOP
      _blocked := 0;
      _deleted := 0;
      FOR _t IN
        SELECT c.table_name, c.column_name
          FROM information_schema.columns c
          JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
         WHERE c.table_schema = 'public' AND c.column_name IN ('user_id', 'account_id') AND c.data_type = 'uuid'
           AND c.table_name NOT IN ('profiles', 'accounts', 'user_roles')
         ORDER BY c.table_name
      LOOP
        BEGIN
          EXECUTE format('DELETE FROM public.%I WHERE %I = ANY ($1)', _t.table_name, _t.column_name) USING _uids;
          GET DIAGNOSTICS _n = ROW_COUNT;
          _deleted := _deleted + _n;
        EXCEPTION WHEN foreign_key_violation THEN
          _blocked := _blocked + 1;
        END;
      END LOOP;
      EXIT WHEN _blocked = 0 AND _deleted = 0;
    END LOOP;

    DELETE FROM public.profiles WHERE id = ANY (_uids);
    DELETE FROM public.accounts WHERE id = ANY (_uids);
    DELETE FROM auth.identities WHERE user_id = ANY (_uids);
    DELETE FROM auth.users WHERE id = ANY (_uids);
  END IF;

  RAISE NOTICE 'Riverside Public School removed (% account(s))', cardinality(_uids);
END
$rollback$;

DO $verify$
DECLARE
  _school constant uuid := '00000000-0000-4000-8000-000000000003';
  _t record;
  _n bigint;
  _left text := '';
  _moved text := '';
BEGIN
  IF EXISTS (SELECT 1 FROM public.schools WHERE id = _school) THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside Public School is still there';
  END IF;
  FOR _t IN SELECT table_name, n FROM rps_rollback_others ORDER BY table_name LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id = $1', _t.table_name) INTO _n USING _school;
    IF _n > 0 THEN _left := _left || format(' %s=%s', _t.table_name, _n); END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id IS DISTINCT FROM $1', _t.table_name) INTO _n USING _school;
    IF _n <> _t.n THEN _moved := _moved || format(' %s %s→%s', _t.table_name, _t.n, _n); END IF;
  END LOOP;
  IF _left <> '' THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside rows remain:%', _left;
  END IF;
  IF _moved <> '' THEN
    RAISE EXCEPTION 'ROLLED BACK: rows of another school changed:%', _moved;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email LIKE '%@rps.e2e.test')
     OR EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE '%@rps.e2e.test') THEN
    RAISE EXCEPTION 'ROLLED BACK: a Riverside login or profile remains';
  END IF;
  RAISE NOTICE 'rollback OK: Riverside Public School, everything added into it and its accounts are gone; no other school''s row changed';
END
$verify$;

DROP TABLE rps_rollback_others;
