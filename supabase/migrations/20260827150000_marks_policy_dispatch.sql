-- ---------------------------------------------------------------------
-- G12 — marks made every reader pay for the write policies.
--
-- The companion to 20260827140000 (exams). Chunk 6.5 dispatched the ROLE
-- inside can_upload_exam_marks, which removed the per-row teacher lookup for
-- non-teachers. It did not change WHICH policies a read evaluates, and that is
-- where the remaining cost is. Measured marginal cost per row afterwards:
--
--   marks   parent    172.80 ms/row   ->  ~35s at 200 marks
--   marks   student   116.38 ms/row   ->  ~23s at 200 marks
--   marks   teacher    12.54 ms/row
--   marks   admin       7.68 ms/row
--
-- Three permissive policies answered SELECT:
--
--   marks admin all      FOR ALL     has_role(admin) AND same_school
--   marks read           FOR SELECT  can_read_mark(exam_id, student_id)
--   marks teacher manage FOR ALL     can_upload_exam_marks(exam_subject_id)
--
-- Permissive policies are OR'd, so a parent reading their child's marks paid
-- has_role(admin) AND the three-table join inside can_upload_exam_marks on
-- every candidate row — both of which exist only to authorise WRITES, and
-- both of which are guaranteed false for a parent. G12: duplicate policies
-- are pure cost.
--
-- After: one SELECT policy, and write policies declared per command so a read
-- never evaluates them.
--
-- can_read_mark already dispatches on the active membership role, so the read
-- path itself is unchanged — only the number of policies it is OR'd with.
--
-- WHO CAN DO WHAT IS UNCHANGED, and this migration proves it rather than
-- asserting it: it counts what every demo role can see BEFORE the swap, again
-- AFTER, and aborts the whole transaction on any difference. Comparing against
-- live measurement rather than a number typed into this file is the point —
-- a hardcoded expectation would still pass if it was wrong when written.
-- ---------------------------------------------------------------------

CREATE TEMP TABLE _marks_visibility_before (email text PRIMARY KEY, n bigint);

DO $before$
DECLARE _r record; _uid uuid; _n bigint;
BEGIN
  FOR _r IN SELECT unnest(ARRAY[
              'admin@wisdomcampus.com',
              'principal@wisdomcampus.com',
              'priya.sharma@wisdomcampus.com',
              'mehta.parent@wisdomcampus.com',
              'arjun.mehta@wisdomcampus.com']) AS email LOOP
    SELECT id INTO _uid FROM auth.users WHERE email = _r.email;
    IF _uid IS NULL THEN CONTINUE; END IF;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _n FROM public.marks;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    INSERT INTO _marks_visibility_before VALUES (_r.email, _n);
  END LOOP;

  IF (SELECT count(*) FROM _marks_visibility_before) = 0 THEN
    RAISE EXCEPTION 'marks policy dispatch: could not measure any role before the swap, so the after-comparison would prove nothing.';
  END IF;
END
$before$;


DROP POLICY IF EXISTS "marks admin all"      ON public.marks;
DROP POLICY IF EXISTS "marks read"           ON public.marks;
DROP POLICY IF EXISTS "marks teacher manage" ON public.marks;

DROP POLICY IF EXISTS marks_read   ON public.marks;
DROP POLICY IF EXISTS marks_insert ON public.marks;
DROP POLICY IF EXISTS marks_update ON public.marks;
DROP POLICY IF EXISTS marks_delete ON public.marks;

-- READ. can_read_mark dispatches on the active membership role and already
-- carries the published-results condition for student and guardian.
--
-- The super-admin arm is restated here because it used to arrive via
-- "marks admin all"'s has_role(admin): a super admin acting inside a granted
-- institution holds no membership row, so can_read_mark's CASE returns its
-- ELSE. Dropping that policy without this would have silently revoked
-- super-admin read. Both calls are argument-free and constant per statement.
CREATE POLICY marks_read ON public.marks
  FOR SELECT
  USING (
    public.can_read_mark(exam_id, student_id)
    OR (public.same_school(school_id)
        AND public.is_super_admin()
        AND public.super_admin_has_any_access())
  );

-- WRITE. can_upload_exam_marks already dispatches on role, restates the
-- super-admin arm, and reads exams.marks_locked — which is what makes
-- finalising a sitting close every subject it covers. Admin write arrives
-- through its 'admin' arm, which is why "marks admin all" is not replaced by
-- a separate policy: it was wholly subsumed.
CREATE POLICY marks_insert ON public.marks
  FOR INSERT
  WITH CHECK (public.can_upload_exam_marks(exam_subject_id));

CREATE POLICY marks_update ON public.marks
  FOR UPDATE
  USING (public.can_upload_exam_marks(exam_subject_id))
  WITH CHECK (public.can_upload_exam_marks(exam_subject_id));

CREATE POLICY marks_delete ON public.marks
  FOR DELETE
  USING (public.can_upload_exam_marks(exam_subject_id));


DO $after$
DECLARE _r record; _uid uuid; _n bigint; _fail text := '';
BEGIN
  FOR _r IN SELECT email, n FROM _marks_visibility_before LOOP
    SELECT id INTO _uid FROM auth.users WHERE email = _r.email;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _n FROM public.marks;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    IF _n <> _r.n THEN
      _fail := _fail || format('%s saw %s marks before and %s after. ', _r.email, _r.n, _n);
    END IF;
  END LOOP;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'marks policy dispatch changed who can read what — aborting: %', _fail;
  END IF;
END
$after$;

DROP TABLE _marks_visibility_before;
