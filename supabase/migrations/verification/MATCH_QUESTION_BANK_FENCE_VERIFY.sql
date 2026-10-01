-- ═══════════════════════════════════════════════════════════════════════════
-- match_question_bank — the board fence, on every path that reaches it
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE, so
-- the cross-board fixture never commits.
--
-- WHY THIS FILE EXISTS, stated plainly, because it is the point:
--
-- This function's tenant fence was a predicate referencing a column that did not
-- exist. Every call threw 42703, so the fence never ran, and "the leak is
-- closed" was true only because the function was dead. Repairing the column made
-- the control execute for the first time — and measurement then showed it held
-- for `authenticated` and not at all for `service_role`, which bypasses RLS and
-- is the only caller the repository actually has.
--
-- Two failure modes therefore have to stay covered, forever:
--
--   1. the fence stops excluding the other board          — the leak returns
--   2. the function stops returning anything at all       — which LOOKS like 1
--
-- So every check below is paired with an own-board control. A pass requires the
-- cross-board row to be absent AND the same-board row to be present. Without the
-- second half, a function that throws on every call reports a clean fence, which
-- is exactly the state this whole thread began in.
--
-- Since 20261049000000 a student reads the bank only through the
-- question_bank_student view: RLS on question_bank admits staff and super
-- admins, nobody else. So a signed-in STUDENT now receives nothing at all from
-- this (invoker) function — item 2b — and the signed-in path where the body is
-- the only fence is a TEACHER, whom qb_staff_read admits to every board: item 2.
-- (Revised 2026-10-01, KNOWN_ISSUES 64: item 2 still expected the student to
-- receive the own-board row, which by design they no longer can.)
--
-- MATCH_QUESTION_BANK_FENCE_VERIFY_OK means every item ran and passed.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  _uid       uuid;
  _teacher   uuid;
  _school    uuid;
  _board     text;
  _other     text;
  _src       public.question_bank%ROWTYPE;
  _fix       uuid := gen_random_uuid();
  _role      text;
  _cross     int;
  _ctl       int;
  _staff     boolean;
  _fail      text := '';
BEGIN

  SELECT u.id INTO _uid FROM auth.users u WHERE u.email = 'arjun.mehta@wisdomcampus.com';
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'MQB_FENCE_VERIFY: demo student missing; cannot verify as a real role.';
  END IF;
  SELECT st.school_id INTO _school FROM public.students st WHERE st.user_id = _uid;
  SELECT s.board INTO _board FROM public.schools s WHERE s.id = _school;
  IF _board IS NULL THEN
    RAISE EXCEPTION 'MQB_FENCE_VERIFY: the demo school has no board, so there is nothing to fence on and every check below would be vacuous.';
  END IF;
  _other := CASE WHEN _board = 'cbse' THEN 'rbse' ELSE 'cbse' END;

  -- The student must not be staff (item 2b asks what a non-staff caller gets),
  -- and the teacher must be staff OF THIS SCHOOL (item 2 relies on RLS
  -- admitting them to every board, leaving the body as the only fence).
  SELECT (public.is_principal_or_admin(_uid)
          OR public.has_role(_uid, 'teacher'::public.app_role)) INTO _staff;
  IF _staff THEN
    RAISE EXCEPTION 'MQB_FENCE_VERIFY: the student probe account is staff; item 2b would be measuring the wrong policy.';
  END IF;
  SELECT u.id INTO _teacher FROM auth.users u
    JOIN public.teachers t ON t.user_id = u.id AND t.school_id = _school
   WHERE u.email = 'priya.sharma@wisdomcampus.com';
  -- Membership, not has_role(): has_role reads the session's active membership
  -- and is false outside the teacher's own signed-in context.
  IF _teacher IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.memberships m
        WHERE m.account_id = _teacher AND m.school_id = _school
          AND m.role = 'teacher'::public.app_role AND m.status = 'active') THEN
    RAISE EXCEPTION 'MQB_FENCE_VERIFY: the demo teacher of the student''s school is missing; item 2 cannot run.';
  END IF;

  SELECT * INTO _src FROM public.question_bank qb
   WHERE qb.is_approved AND qb.is_active AND qb.embed_status = 'embedded'
     AND qb.embedding IS NOT NULL AND qb.board = _board
   ORDER BY qb.created_at LIMIT 1;
  IF _src.id IS NULL THEN
    RAISE EXCEPTION 'MQB_FENCE_VERIFY: no same-board embedded row exists to use as a control; every check below would pass on an empty result.';
  END IF;

  -- Byte-identical embedding. Similarity is 1.0 for the fixture and for the
  -- control, so ranking, the threshold and the LIMIT can never be what separates
  -- them. Only a fence can. The topic is the control's own topic_id: the text
  -- `topic` column was dropped by 20261020010000, and naming it rotted this file.
  INSERT INTO public.question_bank
    (id, class_level, subject, chapter, topic_id, difficulty, question, options,
     correct_index, explanation, source, is_approved, is_active, board,
     embedding, embed_status, chapter_id)
  VALUES
    (_fix, _src.class_level, _src.subject, _src.chapter, _src.topic_id, _src.difficulty,
     'VERIFY cross-board row', _src.options, _src.correct_index, _src.explanation,
     'verify-fence', true, true, _other,
     _src.embedding, 'embedded', _src.chapter_id);


  -- ═════════════════════════════════════════════════════════════════════
  -- 1. service_role — the path aiRouter.ts actually takes. rolbypassrls is
  --    true here, so RLS contributes nothing and the body predicate is the
  --    only fence in existence.
  -- ═════════════════════════════════════════════════════════════════════
  SET LOCAL ROLE service_role;
  _role := current_user;
  SELECT count(*) FILTER (WHERE m.id = _fix), count(*) FILTER (WHERE m.id = _src.id)
    INTO _cross, _ctl
    FROM public.match_question_bank(_src.embedding, _src.class_level, _school, NULL, 0.0, 50) m;
  RESET ROLE;

  IF _role <> 'service_role' THEN
    _fail := _fail || format('(FAIL) 1: probe ran as %s, not service_role — the result says nothing. ', _role);
  END IF;
  IF _cross <> 0 THEN
    _fail := _fail || '(FAIL) 1: service_role received a question from another board. RLS does not apply to it; the fence must be in the body. ';
  END IF;
  IF _ctl <> 1 THEN
    _fail := _fail || '(FAIL) 1: service_role did not receive the OWN-board control row, so a zero cross-board count proves nothing. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 2. authenticated, as a TEACHER — qb_staff_read admits staff to the whole
  --    bank whatever its board, so RLS fences nothing here and the body
  --    predicate is, again, the only fence.
  -- ═════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _role := current_user;
  SELECT count(*) FILTER (WHERE m.id = _fix), count(*) FILTER (WHERE m.id = _src.id)
    INTO _cross, _ctl
    FROM public.match_question_bank(_src.embedding, _src.class_level, _school, NULL, 0.0, 50) m;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _role <> 'authenticated' THEN
    _fail := _fail || format('(FAIL) 2: probe ran as %s, not authenticated. ', _role);
  END IF;
  IF _cross <> 0 THEN
    _fail := _fail || '(FAIL) 2: a signed-in teacher received a question from another board. ';
  END IF;
  IF _ctl <> 1 THEN
    _fail := _fail || '(FAIL) 2: the teacher did not receive the OWN-board control row. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 2b. authenticated, as a STUDENT — receives nothing at all: the bank is
  --     read through question_bank_student (20261049000000). Items 1 and 2
  --     are the controls: the same call returns the own-board row to callers
  --     the table admits.
  -- ═════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) FILTER (WHERE m.id = _fix), count(*) FILTER (WHERE m.id = _src.id)
    INTO _cross, _ctl
    FROM public.match_question_bank(_src.embedding, _src.class_level, _school, NULL, 0.0, 50) m;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _cross <> 0 OR _ctl <> 0 THEN
    _fail := _fail || format('(FAIL) 2b: a signed-in student read the bank directly (cross=%s own=%s). ', _cross, _ctl);
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 3. An unknown school narrows, it does not open. G14: no degraded path
  --    may drop a security predicate. Passing NULL must leave only the
  --    board-agnostic rows, never the whole bank.
  -- ═════════════════════════════════════════════════════════════════════
  SET LOCAL ROLE service_role;
  SELECT count(*) FILTER (WHERE m.id = _fix), count(*) FILTER (WHERE m.id = _src.id)
    INTO _cross, _ctl
    FROM public.match_question_bank(_src.embedding, _src.class_level, NULL, NULL, 0.0, 50) m;
  RESET ROLE;

  IF _cross <> 0 OR _ctl <> 0 THEN
    _fail := _fail || format(
      '(FAIL) 3: p_school_id => NULL returned board-specific rows (cross=%s own=%s). An unknown school must fail closed. ',
      _cross, _ctl);
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 4. NEGATIVE CONTROL for this file itself. Remove the board condition
  --    from the same query and the cross-board row MUST reappear. If it does
  --    not, items 1-3 are being passed by something other than the fence —
  --    an empty table, a failed insert, a threshold — and their green is
  --    meaningless.
  -- ═════════════════════════════════════════════════════════════════════
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO _cross
    FROM public.question_bank qb
   WHERE qb.embed_status = 'embedded' AND qb.is_active AND qb.is_approved
     AND qb.class_level = _src.class_level
     AND (1 - (qb.embedding <=> _src.embedding)) >= 0.0
     AND qb.id = _fix;
  RESET ROLE;

  IF _cross <> 1 THEN
    _fail := _fail || '(FAIL) 4: with the board condition removed the cross-board row still does not appear, so items 1-3 were not testing the fence. ';
  END IF;


  IF _fail <> '' THEN
    RAISE EXCEPTION E'MATCH_QUESTION_BANK_FENCE_VERIFY — AT LEAST ONE CHECK FAILED\n%', _fail;
  END IF;

  RAISE EXCEPTION
    'MATCH_QUESTION_BANK_FENCE_VERIFY_OK — 5/5 passed (service_role fenced, a teacher fenced by the body, a student reads nothing, NULL school fails closed, negative control fires). Rolling back.';
END
$verify$;
