-- Rollback for 20260925160000_homework_is_counted_without_asking_once_per_row.
--
-- Puts every policy on students, homework and homework_submissions, and every
-- routine the migration touched, back exactly as they were before it — the
-- statement, the grant and the comment — from the copies the migration took
-- into rls_pre_20260925160000, whichever database it was. That is:
-- can_read_student_row and can_manage_homework recreated; the read policies
-- asking per row again; "homework teacher manage" one FOR ALL policy again;
-- my_children_class_ids its per-student body; the two set helpers gone; and the
-- EXECUTE grants the policies needed withdrawn.
--
-- WHAT REVERTING COSTS: the nine query-timing findings come back — every
-- homework count 4–6 s for an admin, principal or parent at 13 students, and
-- past the 8 s statement timeout at an ordinary school's volume — and the
-- author of homework in a class they do not teach can read its hand-ins again.
-- Roll back only to undo a deployment.

-- The statement that recreates one policy, rebuilt from the catalog exactly as
-- the migration rebuilt it.
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

CREATE OR REPLACE FUNCTION pg_temp._r160_function_acl(_fn text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT string_agg(x::text, ',' ORDER BY x::text) FROM pg_proc p, unnest(p.proacl) x WHERE p.oid = to_regprocedure(_fn)
$fn$;

CREATE OR REPLACE FUNCTION pg_temp._r160_policy_comment(_name text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT obj_description(p.oid, 'pg_policy')
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = split_part(_name, '.', 1) AND p.polname = substr(_name, strpos(_name, '.') + 1)
$fn$;

DO $pre$
DECLARE
  _changed text;
BEGIN
  IF to_regclass('public.rls_pre_20260925160000') IS NULL THEN
    RAISE EXCEPTION 'ABORT: rls_pre_20260925160000 is gone, so the policies and routines cannot be put back exactly. Restore them from a backup instead.';
  END IF;
  -- Something applied since may have changed what this migration left; putting
  -- the old state back would silently undo that too.
  SELECT string_agg(name, ', ') INTO _changed
    FROM public.rls_pre_20260925160000 r
   WHERE (r.kind = 'policy'
          AND (pg_temp._r160_policy_sql(split_part(r.name, '.', 1), substr(r.name, strpos(r.name, '.') + 1)) IS DISTINCT FROM r.applied
               OR pg_temp._r160_policy_comment(r.name) IS DISTINCT FROM r.applied_comment))
      OR (r.kind = 'function'
          AND ((CASE WHEN to_regprocedure(r.name) IS NOT NULL THEN pg_get_functiondef(to_regprocedure(r.name)) END) IS DISTINCT FROM r.applied
               OR pg_temp._r160_function_acl(r.name) IS DISTINCT FROM r.applied_acl
               OR (CASE WHEN to_regprocedure(r.name) IS NOT NULL THEN obj_description(to_regprocedure(r.name), 'pg_proc') END)
                  IS DISTINCT FROM r.applied_comment));
  IF _changed IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: % changed since 20260925160000 was applied. Roll back what changed it first.', _changed;
  END IF;
  -- Policies on these tables that the migration did not know about would be
  -- left in place by a restore that only knows its own list.
  SELECT string_agg(c.relname || '.' || p.polname, ', ') INTO _changed
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('students', 'homework', 'homework_submissions')
     AND NOT EXISTS (SELECT 1 FROM public.rls_pre_20260925160000 r WHERE r.kind = 'policy' AND r.name = c.relname || '.' || p.polname);
  IF _changed IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: % was created after 20260925160000. Roll back what created it first.', _changed;
  END IF;
END
$pre$;

DO $restore$
DECLARE
  _r record;
  _g record;
BEGIN
  -- 1. Every policy that differs from before is dropped, so no policy still
  --    names a routine about to be dropped or replaced.
  FOR _r IN SELECT name FROM public.rls_pre_20260925160000
             WHERE kind = 'policy' AND applied IS NOT NULL
               AND (definition IS DISTINCT FROM applied OR comment IS DISTINCT FROM applied_comment) LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', substr(_r.name, strpos(_r.name, '.') + 1), split_part(_r.name, '.', 1));
  END LOOP;

  -- 2. Routines: the ones that did not exist go; the others get their body,
  --    grants and comment back.
  FOR _r IN SELECT * FROM public.rls_pre_20260925160000 WHERE kind = 'function' ORDER BY name LOOP
    IF _r.definition IS NULL THEN
      EXECUTE format('DROP FUNCTION %s', _r.name);
      CONTINUE;
    END IF;
    IF _r.definition IS DISTINCT FROM _r.applied THEN
      EXECUTE _r.definition;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', _r.name);
    FOR _g IN SELECT a.grantee, a.privilege_type
                FROM unnest(string_to_array(_r.acl, ',')::aclitem[]) item, aclexplode(ARRAY[item]) a
               WHERE a.grantee <> (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure(_r.name)) LOOP
      EXECUTE format('GRANT %s ON FUNCTION %s TO %s', _g.privilege_type, _r.name,
                     CASE WHEN _g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(_g.grantee::regrole::text) END);
    END LOOP;
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', _r.name, _r.comment);
  END LOOP;

  -- 3. The policies as they were, and their comments.
  FOR _r IN SELECT * FROM public.rls_pre_20260925160000
             WHERE kind = 'policy' AND definition IS NOT NULL
               AND (applied IS NULL OR definition IS DISTINCT FROM applied OR comment IS DISTINCT FROM applied_comment) LOOP
    EXECUTE _r.definition;
    EXECUTE format('COMMENT ON POLICY %I ON public.%I IS %L',
                   substr(_r.name, strpos(_r.name, '.') + 1), split_part(_r.name, '.', 1), _r.comment);
  END LOOP;
END
$restore$;

DO $verify$
DECLARE
  _wrong text;
BEGIN
  SELECT string_agg(name, ', ') INTO _wrong
    FROM public.rls_pre_20260925160000 r
   WHERE (r.kind = 'policy'
          AND (pg_temp._r160_policy_sql(split_part(r.name, '.', 1), substr(r.name, strpos(r.name, '.') + 1)) IS DISTINCT FROM r.definition
               OR pg_temp._r160_policy_comment(r.name) IS DISTINCT FROM r.comment))
      OR (r.kind = 'function'
          AND ((CASE WHEN to_regprocedure(r.name) IS NOT NULL THEN pg_get_functiondef(to_regprocedure(r.name)) END) IS DISTINCT FROM r.definition
               OR pg_temp._r160_function_acl(r.name) IS DISTINCT FROM r.acl
               OR (CASE WHEN to_regprocedure(r.name) IS NOT NULL THEN obj_description(to_regprocedure(r.name), 'pg_proc') END)
                  IS DISTINCT FROM r.comment));
  IF _wrong IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: % is not what it was before 20260925160000', _wrong;
  END IF;

  -- The check above compares against the snapshot; this one names the shape,
  -- so a snapshot that was itself wrong cannot pass.
  IF (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname = 'students' AND p.polname = 'students_read') !~ 'can_read_student_row'
     OR NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                     WHERE c.relname = 'homework' AND p.polname = 'homework teacher manage' AND p.polcmd = '*')
     OR to_regprocedure('public.my_teacher_homework_ids()') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: students_read, homework teacher manage or the set helpers are not as they were';
  END IF;

  DROP TABLE public.rls_pre_20260925160000;
  DROP FUNCTION pg_temp._r160_policy_sql(text, text);
  DROP FUNCTION pg_temp._r160_function_acl(text);
  DROP FUNCTION pg_temp._r160_policy_comment(text);
  RAISE NOTICE 'rollback OK: every policy on the three tables and every routine 20260925160000 touched is back as it was — statement, grant and comment';
END
$verify$;
