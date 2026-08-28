-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7B — BATCH 2a: the six existing practice tenant fences
--
-- Batch 1 created practice_bookmarks, practice_skipped and chapter_tally with
-- the 6.6/6.7 fence pattern from birth, and named the six pre-existing
-- practice tables as work it was deliberately not doing. This is that work.
--
-- MEASURED BEFORE, at fixture volume (scale institution, 40 practice accounts):
--
--   table                     rows   per candidate row   worst role total
--   ------------------------  -----  -----------------   ----------------
--   question_attempts         4,809  2.09 - 2.30 ms      11.05 s  ** over the 8s timeout today **
--   student_question_history  1,000  2.11 - 2.15 ms       2.15 s
--   student_mistakes            489  2.17 - 2.25 ms       1.10 s
--   concept_mastery             417  2.04 - 2.40 ms       1.00 s
--   practice_sessions           247  2.07 - 3.07 ms       0.76 s
--   revision_queue              206  2.03 - 2.09 ms       0.43 s
--
-- The per-row figure is the same ~2.1 ms on every table for every role, which
-- is the signature of the cost being the fence itself and not anything about
-- the data: same_school(school_id) is one SECURITY DEFINER call per candidate
-- row. All thirty paths project past the gate at 10,000 rows, and
-- question_attempts is already a 500 at 4,809.
--
-- THE REWRITE, unchanged from 6.6/6.7 and now applied for the seventh time:
--
--   from  ((school_id IS NULL) OR same_school(school_id))
--     to  (school_id IN (SELECT public.my_accessible_school_ids()))
--
-- IN (SELECT fn()) is uncorrelated, so the planner evaluates it once per
-- statement as a hashed SubPlan; the per-row work becomes a hash probe.
--
-- PROVEN NOT TO WORK, recorded so nobody retries it: rewriting same_school()
-- as a non-SECURITY-DEFINER wrapper to get it inlined does not help. Postgres
-- will not inline a SQL function whose body contains a subquery. Measured
-- 8.0 s -> 16.2 s, worse, in a rolled-back transaction.
--
-- ── The `IS NULL` arm is dropped, not carried over ─────────────────────────
--
-- The old fence admitted every row whose school_id was NULL, to EVERY tenant
-- and to anon. Batch 1 flagged this as a latent hole and gave the three new
-- tables NOT NULL school_id so it could not be expressed. These six carried
-- it. Measured now: zero NULL-school rows across all six (489/417/247/4809/
-- 1000/206 rows, 0 NULL). So the arm protects nothing today and is removed,
-- and school_id is made NOT NULL so it cannot come back.
--
-- That is a genuine tightening, which is why it is stated plainly rather than
-- folded into a performance change: after this, a practice row written without
-- a school_id fails at write time instead of becoming visible to everyone.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Refuse to run if the premise is false ───────────────────────────────
-- If any NULL-school practice row exists, SET NOT NULL would fail partway and
-- the assumption behind dropping the IS NULL arm would be wrong. Check first
-- and name the table, rather than discovering it in a constraint violation.
DO $premise$
DECLARE t text; n bigint; bad text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['student_mistakes','concept_mastery','practice_sessions',
                           'question_attempts','student_question_history','revision_queue'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id IS NULL', t) INTO n;
    IF n > 0 THEN bad := bad || format('%s=%s ', t, n); END IF;
  END LOOP;

  IF bad <> '' THEN
    RAISE EXCEPTION
      'Chunk 7B batch 2a: NULL-school practice rows exist (%). Backfill them before the fence stops admitting NULL, or they become invisible to their own owner.',
      bad;
  END IF;
END
$premise$;

-- ── 2. Make the hole unrepresentable ───────────────────────────────────────
ALTER TABLE public.student_mistakes         ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.concept_mastery          ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.practice_sessions        ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.question_attempts        ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.student_question_history ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.revision_queue           ALTER COLUMN school_id SET NOT NULL;

-- ── 3. The fences ──────────────────────────────────────────────────────────
DO $fences$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_mistakes','concept_mastery','practice_sessions',
                           'question_attempts','student_question_history','revision_queue'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_fence', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated
         USING      (school_id IN (SELECT public.my_accessible_school_ids()))
         WITH CHECK (school_id IN (SELECT public.my_accessible_school_ids()))',
      t || '_tenant_fence', t);
  END LOOP;
END
$fences$;

-- ── 4. Prove the fence admits the same rows ────────────────────────────────
--
-- Both predicates are pure functions of school_id and the caller, so two rows
-- with the same school_id are indistinguishable to the fence. Agreement across
-- every (identity x distinct school_id) pair therefore proves agreement across
-- every row, without reading 4,809 of them through a policy that costs 2.1 ms
-- each. This is the same test as comparing row sets, evaluated at the only
-- granularity the predicate can distinguish.
--
-- Compared under RLS semantics (NULL coerced to false), because that is what
-- the fence does with the value. The two are NOT the same boolean function:
-- for a caller whose school cannot be resolved same_school() returns NULL
-- where the IN form returns FALSE. RLS denies on both, so the new form is
-- strictly no more permissive. Asserted rather than argued.
--
-- The NULL school_id case is deliberately NOT compared: the old fence admitted
-- it and the new one does not. That is the intended tightening from section 2,
-- it applies to zero rows, and section 1 proved that.
DO $prove$
DECLARE
  _acct  record;
  _sid   uuid;
  _old   boolean;
  _new   boolean;
  _fail  text := '';
  _pairs int := 0;
BEGIN
  FOR _acct IN
    SELECT * FROM (
      SELECT id, email FROM auth.users WHERE email LIKE '%@wisdomcampus.com'
      UNION ALL
      (SELECT u.id, u.email FROM auth.users u
        WHERE u.email LIKE '%@northfield.test' ORDER BY u.email LIMIT 3)
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

    FOR _sid IN SELECT id FROM public.schools LOOP
      _old := coalesce(public.same_school(_sid), false);
      _new := coalesce(_sid IN (SELECT public.my_accessible_school_ids()), false);
      _pairs := _pairs + 1;
      IF _old IS DISTINCT FROM _new THEN
        _fail := _fail || format('[%s x school %s: was %s, now %s] ',
                                 _acct.email, _sid, _old, _new);
      END IF;
    END LOOP;
  END LOOP;

  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _pairs = 0 THEN
    RAISE EXCEPTION 'Chunk 7B batch 2a: the equivalence proof compared nothing. A check that runs zero comparisons is not a passing check.';
  END IF;
  IF _fail <> '' THEN
    RAISE EXCEPTION 'Chunk 7B batch 2a ABORTED — the rewritten fence does not admit the same rows: %', _fail;
  END IF;

  RAISE NOTICE 'Chunk 7B batch 2a: fence predicates agree on all % (identity x school) pairs.', _pairs;
END
$prove$;

-- ── 5. Assert the shape that ended up on each table ────────────────────────
-- The proof above compares EXPRESSIONS. This proves the expression that landed
-- is the new one, still RESTRICTIVE, still FOR ALL, still covering anon, still
-- carrying a WITH CHECK. A fence silently downgraded to PERMISSIVE would grant
-- instead of constrain and would pass every timing and equivalence check.
DO $shape$
DECLARE
  t text; _q text; _w text; _perm boolean; _cmd "char"; _roles text[]; _fail text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['student_mistakes','concept_mastery','practice_sessions',
                           'question_attempts','student_question_history','revision_queue'] LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid),
           p.polpermissive, p.polcmd,
           (SELECT array_agg(r.rolname ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles))
      INTO _q, _w, _perm, _cmd, _roles
      FROM pg_policy p
     WHERE p.polrelid = format('public.%I', t)::regclass
       AND p.polname = t || '_tenant_fence';

    IF _q IS NULL THEN _fail := _fail || t || ':missing '; CONTINUE; END IF;
    IF _perm THEN _fail := _fail || t || ':PERMISSIVE '; END IF;
    IF _cmd <> '*' THEN _fail := _fail || t || ':not-FOR-ALL '; END IF;
    IF _w IS NULL THEN _fail := _fail || t || ':no-WITH-CHECK '; END IF;
    IF _q IS DISTINCT FROM _w THEN _fail := _fail || t || ':using<>check '; END IF;
    IF _q LIKE '%same_school%' THEN _fail := _fail || t || ':still-per-row '; END IF;
    IF _q NOT LIKE '%my_accessible_school_ids%' THEN _fail := _fail || t || ':no-set-helper '; END IF;
    IF _q LIKE '%IS NULL%' THEN _fail := _fail || t || ':IS-NULL-arm-survived '; END IF;
    IF NOT (_roles @> ARRAY['anon','authenticated']) THEN _fail := _fail || t || ':roles '; END IF;
  END LOOP;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'Chunk 7B batch 2a: fence shape wrong after rewrite: %', _fail;
  END IF;
END
$shape$;

COMMIT;
