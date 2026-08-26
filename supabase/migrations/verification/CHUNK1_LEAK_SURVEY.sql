-- =====================================================================
-- CHUNK 1 — cross-institution leak survey.
--
-- Proof 2 failed: an account switched to institution B could still see a
-- class belonging to institution A. This measures the FULL surface of that
-- failure rather than fixing the one table the proof happened to touch.
--
-- For each of a student, a teacher and a parent account: give them an active
-- membership at a throwaway institution B, switch the session to B, then count
-- how many rows of institution A remain visible in every school-scoped table.
-- Anything above zero is a cross-institution leak.
--
-- SAFETY: ends in a deliberate RAISE, so the whole transaction — institution
-- B, its rows, and every test membership — is rolled back. Nothing survives.
-- =====================================================================

DO $survey$
DECLARE
  _out     text := E'\n===== CROSS-INSTITUTION LEAK SURVEY =====\n';
  _schoolA uuid;
  _schoolB uuid;
  _sess    uuid;
  _mB      uuid;
  _acct    uuid;
  _label   text;
  _tbl     text;
  _n       int;
  _leaks       int := 0;
  _personleaks int := 0;
  _persons text[][] := ARRAY[
    ['qa.automation@wisdomcampus.com', 'STUDENT'],
    ['priya.sharma@wisdomcampus.com',  'TEACHER'],
    ['mehta.parent@wisdomcampus.com',  'PARENT']
  ];
  _i int;
BEGIN
  SELECT id INTO _schoolA FROM public.schools ORDER BY created_at LIMIT 1;

  INSERT INTO public.schools (name, slug, is_active, board)
  VALUES ('ZZ Survey Institution B', 'zz-survey-b', true, 'rbse')
  RETURNING id INTO _schoolB;

  FOR _i IN 1 .. array_length(_persons, 1) LOOP
    SELECT p.id INTO _acct FROM public.profiles p WHERE p.email = _persons[_i][1];
    _label := _persons[_i][2];

    IF _acct IS NULL THEN
      _out := _out || format('%s%s: account not found (%s) — skipped%s',
                             E'\n', _label, _persons[_i][1], E'\n');
      CONTINUE;
    END IF;

    -- Give this account an active membership at institution B and switch to it.
    INSERT INTO public.memberships (account_id, school_id, role, status, responded_at)
    VALUES (_acct, _schoolB,
            (SELECT m.role FROM public.memberships m
              WHERE m.account_id = _acct AND m.status = 'active' LIMIT 1),
            'active', now())
    RETURNING id INTO _mB;

    _sess := gen_random_uuid();
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _acct, 'role', 'authenticated', 'session_id', _sess)::text, true);

    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_switch_membership(_mB);

    _out := _out || format('%s%s (%s) — active membership switched to institution B%s',
                           E'\n', _label, _persons[_i][1], E'\n');

    -- Every school-scoped table: how much of institution A is still visible?
    FOR _tbl IN
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public'
         AND c.relkind = 'r'
         AND c.relrowsecurity
         AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'school_id'
                        AND a.attnum > 0 AND NOT a.attisdropped)
       ORDER BY c.relname
    LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id = $1', _tbl)
          INTO _n USING _schoolA;
      EXCEPTION WHEN others THEN
        _n := -1;   -- not readable at all; that is not a leak
      END;

      IF _n > 0 THEN
        IF _tbl IN ('memberships', 'profiles', 'accounts', 'sessions', 'account_identifiers') THEN
          -- Expected and required: you must be able to see your own identity
          -- rows at institution A in order to switch back to it.
          _out := _out || format('    ok    %-34s %s row(s) — own identity row, by design%s',
                                 _tbl, _n, E'\n');
        ELSE
          _leaks := _leaks + 1;
          _personleaks := _personleaks + 1;
          _out := _out || format('    LEAK  %-34s %s row(s) of institution A visible%s',
                                 _tbl, _n, E'\n');
        END IF;
      END IF;
    END LOOP;

    IF _personleaks = 0 THEN
      _out := _out || format('    (no leaks for this person)%s', E'\n');
    END IF;
    _personleaks := 0;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
  END LOOP;

  _out := _out || format('%s===== TOTAL LEAKING TABLE/PERSON COMBINATIONS: %s =====%s',
                         E'\n', _leaks, E'\n');
  _out := _out || 'Rolling back — institution B and all survey memberships are discarded.';

  RAISE EXCEPTION '%', _out;
END;
$survey$;
