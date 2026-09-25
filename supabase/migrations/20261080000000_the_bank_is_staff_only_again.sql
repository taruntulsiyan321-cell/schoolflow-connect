-- THE BANK IS STAFF-ONLY AGAIN. THE CATALOG COUNTS IT AS ITS OWNER.
--
-- 20261049000000 dropped qb_select_approved_board because a policy cannot
-- withhold a column of a row it grants: with it in place a student can run
--
--   GET /question_bank?select=id,correct_index,explanation
--
-- and read the answer to every approved question on their board. Measured on
-- 2026-09-24 with a Class 10 student's token: 21,886 rows, answers included.
--
-- 20261060000000 (another branch) put the policy back. Its reason was real:
-- it had replaced rpc_practice_bank_catalog(integer,text,text,text), which
-- 20261050000000 had made SECURITY DEFINER, with a five-argument version
-- (adding _exam_id) that is SECURITY INVOKER, so the catalog ran as the
-- student and counted an empty bank. The policy was the wrong door to reopen:
-- every other student read already goes through question_bank_student, which
-- has no answer column and carries the same fence as the policy (it reads as
-- its owner, so it does not need the policy either).
--
-- So the catalog gets back what it lost, and the policy goes again:
--
--   * rpc_practice_bank_catalog(integer,text,text,text,uuid) becomes
--     SECURITY DEFINER. It returns subject, chapter and a count — no question
--     text, no answer. The school arm is unchanged (the bank is global, G2).
--     The exam arm now also requires _exam_id to be the caller's own
--     exam_accounts.exam_id, which is exactly what the policy enforced for it
--     before; without that a definer would count any exam's bank for anyone.
--   * qb_select_approved_board is dropped. Staff keep qb_staff_read, super
--     admins qb_super_admin_read, and the definer functions and the service
--     role are unaffected by RLS.
--
-- The proof at the end runs as a real school student and as a real exam
-- account, not as the migration's own role: each must see zero base-table
-- rows and a non-empty catalog, and must not be able to count an exam that is
-- not theirs.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer,
  _board text,
  _stream text DEFAULT NULL::text,
  _subject text DEFAULT NULL::text,
  _exam_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(subject text, chapter text, questions integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT qb.subject, qb.chapter, count(*)::int
    FROM public.question_bank qb
   WHERE qb.is_approved
     AND qb.is_active
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
     AND (
       (_exam_id IS NOT NULL
        AND qb.exam_id = _exam_id
        AND _exam_id = (SELECT ea.exam_id
                          FROM public.exam_accounts ea
                         WHERE ea.school_id = (SELECT public.get_my_school_id())))
       OR
       (_exam_id IS NULL
        AND qb.exam_id IS NULL
        AND qb.class_level = _class_level
        AND (qb.board = _board OR qb.board = 'both' OR qb.board IS NULL)
        AND (_stream IS NULL OR qb.stream = _stream OR qb.stream IS NULL))
     )
     AND (_subject IS NULL OR lower(qb.subject) = lower(_subject))
   GROUP BY qb.subject, qb.chapter
   ORDER BY qb.subject, qb.chapter
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_practice_bank_catalog(integer,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_practice_bank_catalog(integer,text,text,text,uuid) TO authenticated;

DROP POLICY IF EXISTS qb_select_approved_board ON public.question_bank;

DO $proof$
DECLARE
  _student uuid := 'd1000003-0001-4000-8000-000000000001';  -- Class 10-A, the fixture school
  _exam_user uuid;
  _own_exam uuid;
  _other_exam uuid;
  _rows int;
  _cat int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.question_bank'::regclass AND polname = 'qb_staff_read') THEN
    RAISE EXCEPTION 'qb_staff_read is gone — teachers would lose the bank';
  END IF;

  SELECT ea.account_id, ea.exam_id INTO _exam_user, _own_exam
    FROM public.exam_accounts ea
    JOIN public.question_bank qb ON qb.exam_id = ea.exam_id AND qb.is_approved AND qb.is_active
   LIMIT 1;
  SELECT ce.id INTO _other_exam
    FROM public.competitive_exams ce
   WHERE ce.id IS DISTINCT FROM _own_exam
     AND EXISTS (SELECT 1 FROM public.question_bank qb WHERE qb.exam_id = ce.id AND qb.is_approved AND qb.is_active)
   LIMIT 1;

  -- A school student.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _rows FROM public.question_bank;
  SELECT count(*) INTO _cat FROM public.rpc_practice_bank_catalog(10, 'rbse');
  RESET ROLE;
  IF _rows <> 0 THEN RAISE EXCEPTION 'a student still reads % question_bank rows', _rows; END IF;
  IF _cat < 5 THEN RAISE EXCEPTION 'the Class 10 catalog is thin for a student (% rows)', _cat; END IF;

  -- An exam account: its own exam is counted, its question rows are not readable.
  IF _exam_user IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _exam_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _rows FROM public.question_bank;
    SELECT count(*) INTO _cat FROM public.rpc_practice_bank_catalog(0, 'cuet', NULL, NULL, _own_exam);
    RESET ROLE;
    IF _rows <> 0 THEN RAISE EXCEPTION 'an exam account still reads % question_bank rows', _rows; END IF;
    IF _cat < 1 THEN RAISE EXCEPTION 'an exam account''s own catalog is empty'; END IF;

    IF _other_exam IS NOT NULL THEN
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO _cat FROM public.rpc_practice_bank_catalog(0, 'cuet', NULL, NULL, _other_exam);
      RESET ROLE;
      IF _cat <> 0 THEN RAISE EXCEPTION 'an exam account counted another exam''s bank (% rows)', _cat; END IF;
    END IF;
  END IF;

  -- Positive control for the exam fence: the school student asking for an
  -- exam's catalog gets nothing.
  IF _own_exam IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _student, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _cat FROM public.rpc_practice_bank_catalog(0, 'cuet', NULL, NULL, _own_exam);
    RESET ROLE;
    IF _cat <> 0 THEN RAISE EXCEPTION 'a school student counted an exam''s bank (% rows)', _cat; END IF;
  END IF;

  RAISE NOTICE 'OK: exam user %, other exam %', _exam_user, _other_exam;
END
$proof$;

COMMIT;
