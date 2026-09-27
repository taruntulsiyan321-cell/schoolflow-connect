-- ===========================================================================
-- THE PRACTICE CATALOG ASKS NO ONE WHICH BOARD — OR EXAM — THEY STUDY.
--
-- rpc_practice_bank_catalog took `_board` and `_exam_id` from the client. Every
-- other student read of the bank goes through `question_bank_student`, which
-- derives both from the caller: the board from their school, the exam from
-- their own exam account. So "which board is this student" had two homes, and
-- the catalog's was whatever the request said (lint-tenant-scope's entry for
-- it, 2026-09-22: "the one-home fix … is a migration waiting on database
-- access"). Nothing private leaked — the counts are of a global bank — but a
-- caller could ask another board's counts, and the two homes could disagree:
-- the app defaults a school with no board to 'rbse', the view does not.
--
-- The fix drafted on 2026-09-22 was "derive the board from get_my_school_id()".
-- Since 20261046000000 an individual account studies an EXAM, not a board, so
-- that alone would be a third home. The one home is the view itself: the
-- catalog now reads FROM question_bank_student and takes its exam arm from the
-- caller's own exam account.
--
--   rpc_practice_bank_catalog(_class_level, _stream, _subject)   what the app calls
--   rpc_practice_bank_catalog(_class_level, _board, _stream,     the old door, kept
--                             _subject, _exam_id)                for installed builds
--
-- The Android app bundles its JavaScript (capacitor webDir: dist), so a phone
-- that has not updated still sends the five-argument call. That form stays, as
-- an invoker door into the same one home: it IGNORES the board and exam it is
-- sent. Drop it once no installed build predates this migration (KNOWN_ISSUES
-- 75).
--
-- `_class_level` and `_stream` stay parameters. They are not in the view's
-- scope — the section a student sits in is resolved by the app — and neither
-- can widen the read past the board or exam the view allows.
--
-- ROLLBACK: rollback/20261110000000_the_practice_catalog_asks_no_one_which_board_they_study.rollback.sql
-- ===========================================================================

BEGIN;

-- ── Before: what each real caller's catalog holds today ─────────────────────
-- Captured AS each caller (role authenticated + their JWT subject), with the
-- arguments the app sends, so the proof below compares like with like. The
-- `forged` rows are the CONTROL for "the board and exam are no longer taken
-- from the request": before, asking for another board or exam changed the
-- answer.
CREATE TEMP TABLE _catalog_before (
  who text PRIMARY KEY, sub uuid, class_level int, board text, stream text, exam_id uuid, rows jsonb
) ON COMMIT DROP;

DO $capture$
DECLARE
  _student constant uuid := 'd1000003-0001-4000-8000-000000000001';  -- Class 10-A, the fixture school
  _board   text;
  _probe   record;
  _acct    record;
  _forger  uuid;
  _other   uuid;
  _rows    jsonb;
BEGIN
  SELECT sc.board INTO _board
    FROM public.students s JOIN public.schools sc ON sc.id = s.school_id
   WHERE s.user_id = _student;
  IF _board IS NULL THEN
    RAISE EXCEPTION 'the fixture student has no school board to capture the old catalog with';
  END IF;

  -- A school student, at the class/stream pairs the app sends (no stream below
  -- 11), and once with a board that is not their school's.
  FOR _probe IN
    SELECT * FROM (VALUES ('school 10', 10, _board, NULL::text), ('school 11 commerce', 11, _board, 'commerce'),
                          ('school 12 commerce', 12, _board, 'commerce'), ('school 12', 12, _board, NULL),
                          ('forged board', 10, 'cbse', NULL)) v(who, lvl, brd, strm)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _student, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.subject, c.chapter) INTO _rows
      FROM public.rpc_practice_bank_catalog(_probe.lvl, _probe.brd, _probe.strm, NULL, NULL) c;
    RESET ROLE;
    INSERT INTO _catalog_before VALUES (_probe.who, _student, _probe.lvl, _probe.brd, _probe.strm, NULL, _rows);
  END LOOP;

  -- Every exam account, as the app asks: its own exam id and placeholders;
  -- and one account once more with an exam that is not its own.
  FOR _acct IN SELECT ea.account_id, ea.exam_id FROM public.exam_accounts ea LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _acct.account_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.subject, c.chapter) INTO _rows
      FROM public.rpc_practice_bank_catalog(0, 'cuet', NULL, NULL, _acct.exam_id) c;
    RESET ROLE;
    INSERT INTO _catalog_before VALUES ('exam ' || _acct.account_id, _acct.account_id, 0, 'cuet', NULL, _acct.exam_id, _rows);
  END LOOP;

  SELECT ea.account_id, (SELECT ce.id FROM public.competitive_exams ce WHERE ce.id <> ea.exam_id LIMIT 1)
    INTO _forger, _other
    FROM public.exam_accounts ea
    JOIN public.exam_syllabus_chapters s ON s.exam_id = ea.exam_id AND s.stream = ea.stream
   LIMIT 1;
  IF _other IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _forger, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.subject, c.chapter) INTO _rows
      FROM public.rpc_practice_bank_catalog(0, 'cuet', NULL, NULL, _other) c;
    RESET ROLE;
    INSERT INTO _catalog_before VALUES ('forged exam', _forger, 0, 'cuet', NULL, _other, _rows);
  END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);
END
$capture$;

-- ── The catalog, with one home for board and exam ───────────────────────────
CREATE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer DEFAULT NULL::integer,
  _stream text DEFAULT NULL::text,
  _subject text DEFAULT NULL::text
)
 RETURNS TABLE(subject text, chapter text, questions integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH mine AS (
    -- The caller's own exam account, when they are one (one per account).
    SELECT ea.exam_id, ea.stream
      FROM public.exam_accounts ea
     WHERE ea.school_id = (SELECT public.get_my_school_id())
  )
  SELECT qb.subject, qb.chapter, count(*)::int
    FROM public.question_bank_student qb
   WHERE qb.is_active
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
     AND CASE
       WHEN EXISTS (SELECT 1 FROM mine) THEN
         -- An exam account: its exam (the view) and its stream's syllabus.
         qb.exam_id IS NOT NULL
         AND qb.chapter_id IN (
           SELECT s.chapter_id
             FROM mine
             JOIN public.exam_syllabus_chapters s ON s.exam_id = mine.exam_id AND s.stream = mine.stream)
       ELSE
         -- A school student: their school's board (the view), their class.
         qb.exam_id IS NULL
         AND qb.class_level = _class_level
         AND (_stream IS NULL OR qb.stream = _stream OR qb.stream IS NULL)
     END
     AND (_subject IS NULL OR lower(qb.subject) = lower(_subject))
   GROUP BY qb.subject, qb.chapter
   ORDER BY qb.subject, qb.chapter
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text) TO authenticated;

COMMENT ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text) IS
  'Subjects and chapters a student can practise, with counts. Board and exam come from question_bank_student (the caller''s school and exam account), never from the request.';

-- The old door, for installed builds: the same catalog, whatever board or exam
-- it is sent. An invoker — the definer above is the only one that reads.
-- Named arguments, because positionally (_class_level, _board, _stream) would
-- also match this five-argument form and Postgres would refuse the call as
-- ambiguous.
CREATE OR REPLACE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer,
  _board text,
  _stream text DEFAULT NULL::text,
  _subject text DEFAULT NULL::text,
  _exam_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(subject text, chapter text, questions integer)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT c.subject, c.chapter, c.questions
    FROM public.rpc_practice_bank_catalog(_class_level => _class_level, _stream => _stream, _subject => _subject) c
$function$;

COMMENT ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text, uuid) IS
  'For app builds before 20261110000000 only. Ignores _board and _exam_id; answers as rpc_practice_bank_catalog(integer, text, text).';

-- ── Proof, as the same callers (each check can fail) ────────────────────────
DO $proof$
DECLARE
  _b      record;
  _new    jsonb;
  _old    jsonb;
  _full_school int := 0;
  _full_exam   int := 0;
  _own    jsonb;
BEGIN
  IF (SELECT string_agg(p.oid::regprocedure::text, ',' ORDER BY p.pronargs) FROM pg_proc p
       WHERE p.proname = 'rpc_practice_bank_catalog' AND p.pronamespace = 'public'::regnamespace)
     IS DISTINCT FROM 'rpc_practice_bank_catalog(integer,text,text),rpc_practice_bank_catalog(integer,text,text,text,uuid)' THEN
    RAISE EXCEPTION 'the catalog is not exactly the new form and the old door';
  END IF;
  IF has_function_privilege('anon', 'public.rpc_practice_bank_catalog(integer,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_practice_bank_catalog(integer,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_practice_bank_catalog(integer,text,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_practice_bank_catalog(integer,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the catalog grants are wrong: authenticated only, never anon';
  END IF;

  -- 1. Every caller sees exactly the catalog they saw before, through both doors.
  FOR _b IN SELECT * FROM _catalog_before WHERE who NOT LIKE 'forged %' LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b.sub, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.subject, c.chapter) INTO _new
      FROM public.rpc_practice_bank_catalog(_class_level => _b.class_level, _stream => _b.stream) c;
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.subject, c.chapter) INTO _old
      FROM public.rpc_practice_bank_catalog(_b.class_level, _b.board, _b.stream, NULL, _b.exam_id) c;
    RESET ROLE;
    IF _new IS DISTINCT FROM _b.rows THEN
      RAISE EXCEPTION '% sees a different catalog: % rows before, % after', _b.who,
        coalesce(jsonb_array_length(_b.rows), 0), coalesce(jsonb_array_length(_new), 0);
    END IF;
    IF _old IS DISTINCT FROM _b.rows THEN
      RAISE EXCEPTION '% sees a different catalog through the old door: % rows before, % after', _b.who,
        coalesce(jsonb_array_length(_b.rows), 0), coalesce(jsonb_array_length(_old), 0);
    END IF;
    IF coalesce(jsonb_array_length(_b.rows), 0) > 0 THEN
      IF _b.who LIKE 'exam %' THEN _full_exam := _full_exam + 1; ELSE _full_school := _full_school + 1; END IF;
    END IF;
  END LOOP;
  -- CONTROL: two empty catalogs are equal too, so each arm must have been
  -- compared on a caller who actually has one.
  IF _full_school = 0 OR _full_exam = 0 THEN
    RAISE EXCEPTION 'CONTROL: % school and % exam comparisons had rows — an arm is unproven', _full_school, _full_exam;
  END IF;

  -- 2. A forged board or exam no longer changes the answer. CONTROL: before
  -- this migration it did, or the check below would prove nothing.
  FOR _b IN SELECT * FROM _catalog_before WHERE who LIKE 'forged %' LOOP
    SELECT rows INTO _own FROM _catalog_before
     WHERE sub = _b.sub AND who NOT LIKE 'forged %' AND class_level = _b.class_level AND stream IS NOT DISTINCT FROM _b.stream;
    IF _b.rows IS NOT DISTINCT FROM _own THEN
      RAISE EXCEPTION 'CONTROL: % gave the caller''s own catalog even before — the forgery test proves nothing', _b.who;
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b.sub, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.subject, c.chapter) INTO _old
      FROM public.rpc_practice_bank_catalog(_b.class_level, _b.board, _b.stream, NULL, _b.exam_id) c;
    RESET ROLE;
    IF _old IS DISTINCT FROM _own THEN
      RAISE EXCEPTION '% still changes the catalog: the request is still a home for it', _b.who;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM _catalog_before WHERE who = 'forged board')
     OR NOT EXISTS (SELECT 1 FROM _catalog_before WHERE who = 'forged exam') THEN
    RAISE EXCEPTION 'a forgery was not probed';
  END IF;

  -- 3. The new defaults cannot widen a school student's read: with no class,
  -- nothing.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'd1000003-0001-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF EXISTS (SELECT 1 FROM public.rpc_practice_bank_catalog()) THEN
    RESET ROLE;
    RAISE EXCEPTION 'a school student with no class got a catalog — the class filter is gone';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261110000000_the_practice_catalog_asks_no_one_which_board_they_study')
ON CONFLICT (version) DO NOTHING;

COMMIT;
