-- ═══════════════════════════════════════════════════════════════════════════
-- match_question_bank: the fence, on the path that actually exists
--
-- Yesterday's 20260830160000_fix_stale_column_refs.sql repaired the dead column
-- reference (`qb.school_id`, on a table that has never had that column) and said
-- of the predicate it removed:
--
--     "Removing the predicate is therefore not a loosening — it restores a
--      function to the behaviour RLS already governs."
--
-- That sentence is true for `authenticated` and FALSE for the only caller this
-- function has. It was reasoned from the function being SECURITY INVOKER; it was
-- not measured against the caller.
--
-- ── What was measured ─────────────────────────────────────────────────────
--
-- A cross-board row was inserted with an embedding byte-identical to a real
-- same-board row — so similarity is 1.0 for both and ranking cannot be what
-- separates them — and the repaired function was CALLED on both paths:
--
--            caller          rows   own-board control   CROSS-BOARD ROW
--     authenticated            50           1                  0
--     service_role             50           -                  1
--
-- `service_role` has rolbypassrls = true. `SECURITY INVOKER` means the policies
-- are evaluated as the caller — and this caller has none evaluated at all.
--
-- supabase/functions/_shared/aiRouter.ts calls it as `admin.rpc(...)`, the
-- service-role client. That is the ONLY caller in the repository. So the board
-- fence has never applied to a single real invocation of this function, on top
-- of the function having thrown 42703 on every one of them.
--
-- ── The rule this is an instance of ───────────────────────────────────────
--
-- "A fix that never executed is not a fix." The board predicate in
-- qb_select_approved_board was the fix for the match_question_bank cross-school
-- leak. Repairing the column made it run for the first time — and only on the
-- path no production call takes. Proving it works meant calling it, on both
-- paths, and one of the two answers was wrong.
--
-- It is also the fourth instance of Sweep 5's rule, which the doc states
-- outright: "RLS applies to authenticated and anon. It does not apply to
-- service_role." A SECURITY INVOKER function is not self-fencing; it inherits
-- whatever fence its caller has, and a service-role caller has none.
--
-- ── The fix ───────────────────────────────────────────────────────────────
--
-- The board test moves INTO the function body, where it holds regardless of who
-- calls it. It is the same test qb_select_approved_board makes, written against
-- p_school_id instead of get_my_school_id():
--
--     board IS NULL OR board = 'both' OR board = (the caller's school's board)
--
-- Three consequences worth stating rather than discovering later:
--
--   * p_school_id stops being vestigial. It is the parameter the original fix
--     named, against the column that never existed; it is now the parameter the
--     fence reads. aiRouter already passes req.actor.schoolId, typed `string`,
--     non-nullable.
--
--   * It fails CLOSED on a NULL or unknown p_school_id. The subselect yields
--     NULL, `board = NULL` is NULL, and only board-agnostic rows (NULL / 'both')
--     survive. There is deliberately no `p_school_id IS NULL OR …` escape: G14
--     — no degraded path may drop a security predicate. This mirrors the sibling
--     match_ai_answer_cache, which narrows to global rows the same way.
--
--   * An `authenticated` caller cannot widen it by passing someone else's school
--     id. RLS on `schools` hides that row from them, so the subselect returns
--     NULL and the result narrows rather than broadens.
--
-- The subselect depends only on a parameter, so it is an uncorrelated InitPlan
-- evaluated once, not per candidate row (G12).
--
-- Belt and braces, deliberately: authenticated keeps the RLS policy AND gains
-- the body predicate. They test the same thing by different means, and the
-- lesson of this migration is that one of the two can be silently absent.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Premise ───────────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='question_bank' AND column_name='school_id') THEN
    RAISE EXCEPTION 'question_bank.school_id EXISTS — the bank is no longer school-shared and this fence is the wrong shape.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='question_bank' AND column_name='board') THEN
    RAISE EXCEPTION 'question_bank.board does not exist — there is no board to fence on.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='schools' AND column_name='board') THEN
    RAISE EXCEPTION 'schools.board does not exist — the fence has nothing to compare against.';
  END IF;
  -- The policy this predicate mirrors. If it has been renamed or rewritten, the
  -- two fences are no longer saying the same thing and that must be looked at.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
     WHERE c.relname='question_bank' AND p.polname='qb_select_approved_board'
       AND pg_get_expr(p.polqual,p.polrelid) ~ 'board') THEN
    RAISE EXCEPTION 'qb_select_approved_board is gone or no longer tests board — re-derive the fence, do not assume it.';
  END IF;
END
$guard$;


-- ── Before: prove the leak is live, or the after-check proves nothing ──────
DO $before$
DECLARE
  _uid uuid; _school uuid; _board text;
  _src public.question_bank%ROWTYPE;
  _fix uuid := gen_random_uuid();
  _role text; _n int;
BEGIN
  SELECT u.id INTO _uid FROM auth.users u WHERE u.email='arjun.mehta@wisdomcampus.com';
  IF _uid IS NULL THEN RAISE EXCEPTION 'no demo student to measure with.'; END IF;
  SELECT st.school_id INTO _school FROM public.students st WHERE st.user_id=_uid;
  SELECT s.board INTO _board FROM public.schools s WHERE s.id=_school;

  SELECT * INTO _src FROM public.question_bank qb
   WHERE qb.is_approved AND qb.is_active AND qb.embed_status='embedded'
     AND qb.embedding IS NOT NULL AND qb.board = _board
   ORDER BY qb.created_at LIMIT 1;
  IF _src.id IS NULL THEN
    RAISE EXCEPTION 'no same-board embedded row exists, so nothing here can be measured.';
  END IF;

  -- Identical embedding: similarity 1.0 for both rows. Only a fence can separate
  -- them, never the ranking.
  INSERT INTO public.question_bank
    (id, class_level, subject, chapter, topic, difficulty, question, options,
     correct_index, explanation, source, is_approved, is_active, board,
     embedding, embed_status, chapter_id)
  VALUES
    (_fix, _src.class_level, _src.subject, _src.chapter, _src.topic, _src.difficulty,
     'FENCE PROBE cross-board row', _src.options, _src.correct_index, _src.explanation,
     'fence-probe', true, true,
     CASE WHEN _board = 'cbse' THEN 'rbse' ELSE 'cbse' END,
     _src.embedding, 'embedded', _src.chapter_id);

  SET LOCAL ROLE service_role;
  _role := current_user;
  SELECT count(*) INTO _n
    FROM public.match_question_bank(_src.embedding, _src.class_level, _school, NULL, 0.0, 50) m
   WHERE m.id = _fix;
  RESET ROLE;

  DELETE FROM public.question_bank WHERE id = _fix;

  -- The role really was service_role, not postgres with a failed SET.
  IF _role <> 'service_role' THEN
    RAISE EXCEPTION 'SET LOCAL ROLE service_role did not take (current_user was %) — the measurement is meaningless.', _role;
  END IF;
  IF _n = 0 THEN
    RAISE EXCEPTION
      'the cross-board row did NOT come back as service_role, so the leak this migration closes is not present and the after-check would pass vacuously. Re-derive before proceeding.';
  END IF;
  RAISE NOTICE 'before: service_role saw the cross-board row (% rows). Leak confirmed live.', _n;
END
$before$;


-- ── The fence, in the body ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_question_bank(
  p_query_embedding vector,
  p_class_level integer,
  p_school_id uuid DEFAULT NULL::uuid,
  p_subjects text[] DEFAULT NULL::text[],
  p_match_threshold double precision DEFAULT 0.82,
  p_match_count integer DEFAULT 3)
 RETURNS TABLE(id uuid, question text, options jsonb, correct_index integer, explanation text, subject text, concept text, chapter text, topic text, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  -- question_bank has no school_id and is shared across schools by design
  -- (§4.2a). The tenancy dimension is BOARD, and this is the same test the RLS
  -- policy qb_select_approved_board makes — written here against p_school_id so
  -- that it also holds for service_role, which bypasses RLS entirely and is the
  -- only caller this function actually has (aiRouter.ts).
  --
  -- No `p_school_id IS NULL OR …` escape: an unknown school narrows the result
  -- to board-agnostic rows rather than opening it (G14).
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.concept, qb.chapter, qb.topic,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  WHERE qb.embed_status = 'embedded'
    AND qb.is_active = true
    AND qb.is_approved = true
    AND qb.class_level = p_class_level
    AND (qb.board IS NULL
         OR qb.board = 'both'
         OR qb.board = (SELECT s.board FROM public.schools s WHERE s.id = p_school_id))
    AND (p_subjects IS NULL OR qb.subject = ANY(p_subjects))
    AND (1 - (qb.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY qb.embedding <=> p_query_embedding
  LIMIT p_match_count;
$function$;


-- ── After: call it on both paths, and require a control on each ───────────
DO $after$
DECLARE
  _uid uuid; _school uuid; _board text;
  _src public.question_bank%ROWTYPE;
  _fix uuid := gen_random_uuid();
  _svc_role text; _auth_role text;
  _svc_cross int; _svc_ctl int;
  _auth_cross int; _auth_ctl int;
  _fail text := '';
BEGIN
  SELECT u.id INTO _uid FROM auth.users u WHERE u.email='arjun.mehta@wisdomcampus.com';
  SELECT st.school_id INTO _school FROM public.students st WHERE st.user_id=_uid;
  SELECT s.board INTO _board FROM public.schools s WHERE s.id=_school;

  SELECT * INTO _src FROM public.question_bank qb
   WHERE qb.is_approved AND qb.is_active AND qb.embed_status='embedded'
     AND qb.embedding IS NOT NULL AND qb.board = _board
   ORDER BY qb.created_at LIMIT 1;

  INSERT INTO public.question_bank
    (id, class_level, subject, chapter, topic, difficulty, question, options,
     correct_index, explanation, source, is_approved, is_active, board,
     embedding, embed_status, chapter_id)
  VALUES
    (_fix, _src.class_level, _src.subject, _src.chapter, _src.topic, _src.difficulty,
     'FENCE PROBE cross-board row', _src.options, _src.correct_index, _src.explanation,
     'fence-probe', true, true,
     CASE WHEN _board = 'cbse' THEN 'rbse' ELSE 'cbse' END,
     _src.embedding, 'embedded', _src.chapter_id);

  SET LOCAL ROLE service_role;
  _svc_role := current_user;
  SELECT count(*) FILTER (WHERE m.id = _fix), count(*) FILTER (WHERE m.id = _src.id)
    INTO _svc_cross, _svc_ctl
    FROM public.match_question_bank(_src.embedding, _src.class_level, _school, NULL, 0.0, 50) m;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _auth_role := current_user;
  SELECT count(*) FILTER (WHERE m.id = _fix), count(*) FILTER (WHERE m.id = _src.id)
    INTO _auth_cross, _auth_ctl
    FROM public.match_question_bank(_src.embedding, _src.class_level, _school, NULL, 0.0, 50) m;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  DELETE FROM public.question_bank WHERE id = _fix;

  IF _svc_role  <> 'service_role'  THEN _fail := _fail || format('(role) service_role probe ran as %s. ', _svc_role); END IF;
  IF _auth_role <> 'authenticated' THEN _fail := _fail || format('(role) authenticated probe ran as %s. ', _auth_role); END IF;

  -- The fence.
  IF _svc_cross  <> 0 THEN _fail := _fail || 'service_role still receives the cross-board row. '; END IF;
  IF _auth_cross <> 0 THEN _fail := _fail || 'authenticated still receives the cross-board row. '; END IF;

  -- The control on each path. Without these, a function that returns nothing at
  -- all — the exact state this whole thread started in — reads as a pass.
  IF _svc_ctl  <> 1 THEN _fail := _fail || 'service_role lost the OWN-board row: the fence is over-narrow, not correct. '; END IF;
  IF _auth_ctl <> 1 THEN _fail := _fail || 'authenticated lost the OWN-board row: the fence is over-narrow, not correct. '; END IF;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'match_question_bank fence: %', _fail;
  END IF;

  RAISE NOTICE 'after: cross-board 0/0, own-board 1/1, on service_role and authenticated.';
END
$after$;


-- ── No probe row survives ─────────────────────────────────────────────────
DO $clean$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.question_bank WHERE source = 'fence-probe';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'probe rows left behind in question_bank: %', _n;
  END IF;
END
$clean$;

COMMIT;
