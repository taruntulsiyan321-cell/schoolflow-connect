-- ═══════════════════════════════════════════════════════════════════════════
-- NO CLIENT WRITES THROUGH A VIEW
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Found 2026-10-13 by Supabase's security advisor (security_definer_view) and
-- confirmed as a real student, in a rolled-back transaction:
--
--   UPDATE public.question_bank_student SET question = … WHERE id = …   ALLOWED
--   DELETE FROM public.question_bank_student WHERE id = …              ALLOWED
--
-- question_bank_student is the students' door into the shared bank. It reads
-- one table with no aggregate, so PostgreSQL makes it automatically updatable;
-- it runs with its owner's rights (deliberately — students cannot read
-- question_bank itself), so RLS on question_bank does not apply to writes
-- through it; and `authenticated` held every privilege on it. Any signed-in
-- account could rewrite or delete any question through PATCH/DELETE on
-- /rest/v1/question_bank_student.
--
-- No view here is written through by anyone: the app and the edge functions
-- only read them (measured: no .update/.insert/.upsert/.delete on any view).
-- So the rule is general, not one view's patch: a client role (anon,
-- authenticated) holds at most SELECT on a view. Two views already had exactly
-- that (homework_completion, homework_student_status); five held everything.
-- caller-privileges probe52 keeps it so for views created later.
--
-- ROLLBACK: rollback/20261159000000_no_client_writes_through_a_view.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- What a student could do before, measured inside a sub-block that is undone.
CREATE TEMP TABLE e9_before (k text PRIMARY KEY, v text);

DO $before$
DECLARE
  _acct uuid; _qid uuid; _upd text := 'no rows'; _del text := 'no rows';
BEGIN
  SELECT ea.account_id INTO _acct FROM public.exam_accounts ea ORDER BY ea.account_id LIMIT 1;
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: no exam account to prove with';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
  -- a question THIS student sees (the view filters by the caller's exam)
  SET LOCAL ROLE authenticated;
  SELECT q.id INTO _qid FROM public.question_bank_student q ORDER BY q.id LIMIT 1;
  RESET ROLE;
  IF _qid IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: the student sees no question to prove with';
  END IF;
  BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE public.question_bank_student SET question = question || ' [probe]' WHERE id = _qid;
      IF FOUND THEN _upd := 'allowed'; END IF;
    EXCEPTION WHEN insufficient_privilege THEN _upd := 'refused';
    END;
    BEGIN
      DELETE FROM public.question_bank_student WHERE id = _qid;
      IF FOUND THEN _del := 'allowed'; END IF;
    EXCEPTION WHEN insufficient_privilege THEN _del := 'refused';
    END;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P9E09';
  EXCEPTION WHEN SQLSTATE 'P9E09' THEN NULL;
  END;
  RESET ROLE;
  INSERT INTO e9_before VALUES ('update', _upd), ('delete', _del), ('account', _acct::text), ('question', _qid::text);
END $before$;

-- ── The rule: a client role holds at most SELECT on a view ─────────────────
DO $revoke$
DECLARE _v regclass;
BEGIN
  FOR _v IN
    SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON %s FROM PUBLIC, anon, authenticated', _v);
  END LOOP;
END $revoke$;

-- ── PROOF ───────────────────────────────────────────────────────────────────
DO $proof$
DECLARE
  _acct uuid := (SELECT v::uuid FROM e9_before WHERE k = 'account');
  _qid  uuid := (SELECT v::uuid FROM e9_before WHERE k = 'question');
  _upd text := 'allowed'; _del text := 'allowed'; _ins text := 'allowed';
  _seen int; _left int; _len_before int; _len_after int;
BEGIN
  -- CONTROL: the hole was real, so "refused" below means something.
  IF (SELECT v FROM e9_before WHERE k = 'update') <> 'allowed' OR (SELECT v FROM e9_before WHERE k = 'delete') <> 'allowed' THEN
    RAISE EXCEPTION 'VERIFY FAILED: the write was not reproducible before the fix (%, %), so its refusal proves nothing',
      (SELECT v FROM e9_before WHERE k = 'update'), (SELECT v FROM e9_before WHERE k = 'delete');
  END IF;

  SELECT length(question) INTO _len_before FROM public.question_bank WHERE id = _qid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- Only a privilege refusal counts as refused: any other error (a constraint,
  -- say) means the privilege check let the write through.
  BEGIN
    UPDATE public.question_bank_student SET question = question || ' [probe]' WHERE id = _qid;
  EXCEPTION WHEN insufficient_privilege THEN _upd := 'refused';
            WHEN OTHERS THEN _upd := 'allowed, then ' || SQLSTATE;
  END;
  BEGIN
    DELETE FROM public.question_bank_student WHERE id = _qid;
  EXCEPTION WHEN insufficient_privilege THEN _del := 'refused';
            WHEN OTHERS THEN _del := 'allowed, then ' || SQLSTATE;
  END;
  BEGIN
    INSERT INTO public.question_bank_student (question) VALUES ('probe');
  EXCEPTION WHEN insufficient_privilege THEN _ins := 'refused';
            WHEN OTHERS THEN _ins := 'allowed, then ' || SQLSTATE;
  END;
  -- POSITIVE CONTROL: the student still reads the bank.
  BEGIN
    SELECT count(*) INTO _seen FROM public.question_bank_student;
  EXCEPTION WHEN insufficient_privilege THEN _seen := -1;
  END;
  RESET ROLE;
  SELECT length(question) INTO _len_after FROM public.question_bank WHERE id = _qid;

  IF _upd <> 'refused' OR _del <> 'refused' OR _ins <> 'refused' THEN
    RAISE EXCEPTION 'VERIFY FAILED: a student can still write through the view (update %, delete %, insert %)', _upd, _del, _ins;
  END IF;
  IF _len_after IS DISTINCT FROM _len_before THEN
    RAISE EXCEPTION 'VERIFY FAILED: the question changed (% -> %)', _len_before, _len_after;
  END IF;
  IF _seen < 100 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the student reads only % questions — reading broke', _seen;
  END IF;

  -- Structural: no client role holds anything but SELECT on any public view.
  SELECT count(*) INTO _left
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
         CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
   WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
     AND has_table_privilege(r.role, c.oid, p.priv);
  IF _left > 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % client write privileges remain on views', _left;
  END IF;
  -- and reading is unchanged where it was granted
  IF NOT has_table_privilege('authenticated', 'public.question_bank_student', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.students_current', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.trash', 'SELECT') THEN
    RAISE EXCEPTION 'VERIFY FAILED: SELECT was revoked too';
  END IF;
END $proof$;

DROP TABLE e9_before;

COMMIT;
