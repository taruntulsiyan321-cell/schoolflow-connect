-- probe21: correcting submitted attendance, as the caller.
--
-- 20260910000000 restored the consolidated `tg_log_attendance_change` after a
-- db:migrate replay reinstated the pre-consolidation body. That body read
-- NEW.class_id and NEW.date, columns `attendance` no longer has, so every
-- status change raised 42703 and the correction §10.5 reserves to admins was
-- impossible for everyone.
--
-- THE CLAIMS
--   1. a TEACHER is refused on a day already submitted, and told why.
--      (§10.5: "submitted once. After submission, only admin can edit.")
--   2. ...and the mark is unchanged after that refusal.
--   3. an ADMIN can correct the same day.            <- THE FIX. 42703 before.
--   4. ...and the mark really changed.               (positive control)
--   5. the correction wrote an academic_audit row.   (positive control)
--   6. that row carries the FROZEN class_id, date and submission_id in
--      metadata, which is what the dedicated table used to hold.
--   7. the legacy attendance_audit table is gone.
--   8. a PRINCIPAL is refused outright (§10: "Cannot mark or edit
--      attendance"), and 9. the mark is unchanged by that attempt.
--
-- 3, 4, 5 and 6 are what would catch a "fix" that merely stopped erroring
-- without recording anything; 1 and 2 are what would catch one that opened the
-- day up to whoever asked.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '90s';
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
  t1      uuid := 'd1000002-0001-4000-8000-000000000001';  -- Priya Sharma, class teacher of 10 A
  adm     uuid := 'd1000001-0001-4000-8000-000000000001';  -- admin, same school
  prin    uuid := 'd1000001-0002-4000-8000-000000000002';  -- principal, same school
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  cls     uuid := 'd2000001-0001-4000-8000-000000000001';  -- 10 A
  d       date := current_date;
  sub_id  uuid;
  stu     uuid;
  att_id  uuid;
  payload jsonb;
  st      text;
  audit_n int;
  meta    jsonb;
  r       text;
BEGIN
  SELECT s.id INTO stu FROM public.students s
   WHERE s.class_id = cls AND s.user_id IS NOT NULL ORDER BY s.id LIMIT 1;
  IF stu IS NULL THEN
    RAISE EXCEPTION 'probe21: need a student in 10 A to mark';
  END IF;

  -- A day in a KNOWN submitted state. Whatever the tenant happens to hold for
  -- today is cleared first so the probe does not depend on whether the
  -- evidence suite has run: the branch under test is "already submitted", and
  -- it has to be reached deterministically.
  DELETE FROM public.attendance a
   USING public.attendance_submissions s
   WHERE a.submission_id = s.id AND s.section_id = cls AND s.date = d;
  DELETE FROM public.attendance_submissions s WHERE s.section_id = cls AND s.date = d;

  INSERT INTO public.attendance_submissions
    (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES (sch_a,
          (SELECT ay.id FROM public.academic_years ay
            WHERE ay.school_id = sch_a AND ay.is_current LIMIT 1),
          cls, d, t1)
  RETURNING id INTO sub_id;

  INSERT INTO public.attendance (school_id, student_id, status, marked_by, submission_id)
  VALUES (sch_a, stu, 'present', t1, sub_id)
  RETURNING id INTO att_id;

  payload := jsonb_build_array(jsonb_build_object(
    'student_id', stu::text, 'class_id', cls::text,
    'date', to_char(d,'YYYY-MM-DD'), 'status', 'absent'));

  -- ── 1/2. the teacher is out, and the mark is untouched ─────────────────
  r := pg_temp.as_user(t1, format(
        'SELECT public.rpc_bulk_upsert_attendance(%L::jsonb)::text', payload::text));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('correct a day already submitted','teacher (class teacher of 10 A)',
     'ERROR already been submitted', r,
     CASE WHEN r LIKE 'ERROR%already been submitted%' THEN 'PASS' ELSE 'FAIL' END);

  SELECT status::text INTO st FROM public.attendance WHERE id = att_id;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and the mark is unchanged by that attempt','-','present', coalesce(st,'null'),
     CASE WHEN st = 'present' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3/4. THE FIX: the admin may correct it ─────────────────────────────
  -- Before 20260910000000 this was
  --   ERROR: record "new" has no field "class_id"
  r := pg_temp.as_user(adm, format(
        'SELECT public.rpc_bulk_upsert_attendance(%L::jsonb)::text', payload::text));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('correct a day already submitted','admin (same school)',
     'OK, and no 42703', r,
     CASE WHEN r LIKE 'OK:%' AND r !~ 'class_id' THEN 'PASS' ELSE 'FAIL' END);

  SELECT status::text INTO st FROM public.attendance WHERE id = att_id;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and the mark really changed (positive control)','-','absent', coalesce(st,'null'),
     CASE WHEN st = 'absent' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5/6. the correction is recorded, with the frozen facts ─────────────
  SELECT count(*), (array_agg(aa.metadata ORDER BY aa.created_at DESC))[1]
    INTO audit_n, meta
    FROM public.academic_audit aa
   WHERE aa.entity_type = 'attendance'
     AND aa.action = 'attendance.status_edited'
     AND aa.entity_id = att_id;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the correction wrote an academic_audit row (positive control)','-','1',
     audit_n::text, CASE WHEN audit_n = 1 THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...carrying the frozen class_id, date and submission_id','-',
     'all three present and correct', coalesce(meta::text,'null'),
     CASE WHEN meta->>'class_id' = cls::text
           AND meta->>'date' = to_char(d,'YYYY-MM-DD')
           AND meta->>'submission_id' = sub_id::text
          THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. the legacy table is gone ────────────────────────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'legacy attendance_audit table removed','-','0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'attendance_audit';

  -- ── 8/9. §10: the principal is out of attendance entirely ──────────────
  -- "Cannot mark or edit attendance" (docs/locked-decisions.md:151). Asserted
  -- here because the CLIENT used to disagree: ownership.ts listed principal
  -- among the owners of attendance and assertTeacherMayMarkClass admitted every
  -- isSchoolOperator, so the UI would have offered an action this raise refuses.
  -- Both sides now say admin; this is the half that cannot drift.
  --
  -- Asserted on the OUTCOME, not on one exact sentence. TWO guards refuse the
  -- principal and the outer one wins: `rpc_bulk_upsert_attendance` carries its
  -- own class-teacher check ("Only the class teacher can mark attendance for
  -- class %"), while the §10-shaped message ("The principal cannot mark
  -- attendance") lives in `rpc_ensure_attendance_submission`, which is reached
  -- later and so never speaks. Pinning this to the second sentence would have
  -- failed on a correct refusal — it did, on the first run of this claim.
  -- What must hold is that it is refused ON AUTHORITY, not by 42703 and not by
  -- the already-submitted branch, either of which would refuse the principal
  -- for a reason that has nothing to do with §10.
  r := pg_temp.as_user(prin, format(
        'SELECT public.rpc_bulk_upsert_attendance(%L::jsonb)::text', payload::text));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('correct a submitted day','principal','ERROR on authority (§10)', r,
     CASE WHEN r LIKE 'ERROR%'
           AND r ~* '(principal cannot mark|only the class teacher)'
           AND r !~ 'class_id'
           AND r !~ 'already been submitted'
          THEN 'PASS' ELSE 'FAIL' END);

  SELECT status::text INTO st FROM public.attendance WHERE id = att_id;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and the mark is unchanged by the principal','-','absent', coalesce(st,'null'),
     CASE WHEN st = 'absent' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
