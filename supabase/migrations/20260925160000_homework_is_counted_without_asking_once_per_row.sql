-- ═══════════════════════════════════════════════════════════════════════════
-- Homework is counted without asking "may I?" once per row
--
-- docs/rls-policy-pattern.md, applied to the three tables every homework count
-- reads: `homework`, `homework_submissions`, and the `students` roster. None of
-- the three was ever converted; each still asked a per-row function whether the
-- caller may see the row. `homework_completion` (20260925130000) joins all
-- three once per student a homework is set to, so it multiplied the question by
-- homework × students.
--
-- ── MEASURED ON LIVE, 2026-09-14, BEFORE THIS ────────────────────────────────
--
-- The production browser run of the homework chain did not fail on a wrong
-- answer. It ran out of its five minutes: the teacher's list reloads through
-- `homework_completion` after every action, and every edge log of that request
-- showed 2.6–4.9 s of origin time (02:22–02:25 UTC) — for a school of 13
-- students and 20 published homework.
--
-- `scripts/query-timing.mjs`, as each role (statement_timeout is 8 s):
--
--     homework_submissions     admin 4,694 ms (32.1 ms/row)  principal 4,665
--                              parent 4,032  student 3,845              FINDING x3
--     homework                 admin 1,464 ms (28.0 ms/row)
--     homework_student_status  admin 4,559  principal 5,457  parent 5,243  FINDING x3
--     homework_completion      admin 4,537  principal 6,053  parent 4,840  FINDING x3
--
-- Nine findings at current volume, and every homework path projects past the
-- timeout at 10,000 rows — one school's year is far past that.
--
-- Per call, as a teacher: can_read_student_row 17.2 ms, teacher_teaches_class
-- 6.0 ms, can_manage_homework 3.5 ms, same_school 3.4 ms. Permissive policies
-- are OR'ed, so a teacher's row paid the admin, parent, principal and student
-- arms before reaching their own.
--
-- ── THE SHAPE, AND WHAT IS EXACTLY THE SAME ─────────────────────────────────
--
-- Every no-column call is hoisted into (SELECT …), which the planner resolves
-- once per statement. Every per-row lookup becomes membership of a set built
-- once. Each predicate is the one it replaces:
--
--   same_school(school_id)           → school_id IN (SELECT my_accessible_school_ids()),
--                                      the set form of the same rule, which the
--                                      tenant fence on all three tables already uses
--   is_my_student_record(student_id) → its own body, hoisted
--   is_my_child(student_id)          → parent AND student_id IN my_own_or_children_student_ids()
--   is_class_of_my_child(class_id)   → parent AND class_id IN my_children_class_ids()
--   student_class_id(auth.uid())     → the same call, hoisted
--   has_role(auth.uid(), …)          → the same call, hoisted
--   can_read_student_row(row)        → its own body, inlined, with the guardian
--                                      link read by a set helper so the policy
--                                      still never selects from `students` (the
--                                      INSERT … RETURNING defect 20260912010000
--                                      removed stays removed)
--
-- ── WHAT IS DELIBERATELY NOT THE SAME ─────────────────────────────────────────
--
-- 1. A teacher READS homework and hand-ins through `my_teacher_class_ids()` —
--    the set form of teacher_teaches_class, which `students`, tests, exams,
--    marks and attendance already read through. The two differ only when the
--    teacher's institution is not active: the set form refuses, as §10.20
--    requires, where teacher_teaches_class falls back through
--    get_my_school_id. Writes keep teacher_teaches_class per row, unchanged.
--    "homework teacher manage" was FOR ALL, so every reader paid it on SELECT;
--    it is split into a read policy and INSERT / UPDATE / DELETE policies
--    carrying the predicate 20260919000000 set.
--
-- 2. The hand-ins of homework a teacher AUTHORED into a class they do not
--    teach. `hw_sub teacher read` was can_manage_homework(homework_id), which
--    still carried `created_by = auth.uid()` — the authorship door
--    20260919000000 shut on the homework itself ("Authorship is not a teaching
--    relationship. A teacher may manage homework for the classes they teach —
--    full stop."). So that author could not read the homework but could read
--    the students' files handed in to it. Counted on live before writing: 3
--    hand-ins, on the 3 homework that ruling already re-scoped away from their
--    author. They stay readable to the admin, the principal, and the teachers
--    of that class.
--
-- can_read_student_row and can_manage_homework have no other caller (policies
-- and function bodies in every schema, and src/, searched) and are dropped.
--
-- ── PROOF, BEFORE THIS COMMITS ────────────────────────────────────────────────
--
-- Ground truth is the OLD policies, read AS EACH CALLER before anything
-- changes: every student, homework and hand-in id visible to an admin, a
-- principal, a class teacher, a subject teacher, the author of hand-ins on a
-- class they do not teach, a student with hand-ins, a parent linked by
-- parent_user_id, a parent linked only through parent_students, an account
-- holding two memberships, and a super admin. After the change the same
-- callers must see exactly the same ids, less exactly the hand-ins of
-- difference 2 — which are computed BEFORE the change from the old predicates
-- themselves, and every one of which must be gone. A negative control opens
-- students_read and must be caught. `gurukul.verify_accounts` (a comma list)
-- replaces the representative callers with the named ones, so a rolled-back
-- dry run can prove every account there is.
--
-- Rollback: supabase/migrations/rollback/
--           20260925160000_homework_is_counted_without_asking_once_per_row.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Ground truth, as each caller, before anything changes ───────────────

-- Session temp tables, not ON COMMIT DROP: applied statement by statement (the
-- local replica) they must outlive each statement; applied as one transaction
-- (live) they are dropped at the end of the proof either way.
DROP TABLE IF EXISTS pg_temp._v160_picks, pg_temp._v160_seen, pg_temp._v160_policies;
CREATE TEMP TABLE _v160_picks (account uuid NOT NULL, why text NOT NULL);
CREATE TEMP TABLE _v160_seen (phase text NOT NULL, account uuid NOT NULL, rel text NOT NULL, id uuid NOT NULL);
CREATE TEMP TABLE _v160_policies (phase text NOT NULL, tbl text NOT NULL, pol text NOT NULL, expr text NOT NULL);

-- One reading, as `_account`, into _v160_seen. What the caller reads is
-- gathered into arrays while acting as `authenticated`, and written after
-- switching back: the temp table is not the caller's to write.
--
-- In phase 'before' it also records the hand-ins this caller could read ONLY
-- by having authored the homework (rel 'authorship_only'), from the old
-- predicates themselves, evaluated as that caller while they still exist:
-- can_manage_homework true, and every other read arm of the old policy false.
CREATE OR REPLACE FUNCTION pg_temp._v160_read_as(_phase text, _account uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  _me         text := current_user;
  _students   uuid[];
  _homework   uuid[];
  _handins    uuid[];
  _children   uuid[];
  _authorship uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _account, 'role', 'authenticated')::text, true);
  _children := public.my_children_class_ids();
  IF _phase = 'before' THEN
    EXECUTE $q$
      SELECT coalesce(array_agg(hs.id), ARRAY[]::uuid[])
        FROM public.homework_submissions hs
        JOIN public.homework h ON h.id = hs.homework_id
       WHERE h.created_by = $1
         AND public.can_manage_homework(hs.homework_id)
         AND NOT public.teacher_teaches_class($1, h.class_id)
         AND NOT (public.has_role($1, 'admin'::public.app_role) AND public.same_school(hs.school_id))
         AND NOT (public.has_role($1, 'principal'::public.app_role) AND public.same_school(hs.school_id))
         AND NOT public.is_my_child(hs.student_id)
         AND NOT public.is_my_student_record(hs.student_id)$q$
      INTO _authorship USING _account;
  END IF;
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    _students := ARRAY(SELECT id FROM public.students);
    _homework := ARRAY(SELECT id FROM public.homework);
    _handins  := ARRAY(SELECT id FROM public.homework_submissions);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role', _me, true);
    RAISE EXCEPTION 'ROLLED BACK: reading as % (%) failed: %', _account, _phase, SQLERRM;
  END;
  PERFORM set_config('role', _me, true);
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO _v160_seen
  SELECT _phase, _account, 'students', unnest(_students)
  UNION ALL SELECT _phase, _account, 'homework', unnest(_homework)
  UNION ALL SELECT _phase, _account, 'homework_submissions', unnest(_handins)
  UNION ALL SELECT _phase, _account, 'my_children_class_ids', unnest(_children)
  UNION ALL SELECT _phase, _account, 'authorship_only', unnest(_authorship);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp._v160_snapshot_policies(_phase text) RETURNS void
LANGUAGE sql AS $fn$
  INSERT INTO _v160_policies
  SELECT _phase, c.relname, p.polname,
         coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('students', 'homework', 'homework_submissions')
     AND p.polcmd IN ('r', '*');
$fn$;

-- True when a policy a reader pays still asks per row: it names a per-row
-- predicate, or names a no-argument resolver outside (SELECT …).
CREATE OR REPLACE FUNCTION pg_temp._v160_asks_per_row(_expr text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT _expr ~ 'can_read_student_row|can_manage_homework|same_school\(|is_my_child\(|is_my_student_record\(|is_class_of_my_child\(|teacher_teaches_class\('
      OR regexp_count(_expr, '(public\.)?has_role\(') <> regexp_count(_expr, 'SELECT (public\.)?has_role\(')
      OR regexp_count(_expr, '(public\.)?student_class_id\(') <> regexp_count(_expr, 'SELECT (public\.)?student_class_id\(')
      OR regexp_count(_expr, '(public\.)?active_membership_role\(') <> regexp_count(_expr, 'SELECT (public\.)?active_membership_role\(')
      OR regexp_count(_expr, '(public\.)?active_local_person_id\(') <> regexp_count(_expr, 'SELECT (public\.)?active_local_person_id\(');
$fn$;

DO $baseline$
DECLARE
  _requested text := nullif(btrim(current_setting('gurukul.verify_accounts', true)), '');
  _a uuid;
BEGIN
  IF _requested IS NOT NULL THEN
    INSERT INTO _v160_picks
    SELECT DISTINCT btrim(x)::uuid, 'requested' FROM unnest(string_to_array(_requested, ',')) x WHERE btrim(x) <> '';
  ELSE
    INSERT INTO _v160_picks
    SELECT pick.account, pick.why FROM (
      (SELECT m.account_id AS account, 'admin' AS why FROM public.memberships m
        WHERE m.status = 'active' AND m.role = 'admin' ORDER BY m.account_id LIMIT 1)
    UNION ALL
      (SELECT m.account_id, 'principal' FROM public.memberships m
        WHERE m.status = 'active' AND m.role = 'principal' ORDER BY m.account_id LIMIT 1)
    UNION ALL
      (SELECT m.account_id, 'class teacher' FROM public.memberships m JOIN public.teachers t ON t.id = m.local_person_id
        WHERE m.status = 'active' AND m.role = 'teacher' AND t.class_teacher_of IS NOT NULL ORDER BY m.account_id LIMIT 1)
    UNION ALL
      (SELECT m.account_id, 'subject teacher' FROM public.memberships m JOIN public.teachers t ON t.id = m.local_person_id
        WHERE m.status = 'active' AND m.role = 'teacher' AND t.class_teacher_of IS NULL
          AND EXISTS (SELECT 1 FROM public.teacher_classes tc WHERE tc.teacher_id = t.id) ORDER BY m.account_id LIMIT 1)
    UNION ALL
      (SELECT h.created_by, 'author of hand-ins on a class they do not teach'
         FROM public.homework_submissions hs JOIN public.homework h ON h.id = hs.homework_id
        WHERE EXISTS (SELECT 1 FROM public.memberships m WHERE m.account_id = h.created_by AND m.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = h.created_by
                             AND (t.class_teacher_of = h.class_id
                                  OR EXISTS (SELECT 1 FROM public.teacher_classes tc WHERE tc.teacher_id = t.id AND tc.class_id = h.class_id)))
        ORDER BY h.created_by LIMIT 1)
    UNION ALL
      (SELECT m.account_id, 'student with hand-ins' FROM public.memberships m
        WHERE m.status = 'active' AND m.role = 'student'
          AND EXISTS (SELECT 1 FROM public.homework_submissions hs WHERE hs.student_id = m.local_person_id) ORDER BY m.account_id LIMIT 1)
    UNION ALL
      (SELECT m.account_id, 'parent linked by parent_user_id' FROM public.memberships m
        WHERE m.status = 'active' AND m.role = 'parent'
          AND EXISTS (SELECT 1 FROM public.students s WHERE s.parent_user_id = m.account_id) ORDER BY m.account_id LIMIT 1)
    UNION ALL
      (SELECT m.account_id, 'parent linked only through parent_students' FROM public.memberships m
        WHERE m.status = 'active' AND m.role = 'parent'
          AND EXISTS (SELECT 1 FROM public.parent_students ps WHERE ps.parent_id = m.local_person_id)
          AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.parent_user_id = m.account_id) ORDER BY m.account_id LIMIT 1)
    UNION ALL
      (SELECT m.account_id, 'two memberships' FROM public.memberships m
        WHERE m.status = 'active' GROUP BY m.account_id HAVING count(*) > 1 ORDER BY m.account_id LIMIT 1)
    UNION ALL
      (SELECT sa.account_id, 'super admin' FROM public.super_admins sa
        WHERE sa.revoked_at IS NULL ORDER BY sa.account_id LIMIT 1)
    ) pick;

    -- A proof that picked nobody proves nothing: the four arms every count
    -- depends on must each have a caller.
    IF NOT EXISTS (SELECT 1 FROM _v160_picks WHERE why = 'admin')
       OR NOT EXISTS (SELECT 1 FROM _v160_picks WHERE why IN ('class teacher', 'subject teacher'))
       OR NOT EXISTS (SELECT 1 FROM _v160_picks WHERE why = 'student with hand-ins')
       OR NOT EXISTS (SELECT 1 FROM _v160_picks WHERE why LIKE 'parent linked%') THEN
      RAISE EXCEPTION 'ROLLED BACK: the proof needs an admin, a teacher, a student with hand-ins and a parent to read as; found %',
        (SELECT coalesce(string_agg(why, ', '), 'nobody') FROM _v160_picks);
    END IF;
  END IF;

  FOR _a IN SELECT DISTINCT account FROM _v160_picks ORDER BY account LOOP
    PERFORM pg_temp._v160_read_as('before', _a);
  END LOOP;
  PERFORM pg_temp._v160_snapshot_policies('before');
END
$baseline$;

-- ── 0b. Snapshot, so the rollback restores exactly what was there ──────────
-- Live and a bare replica do not hold the same grants, and live's comment on
-- can_read_student_row is not the one in the repo, so a rollback written from
-- either would be wrong on the other. Every policy on the three tables and
-- every routine this touches is copied here as it is — statement, grant,
-- comment — and again as this migration leaves it, so the rollback can refuse
-- to overwrite anything changed since.

CREATE TABLE public.rls_pre_20260925160000 (
  kind            text NOT NULL CHECK (kind IN ('function', 'policy')),
  name            text NOT NULL,
  definition      text,
  acl             text,
  comment         text,
  applied         text,
  applied_acl     text,
  applied_comment text,
  PRIMARY KEY (kind, name)
);
ALTER TABLE public.rls_pre_20260925160000 ENABLE ROW LEVEL SECURITY;
-- A new table in public is granted ALL to anon and authenticated by default.
REVOKE ALL ON public.rls_pre_20260925160000 FROM anon, authenticated;
COMMENT ON TABLE public.rls_pre_20260925160000 IS
  'Rollback source for 20260925160000: every policy on students, homework and homework_submissions, and every routine it touched, as they were before it and as it left them — statement, grant and comment. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

-- The statement that recreates one policy exactly, rebuilt from the catalog.
CREATE OR REPLACE FUNCTION pg_temp._r160_policy_sql(_tbl text, _pol text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s',
           p.polname, c.relname,
           CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
           CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
           CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC'
                ELSE (SELECT string_agg(quote_ident(r.rolname), ', ' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)) END,
           CASE WHEN p.polqual IS NULL THEN '' ELSE ' USING (' || pg_get_expr(p.polqual, p.polrelid) || ')' END,
           CASE WHEN p.polwithcheck IS NULL THEN '' ELSE ' WITH CHECK (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')' END)
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = _tbl AND p.polname = _pol
$fn$;

INSERT INTO public.rls_pre_20260925160000 (kind, name, definition, comment)
SELECT 'policy', c.relname || '.' || p.polname, pg_temp._r160_policy_sql(c.relname, p.polname), obj_description(p.oid, 'pg_policy')
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('students', 'homework', 'homework_submissions');

INSERT INTO public.rls_pre_20260925160000 (kind, name, definition, acl, comment)
SELECT 'function', f,
       CASE WHEN to_regprocedure(f) IS NOT NULL THEN pg_get_functiondef(to_regprocedure(f)) END,
       (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM pg_proc p, unnest(p.proacl) x WHERE p.oid = to_regprocedure(f)),
       CASE WHEN to_regprocedure(f) IS NOT NULL THEN obj_description(to_regprocedure(f), 'pg_proc') END
  FROM unnest(ARRAY['public.can_read_student_row(uuid,uuid,uuid,uuid,uuid)', 'public.can_manage_homework(uuid)',
                    'public.my_children_class_ids()', 'public.my_teacher_class_ids()',
                    'public.my_own_or_children_student_ids()',
                    'public.my_guardian_student_ids()', 'public.my_teacher_homework_ids()']) AS f;

-- ── 1. The sets the policies probe, each built once per statement ─────────

-- The guardian link, for students_read. Reads parent_students only, so the
-- policy on `students` still never selects from `students`.
CREATE FUNCTION public.my_guardian_student_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ps.student_id
    FROM public.parent_students ps
   WHERE (SELECT public.active_membership_role()) = 'parent'
     AND ps.parent_id = (SELECT public.active_local_person_id())
$$;

COMMENT ON FUNCTION public.my_guardian_student_ids() IS
  'The students the caller is linked to as a guardian through parent_students, resolved once per statement. Read by students_read, which must not select from students (20260912010000). Re-states the active role and active local person it bypasses.';

-- The homework of the classes the caller teaches, for the hand-ins a teacher
-- reads. Authorship is not in it (20260919000000).
CREATE FUNCTION public.my_teacher_homework_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT h.id
    FROM public.homework h
   WHERE h.school_id IN (SELECT public.my_accessible_school_ids())
     AND h.class_id IN (SELECT public.my_teacher_class_ids())
$$;

COMMENT ON FUNCTION public.my_teacher_homework_ids() IS
  'Homework set to a class the caller teaches, resolved once per statement. Read by "hw_sub teacher read". Institution and teaching relationship are re-stated through my_accessible_school_ids and my_teacher_class_ids; authorship is deliberately not a door (20260919000000).';

-- The classes of the caller's children. Same answer as before — it now asks
-- my_own_or_children_student_ids, the one statement of "my children", instead
-- of calling the active-membership resolvers once per student it scanned.
CREATE OR REPLACE FUNCTION public.my_children_class_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN (SELECT public.active_membership_role()) <> 'parent' THEN ARRAY[]::uuid[]
    ELSE COALESCE(
      (SELECT array_agg(DISTINCT s.class_id)
         FROM public.students s
        WHERE s.class_id IS NOT NULL
          AND s.id IN (SELECT public.my_own_or_children_student_ids())),
      ARRAY[]::uuid[])
  END
$$;

-- A policy is evaluated as its caller, so every helper it names must be
-- executable by `authenticated` — stated whole, because a bare replica's default
-- privileges are not live's.
REVOKE ALL ON FUNCTION public.my_guardian_student_ids() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_teacher_homework_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_guardian_student_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_teacher_homework_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_teacher_class_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_children_class_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_own_or_children_student_ids() TO authenticated;

-- ── 2. students_read ───────────────────────────────────────────────────────
-- can_read_student_row's body, term for term, in the policy itself so its
-- no-column calls resolve once. Row-local: nothing here selects from students.
-- TO authenticated: anon was admitted to the old policy only to be refused by
-- it (no account, no school), and now simply has no read arm.

DROP POLICY students_read ON public.students;
CREATE POLICY students_read ON public.students
  FOR SELECT TO authenticated
  USING (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND (
      (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
      OR (SELECT public.has_role(auth.uid(), 'principal'::public.app_role))
      OR ((SELECT public.active_membership_role()) = 'student'
          AND user_id = (SELECT auth.uid())
          AND id = (SELECT public.active_local_person_id()))
      OR ((SELECT public.active_membership_role()) = 'parent'
          AND (parent_user_id = (SELECT auth.uid())
               OR id IN (SELECT public.my_guardian_student_ids())))
      OR class_id IN (SELECT public.my_teacher_class_ids())
    )
  );

DROP FUNCTION public.can_read_student_row(uuid, uuid, uuid, uuid, uuid);

-- ── 3. homework ────────────────────────────────────────────────────────────

DROP POLICY "homework admin all" ON public.homework;
CREATE POLICY "homework admin all" ON public.homework
  FOR ALL TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
         AND school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
              AND school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY "homework principal read" ON public.homework;
CREATE POLICY "homework principal read" ON public.homework
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'principal'::public.app_role))
         AND school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY "homework student read" ON public.homework;
CREATE POLICY "homework student read" ON public.homework
  FOR SELECT TO authenticated
  USING (class_id = (SELECT public.student_class_id(auth.uid()))
         AND status = 'published' AND deleted_at IS NULL);

DROP POLICY "homework parent read" ON public.homework;
CREATE POLICY "homework parent read" ON public.homework
  FOR SELECT TO authenticated
  USING ((SELECT public.active_membership_role()) = 'parent'
         AND class_id IN (SELECT unnest(public.my_children_class_ids()))
         AND status = 'published' AND deleted_at IS NULL);

DROP POLICY "homework teacher manage" ON public.homework;
CREATE POLICY "homework teacher read" ON public.homework
  FOR SELECT TO authenticated
  USING (class_id IN (SELECT public.my_teacher_class_ids()));
CREATE POLICY "homework teacher insert" ON public.homework
  FOR INSERT TO authenticated
  WITH CHECK (public.teacher_teaches_class((SELECT auth.uid()), class_id));
CREATE POLICY "homework teacher update" ON public.homework
  FOR UPDATE TO authenticated
  USING (public.teacher_teaches_class((SELECT auth.uid()), class_id))
  WITH CHECK (public.teacher_teaches_class((SELECT auth.uid()), class_id));
CREATE POLICY "homework teacher delete" ON public.homework
  FOR DELETE TO authenticated
  USING (public.teacher_teaches_class((SELECT auth.uid()), class_id));

COMMENT ON POLICY "homework teacher read" ON public.homework IS
  'A teacher reads the homework of the classes they teach, through my_teacher_class_ids — resolved once per statement, as students, tests, exams, marks and attendance read. Authorship is not a door (20260919000000).';
COMMENT ON POLICY "homework teacher insert" ON public.homework IS
  'A teacher sets homework only for a class they teach (20260919000000). Per row, as writes stay: one row at a time, and a subquery form may not see the row being inserted.';
COMMENT ON POLICY "homework teacher update" ON public.homework IS
  'A teacher changes homework only for a class they teach, and cannot move it to one they do not (20260919000000).';
COMMENT ON POLICY "homework teacher delete" ON public.homework IS
  'Kept from "homework teacher manage", which was FOR ALL; deletion in the app goes to the trash through rpc_homework_delete.';

DROP POLICY homework_soft_delete_fence ON public.homework;
CREATE POLICY homework_soft_delete_fence ON public.homework
  AS RESTRICTIVE FOR SELECT TO authenticated, anon
  USING (deleted_at IS NULL OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

-- ── 4. homework_submissions ────────────────────────────────────────────────

DROP POLICY "hw_sub admin read" ON public.homework_submissions;
CREATE POLICY "hw_sub admin read" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
         AND school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY "hw_sub principal read" ON public.homework_submissions;
CREATE POLICY "hw_sub principal read" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'principal'::public.app_role))
         AND school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY "hw_sub parent read" ON public.homework_submissions;
CREATE POLICY "hw_sub parent read" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING ((SELECT public.active_membership_role()) = 'parent'
         AND student_id IN (SELECT public.my_own_or_children_student_ids()));

DROP POLICY "hw_sub student read own" ON public.homework_submissions;
CREATE POLICY "hw_sub student read own" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING ((SELECT public.active_membership_role()) = 'student'
         AND student_id = (SELECT public.active_local_person_id()));

DROP POLICY "hw_sub teacher read" ON public.homework_submissions;
CREATE POLICY "hw_sub teacher read" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (homework_id IN (SELECT public.my_teacher_homework_ids()));

DROP FUNCTION public.can_manage_homework(uuid);

-- ── 4b. What this leaves, so the rollback can refuse a later change ───────

INSERT INTO public.rls_pre_20260925160000 (kind, name)
SELECT 'policy', c.relname || '.' || p.polname
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('students', 'homework', 'homework_submissions')
ON CONFLICT DO NOTHING;

UPDATE public.rls_pre_20260925160000 r
   SET applied = pg_temp._r160_policy_sql(split_part(r.name, '.', 1), substr(r.name, strpos(r.name, '.') + 1)),
       applied_comment = (SELECT obj_description(p.oid, 'pg_policy')
                            FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = 'public' AND c.relname = split_part(r.name, '.', 1)
                             AND p.polname = substr(r.name, strpos(r.name, '.') + 1))
 WHERE r.kind = 'policy';

UPDATE public.rls_pre_20260925160000 r
   SET applied = CASE WHEN to_regprocedure(r.name) IS NOT NULL THEN pg_get_functiondef(to_regprocedure(r.name)) END,
       applied_acl = (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM pg_proc p, unnest(p.proacl) x WHERE p.oid = to_regprocedure(r.name)),
       applied_comment = CASE WHEN to_regprocedure(r.name) IS NOT NULL THEN obj_description(to_regprocedure(r.name), 'pg_proc') END
 WHERE r.kind = 'function';

-- ── 5. Proof ───────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  _a        uuid;
  _n        int;
  _sample   text;
  _narrow   uuid;
BEGIN
  FOR _a IN SELECT DISTINCT account FROM _v160_picks ORDER BY account LOOP
    PERFORM pg_temp._v160_read_as('after', _a);
  END LOOP;
  PERFORM pg_temp._v160_snapshot_policies('after');

  -- 1. The proof read something: a comparison of empty sets is not a proof.
  IF (SELECT count(DISTINCT rel) FROM _v160_seen
       WHERE phase = 'before' AND rel IN ('students', 'homework', 'homework_submissions')) < 3 THEN
    RAISE EXCEPTION 'ROLLED BACK: the callers read nothing from at least one of students, homework, homework_submissions';
  END IF;

  -- 2. Nobody sees anything they could not see before.
  SELECT count(*), string_agg(DISTINCT x.account || ' ' || x.rel, '; ') INTO _n, _sample
    FROM (SELECT account, rel, id FROM _v160_seen WHERE phase = 'after' AND rel <> 'authorship_only'
          EXCEPT SELECT account, rel, id FROM _v160_seen WHERE phase = 'before') x;
  IF _n > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % row(s) became visible that were not before (%)', _n, _sample;
  END IF;

  -- 3. Nobody loses anything, except the hand-ins they could read only by
  --    authorship — as the old predicates said, before they were dropped.
  SELECT count(*), string_agg(DISTINCT x.account || ' ' || x.rel, '; ') INTO _n, _sample
    FROM (SELECT account, rel, id FROM _v160_seen WHERE phase = 'before' AND rel <> 'authorship_only'
          EXCEPT SELECT account, rel, id FROM _v160_seen WHERE phase = 'after') x
   WHERE NOT (x.rel = 'homework_submissions'
              AND (x.account, x.id) IN (SELECT account, id FROM _v160_seen WHERE phase = 'before' AND rel = 'authorship_only'));
  IF _n > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % row(s) a caller could see are no longer visible (%)', _n, _sample;
  END IF;

  -- ...and the door is shut: every hand-in behind it is gone.
  SELECT count(*) INTO _n
    FROM _v160_seen d
    JOIN _v160_seen s ON s.phase = 'after' AND s.rel = 'homework_submissions' AND s.account = d.account AND s.id = d.id
   WHERE d.phase = 'before' AND d.rel = 'authorship_only';
  IF _n > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % hand-in(s) are still readable only because their reader authored the homework', _n;
  END IF;

  -- 4. The shape: no read policy this migration wrote asks per row — and the
  --    same test must flag the three policies it was written to replace. (The
  --    tenant fences are 20260912000000's, and are not re-asserted here.)
  IF (SELECT count(*) FROM _v160_policies WHERE phase = 'after' AND (tbl, pol) IN (
        ('students', 'students_read'),
        ('homework', 'homework admin all'), ('homework', 'homework principal read'),
        ('homework', 'homework student read'), ('homework', 'homework parent read'),
        ('homework', 'homework teacher read'), ('homework', 'homework_soft_delete_fence'),
        ('homework_submissions', 'hw_sub admin read'), ('homework_submissions', 'hw_sub principal read'),
        ('homework_submissions', 'hw_sub parent read'), ('homework_submissions', 'hw_sub student read own'),
        ('homework_submissions', 'hw_sub teacher read'))) <> 12 THEN
    RAISE EXCEPTION 'ROLLED BACK: the twelve read policies this migration writes are not all present';
  END IF;
  SELECT count(*), string_agg(tbl || '.' || pol, ', ') INTO _n, _sample
    FROM _v160_policies
   WHERE phase = 'after' AND pg_temp._v160_asks_per_row(expr)
     AND (tbl, pol) IN (
        ('students', 'students_read'),
        ('homework', 'homework admin all'), ('homework', 'homework principal read'),
        ('homework', 'homework student read'), ('homework', 'homework parent read'),
        ('homework', 'homework teacher read'), ('homework', 'homework_soft_delete_fence'),
        ('homework_submissions', 'hw_sub admin read'), ('homework_submissions', 'hw_sub principal read'),
        ('homework_submissions', 'hw_sub parent read'), ('homework_submissions', 'hw_sub student read own'),
        ('homework_submissions', 'hw_sub teacher read'));
  IF _n > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % read policy(ies) still ask per row: %', _n, _sample;
  END IF;
  IF (SELECT count(*) FROM _v160_policies
       WHERE phase = 'before' AND pg_temp._v160_asks_per_row(expr)
         AND (tbl, pol) IN (('students', 'students_read'), ('homework', 'homework teacher manage'),
                            ('homework_submissions', 'hw_sub teacher read'))) <> 3 THEN
    RAISE EXCEPTION 'ROLLED BACK: the shape check did not flag the policies it replaced, so it cannot fail';
  END IF;

  -- 5. The two predicates this retires are gone, and nothing still names them.
  IF to_regprocedure('public.can_read_student_row(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.can_manage_homework(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: can_read_student_row or can_manage_homework still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT LIKE 'pg_temp%' AND p.prosrc ~ 'can_read_student_row|can_manage_homework')
     OR EXISTS (SELECT 1 FROM pg_policy p
                 WHERE coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
                       ~ 'can_read_student_row|can_manage_homework') THEN
    RAISE EXCEPTION 'ROLLED BACK: something still calls a predicate this migration dropped';
  END IF;

  -- 6. The writes keep the rule 20260919000000 set, and only the writes do.
  IF (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname = 'homework'
         AND p.polname IN ('homework teacher insert', 'homework teacher update', 'homework teacher delete')
         AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
             ~ 'teacher_teaches_class\('
         AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
             !~ 'created_by') <> 3
     OR EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                 WHERE c.relname = 'homework' AND p.polname = 'homework teacher manage') THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher write policies are not the three per-row checks of 20260919000000';
  END IF;

  -- 6b. The rollback has what it needs: the two retired predicates and the old
  --     policies as they were, the two helpers as absent before, and the old
  --     policy statement replays to exactly the text it was read from.
  IF (SELECT count(*) FROM public.rls_pre_20260925160000
       WHERE kind = 'function' AND definition IS NOT NULL AND applied IS NULL
         AND name IN ('public.can_read_student_row(uuid,uuid,uuid,uuid,uuid)', 'public.can_manage_homework(uuid)')) <> 2
     OR (SELECT count(*) FROM public.rls_pre_20260925160000
          WHERE kind = 'function' AND definition IS NULL AND applied IS NOT NULL
            AND name IN ('public.my_guardian_student_ids()', 'public.my_teacher_homework_ids()')) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.rls_pre_20260925160000
                     WHERE kind = 'policy' AND name = 'homework.homework teacher manage'
                       AND definition ~ 'teacher_teaches_class' AND applied IS NULL AND comment ~ 'Authorship is NOT')
     OR NOT EXISTS (SELECT 1 FROM public.rls_pre_20260925160000
                     WHERE kind = 'policy' AND name = 'students.students_read'
                       AND definition ~ 'can_read_student_row' AND applied ~ 'my_teacher_class_ids')
     OR (SELECT acl FROM public.rls_pre_20260925160000 WHERE kind = 'function' AND name = 'public.my_teacher_class_ids()')
        IS NOT DISTINCT FROM
        (SELECT applied_acl FROM public.rls_pre_20260925160000 WHERE kind = 'function' AND name = 'public.my_teacher_class_ids()') THEN
    RAISE EXCEPTION 'ROLLED BACK: the rollback snapshot does not hold what was there before and what this left';
  END IF;

  -- 7. Negative control: open students_read to every row and the comparison in
  --    step 2 must see it. The savepoint puts the policy back. It reads as the
  --    caller with the narrowest view of the roster — a student, parent or
  --    teacher; an operator already sees the whole school, so opening the
  --    policy would change nothing for them.
  SELECT p.account INTO _narrow
    FROM (SELECT DISTINCT account FROM _v160_picks) p
   WHERE EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = p.account AND m.status = 'active' AND m.role IN ('student', 'parent', 'teacher'))
     AND NOT EXISTS (SELECT 1 FROM public.memberships m
                      WHERE m.account_id = p.account AND m.status = 'active' AND m.role IN ('admin', 'principal'))
   ORDER BY (SELECT count(*) FROM _v160_seen s WHERE s.phase = 'before' AND s.rel = 'students' AND s.account = p.account),
            p.account
   LIMIT 1;
  IF _narrow IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: no student, parent or teacher caller to run the negative control as';
  END IF;
  BEGIN
    EXECUTE 'ALTER POLICY students_read ON public.students USING (true)';
    PERFORM pg_temp._v160_read_as('opened', _narrow);
    SELECT count(*) INTO _n
      FROM (SELECT id FROM _v160_seen WHERE phase = 'opened' AND account = _narrow AND rel = 'students'
            EXCEPT SELECT id FROM _v160_seen WHERE phase = 'before' AND account = _narrow AND rel = 'students') x;
    IF _n = 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: students_read opened to every row, and the comparison saw no difference';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0998', MESSAGE = 'negative control caught';
  EXCEPTION WHEN SQLSTATE 'P0998' THEN
    NULL;
  END;
  IF (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname = 'students' AND p.polname = 'students_read') !~ 'my_teacher_class_ids' THEN
    RAISE EXCEPTION 'ROLLED BACK: the negative control did not put students_read back';
  END IF;

  RAISE NOTICE 'verify OK: % caller(s) (%) see exactly the students, homework and hand-ins they saw before, less % hand-in(s) they could read only by authorship; no read policy on the three tables asks per row, and the check flags the three it replaced; the retired predicates are gone; the teacher writes keep their rule; an opened students_read was caught and put back',
    (SELECT count(DISTINCT account) FROM _v160_picks),
    (SELECT string_agg(why, ', ' ORDER BY why) FROM _v160_picks),
    (SELECT count(*) FROM _v160_seen WHERE phase = 'before' AND rel = 'authorship_only');

  DROP TABLE _v160_picks, _v160_seen, _v160_policies;
  DROP FUNCTION pg_temp._v160_read_as(text, uuid);
  DROP FUNCTION pg_temp._v160_snapshot_policies(text);
  DROP FUNCTION pg_temp._v160_asks_per_row(text);
  DROP FUNCTION pg_temp._r160_policy_sql(text, text);
END
$verify$;
