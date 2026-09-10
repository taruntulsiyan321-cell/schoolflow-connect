-- Rollback for 20260916150000.
--
-- Drops the topics narrowing from the fill and removes the column. Any topic
-- a teacher had chosen on a draft section is lost, and those sections go back
-- to drawing on the whole chapter set -- which is a WIDER pool, never an empty
-- one, so no paper breaks.
--
-- The function body below is the pre-topics one, with the mojibake in the
-- "paper is final" message left repaired: reintroducing a broken character in
-- a teacher-facing string is not part of undoing this feature.

CREATE OR REPLACE FUNCTION public.rpc_fill_paper_section_from_bank(
  _section_id uuid,
  _bank_ids   uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  sec       public.question_paper_sections%ROWTYPE;
  pap       public.question_papers%ROWTYPE;
  present   int;
  wanted    int;
  pool      int;
  inserted  int;
  next_ix   int;
  semantic  boolean := _bank_ids IS NOT NULL AND cardinality(_bank_ids) > 0;
BEGIN
  SELECT * INTO sec FROM public.question_paper_sections WHERE id = _section_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your question paper section' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO pap FROM public.question_papers WHERE id = sec.paper_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your question paper' USING ERRCODE = '42501';
  END IF;

  IF pap.status <> 'draft' THEN
    RAISE EXCEPTION 'This paper is final - reopen it before changing its questions'
      USING ERRCODE = '22023';
  END IF;

  IF sec.question_format <> 'mcq' THEN
    RAISE EXCEPTION
      'The question bank holds multiple-choice questions only, so a % section cannot be filled from it',
      sec.question_format
      USING ERRCODE = '22023';
  END IF;

  IF pap.class_level IS NULL THEN
    RAISE EXCEPTION 'This paper has no class level, so the bank cannot be narrowed to it'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO present
    FROM public.question_paper_questions q WHERE q.section_id = _section_id;

  wanted := GREATEST(sec.target_count - present, 0);

  SELECT COALESCE(max(q.order_index), -1) + 1 INTO next_ix
    FROM public.question_paper_questions q WHERE q.section_id = _section_id;

  WITH candidates AS (
    SELECT qb.id, qb.question, qb.options, qb.correct_index, qb.explanation, qb.chapter,
           CASE WHEN semantic THEN array_position(_bank_ids, qb.id) END AS rank_ix,
           row_number() OVER (
             PARTITION BY qb.chapter
             ORDER BY md5(qb.id::text || _section_id::text)
           ) AS rn_in_chapter
      FROM public.question_bank qb
     WHERE qb.is_active
       AND qb.is_approved
       AND qb.class_level = pap.class_level
       AND qb.subject = pap.subject
       AND (pap.board IS NULL OR qb.board = pap.board OR qb.board = 'both')
       AND (cardinality(sec.chapters) = 0 OR qb.chapter = ANY (sec.chapters))
       AND (sec.difficulty IS NULL OR qb.difficulty = sec.difficulty)
       AND (NOT semantic OR qb.id = ANY (_bank_ids))
       AND NOT EXISTS (
             SELECT 1 FROM public.question_paper_questions q
              WHERE q.paper_id = sec.paper_id AND q.bank_id = qb.id)
  ), ordered AS (
    SELECT c.*,
           row_number() OVER (
             ORDER BY c.rank_ix NULLS LAST,
                      c.rn_in_chapter,
                      c.chapter,
                      md5(c.id::text || _section_id::text)
           ) AS pick_ix
      FROM candidates c
  ), picked AS (
    SELECT * FROM ordered ORDER BY pick_ix LIMIT wanted
  ), ins AS (
    INSERT INTO public.question_paper_questions
      (paper_id, section_id, school_id, order_index, origin, bank_id,
       question, options, correct_index, explanation, chapter, marks)
    SELECT sec.paper_id, _section_id, sec.school_id,
           next_ix + (p.pick_ix - 1)::int, 'retrieved', p.id,
           p.question, p.options, p.correct_index, p.explanation, p.chapter,
           sec.marks_per_question
      FROM picked p
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM ins)
    INTO pool, inserted;

  RETURN jsonb_build_object(
    'section_id', _section_id,
    'target_count', sec.target_count,
    'already_present', present,
    'requested', wanted,
    'pool_size', pool,
    'inserted', inserted,
    'shortfall', GREATEST(wanted - inserted, 0),
    'strategy', CASE WHEN semantic THEN 'semantic' ELSE 'structured' END,
    'ranked_candidates', CASE WHEN semantic THEN cardinality(_bank_ids) ELSE 0 END
  );
END;
$function$;

ALTER TABLE public.question_paper_sections DROP COLUMN IF EXISTS topics;
