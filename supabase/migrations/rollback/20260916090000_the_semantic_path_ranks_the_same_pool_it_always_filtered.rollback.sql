-- Rollback for 20260916090000_the_semantic_path_ranks_the_same_pool_it_always_filtered
--
-- Restores the one-argument, structured-only fill from 20260916050000. The
-- semantic ranking stops being possible; nothing else changes, because the
-- semantic path only ever REORDERED a pool the structured filters had already
-- decided.
--
-- The two-argument form is dropped FIRST. Leaving it beside the restored
-- one-argument form would give PostgREST two overloads to choose between, and
-- an ambiguous call fails in a way that reads as "the function is missing" —
-- probe14 has already watched that happen.
--
-- Papers and their questions are untouched: what was already retrieved stays
-- retrieved, including anything the semantic path chose.

DROP FUNCTION IF EXISTS public.rpc_fill_paper_section_from_bank(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.rpc_fill_paper_section_from_bank(_section_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
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
    RAISE EXCEPTION 'This paper is final — reopen it before changing its questions'
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
       AND NOT EXISTS (
             SELECT 1 FROM public.question_paper_questions q
              WHERE q.paper_id = sec.paper_id AND q.bank_id = qb.id)
  ), ordered AS (
    SELECT c.*,
           row_number() OVER (
             ORDER BY c.rn_in_chapter, c.chapter, md5(c.id::text || _section_id::text)
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
    'shortfall', GREATEST(wanted - inserted, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid) TO authenticated;

DO $verify$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_fill_paper_section_from_bank';
  IF _n <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: % overload(s) left behind — PostgREST cannot choose', _n;
  END IF;

  IF (SELECT pg_get_function_identity_arguments(p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='rpc_fill_paper_section_from_bank') <> 'uuid' THEN
    RAISE EXCEPTION 'ROLLED BACK: the restored function does not take exactly one uuid';
  END IF;

  RAISE NOTICE 'structured-only fill restored; the semantic ranking is no longer available.';
END $verify$;
