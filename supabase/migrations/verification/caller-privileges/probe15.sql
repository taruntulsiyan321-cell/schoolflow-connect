-- probe15: the question_bank author fence, as the caller.
--
-- 20260906030000 added ownership to the three question_bank write policies,
-- which previously asked only "is the caller staff" -- no owner, no school. Any
-- teacher at any school could edit or delete any of the 21,696 reference rows.
--
-- Reading is NOT fenced and must not become fenced: §10.9 (locked-decisions.md:385)
-- says the bank is "Centralised and shared across all schools and all users".
-- Claims 9-11 are the controls that would catch a policy which merely refused
-- everybody, or which quietly turned the shared bank into a per-school one
-- (rule 8).
--
-- THE CLAIMS
--   1. a teacher cannot DELETE a reference row (created_by IS NULL).
--   2. a teacher cannot UPDATE a reference row.
--   3. a teacher cannot INSERT a row attributed to somebody else.
--   4. a teacher CAN insert their own contribution.          (positive control)
--   5. a second teacher cannot UPDATE the first one's contribution.
--   6. a second teacher cannot DELETE the first one's contribution.
--   7. the author CAN update their own.                      (positive control)
--   8. the author CAN delete their own.                      (positive control)
--   9. the school-B teacher really resolves to school B.     (fixture control)
--  10. a teacher at ANOTHER SCHOOL still reads the shared bank. (§10.9 control)
--  11. ...including the reference seed.                      (§10.9 control)
--  12. match_question_bank is CALLABLE by a teacher -- the retrieval half of
--      the MCQ path, proven by calling it rather than by reading its grant.
--
-- Every write is rolled back. The school-B teacher is built inside this
-- transaction because school B holds no memberships at all; active_membership_id()
-- branch 3 resolves it straight from `memberships`, so no session row is needed.
BEGIN;
SET LOCAL statement_timeout = '60s';
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
  t1      uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  t2      uuid := 'd1000002-0002-4000-8000-000000000002';  -- a 2nd teacher, school A
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';  -- school A (rbse)
  sch_b   uuid := '00000000-0000-4000-8000-000000000002';  -- school B (rbse)
  tb      uuid;   -- an unattached account, made a school-B teacher below
  ref_d   uuid;   -- a reference seed row, for the DELETE claim
  ref_u   uuid;   -- a DIFFERENT one, for the UPDATE and read claims
  chap    uuid;   -- a real chapter_id: question_bank_active_must_be_keyed
  mine    uuid;   -- t1's own contribution
  r text;
BEGIN
  -- Two distinct reference rows on purpose. Against the UNFENCED database the
  -- delete claim SUCCEEDS, and if the update and read claims shared that row
  -- they would then measure a row that claim 1 had already removed and report
  -- a fence that was not there. Measured: that is exactly what happened.
  SELECT id, chapter_id INTO ref_d, chap FROM public.question_bank
   WHERE created_by IS NULL AND is_approved AND board = 'rbse' AND chapter_id IS NOT NULL
   ORDER BY created_at, id LIMIT 1;
  SELECT id INTO ref_u FROM public.question_bank
   WHERE created_by IS NULL AND is_approved AND board = 'rbse' AND id <> ref_d
   ORDER BY created_at, id LIMIT 1;
  IF ref_d IS NULL OR ref_u IS NULL OR chap IS NULL THEN
    RAISE EXCEPTION 'probe15: could not find two keyed reference rows to test with';
  END IF;

  -- 1. reference seed: DELETE refused.
  -- RLS filters rather than raising, so the evidence is "0 rows affected AND
  -- the row is still there" rather than an exception.
  r := pg_temp.as_user(t1, format(
        'WITH d AS (DELETE FROM public.question_bank WHERE id=%L RETURNING 1) SELECT count(*)::text FROM d', ref_d));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('qb delete a REFERENCE row','teacher (school A)','OK: 0 and row survives',
     r || ' / row still there: ' || (SELECT count(*) FROM public.question_bank WHERE id=ref_d)::text,
     CASE WHEN r = 'OK: 0' AND (SELECT count(*) FROM public.question_bank WHERE id=ref_d) = 1
          THEN 'PASS' ELSE 'FAIL' END);

  -- 2. reference seed: UPDATE refused.
  r := pg_temp.as_user(t1, format(
        'WITH u AS (UPDATE public.question_bank SET explanation=$x$tampered$x$ WHERE id=%L RETURNING 1) SELECT count(*)::text FROM u', ref_u));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('qb update a REFERENCE row','teacher (school A)','OK: 0',r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- 3. cannot attribute a contribution to somebody else.
  r := pg_temp.as_user(t1, format(
        'WITH i AS (INSERT INTO public.question_bank (subject,question,options,correct_index,created_by,board,class_level,chapter_id) '
        'VALUES ($x$Accountancy$x$,$x$probe15 forged$x$,$x$["a","b","c","d"]$x$::jsonb,0,%L,$x$rbse$x$,12,%L) RETURNING 1) '
        'SELECT count(*)::text FROM i', t2, chap));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('qb insert attributed to ANOTHER teacher','teacher (school A)','ERROR row-level security',r,
     CASE WHEN r LIKE 'ERROR%row-level security%' THEN 'PASS' ELSE 'FAIL' END);

  -- 4. own contribution inserts (positive control).
  r := pg_temp.as_user(t1, format(
        'WITH i AS (INSERT INTO public.question_bank (subject,question,options,correct_index,created_by,board,class_level,chapter_id) '
        'VALUES ($x$Accountancy$x$,$x$probe15 mine$x$,$x$["a","b","c","d"]$x$::jsonb,0,%L,$x$rbse$x$,12,%L) RETURNING id) '
        'SELECT id::text FROM i', t1, chap));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('qb insert OWN contribution (positive control)','teacher (school A)','OK: a uuid',r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);
  SELECT id INTO mine FROM public.question_bank WHERE question = 'probe15 mine';

  -- 5. another teacher cannot UPDATE it.
  r := pg_temp.as_user(t2, format(
        'WITH u AS (UPDATE public.question_bank SET explanation=$x$tampered$x$ WHERE id=%L RETURNING 1) SELECT count(*)::text FROM u', mine));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('qb update ANOTHER teacher contribution','teacher 2 (same school)','OK: 0',
     r || ' / explanation: ' || coalesce((SELECT explanation FROM public.question_bank WHERE id=mine),'null'),
     CASE WHEN r = 'OK: 0'
           AND coalesce((SELECT explanation FROM public.question_bank WHERE id=mine),'') <> 'tampered'
          THEN 'PASS' ELSE 'FAIL' END);

  -- 6. another teacher cannot DELETE it.
  r := pg_temp.as_user(t2, format(
        'WITH d AS (DELETE FROM public.question_bank WHERE id=%L RETURNING 1) SELECT count(*)::text FROM d', mine));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('qb delete ANOTHER teacher contribution','teacher 2 (same school)','OK: 0 and row survives',
     r || ' / row still there: ' || (SELECT count(*) FROM public.question_bank WHERE id=mine)::text,
     CASE WHEN r = 'OK: 0' AND (SELECT count(*) FROM public.question_bank WHERE id=mine) = 1
          THEN 'PASS' ELSE 'FAIL' END);

  -- 7. the author still can update (positive control).
  r := pg_temp.as_user(t1, format(
        'WITH u AS (UPDATE public.question_bank SET explanation=$x$by the author$x$ WHERE id=%L RETURNING 1) SELECT count(*)::text FROM u', mine));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('qb author updates their OWN row (positive control)','teacher (school A)','OK: 1',
     r || ' / explanation: ' || coalesce((SELECT explanation FROM public.question_bank WHERE id=mine),'null'),
     CASE WHEN r = 'OK: 1'
           AND (SELECT explanation FROM public.question_bank WHERE id=mine) = 'by the author'
          THEN 'PASS' ELSE 'FAIL' END);

  -- 8. the author still can delete (positive control).
  r := pg_temp.as_user(t1, format(
        'WITH d AS (DELETE FROM public.question_bank WHERE id=%L RETURNING 1) SELECT count(*)::text FROM d', mine));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('qb author deletes their OWN row (positive control)','teacher (school A)','OK: 1 and row gone',
     r || ' / rows now: ' || (SELECT count(*) FROM public.question_bank WHERE id=mine)::text,
     CASE WHEN r = 'OK: 1' AND (SELECT count(*) FROM public.question_bank WHERE id=mine) = 0
          THEN 'PASS' ELSE 'FAIL' END);

  -- 9-11. the bank is still SHARED across schools -- §10.9.
  -- School B holds no memberships at all, so a school-B teacher is made here by
  -- granting one to an account that has NO membership and no student/teacher/
  -- parent/profile tie anywhere -- otherwise get_my_school_id() would fall
  -- through to an existing school-A row and claim 9 would silently test the
  -- wrong school. A fresh auth.users row is NOT an option: handle_new_user()
  -- fires link_portal_on_auth() and raises "Cannot link portal for another user".
  -- Claim 9 is the control that this fixture is really at school B.
  SELECT a.id INTO tb
    FROM public.accounts a
   WHERE NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.account_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.students  s WHERE s.user_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.teachers  t WHERE t.user_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.parents   p WHERE p.user_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = a.id AND pr.school_id IS NOT NULL)
   ORDER BY a.id LIMIT 1;
  IF tb IS NULL THEN
    RAISE EXCEPTION 'probe15: no unattached account to make a school-B teacher from';
  END IF;
  INSERT INTO public.memberships (account_id, school_id, role, status)
    VALUES (tb, sch_b, 'teacher', 'active') ON CONFLICT DO NOTHING;

  r := pg_temp.as_user(tb, 'SELECT public.get_my_school_id()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('school-B teacher resolves to school B (fixture control)','teacher (school B)','OK: '||sch_b::text,r,
     CASE WHEN r = 'OK: '||sch_b::text THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(tb, 'SELECT (count(*) > 20000)::text FROM public.question_bank WHERE is_approved');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.9 bank still shared ACROSS schools','teacher (school B)','OK: true',r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(tb, format('SELECT count(*)::text FROM public.question_bank WHERE id=%L', ref_u));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.9 reference seed readable at another school','teacher (school B)','OK: 1',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);
  -- 12. match_question_bank is REACHABLE from a teacher context.
  -- The `embed` edge function is only half of MCQ retrieval; the other half is
  -- this RPC, which takes the pre-computed vector. It is STABLE and NOT
  -- SECURITY DEFINER, and `authenticated` holds EXECUTE directly rather than
  -- only through PUBLIC -- but reading a grant is not the same as being able
  -- to call it, so it is CALLED here with a real 1536-dim vector.
  -- The caller's OWN school is passed, not NULL. match_question_bank fences on
  -- BOARD via `board = (SELECT board FROM schools WHERE id = p_school_id)`, and
  -- passing NULL narrows the result to board-agnostic rows rather than opening
  -- it (G14, deliberate) -- which returned 0 and would have made this assertion
  -- pass while exercising an empty path. All 21,696 rows are embedded, so the
  -- real path returns the full LIMIT.
  -- pgvector's input syntax is [a,b,c], not Postgres's own {a,b,c}, so the
  -- literal is built rather than cast from an array. 0.01 rather than 0.0
  -- because a zero vector has zero norm and cosine distance against it is
  -- undefined -- that would fail for a reason that has nothing to do with
  -- permission, which is the only thing this claim is about.
  r := pg_temp.as_user(t1,
        'SELECT count(*)::text FROM public.match_question_bank('
        || '($x$[$x$ || array_to_string(array_fill(0.01::real, ARRAY[1536]), $x$,$x$) || $x$]$x$)::vector, '
        || format('12, %L::uuid, ARRAY[$x$Accountancy$x$], 0.0::float8, 5)', sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('match_question_bank callable by a teacher','teacher (school A)','OK: 5 rows back',r,
     CASE WHEN r = 'OK: 5' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
