-- ---------------------------------------------------------------------
-- G12 — exams carried the shape that made the parent panel a 500.
--
-- Found by the new per-row timing gate, which Chunk 6.5 ran because it made
-- `exams` the sitting: every read of a sitting now goes through this stack.
-- Measured marginal cost per row, before this migration:
--
--   exams   parent    251.92 ms/row   ->  ~50s at 200 sittings
--   exams   student   131.70 ms/row   ->  ~26s at 200 sittings
--   exams   admin      51.10 ms/row   ->  ~10s at 200 sittings
--   exams   teacher     5.72 ms/row
--
-- The statement timeout for `authenticated` is 8s. Nothing is over the line at
-- the demo school's 6 exams; every one of those shapes is over it at a real
-- school. That is the whole point of reporting per-row cost: the total hides
-- it, the slope does not.
--
-- Three separate causes, all of them G12's named ones:
--
-- 1. NESTED RLS. "Parents via parent_students can view exams" is a bare EXISTS
--    over parents JOIN parent_students JOIN students with no SECURITY DEFINER
--    wrapper, so each candidate exam row pays all three of those tables' own
--    policy stacks. This is the identical defect Chunk 5.1 fixed for the
--    parent panel; it was simply never applied here.
--
-- 2. UN-DISPATCHED OR ARMS. "exams school read" evaluates has_role(admin) OR
--    has_role(principal) OR teacher_teaches_class(...) OR student_class_id(...)
--    OR my_children_class_ids(). A parent pays four failing arms — including
--    the per-row teacher_teaches_class lookup — before reaching their own.
--
-- 3. DUPLICATE POLICIES ARE PURE COST. Five permissive policies answered
--    SELECT, and two FOR ALL policies were re-evaluated on every read purely
--    so they could authorise writes. Permissive policies are OR'd, so a read
--    pays for all of them.
--
-- After: one SELECT policy that dispatches on the role, and write policies
-- that are declared per command so a read never evaluates them at all.
--
-- DELIBERATE NARROWING, stated rather than slipped in: the dropped parent
-- policy matched on `parents.user_id = auth.uid()` alone. It did not require
-- that the caller is currently ACTING as a parent, and it carried no school
-- predicate of its own. my_children_class_ids() requires both — the Chunk 1
-- role binding and the active membership's school. An account holding a parent
-- link in another institution loses a read it should never have had. The
-- restrictive tenant fence already blocked the cross-school half; the
-- role-binding half is new here and is the rule every other table follows.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Parents via parent_students can view exams" ON public.exams;
DROP POLICY IF EXISTS "exams principal read" ON public.exams;
DROP POLICY IF EXISTS "exams school read"    ON public.exams;
DROP POLICY IF EXISTS "exams admin all"      ON public.exams;
DROP POLICY IF EXISTS "exams teacher manage" ON public.exams;

DROP POLICY IF EXISTS exams_read   ON public.exams;
DROP POLICY IF EXISTS exams_insert ON public.exams;
DROP POLICY IF EXISTS exams_update ON public.exams;
DROP POLICY IF EXISTS exams_delete ON public.exams;

-- READ. One policy, one dispatch. The parent and student arms call
-- argument-free SECURITY DEFINER helpers, which are constant per statement:
-- the per-row work is an array membership test, not a join through three
-- tables' policies.
CREATE POLICY exams_read ON public.exams
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND (
      CASE public.active_membership_role()
        WHEN 'admin'     THEN true
        WHEN 'principal' THEN true
        WHEN 'teacher'   THEN public.teacher_teaches_class(auth.uid(), class_id)
        WHEN 'student'   THEN public.student_class_id(auth.uid()) = class_id
        WHEN 'parent'    THEN class_id = ANY (public.my_children_class_ids())
        ELSE false
      END
      -- has_role()'s super-admin arm, restated. A super admin acting inside a
      -- granted institution holds no membership row of their own, so
      -- dispatching on the membership role alone would silently revoke the
      -- read that "exams admin all" used to grant them.
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
  );

-- WRITE. Declared per command so that SELECT never evaluates them. Admin and
-- the teachers of the class, exactly as before; principal is absent
-- deliberately and was absent before — oversight, not editor, the same call
-- as attendance, homework_submissions and marks.
CREATE POLICY exams_insert ON public.exams
  FOR INSERT
  WITH CHECK (
    public.same_school(school_id)
    AND (
      CASE public.active_membership_role()
        WHEN 'admin'   THEN true
        WHEN 'teacher' THEN public.teacher_teaches_class(auth.uid(), class_id)
        ELSE false
      END
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
  );

CREATE POLICY exams_update ON public.exams
  FOR UPDATE
  USING (
    public.same_school(school_id)
    AND (
      CASE public.active_membership_role()
        WHEN 'admin'   THEN true
        WHEN 'teacher' THEN public.teacher_teaches_class(auth.uid(), class_id)
        ELSE false
      END
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      CASE public.active_membership_role()
        WHEN 'admin'   THEN true
        WHEN 'teacher' THEN public.teacher_teaches_class(auth.uid(), class_id)
        ELSE false
      END
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
  );

CREATE POLICY exams_delete ON public.exams
  FOR DELETE
  USING (
    public.same_school(school_id)
    AND (
      CASE public.active_membership_role()
        WHEN 'admin'   THEN true
        WHEN 'teacher' THEN public.teacher_teaches_class(auth.uid(), class_id)
        ELSE false
      END
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
  );


-- ---------------------------------------------------------------------
-- Assert the guarantee, not the policy text: every role still reads exactly
-- the exams it read before, and no role reads one it did not.
--
-- Run as each real demo account under RLS. A count that CHANGED is a
-- regression; a count that is zero for a role that should see rows means the
-- dispatch dropped an arm.
-- ---------------------------------------------------------------------

DO $check$
DECLARE
  _r        record;
  _n        bigint;
  _expected jsonb := '{}'::jsonb;
  _fail     text := '';
BEGIN
  -- Expected visible counts, measured before this migration on this database.
  _expected := jsonb_build_object(
    'admin@wisdomcampus.com',        6,
    'principal@wisdomcampus.com',    6,
    'priya.sharma@wisdomcampus.com', 6,
    'mehta.parent@wisdomcampus.com', 5,
    'arjun.mehta@wisdomcampus.com',  5
  );

  FOR _r IN SELECT key AS email, value::text::bigint AS want FROM jsonb_each(_expected) LOOP
    DECLARE _uid uuid;
    BEGIN
      SELECT id INTO _uid FROM auth.users WHERE email = _r.email;
      IF _uid IS NULL THEN
        _fail := _fail || format('(no such account: %s) ', _r.email);
        CONTINUE;
      END IF;

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO _n FROM public.exams;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);

      IF _n <> _r.want THEN
        _fail := _fail || format('%s now sees %s exams, expected %s. ', _r.email, _n, _r.want);
      END IF;
    END;
  END LOOP;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'exams policy dispatch changed who can read what: %', _fail;
  END IF;
END
$check$;
