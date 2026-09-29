-- ===========================================================================
-- A BROUGHT QUESTION IS ASKED ONLY IF IT CAN BE ANSWERED
--
-- Found 2026-09-29, checking screen capture and Custom Practice again.
--
-- A captured question and an uploaded one may be stored with their answer as
-- text only — no options, or no option index (student_capture_questions and
-- student_upload_questions both allow it: answer_shape CHECK, 20261077000000,
-- 20261063000000). PW shows numeric and written answers that way, and a file
-- can carry them. Such a question is a real mistake and belongs in the book.
--
-- It cannot be ASKED. Practice drops any private question without at least
-- two options and an option index ("Private rows must carry a usable key",
-- src/gurukul/pages/Practice.tsx), because the attempt is graded on that
-- index. But _recovery_session_plan_for planned it as a tier-0 original on
-- the row existing alone, and rpc_submit_recovery_session kept it in the
-- tier on the row existing alone — so the session showed one question fewer
-- than it said, and the one it never showed was scored as asked and got
-- wrong, lowering the procedural rate for something the student never saw.
--
-- _brought_question_askable(options, correct_index) is now the one server
-- definition of "can be asked" — the same rule Practice applies — and the
-- plan and the scoring both use it. A text-answer mistake stays in the book
-- and still gets its rungs from the bank (its anchor, its chapter); it is
-- just not planned as a question the session will put to the student.
--
-- AND THE REVISION CHECK, for the same reason and out of the same definition.
-- 20261118000000 (applied 2026-09-28, written in parallel with this branch)
-- made a revision check re-ask what the student BROUGHT: its misses half now
-- returns upload and capture ids beside bank ones, on the row still existing
-- alone — the very test this migration is replacing everywhere else. Left out,
-- "can this be asked" would have had two homes the day both branches landed:
-- recovery would skip a written-answer mistake and revision would still plan
-- it, and the check would show one question fewer than it announced. There is
-- no such row on production today (measured 2026-09-29: 0 of 33 upload and 0
-- of 1 capture questions are unaskable), so this closes it before it is
-- reached rather than after.
--
-- ROLLBACK: rollback/20261120000000_a_brought_question_is_asked_only_if_it_can_be_answered.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.routines_pre_20261120000000 (
  object text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20261120000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261120000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261120000000 IS
  'Rollback source for 20261120000000: the three functions it changes, as they were. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261120000000 (object, definition)
SELECT o, pg_get_functiondef(o::regprocedure)
  FROM unnest(ARRAY[
    'public._recovery_session_plan_for(uuid,uuid)',
    'public.rpc_submit_recovery_session(uuid,uuid)',
    'public.rpc_revision_session_plan(uuid)']) AS o;

CREATE TEMP TABLE _plan_before ON COMMIT DROP AS
SELECT m.user_id, m.chapter_id,
       public._recovery_session_plan_for(m.user_id, m.chapter_id)->'tiers' AS tiers
  FROM (SELECT sm.user_id, sm.chapter_id
          FROM public.student_mistakes sm
         WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
           AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL
                OR sm.capture_question_id IS NOT NULL)
         GROUP BY sm.user_id, sm.chapter_id
        HAVING count(*) <= public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int) m
 WHERE public._recovery_chapter_is_for(m.user_id, m.chapter_id);

CREATE OR REPLACE FUNCTION public._brought_question_askable(_options jsonb, _correct_index integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  -- The rule Practice applies to an uploaded or captured question before it
  -- will show it: at least two options, and an option index to grade on.
  SELECT COALESCE(jsonb_typeof(_options) = 'array', false)
     AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(_options) = 'array' THEN _options END), 0) >= 2
     AND _correct_index IS NOT NULL;
$function$;

COMMENT ON FUNCTION public._brought_question_askable(jsonb, integer) IS
  'Whether an uploaded or captured question can be put to the student: two or more options and an option index — the rule Practice applies before showing one.';
REVOKE ALL ON FUNCTION public._brought_question_askable(jsonb, integer) FROM PUBLIC, anon, authenticated;

DO $edit$
DECLARE
  _def text;
  _n   int;
  _up_old constant text :=
    E'        SELECT 1 FROM public.student_upload_questions uq\n' ||
    E'         WHERE uq.id = _m.upload_question_id\n' ||
    E'           AND uq.owner_id = _uid\n';
  _up_new constant text := _up_old ||
    E'           AND public._brought_question_askable(uq.options, uq.correct_index)\n';
  _cap_old constant text :=
    E'        SELECT 1 FROM public.student_capture_questions cq\n' ||
    E'         WHERE cq.id = _m.capture_question_id\n' ||
    E'           AND cq.owner_id = _uid\n';
  _cap_new constant text := _cap_old ||
    E'           AND public._brought_question_askable(cq.options, cq.correct_index)\n';
  _sup_old constant text :=
    E'FROM public.student_upload_questions u WHERE u.id = ANY(_ids_up) AND u.owner_id = _uid;';
  _sup_new constant text :=
    E'FROM public.student_upload_questions u WHERE u.id = ANY(_ids_up) AND u.owner_id = _uid\n' ||
    E'       AND public._brought_question_askable(u.options, u.correct_index);';
  _scap_old constant text :=
    E'FROM public.student_capture_questions c WHERE c.id = ANY(_ids_cap) AND c.owner_id = _uid;';
  _scap_new constant text :=
    E'FROM public.student_capture_questions c WHERE c.id = ANY(_ids_cap) AND c.owner_id = _uid\n' ||
    E'       AND public._brought_question_askable(c.options, c.correct_index);';
  -- The revision check's misses (20261118000000): the same two tests, on the
  -- same rule. Each arm ends in the EXISTS's paren and the OR clause's, so the
  -- new line goes inside both.
  _rup_old constant text :=
    E'             WHERE uq.id = sm.upload_question_id AND uq.owner_id = _uid))';
  _rup_new constant text :=
    E'             WHERE uq.id = sm.upload_question_id AND uq.owner_id = _uid\n' ||
    E'               AND public._brought_question_askable(uq.options, uq.correct_index)))';
  _rcap_old constant text :=
    E'             WHERE cq.id = sm.capture_question_id AND cq.owner_id = _uid))';
  _rcap_new constant text :=
    E'             WHERE cq.id = sm.capture_question_id AND cq.owner_id = _uid\n' ||
    E'               AND public._brought_question_askable(cq.options, cq.correct_index)))';
BEGIN
  _def := replace(pg_get_functiondef('public._recovery_session_plan_for(uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _up_old, ''))) / length(_up_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'plan: expected the upload original check once, found %', _n; END IF;
  _n := (length(_def) - length(replace(_def, _cap_old, ''))) / length(_cap_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'plan: expected the capture original check once, found %', _n; END IF;
  EXECUTE replace(replace(_def, _up_old, _up_new), _cap_old, _cap_new);

  _def := replace(pg_get_functiondef('public.rpc_submit_recovery_session(uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _sup_old, ''))) / length(_sup_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'submit: expected the upload filter once, found %', _n; END IF;
  _n := (length(_def) - length(replace(_def, _scap_old, ''))) / length(_scap_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'submit: expected the capture filter once, found %', _n; END IF;
  EXECUTE replace(replace(_def, _sup_old, _sup_new), _scap_old, _scap_new);

  _def := replace(pg_get_functiondef('public.rpc_revision_session_plan(uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _rup_old, ''))) / length(_rup_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'revision: expected the upload arm once, found %', _n; END IF;
  _n := (length(_def) - length(replace(_def, _rcap_old, ''))) / length(_rcap_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'revision: expected the capture arm once, found %', _n; END IF;
  EXECUTE replace(replace(_def, _rup_old, _rup_new), _rcap_old, _rcap_new);
END
$edit$;

-- ── THE PROOF ────────────────────────────────────────────────────────────
--
--   1. The rule: two or more options and an index, nothing else.
--   2. Every plan the live database can build lost from tier 0 only brought
--      questions the app cannot ask, and no other tier changed.
--   3. Every brought question still planned is one the app can ask.
--   4. The revision check does the same, shown on a real open mistake AS THAT
--      STUDENT: it is in the check while it can be answered (the positive
--      control — without it the next assertion would pass on an empty plan),
--      and gone once the same row carries a text answer only. The row is put
--      back before the assertion, and the whole migration is one transaction,
--      so it is restored either way.
DO $proof$
DECLARE
  _b record; _after jsonb; _n int := 0;
  _ruid uuid; _rchap uuid; _rcap uuid;
  _plan jsonb; _opts jsonb; _idx int; _ans text;
BEGIN
  IF NOT public._brought_question_askable('["a","b"]'::jsonb, 0)
     OR public._brought_question_askable(NULL, 0)
     OR public._brought_question_askable('["a"]'::jsonb, 0)
     OR public._brought_question_askable('["a","b"]'::jsonb, NULL)
     OR public._brought_question_askable('"a, b"'::jsonb, 0) THEN
    RAISE EXCEPTION 'the askable rule does not read options and an index the way Practice does';
  END IF;

  FOR _b IN SELECT * FROM _plan_before LOOP
    _n := _n + 1;
    _after := public._recovery_session_plan_for(_b.user_id, _b.chapter_id)->'tiers';
    IF (_after - '0') IS DISTINCT FROM (_b.tiers - '0')
       OR (_after->'0'->'from_bank') IS DISTINCT FROM (_b.tiers->'0'->'from_bank') THEN
      RAISE EXCEPTION 'a plan changed beyond its brought originals for % / %', _b.user_id, _b.chapter_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(_b.tiers->'0'->'from_upload', '[]')) x(id)
        JOIN public.student_upload_questions uq ON uq.id = x.id::uuid
       WHERE NOT (COALESCE(_after->'0'->'from_upload', '[]') ? x.id)
         AND public._brought_question_askable(uq.options, uq.correct_index))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(_b.tiers->'0'->'from_capture', '[]')) x(id)
        JOIN public.student_capture_questions cq ON cq.id = x.id::uuid
       WHERE NOT (COALESCE(_after->'0'->'from_capture', '[]') ? x.id)
         AND public._brought_question_askable(cq.options, cq.correct_index)) THEN
      RAISE EXCEPTION 'a plan dropped a brought question the app can ask, for % / %', _b.user_id, _b.chapter_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(_after->'0'->'from_upload', '[]')) x(id)
        JOIN public.student_upload_questions uq ON uq.id = x.id::uuid
       WHERE NOT public._brought_question_askable(uq.options, uq.correct_index))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(_after->'0'->'from_capture', '[]')) x(id)
        JOIN public.student_capture_questions cq ON cq.id = x.id::uuid
       WHERE NOT public._brought_question_askable(cq.options, cq.correct_index)) THEN
      RAISE EXCEPTION 'a plan still holds a brought question the app cannot ask, for % / %', _b.user_id, _b.chapter_id;
    END IF;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'no plan to compare — check 2 proved nothing'; END IF;
  RAISE NOTICE '% plans re-checked', _n;

  IF pg_get_functiondef('public.rpc_submit_recovery_session(uuid,uuid)'::regprocedure)
       NOT LIKE '%_brought_question_askable(u.options, u.correct_index)%_brought_question_askable(c.options, c.correct_index)%' THEN
    RAISE EXCEPTION 'the scoring still counts a brought question the app cannot ask';
  END IF;

  IF pg_get_functiondef('public.rpc_revision_session_plan(uuid)'::regprocedure)
       NOT LIKE '%_brought_question_askable(uq.options, uq.correct_index)%_brought_question_askable(cq.options, cq.correct_index)%' THEN
    RAISE EXCEPTION 'the revision check still plans a brought question the app cannot ask';
  END IF;

  -- 4. The same, measured rather than read: a real student's own open capture
  --    mistake, in a chapter that still has unseen questions (so the plan
  --    builds at all), asked for as that student.
  SELECT sm.user_id, sm.chapter_id, sm.capture_question_id
    INTO _ruid, _rchap, _rcap
    FROM public.student_mistakes sm
   WHERE sm.status = 'open'
     AND sm.chapter_id IS NOT NULL
     AND sm.question_id IS NULL
     AND sm.capture_question_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.student_capture_questions cq
                  WHERE cq.id = sm.capture_question_id
                    AND cq.owner_id = sm.user_id
                    AND public._brought_question_askable(cq.options, cq.correct_index))
     AND EXISTS (SELECT 1 FROM public.question_bank qb
                  WHERE qb.chapter_id = sm.chapter_id
                    AND qb.is_active AND qb.is_approved
                    AND qb.replaced_by_question_id IS NULL
                    AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa
                                     WHERE qa.user_id = sm.user_id
                                       AND qa.bank_question_id = qb.id))
   LIMIT 1;

  IF _rcap IS NULL THEN
    RAISE WARNING 'no live capture mistake to put the revision check to; its body was verified, its behaviour was not';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _ruid)::text, true);
    SET LOCAL ROLE authenticated;
    _plan := public.rpc_revision_session_plan(_rchap);
    RESET ROLE;
    IF NOT ((_plan->'mistake_ids') ? _rcap::text) THEN
      RAISE EXCEPTION
        'CONTROL FAILED: capture % is answerable but the check does not ask it, so dropping it proves nothing', _rcap;
    END IF;

    SELECT cq.options, cq.correct_index, cq.correct_answer
      INTO _opts, _idx, _ans
      FROM public.student_capture_questions cq WHERE cq.id = _rcap;

    -- A written answer, which the answer_shape CHECK allows and Practice will
    -- not show. correct_answer must stay non-empty or the row is illegal.
    UPDATE public.student_capture_questions
       SET options = NULL, correct_index = NULL,
           correct_answer = COALESCE(NULLIF(btrim(correct_answer), ''), '42')
     WHERE id = _rcap;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _ruid)::text, true);
    SET LOCAL ROLE authenticated;
    _plan := public.rpc_revision_session_plan(_rchap);
    RESET ROLE;

    UPDATE public.student_capture_questions
       SET options = _opts, correct_index = _idx, correct_answer = _ans
     WHERE id = _rcap;

    IF ((_plan->'mistake_ids') ? _rcap::text) THEN
      RAISE EXCEPTION
        'the revision check plans capture %, which has no options to answer', _rcap;
    END IF;

    IF EXISTS (SELECT 1 FROM public.student_capture_questions cq
                WHERE cq.id = _rcap
                  AND (cq.options IS DISTINCT FROM _opts
                       OR cq.correct_index IS DISTINCT FROM _idx
                       OR cq.correct_answer IS DISTINCT FROM _ans)) THEN
      RAISE EXCEPTION 'the probe did not put capture % back as it found it', _rcap;
    END IF;
    RAISE NOTICE 'revision check proved on capture % for student %', _rcap, _ruid;
  END IF;
END
$proof$;

COMMIT;
