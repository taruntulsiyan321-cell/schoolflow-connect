-- =====================================================================
-- CHUNK 8 BATCH 1a — leave_decisions, proved as real roles.
--
-- SAFETY: this script inserts a decision row, proves what it needs to, and
-- then RAISES on purpose. The raise aborts the transaction, so the fixture
-- row is rolled back and nothing survives. The proof arrives as the text of
-- that exception. It cannot leave debris behind.
--
-- Run it AFTER 20260902140000_chunk8_batch1a_leave_decisions.sql is applied.
--
-- Every check below is a BEHAVIOURAL one, run under SET LOCAL ROLE
-- authenticated with a real user's claims. Reading pg_policies would only
-- prove the policies exist, which is the failure mode G13 exists for: a
-- policy that is present and does not fence is indistinguishable from a
-- policy that works, until someone calls it as a person.
-- =====================================================================

DO $proof$
DECLARE
  _out        text := E'\n===== CHUNK 8 BATCH 1a =====\n';
  _ok         boolean := true;
  _n          int;
  _total      int;
  _req        uuid;
  _owner      uuid;
  _other      uuid;
  _ct         uuid;
  _student    uuid;
  _school     uuid;
  _seen       int;
  _inserted   int;
BEGIN
  -- ---------- 1. there is exactly one home for a verdict ------------------
  -- This check used to compare the derivation against leave_requests.status.
  -- Batch 1c dropped that column, so the comparison is no longer possible —
  -- and what it was really asserting has become the stronger statement below:
  -- there is nothing left to disagree with. The 1c migration ran the old
  -- comparison one last time immediately before the DROP and refused to
  -- proceed on any disagreement, which is the only moment it could be asked.
  SELECT count(*) INTO _total FROM public.leave_requests;
  SELECT count(*) INTO _n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'leave_requests'
     AND column_name IN ('status', 'reviewed_at', 'reviewed_by');

  IF _n = 0 THEN
    _out := _out || format(E'PASS  leave_decisions is the only home for a verdict across %s request(s)\n', _total);
  ELSE
    _out := _out || format(E'FAIL  %s dual-write column(s) still on leave_requests\n', _n);
    _ok := false;
  END IF;

  -- ---------- 2. null decider survived the write, as null -----------------
  -- The eight unattributed rows are the whole reason decided_by is nullable.
  -- If anything defaulted them, this is where it shows.
  SELECT count(*) INTO _n
    FROM public.leave_decisions WHERE decided_by IS NULL AND decided_at IS NULL;
  IF _n = 8 THEN
    _out := _out || E'PASS  8 unattributed decision(s) still carry NULL decider and NULL time\n';
  ELSE
    _out := _out || format(E'FAIL  expected 8 unattributed, found %s\n', _n);
    _ok := false;
  END IF;

  SELECT count(*) INTO _n
    FROM public.leave_decisions
   WHERE decided_by IS NULL AND (provenance IS NULL OR provenance = '');
  IF _n = 0 THEN
    _out := _out || E'PASS  every unattributed decision says why it is unattributed\n';
  ELSE
    _out := _out || format(E'FAIL  %s unattributed decision(s) carry no provenance\n', _n);
    _ok := false;
  END IF;

  -- ---------- 3. a student sees their own decision, and only theirs -------
  SELECT d.leave_request_id, lr.applicant_user_id, lr.school_id
    INTO _req, _owner, _school
    FROM public.leave_decisions d
    JOIN public.leave_requests lr ON lr.id = d.leave_request_id
   WHERE lr.applicant_user_id IS NOT NULL
   LIMIT 1;

  IF _req IS NULL THEN
    _out := _out || E'FAIL  no decision with an applicant to test as — the role checks below would be vacuous\n';
    _ok := false;
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO _seen
      FROM public.leave_decisions WHERE leave_request_id = _req;

    -- The positive and the negative in one pass: they must see their own row,
    -- and must NOT see the whole table. A check that only asserts absence
    -- passes just as well when the query is broken.
    SELECT count(*) INTO _n FROM public.leave_decisions;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    IF _seen >= 1 THEN
      _out := _out || E'PASS  applicant can read the decision on their own request\n';
    ELSE
      _out := _out || E'FAIL  applicant cannot read the decision on their own request\n';
      _ok := false;
    END IF;

    SELECT count(*) INTO _total FROM public.leave_decisions;
    IF _n < _total THEN
      _out := _out || format(E'PASS  applicant sees %s of %s decision(s), not the table\n', _n, _total);
    ELSE
      _out := _out || format(E'FAIL  applicant sees all %s decision(s) — the fence is not fencing\n', _n);
      _ok := false;
    END IF;
  END IF;

  -- ---------- 4. a class teacher can actually DECIDE ----------------------
  -- The ruling records that approval is blocked behind isSchoolOperator, so a
  -- class teacher cannot act on student leave. This proves where that block
  -- lives: if the INSERT succeeds as the class teacher, the database was
  -- never the obstacle and the gate is purely client-side.
  SELECT lr.id, lr.student_id, lr.school_id, t.user_id
    INTO _req, _student, _school, _ct
    FROM public.leave_requests lr
    JOIN public.students s  ON s.id = lr.student_id
    JOIN public.teachers t  ON t.class_teacher_of = s.class_id
   WHERE NOT EXISTS (SELECT 1 FROM public.leave_decisions d WHERE d.leave_request_id = lr.id)
     AND t.user_id IS NOT NULL
   LIMIT 1;

  IF _ct IS NULL THEN
    _out := _out || E'SKIP  no pending request whose class has a class teacher — cannot prove the write path\n';
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _ct, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      INSERT INTO public.leave_decisions
        (leave_request_id, school_id, decided_by, decided_by_role, decision, reason, decided_at)
      VALUES (_req, _school, _ct, 'class_teacher', 'approved', 'verification fixture', now());
      _inserted := 1;
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
      _inserted := 0;
    END;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    IF _inserted = 1 THEN
      _out := _out || E'PASS  a class teacher CAN write a decision — the DB permits it; the block is client-side only\n';
    ELSE
      _out := _out || E'FAIL  a class teacher cannot write a decision — the fix is not only in the client\n';
      _ok := false;
    END IF;
  END IF;

  -- ---------- 5. a decision cannot be recorded twice ----------------------
  -- This check used to assert that no pending request carried a decision —
  -- detecting disagreement between the column and the table. With one home
  -- that is tautological, and a check that cannot fail is not a check. What
  -- replaced it is the guarantee batch 1c had to move into the database when
  -- it deleted the client-side .eq("status","pending") predicate that had
  -- been standing in for it: UNIQUE (leave_request_id, decided_by_role)
  -- rejects a same-role duplicate, and the partial index covers the role-less
  -- case that NULLs would otherwise let through.
  SELECT count(*) INTO _n FROM (
    SELECT leave_request_id
      FROM public.leave_decisions
     WHERE decided_by_role IS NULL
     GROUP BY 1 HAVING count(*) > 1
  ) x;
  IF _n <> 0 THEN
    _out := _out || format(E'FAIL  %s request(s) carry more than one role-less decision\n', _n);
    _ok := false;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_indexes
                     WHERE schemaname = 'public'
                       AND indexname = 'leave_decisions_one_roleless_per_request') THEN
    _out := _out || E'FAIL  leave_decisions_one_roleless_per_request is missing — nothing refuses a role-less duplicate\n';
    _ok := false;
  ELSE
    -- Prove it FIRES. An index that exists and an index that refuses look the
    -- same from pg_indexes. This whole file rolls back, so nothing persists.
    --
    -- The id is captured and reused deliberately: an earlier version selected
    -- the second row with `WHERE reason = 'verification fixture' LIMIT 1`, which
    -- picked up check 4's fixture instead — a DIFFERENT request, carrying a
    -- role — so no duplicate was ever attempted and the proof reported a
    -- failure it had not actually tested for.
    _req := NULL;
    SELECT lr.id INTO _req
      FROM public.leave_requests lr
     WHERE NOT EXISTS (SELECT 1 FROM public.leave_decisions d WHERE d.leave_request_id = lr.id)
     LIMIT 1;

    IF _req IS NULL THEN
      _out := _out || E'SKIP  no undecided request to attempt a duplicate against\n';
    ELSE
      INSERT INTO public.leave_decisions (leave_request_id, school_id, decision, decided_by_role, reason)
      SELECT _req, lr.school_id, 'approved', NULL, 'verification fixture'
        FROM public.leave_requests lr WHERE lr.id = _req;
      GET DIAGNOSTICS _inserted = ROW_COUNT;

      IF _inserted <> 1 THEN
        -- The probe has to land before it can prove anything.
        _out := _out || E'FAIL  could not insert the first role-less decision — the proof never ran\n';
        _ok := false;
      ELSE
        BEGIN
          INSERT INTO public.leave_decisions (leave_request_id, school_id, decision, decided_by_role, reason)
          SELECT _req, lr.school_id, 'rejected', NULL, 'verification fixture'
            FROM public.leave_requests lr WHERE lr.id = _req;
          _out := _out || E'FAIL  a second role-less decision was accepted — the partial index does not refuse\n';
          _ok := false;
        EXCEPTION WHEN unique_violation THEN
          _out := _out || E'PASS  a duplicate decision is refused by the database, not by a client predicate\n';
        END;
      END IF;
    END IF;
  END IF;

  _out := _out || E'=====================================\n';
  _out := _out || CASE WHEN _ok THEN E'ALL CHECKS PASSED\n' ELSE E'*** ONE OR MORE CHECKS FAILED ***\n' END;

  -- Deliberate: aborts the transaction so the fixture row above never lands.
  RAISE EXCEPTION '%', _out;
END
$proof$;
