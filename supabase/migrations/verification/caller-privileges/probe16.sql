-- probe16: contributions enter unapproved, and only their author retrieves them.
--
-- 20260907000000 defaulted `question_bank.is_approved` to FALSE and widened
-- `match_question_bank` to `is_approved OR created_by = auth.uid()`.
--
-- Before it, a teacher's contribution was student-visible AT EVERY SCHOOL on a
-- matching board the moment it saved, because `qb_select_approved_board` asks
-- only `is_approved AND board matches` and the bank has no school_id.
--
-- THE CLAIMS
--   1. the DEFAULT is false — a row inserted without naming `is_approved`
--      comes out unapproved.                                (the schema change)
--   2. the AUTHOR retrieves their own unapproved question.  (the ruling)
--   3. ANOTHER TEACHER does not.
--   4. a STUDENT of the author's own school does not.
--   5. an APPROVED row still reaches the author.        (positive control)
--   6. an APPROVED row still reaches a student at ANOTHER school on the same
--      board — the bank is still shared, §10.9.          (positive control)
--
-- 5 and 6 are what would catch a predicate that simply returned nothing, and 6
-- specifically would catch one that had quietly become per-school.
--
-- The test row is inserted WITH an embedding copied from a real row and
-- `embed_status='embedded'`, because match_question_bank filters on
-- `embed_status = 'embedded'` and a freshly inserted row is 'pending_embed' —
-- without that, every retrieval claim here would return 0 for a reason that has
-- nothing to do with approval, and claims 3 and 4 would PASS while proving
-- nothing.
--
-- Everything is rolled back.
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
  t1       uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  t2       uuid := 'd1000002-0002-4000-8000-000000000002';  -- 2nd teacher, school A
  stu_a    uuid := 'd1000003-0009-4000-8000-000000000009';  -- student, school A
  stu_b    uuid;                                            -- student, school B
  sch_a    uuid := '00000000-0000-4000-8000-000000000001';
  sch_b    uuid := '00000000-0000-4000-8000-000000000002';  -- also rbse
  src      uuid;   -- a real embedded row to borrow a vector and a chapter from
  chap     uuid;
  vec      text;   -- that row's embedding, as a pgvector literal
  mine     uuid;   -- t1's unapproved contribution
  call_sql text;
  r text;
BEGIN
  SELECT id, chapter_id, embedding::text INTO src, chap, vec
    FROM public.question_bank
   WHERE embed_status='embedded' AND is_active AND board='rbse'
     AND class_level=12 AND subject='Accountancy' AND chapter_id IS NOT NULL
     AND embedding IS NOT NULL
   ORDER BY id LIMIT 1;
  IF src IS NULL THEN
    RAISE EXCEPTION 'probe16: no embedded reference row to build the fixture from';
  END IF;

  -- ── 1. the DEFAULT ────────────────────────────────────────────────────
  -- `is_approved` is deliberately NOT named in this INSERT.
  INSERT INTO public.question_bank
    (subject, question, options, correct_index, created_by, board, class_level,
     chapter_id, embedding, embed_status)
  VALUES
    ('Accountancy','probe16 unapproved contribution','["a","b","c","d"]'::jsonb,0,
     t1,'rbse',12, chap, vec::vector, 'embedded')
  RETURNING id INTO mine;

  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'is_approved DEFAULT on a contribution','-','false',
         coalesce(is_approved::text,'null'),
         CASE WHEN is_approved = false THEN 'PASS' ELSE 'FAIL' END
    FROM public.question_bank WHERE id = mine;

  -- The retrieval call, reused verbatim for every caller below so the only
  -- thing that varies is WHO is asking. Threshold 0 and the source row's own
  -- vector, so similarity cannot be the reason anything is missing.
  call_sql := format(
    'SELECT count(*)::text FROM public.match_question_bank(%L::vector, 12, %%L::uuid, ARRAY[$x$Accountancy$x$], 0.0::float8, 200) m WHERE m.id = %L',
    vec, mine);

  -- ── 2. the AUTHOR retrieves their own unapproved question ─────────────
  r := pg_temp.as_user(t1, format(call_sql, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('own UNAPPROVED question is retrievable','author (teacher, school A)','OK: 1',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. another teacher does not ───────────────────────────────────────
  r := pg_temp.as_user(t2, format(call_sql, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('another teacher''s UNAPPROVED question','teacher 2 (same school)','OK: 0',r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. a student does not ─────────────────────────────────────────────
  r := pg_temp.as_user(stu_a, format(call_sql, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('UNAPPROVED question reaching a student','student (same school)','OK: 0',r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. approved rows still reach the author (positive control) ────────
  -- Without this, a predicate that returned nothing at all would pass 3 and 4.
  r := pg_temp.as_user(t1, format(
    format('SELECT count(*)::text FROM public.match_question_bank(%L::vector, 12, %%L::uuid, ARRAY[$x$Accountancy$x$], 0.0::float8, 200) m WHERE m.id = %L', vec, src),
    sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an APPROVED row still retrieves (positive control)','author (teacher, school A)','OK: 1',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. §10.9: approved rows still cross schools (positive control) ────
  -- School B holds no memberships at all, so the student is made here from an
  -- account with no membership and no student/teacher/parent/profile tie —
  -- otherwise get_my_school_id() would fall through to a school-A row and this
  -- would silently test the wrong school.
  SELECT a.id INTO stu_b
    FROM public.accounts a
   WHERE NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.account_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.students  s WHERE s.user_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.teachers  t WHERE t.user_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.parents   p WHERE p.user_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = a.id AND pr.school_id IS NOT NULL)
   ORDER BY a.id LIMIT 1;
  IF stu_b IS NULL THEN
    RAISE EXCEPTION 'probe16: no unattached account to make a school-B student from';
  END IF;
  INSERT INTO public.memberships (account_id, school_id, role, status)
    VALUES (stu_b, sch_b, 'student', 'active') ON CONFLICT DO NOTHING;

  r := pg_temp.as_user(stu_b, 'SELECT public.get_my_school_id()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('school-B student resolves to school B (fixture control)','student (school B)','OK: '||sch_b::text,r,
     CASE WHEN r = 'OK: '||sch_b::text THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(stu_b, format(
    format('SELECT count(*)::text FROM public.match_question_bank(%L::vector, 12, %%L::uuid, ARRAY[$x$Accountancy$x$], 0.0::float8, 200) m WHERE m.id = %L', vec, src),
    sch_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.9 APPROVED row still crosses schools','student (school B, same board)','OK: 1',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- and the unapproved one still does not cross.
  r := pg_temp.as_user(stu_b, format(call_sql, sch_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('UNAPPROVED question crossing schools','student (school B)','OK: 0',r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
