-- ═══════════════════════════════════════════════════════════════════════════
-- THE PAPER IS READ BY THE ANALYSIS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-03: the Analysis tab reads a student against the real CUET
-- paper — their pace against the time it allows, and what their accuracy
-- would score on it. The paper's shape is stated once, in _mock_paper(), which
-- a student may not call. Its numbers already reach them, through the mock
-- catalog and through rpc_session_analysis_context; this is the same four
-- facts, for a screen that has no session or catalog to read them from.
--
-- rpc_exam_paper() returns { questions, minutes, marks_correct, marks_wrong,
-- max_score } from _mock_paper(). It reads no table.
--
-- ROLLBACK: rollback/20261144000000_the_paper_is_read_by_the_analysis.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE FUNCTION public.rpc_exam_paper()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _m jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  _m := public._mock_paper();
  RETURN jsonb_build_object(
    'questions',     _m->'questions',
    'minutes',       _m->'minutes',
    'marks_correct', _m->'marks_correct',
    'marks_wrong',   _m->'marks_wrong',
    'max_score',     _m->'max_score');
END $fn$;

REVOKE ALL ON FUNCTION public.rpc_exam_paper() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_exam_paper() TO authenticated;

COMMENT ON FUNCTION public.rpc_exam_paper() IS
  'The CUET paper''s shape from _mock_paper(), for a signed-in student (20261144000000). Reads no table.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.rpc_exam_paper()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_exam_paper()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the paper is shut to students or open to strangers';
  END IF;
  -- _mock_paper() itself stays shut: this is a door to its numbers, not to it.
  IF has_function_privilege('authenticated', 'public._mock_paper()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: _mock_paper() is open to students';
  END IF;
END $verify$;

-- ── PROOF: as the student, as a stranger, with no identity; rolled back ────
DO $proof$
DECLARE
  _fail text := '';
  _sentinel constant text := 'm20261144 proof rolled back';
  _a uuid;
  _r jsonb;
BEGIN
  SELECT st.user_id INTO _a
    FROM public.students st JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
   WHERE st.user_id IS NOT NULL ORDER BY st.user_id LIMIT 1;
  IF _a IS NULL THEN
    RAISE EXCEPTION 'PROOF FAILED: fixture missing (an individual student)';
  END IF;

  BEGIN
    -- 1. A student reads the paper, and it is _mock_paper()'s.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    _r := public.rpc_exam_paper();
    EXECUTE 'RESET ROLE';
    IF (_r->>'questions')::int IS DISTINCT FROM (public._mock_paper()->>'questions')::int
       OR (_r->>'minutes')::int IS DISTINCT FROM (public._mock_paper()->>'minutes')::int
       OR (_r->>'marks_correct')::int IS DISTINCT FROM (public._mock_paper()->>'marks_correct')::int
       OR (_r->>'marks_wrong')::int IS DISTINCT FROM (public._mock_paper()->>'marks_wrong')::int
       OR (_r->>'max_score')::int IS DISTINCT FROM (public._mock_paper()->>'max_score')::int THEN
      _fail := _fail || ' [1 paper ' || coalesce(_r::text, 'null') || ']';
    END IF;
    -- 2. A stranger cannot call it.
    PERFORM set_config('request.jwt.claims', NULL, true);
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.rpc_exam_paper();
      _fail := _fail || ' [2 a stranger read the paper]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    EXECUTE 'RESET ROLE';
    -- 3. With no identity, it refuses.
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.rpc_exam_paper();
      _fail := _fail || ' [3 read with no identity]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'auth required' THEN _fail := _fail || ' [3 ' || SQLERRM || ']'; END IF;
    END;
    EXECUTE 'RESET ROLE';

    RAISE EXCEPTION USING MESSAGE = _sentinel;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> _sentinel THEN
      RAISE EXCEPTION 'PROOF FAILED (unexpected %): %', SQLSTATE, SQLERRM;
    END IF;
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'PROOF FAILED:%', _fail;
  END IF;
END $proof$;

COMMIT;
