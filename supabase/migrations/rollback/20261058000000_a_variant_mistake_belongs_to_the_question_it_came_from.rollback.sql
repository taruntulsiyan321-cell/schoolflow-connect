-- ROLLBACK 20261058000000 — puts the variant-keyed mistake rows back exactly
-- as they were, and the root rows that absorbed them back exactly as they
-- were before absorbing.
--
-- THIS RESTORES THE DEFECT: the same gap counted twice — once on the original
-- question and again on each variant of it — in the open-mistake total, the
-- recovery trigger, the §6.3 chapter list and "of those, repeated".
--
-- It is exact rather than approximate because the forward migration copied
-- every row it was about to change — each variant row, and each root row that
-- absorbed one — into `student_mistakes_variant_merge` whole, as jsonb, before
-- changing anything. So nothing here does arithmetic: every backed-up row is
-- put back as it stood. (Subtracting times_wrong back out of a root, as the
-- first draft did, could not restore the last_wrong_at and created_at the
-- merge also moves.)
--
-- A row is deleted and re-inserted rather than updated so that a variant row
-- the merge deleted and one it kept all come back the same way. Both INSERT
-- triggers on student_mistakes only fill a NULL (school_id, chapter_id), so a
-- whole row passes through them unchanged.

DO $rollback$
DECLARE
  _restored int := 0;
  _b        record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'student_mistakes_variant_merge'
  ) THEN
    RAISE EXCEPTION 'there is no backup table — 20261058000000 was never applied here';
  END IF;

  -- Delete every backed-up id first, then insert: a repointed variant row
  -- now sits on its root's (user, source, question) key, and must be gone
  -- before the root's own row can come back to it.
  DELETE FROM public.student_mistakes sm
   WHERE sm.id IN (SELECT (b.row_data ->> 'id')::uuid FROM public.student_mistakes_variant_merge b);

  FOR _b IN SELECT row_data FROM public.student_mistakes_variant_merge LOOP
    INSERT INTO public.student_mistakes
    SELECT * FROM jsonb_populate_record(NULL::public.student_mistakes, _b.row_data);
    _restored := _restored + 1;
  END LOOP;

  -- Fail closed: every backed-up row must be back, byte for byte.
  IF EXISTS (
    SELECT 1
      FROM public.student_mistakes_variant_merge b
      LEFT JOIN public.student_mistakes sm ON sm.id = (b.row_data ->> 'id')::uuid
     WHERE sm.id IS NULL OR to_jsonb(sm) <> b.row_data
  ) THEN
    RAISE EXCEPTION 'a restored row does not match its backup — the rollback is not exact';
  END IF;
  IF EXISTS (SELECT 1 FROM public.student_mistakes_variant_merge WHERE kind = 'variant')
     AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
         JOIN public.question_bank qb ON qb.id = sm.question_id
        WHERE qb.source_question_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'nothing is keyed on a variant again — the restore did not land';
  END IF;

  RAISE NOTICE 'restored % row(s) from the merge backup', _restored;
END
$rollback$;

DROP TABLE IF EXISTS public.student_mistakes_variant_merge;

DELETE FROM public.schema_migrations
 WHERE version = '20261058000000_a_variant_mistake_belongs_to_the_question_it_came_from';
