-- =====================================================================
-- REVERSE OF: 20260828160000_chunk7a_question_bank.sql
--
-- WHAT THIS COSTS
--
--  1. THE BOARD AND CLASS FILTERS COME OFF TWO SECURITY DEFINER PATHS.
--     rpc_dpp_pick_from_bank goes back to having NO class filter and no
--     board filter; rpc_generate_battle goes back to a class filter that
--     passes whenever either side is NULL, and no board filter. Both read
--     the bank as SECURITY DEFINER, so the policy's board filter does not
--     run for them. Reverting means a Class 5 DPP can draw Class 12
--     questions again, and an ICSE school can be served RBSE content.
--     That is the failure 7A existed to close.
--
--  2. THE 15 UNKEYABLE QUESTIONS BECOME ACTIVE AGAIN, and the constraint
--     that stops an unkeyed question being active is dropped, so new ones
--     can be imported.
--
--  3. question_reports is dropped with any reports filed in it.
--
-- ON THE school_id RESTORE, honestly: the column is recreated and
-- repopulated from source='seed', which is exact — there are precisely 50
-- such rows and they are precisely the 50 that carried school_id. That is
-- luck, not design. The right practice before an irreversible DROP COLUMN
-- is to snapshot the mapping first; this rollback happens to be faithful
-- because a second column identified the same set. Do not rely on that
-- next time.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. The two SECURITY DEFINER functions, as they were.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_dpp_pick_from_bank(_dpp_id uuid, _count integer DEFAULT 5, _difficulty text DEFAULT NULL::text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _d record; _n int := 0; _start int;
BEGIN
  SELECT * INTO _d FROM public.dpps WHERE id = _dpp_id;
  IF _d IS NULL THEN RAISE EXCEPTION 'DPP not found'; END IF;
  IF NOT (teacher_teaches_class(auth.uid(), _d.class_id) OR has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT COALESCE(MAX(order_index)+1, 0) INTO _start FROM public.dpp_questions WHERE dpp_id = _dpp_id;

  WITH picked AS (
    SELECT question, options, correct_index, explanation
    FROM public.question_bank
    WHERE is_approved
      AND lower(subject) = lower(_d.subject)
      AND (_d.chapter IS NULL OR chapter ILIKE _d.chapter)
      AND (_difficulty IS NULL OR difficulty = _difficulty)
    ORDER BY random() LIMIT GREATEST(_count,1)
  ), ins AS (
    INSERT INTO public.dpp_questions (dpp_id, order_index, kind, question, options, correct, marks, explanation, school_id)
    SELECT _dpp_id, _start + (row_number() OVER ()) - 1, 'mcq'::dpp_question_kind,
           question, options, jsonb_build_object('indexes', jsonb_build_array(correct_index)),
           1, explanation, _d.school_id
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;

  UPDATE public.dpps SET
    question_count = (SELECT count(*) FROM public.dpp_questions WHERE dpp_id = _dpp_id),
    total_marks = (SELECT COALESCE(SUM(marks),0) FROM public.dpp_questions WHERE dpp_id = _dpp_id)
  WHERE id = _dpp_id;
  RETURN _n;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_generate_battle(_battle_id uuid, _count integer DEFAULT 5)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _b   record;
  _uid uuid := auth.uid();
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;
  IF _b.creator_user_id <> _uid
     AND NOT has_role(_uid,'admin') AND NOT has_role(_uid,'teacher')
     AND NOT (
       coalesce(_b.source, '') LIKE 'featured_%'
       AND _b.class_id IS NOT NULL
       AND public.student_class_id(_uid) IS NOT DISTINCT FROM _b.class_id
     ) THEN
    RAISE EXCEPTION 'Not your battle';
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty,
           COALESCE(h.times_seen, 0) AS seen,
           COALESCE(h.last_seen_at, 'epoch'::timestamptz) AS last_seen
    FROM public.question_bank q
    LEFT JOIN public.student_question_history h
      ON h.question_id = q.id AND h.user_id = _uid
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.topic IS NULL OR q.topic ILIKE _b.topic)
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index FROM pool
    ORDER BY seen ASC,
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      last_seen ASC, random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id, school_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id, _b.school_id
    FROM picked RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
    SET
      source = CASE WHEN nullif(trim(source), '') IS NULL THEN 'bank' ELSE source END,
      question_count = _inserted,
      duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $function$;

-- ---------------------------------------------------------------------
-- 2. topics policies, as they were.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS topics_update_super ON public.topics;
DROP POLICY IF EXISTS topics_delete_super ON public.topics;
DROP POLICY IF EXISTS topics_read         ON public.topics;

CREATE POLICY topics_write_super ON public.topics
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY topics_read ON public.topics
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------
-- 3. question_reports, and the constraints 7A added.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS public.question_reports;

ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_active_must_be_keyed;
ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_no_self_lineage;
ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_variant_tier_check;
DROP INDEX IF EXISTS public.question_bank_source_idx;

ALTER TABLE public.question_bank
  DROP COLUMN IF EXISTS variant_tier,
  DROP COLUMN IF EXISTS replaced_by_question_id,
  DROP COLUMN IF EXISTS source_question_id;

-- ---------------------------------------------------------------------
-- 4. school_id back on the bank, with its 50 assignments.
-- ---------------------------------------------------------------------
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL;

UPDATE public.question_bank
   SET school_id = '00000000-0000-4000-8000-000000000001'
 WHERE source = 'seed';

-- ---------------------------------------------------------------------
-- 5. question_bank policies, as they were — including school_id.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS qb_select_approved_board ON public.question_bank;
DROP POLICY IF EXISTS qb_staff_read            ON public.question_bank;
DROP POLICY IF EXISTS qb_staff_insert          ON public.question_bank;
DROP POLICY IF EXISTS qb_staff_update          ON public.question_bank;
DROP POLICY IF EXISTS qb_staff_delete          ON public.question_bank;

CREATE POLICY qb_select_approved_board ON public.question_bank
  FOR SELECT
  USING (
    is_approved = true
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
    AND (board IS NULL OR board = 'both'
         OR board = COALESCE((SELECT s.board FROM public.schools s WHERE s.id = public.get_my_school_id()), 'rbse'))
  );

CREATE POLICY qb_staff_manage ON public.question_bank
  FOR ALL
  USING (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'principal') OR public.has_role(auth.uid(),'teacher'))
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
  )
  WITH CHECK (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'principal') OR public.has_role(auth.uid(),'teacher'))
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
  );

CREATE POLICY qb_teacher_insert ON public.question_bank
  FOR INSERT
  WITH CHECK (
    (public.has_role(auth.uid(),'teacher') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'principal'))
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
  );

-- ---------------------------------------------------------------------
-- 6. The 15 unkeyable questions, active again.
--    Done LAST, because the constraint forbidding it is dropped in step 3.
-- ---------------------------------------------------------------------
UPDATE public.question_bank
   SET is_active = true
 WHERE chapter_id IS NULL;

DELETE FROM public.schema_migrations
 WHERE version = '20260828160000_chunk7a_question_bank';

COMMIT;
