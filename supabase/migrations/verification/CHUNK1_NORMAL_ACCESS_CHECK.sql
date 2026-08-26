-- =====================================================================
-- CHUNK 1 — did the tenancy fences take anything away from real users?
--
-- The membership fence and the restrictive tenant fence both narrow access.
-- This is the counter-check: every real account, in its own ordinary single
-- membership session (no fixtures, no switching), reading the tables it uses.
-- A zero where data exists means the fence went too far.
--
-- Writes nothing. Ends in a deliberate RAISE so the transaction rolls back
-- no matter what.
-- =====================================================================

DO $chk$
DECLARE
  _out text := E'\n===== NORMAL ACCESS — each user in their own single membership =====\n';
  _p   record;
  _t   text;
  _n   int;
  _row text;
  _tables text[] := ARRAY['students','teachers','classes','attendance','homework',
                          'homework_submissions','marks','exams','notifications','notices'];
BEGIN
  _out := _out || format('%-11s %-34s %s%s', 'ROLE', 'ACCOUNT',
                         array_to_string(_tables, ' | '), E'\n');

  FOR _p IN
    SELECT pr.id, pr.email, m.role::text AS role
      FROM public.profiles pr
      JOIN public.memberships m ON m.account_id = pr.id AND m.status = 'active'
     WHERE pr.email IN ('arjun.mehta@wisdomcampus.com',
                        'priya.sharma@wisdomcampus.com',
                        'mehta.parent@wisdomcampus.com',
                        'admin@wisdomcampus.com',
                        'principal@wisdomcampus.com')
     ORDER BY m.role
  LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _p.id, 'role', 'authenticated',
                        'session_id', gen_random_uuid())::text, true);
    SET LOCAL ROLE authenticated;

    _row := '';
    FOREACH _t IN ARRAY _tables LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I', _t) INTO _n;
      EXCEPTION WHEN others THEN
        _n := -1;
      END;
      _row := _row || lpad(_n::text, 4) || ' ';
    END LOOP;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    _out := _out || format('%-11s %-34s %s%s', _p.role, _p.email, _row, E'\n');
  END LOOP;

  _out := _out || E'\n(-1 = table not readable at all. A 0 where that role should see data is a regression.)';
  RAISE EXCEPTION '%', _out;
END $chk$;
