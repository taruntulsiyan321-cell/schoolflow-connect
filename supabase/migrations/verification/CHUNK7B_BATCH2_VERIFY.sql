-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7B VERIFICATION — batch 2a (the six existing practice tenant fences)
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE, so
-- nothing it does survives. That is what lets item 5 open a fence for real and
-- confirm the checks notice, without production ever seeing the hole.
--
-- CHUNK7B_BATCH2_VERIFY_OK means every item ran and passed.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  _tables  text[] := ARRAY['student_mistakes','concept_mastery','practice_sessions',
                           'question_attempts','student_question_history','revision_queue'];
  _demo    uuid := '00000000-0000-4000-8000-000000000001';
  _scale   uuid := '00000000-0000-4000-8000-000000000002';
  t        text;
  _uid     uuid;
  _n       bigint;
  _h_before text;
  _h_after  text;
  _q       text;
  _fail    text := '';
  _pairs   int := 0;
BEGIN

  -- ═════════════════════════════════════════════════════════════════
  -- 1. Shape: still a fence, and the NULL arm is gone.
  --
  -- A fence downgraded to PERMISSIVE grants instead of constrains, and would
  -- pass every timing and set-equality check while opening the table.
  -- ═════════════════════════════════════════════════════════════════
  FOREACH t IN ARRAY _tables LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO _q
      FROM pg_policy p
     WHERE p.polrelid = format('public.%I', t)::regclass
       AND p.polname = t || '_tenant_fence'
       AND NOT p.polpermissive
       AND p.polcmd = '*'
       AND p.polwithcheck IS NOT NULL
       AND pg_get_expr(p.polqual, p.polrelid) = pg_get_expr(p.polwithcheck, p.polrelid);

    IF _q IS NULL THEN
      _fail := _fail || format('(FAIL) item 1: %s has no RESTRICTIVE FOR ALL fence with a matching WITH CHECK. ', t);
    ELSE
      IF _q LIKE '%same_school%' THEN
        _fail := _fail || format('(FAIL) item 1: %s still calls same_school per row. ', t);
      END IF;
      IF _q NOT LIKE '%my_accessible_school_ids%' THEN
        _fail := _fail || format('(FAIL) item 1: %s does not use the set helper. ', t);
      END IF;
      IF _q LIKE '%IS NULL%' THEN
        _fail := _fail || format('(FAIL) item 1: %s kept the IS NULL arm, so a NULL-school row is visible to every tenant. ', t);
      END IF;
    END IF;

    -- The IS NULL arm is only safe to remove if a NULL cannot be written.
    SELECT count(*) INTO _n
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name=t AND column_name='school_id' AND is_nullable='NO';
    IF _n <> 1 THEN
      _fail := _fail || format('(FAIL) item 1: %s.school_id is still nullable, so the dropped IS NULL arm leaves rows unreachable by their own owner. ', t);
    END IF;
  END LOOP;


  -- ═════════════════════════════════════════════════════════════════
  -- 2. §10.8 — practice is readable by the student and NOBODY else.
  --
  -- The rows are live and in these roles' own institution, so each zero is
  -- the policy refusing, not an empty table. Item 5 proves that distinction
  -- is real rather than assumed.
  -- ═════════════════════════════════════════════════════════════════
  FOREACH t IN ARRAY _tables LOOP
    FOR _uid IN
      SELECT u.id FROM auth.users u
       WHERE u.email IN ('admin@wisdomcampus.com','principal@wisdomcampus.com',
                         'priya.sharma@wisdomcampus.com','mehta.parent@wisdomcampus.com')
    LOOP
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO _n;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);
      _pairs := _pairs + 1;

      IF _n <> 0 THEN
        _fail := _fail || format('(FAIL) item 2: a non-student role reads %s rows of %s. ', _n, t);
      END IF;
    END LOOP;
  END LOOP;

  IF _pairs = 0 THEN
    _fail := _fail || '(FAIL) item 2: zero role/table pairs were checked, so the zeros above prove nothing. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════
  -- 3. The student still reads their OWN practice.
  --
  -- Without this half, item 2 passes trivially on a fence that locked
  -- everyone out — over-fencing looks identical to correct fencing if you
  -- only ever assert zero.
  -- ═════════════════════════════════════════════════════════════════
  SELECT id INTO _uid FROM auth.users WHERE email = 'arjun.mehta@wisdomcampus.com';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.student_mistakes;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _n = 0 THEN
    _fail := _fail || '(FAIL) item 3: the student cannot read their own mistake book. The fence was over-tightened. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════
  -- 4. Cross-institution isolation AT VOLUME.
  --
  -- The scale institution holds thousands of practice rows. No demo-school
  -- role, including the demo student, may see one of them.
  -- ═════════════════════════════════════════════════════════════════
  SELECT count(*) INTO _n FROM public.question_attempts WHERE school_id = _scale;
  IF _n < 2000 THEN
    _fail := _fail || format('(FAIL) item 4: only %s scale-institution attempts exist, so isolation is not tested at volume. ', _n);
  END IF;

  SELECT id INTO _uid FROM auth.users WHERE email = 'arjun.mehta@wisdomcampus.com';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.question_attempts WHERE school_id = _scale;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _n <> 0 THEN
    _fail := _fail || format('(FAIL) item 4: the demo student sees %s attempt(s) from the other institution. ', _n);
  END IF;


  -- ═════════════════════════════════════════════════════════════════
  -- 5. NEGATIVE CONTROL — can item 2 actually fail?
  --
  -- "A gate never seen to fail is a gate never seen to work."
  --
  -- Give the teacher a real way in to student_mistakes and confirm the check
  -- notices. If it does not, every zero above was meaningless.
  -- ═════════════════════════════════════════════════════════════════
  SELECT id INTO _uid FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), coalesce(md5(string_agg(h, ',' ORDER BY h)), '-') INTO _n, _h_before
    FROM (SELECT md5(x::text) AS h FROM public.student_mistakes x) s;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _n <> 0 THEN
    _fail := _fail || '(FAIL) item 5 setup: the teacher already reads the mistake book before the hole was opened. ';
  END IF;

  EXECUTE 'CREATE POLICY sm_negctl ON public.student_mistakes FOR SELECT TO authenticated USING (true)';

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), coalesce(md5(string_agg(h, ',' ORDER BY h)), '-') INTO _n, _h_after
    FROM (SELECT md5(x::text) AS h FROM public.student_mistakes x) s;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  EXECUTE 'DROP POLICY sm_negctl ON public.student_mistakes';

  IF _n = 0 OR _h_after IS NOT DISTINCT FROM _h_before THEN
    _fail := _fail ||
      '(FAIL) item 5: a wide-open SELECT policy was added and the teacher still read nothing. '
      || 'The check cannot detect a hole, so item 2 proves nothing. ';
  END IF;

  -- The tenant fence is RESTRICTIVE, so even with that permissive hole open
  -- the teacher may only reach rows of their OWN institution. Confirm the
  -- fence did its half: the scale institution stays invisible regardless.
  IF _n >= (SELECT count(*) FROM public.student_mistakes) THEN
    _fail := _fail ||
      '(FAIL) item 5: with the permissive hole open the teacher saw EVERY row including the other institution — the RESTRICTIVE fence is not holding. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════
  IF _fail <> '' THEN
    RAISE EXCEPTION 'CHUNK7B_BATCH2_VERIFY — AT LEAST ONE CHECK FAILED: %', _fail;
  END IF;

  RAISE EXCEPTION
    'CHUNK7B_BATCH2_VERIFY_OK — 6 fences, % role/table privacy pairs, isolation at volume, negative control fired; rolling back.',
    _pairs;
END
$verify$;
