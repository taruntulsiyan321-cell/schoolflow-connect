-- ═══════════════════════════════════════════════════════════════════════════
-- PRACTICE IN THE REAL EXAM'S MIX, BY DEFAULT (docs/TODO.md C7)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A practice session was a draw from the pool, so a student met statement,
-- match, sequence and case questions only as often as the pool happened to
-- hold them. The approved blueprint (docs/cuet-blueprint.md, 20261150000000)
-- says how often the real paper sets each; practice now follows it.
--
-- 1. public._blueprint_forms(exam, subject, options) — a subject's form
--    shares under a student's choices — becomes the one reading of them.
-- 2. _mock_targets, which read the same shares with its own query, reads
--    the helper instead: the mock paper and practice cannot disagree on a
--    subject's mix.
-- 3. public.rpc_exam_form_mix(subject) gives a practising student their
--    exam's mix for a subject, under the choices they have made (a choice not
--    made leaves only the shares every paper has). A school account, which
--    has no exam, gets {} and practises as before. The draw itself — each
--    form's share from questions the student has never seen, the rest filled
--    as before — is the app's (src/academic/services/practiceDraw.ts).
--
-- ROLLBACK: rollback/20261155000000_practice_in_the_exam_mix.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. One reading of a subject's form mix ──────────────────────────────────
CREATE FUNCTION public._blueprint_forms(_exam uuid, _subject text, _options jsonb)
RETURNS TABLE(form text, questions integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.form, sum(f.questions)::int
    FROM public.exam_blueprint_forms f
   WHERE f.exam_id = _exam AND lower(f.subject) = lower(_subject)
     AND (f.option_group = '' OR f.option = _options->>f.option_group)
   GROUP BY f.form
$$;

REVOKE ALL ON FUNCTION public._blueprint_forms(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 2. The mock paper reads it ──────────────────────────────────────────────
-- As 20261150000000 left it, with its form query replaced by the helper.
CREATE OR REPLACE FUNCTION public._mock_targets(_exam uuid, _subject text, _chapter uuid, _options jsonb)
RETURNS TABLE(kind text, key text, questions integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _want    int := (public._mock_paper()->>'questions')::int;
  _missing text;
BEGIN
  SELECT string_agg(DISTINCT o.label_group, '; ') INTO _missing
    FROM (SELECT o.option_group, string_agg(o.label, ' or ' ORDER BY o.position) AS label_group
            FROM public.exam_blueprint_options o
           WHERE o.exam_id = _exam AND lower(o.subject) = lower(_subject)
             AND (_chapter IS NULL OR EXISTS (
                   SELECT 1 FROM public.exam_blueprint_forms f
                    WHERE f.exam_id = _exam AND lower(f.subject) = lower(_subject) AND f.option_group = o.option_group))
           GROUP BY o.option_group) o
   WHERE NOT EXISTS (SELECT 1 FROM public.exam_blueprint_options c
                      WHERE c.exam_id = _exam AND lower(c.subject) = lower(_subject)
                        AND c.option_group = o.option_group AND c.option = _options->>o.option_group);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'mock_option_not_chosen' USING ERRCODE = 'P0001',
      DETAIL = format('Choose first: %s.', _missing);
  END IF;

  IF _chapter IS NULL THEN
    RETURN QUERY
      SELECT 'chapter'::text, b.chapter_id::text, sum(b.questions)::int
        FROM public.exam_blueprint_chapters b
        JOIN public.chapters c ON c.id = b.chapter_id
        JOIN public.curriculum_subjects s ON s.id = c.curriculum_subject_id
       WHERE b.exam_id = _exam AND lower(s.name) = lower(_subject)
         AND (b.option_group = '' OR b.option = _options->>b.option_group)
       GROUP BY b.chapter_id;
  ELSE
    RETURN QUERY SELECT 'chapter'::text, _chapter::text, _want;
  END IF;
  -- The subject's form shares: _blueprint_forms, the one reading of them.
  RETURN QUERY
    SELECT 'form'::text, bf.form, bf.questions
      FROM public._blueprint_forms(_exam, _subject, _options) bf;
END $$;

-- ── 3. A practising student's mix ───────────────────────────────────────────
CREATE FUNCTION public.rpc_exam_form_mix(_subject text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _exam uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  -- A school account has no exam paper, so no shares: {} — it practises as before.
  SELECT ea.exam_id INTO _exam FROM public.exam_accounts ea WHERE ea.account_id = _uid;
  RETURN (SELECT COALESCE(jsonb_object_agg(b.form, b.questions), '{}'::jsonb)
            FROM public._blueprint_forms(_exam, _subject, public._mock_options(_uid, _exam, _subject, NULL)) b);
END $$;

COMMENT ON FUNCTION public.rpc_exam_form_mix(text) IS
  'The caller''s exam''s form shares for a subject, under their choices: {"mcq": 24, "case_based": 10, ...}. {} for a school account (20261155000000, C7).';

REVOKE ALL ON FUNCTION public.rpc_exam_form_mix(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_exam_form_mix(text) TO authenticated;

-- ── PROOF, as the caller, before COMMIT ─────────────────────────────────────
DO $proof$
DECLARE
  _exam    uuid;
  _acct    uuid;
  _school  uuid;
  _mix     jsonb;
  _want    jsonb;
  _n       int;
  _err     text;
BEGIN
  SELECT e.id INTO _exam FROM public.competitive_exams e WHERE e.code = 'cuet';
  SELECT ea.account_id INTO _acct FROM public.exam_accounts ea WHERE ea.exam_id = _exam ORDER BY ea.account_id LIMIT 1;
  IF _acct IS NULL THEN RAISE EXCEPTION 'VERIFY FAILED: no CUET account to prove with'; END IF;

  -- 1. The mock paper's form targets still come to a full paper, for a subject
  --    with no choice and for each choice of one that has them.
  FOR _want IN SELECT x FROM (VALUES
      (jsonb_build_object('subject', 'Accountancy', 'options', '{"unit_v": "analysis"}'::jsonb)),
      (jsonb_build_object('subject', 'Accountancy', 'options', '{"unit_v": "cas"}'::jsonb)),
      (jsonb_build_object('subject', 'Business Studies', 'options', '{}'::jsonb)),
      (jsonb_build_object('subject', 'Mathematics', 'options', '{"section_b": "applied"}'::jsonb))) AS v(x)
  LOOP
    SELECT sum(t.questions) INTO _n FROM public._mock_targets(_exam, _want->>'subject', NULL, _want->'options') t WHERE t.kind = 'form';
    IF _n IS DISTINCT FROM (public._mock_paper()->>'questions')::int THEN
      RAISE EXCEPTION 'VERIFY FAILED: % form targets come to %, not a paper', _want, _n;
    END IF;
  END LOOP;
  -- CONTROL: the mock still refuses a subject whose choice is not made.
  BEGIN
    PERFORM * FROM public._mock_targets(_exam, 'Accountancy', NULL, '{}'::jsonb);
    _err := 'none';
  EXCEPTION WHEN raise_exception THEN
    _err := SQLERRM;
  END;
  IF _err <> 'mock_option_not_chosen' THEN RAISE EXCEPTION 'VERIFY FAILED: an unmade choice gave %', _err; END IF;

  -- 2. As a CUET student: the blueprint's own shares for the subject.
  SELECT COALESCE(jsonb_object_agg(f.form, f.n), '{}'::jsonb) INTO _want
    FROM (SELECT f.form, sum(f.questions)::int AS n FROM public.exam_blueprint_forms f
           WHERE f.exam_id = _exam AND f.subject = 'Accountancy' AND f.option_group = '' GROUP BY f.form) f;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _mix := public.rpc_exam_form_mix('Accountancy');
  RESET ROLE;
  IF _mix IS DISTINCT FROM _want OR (SELECT sum(v::int) FROM jsonb_each_text(_mix) AS e(k, v)) <> 50 THEN
    RAISE EXCEPTION 'VERIFY FAILED: Accountancy mix %, the blueprint says %', _mix, _want;
  END IF;
  IF NOT (_mix ? 'case_based' AND _mix ? 'match' AND _mix ? 'statements') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the mix carries no non-direct form: %', _mix;
  END IF;

  -- 3. A school account has no exam: {} — it practises as before.
  SELECT p.id INTO _school FROM public.profiles p
   WHERE NOT EXISTS (SELECT 1 FROM public.exam_accounts ea WHERE ea.account_id = p.id)
   ORDER BY p.id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _school, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _mix := public.rpc_exam_form_mix('Accountancy');
  RESET ROLE;
  IF _mix IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'VERIFY FAILED: a school account got a mix: %', _mix; END IF;

  -- 4. Not for anon; the helper not for anyone but the definers.
  IF has_function_privilege('anon', 'public.rpc_exam_form_mix(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_exam_form_mix(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._blueprint_forms(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: grants';
  END IF;
END $proof$;

COMMIT;
