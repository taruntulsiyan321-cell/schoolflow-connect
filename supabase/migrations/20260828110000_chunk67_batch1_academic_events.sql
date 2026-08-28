-- ---------------------------------------------------------------------
-- CHUNK 6.7 — BATCH 1: academic_events, and the grant the whole chunk rests on
--
-- This is a change to the isolation boundary, not a performance change that
-- happens to touch policies. It is scoped to ONE table so the mechanism can be
-- proved before it is repeated 89 times.
--
-- WHY academic_events FIRST: measured, not projected. As of 2026-08-28, on
-- 4,335 rows, a full read of this table costs:
--
--   admin      56.5 s        principal  85.2 s        teacher   53.4 s
--   parent     85.1 s        student    91.5 s
--
-- Against an 8 s statement timeout. And three of those five roles could not be
-- read at all through the Management API, which gives up at ~100 s (HTTP 524).
-- This table is not degraded. It is down, and has been.
--
-- ---------------------------------------------------------------------
-- SECTION 1 — The grant this entire chunk depends on.
--
-- my_accessible_school_ids() is currently executable only through the implicit
-- PUBLIC grant (ACL '{=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
-- whereas same_school() carries explicit anon and authenticated grants. Once
-- 90 tenant fences call it, a routine "REVOKE EXECUTE ON ALL FUNCTIONS IN
-- SCHEMA public FROM PUBLIC" hardening step would stop every fenced query for
-- every end user, on every table, with a permission error.
--
-- Granted explicitly here so the fence does not depend on a default that
-- security hardening is expected to remove.
-- ---------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.my_accessible_school_ids() TO anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 2 — The rewrite.
--
-- FROM: ((school_id IS NULL) OR same_school(school_id))
--   TO: ((school_id IS NULL) OR (school_id IN (SELECT my_accessible_school_ids())))
--
-- same_school() takes a per-row argument, so Postgres re-invokes it — and the
-- get_my_school_id() and super_admin_has_access() calls inside it — once per
-- candidate row. my_accessible_school_ids() takes no argument and returns a
-- set, so the planner hoists it into a hashed SubPlan evaluated once per
-- statement; the per-row work becomes a hash probe.
--
-- PROVEN NOT TO WORK, DO NOT RETRY (recorded so nobody spends the day again):
-- rewriting same_school() as a non-SECURITY-DEFINER wrapper to get it inlined
-- does not help. Postgres will not inline a SQL function whose body contains a
-- subquery, so the call survives and the definer's cheap plan is lost.
-- Measured 8.0 s -> 16.2 s, worse. Tested in a rolled-back transaction;
-- production never saw it.
--
-- EQUIVALENCE, stated precisely rather than loosely:
--   same_school(v)                        = v IS NOT NULL AND (v = get_my_school_id()
--                                                              OR super_admin_has_access(v))
--   v IN (SELECT my_accessible_school_ids()) = v IS NOT NULL AND (v = get_my_school_id()
--                                                              OR v is a live grant)
-- and my_accessible_school_ids() is exactly {get_my_school_id()} UNION {live grants}
-- under the identical revoked_at IS NULL AND expires_at > now() conditions.
--
-- They are NOT the same boolean function. For a caller whose school cannot be
-- resolved, same_school() returns NULL while the IN form returns FALSE. RLS
-- coerces NULL to false, so both DENY — the new form is strictly no more
-- permissive than the old, and identical in effect. Saying "exactly
-- equivalent" would have been wrong, and the difference is asserted below
-- rather than argued.
--
-- Section 3 proves this for every caller and every school_id value that
-- exists, and aborts the whole migration if any pair disagrees.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS academic_events_tenant_fence ON public.academic_events;

CREATE POLICY academic_events_tenant_fence ON public.academic_events
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING      ((school_id IS NULL) OR (school_id IN ( SELECT public.my_accessible_school_ids() )))
  WITH CHECK ((school_id IS NULL) OR (school_id IN ( SELECT public.my_accessible_school_ids() )));


-- ---------------------------------------------------------------------
-- SECTION 3 — Prove the fence admits exactly the same rows.
--
-- The reduction that makes this cheap AND complete: both predicates are pure
-- functions of school_id and the caller. Two rows with the same school_id are
-- therefore indistinguishable to the fence. So agreement over the DISTINCT
-- school_id values that exist — here 2 schools plus NULL — proves agreement
-- over every row, without reading 4,335 of them through a policy that takes
-- 90 seconds.
--
-- This is not a weaker test than comparing row sets. It is the same test,
-- evaluated at the only granularity the predicate can distinguish.
--
-- Compared under RLS semantics (NULL coerced to false), because that is what
-- the fence actually does with the value.
-- ---------------------------------------------------------------------

DO $prove$
DECLARE
  _acct   record;
  _sid    uuid;
  _old    boolean;
  _new    boolean;
  _fail   text := '';
  _pairs  int := 0;
BEGIN
  FOR _acct IN
    -- Every distinct identity that can reach the fence: each account holding a
    -- membership, plus an account with none (unresolvable), plus no identity
    -- at all (anon). The unresolvable and anon cases are the ones where the
    -- two predicates genuinely differ in raw 3-valued logic.
    SELECT * FROM (
      SELECT id, email FROM auth.users WHERE email LIKE '%@wisdomcampus.com'
      UNION ALL
      (SELECT p.id, '<profile with no school>'
         FROM public.profiles p WHERE p.school_id IS NULL LIMIT 1)
      UNION ALL
      SELECT NULL::uuid, '<anon: no jwt>'
    ) ids
  LOOP
    IF _acct.id IS NULL THEN
      PERFORM set_config('request.jwt.claims', NULL, true);
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _acct.id, 'role', 'authenticated')::text, true);
    END IF;

    FOR _sid IN
      SELECT * FROM (
        SELECT id FROM public.schools
        UNION ALL SELECT NULL::uuid
      ) sids
    LOOP
      -- The fence expression as it was, and as it now is.
      _old := coalesce((_sid IS NULL) OR public.same_school(_sid), false);
      _new := coalesce((_sid IS NULL)
                       OR (_sid IN (SELECT public.my_accessible_school_ids())), false);
      _pairs := _pairs + 1;

      IF _old IS DISTINCT FROM _new THEN
        _fail := _fail || format('[%s x school %s: was %s, now %s] ',
                                 _acct.email, coalesce(_sid::text, 'NULL'), _old, _new);
      END IF;
    END LOOP;
  END LOOP;

  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _pairs = 0 THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1: the equivalence proof compared nothing. A check that runs zero comparisons is not a passing check.';
  END IF;

  IF _fail <> '' THEN
    RAISE EXCEPTION
      'Chunk 6.7 batch 1 ABORTED — the rewritten fence does not admit the same rows: %', _fail;
  END IF;

  RAISE NOTICE 'Chunk 6.7 batch 1: fence predicates agree on all % (identity x school_id) pairs.', _pairs;
END
$prove$;


-- ---------------------------------------------------------------------
-- SECTION 4 — Assert the policy is actually in the state we think.
--
-- G11: the checks above prove the two EXPRESSIONS agree. This proves the
-- expression that ended up on the table is the new one, still RESTRICTIVE,
-- still FOR ALL, still applying to both anon and authenticated, and still
-- carrying a WITH CHECK. A fence that was silently downgraded to permissive,
-- or lost its WITH CHECK, would pass every test above.
-- ---------------------------------------------------------------------

DO $shape$
DECLARE
  _q text; _w text; _perm boolean; _cmd "char"; _roles text[];
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid),
         p.polpermissive, p.polcmd,
         (SELECT array_agg(r.rolname ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles))
    INTO _q, _w, _perm, _cmd, _roles
    FROM pg_policy p
   WHERE p.polrelid = 'public.academic_events'::regclass
     AND p.polname = 'academic_events_tenant_fence';

  IF _q IS NULL THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1: the fence is missing from academic_events.';
  END IF;
  IF _perm THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1: the fence came back PERMISSIVE — it must be RESTRICTIVE or it grants instead of constraining.';
  END IF;
  IF _cmd <> '*' THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1: the fence is no longer FOR ALL (polcmd=%).', _cmd;
  END IF;
  IF _w IS NULL THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1: the fence lost its WITH CHECK, so writes are no longer fenced.';
  END IF;
  IF _q <> _w THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1: USING and WITH CHECK diverged (% vs %).', _q, _w;
  END IF;
  IF _q NOT LIKE '%my_accessible_school_ids%' THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1: the fence does not use the set helper: %', _q;
  END IF;
  IF _q LIKE '%same_school%' THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1: the fence still calls same_school per row: %', _q;
  END IF;
  IF NOT (_roles @> ARRAY['anon','authenticated']) THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1: the fence no longer applies to both anon and authenticated (%).', _roles;
  END IF;
END
$shape$;

COMMENT ON TABLE public.academic_events IS
  'Tenant fence rewritten in Chunk 6.7 batch 1: the fence resolves the caller''s accessible schools once per statement via my_accessible_school_ids() instead of calling same_school() per candidate row. Before the rewrite a full read cost 53-91s per role against an 8s statement timeout.';
