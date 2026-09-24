-- ROLLBACK 20261058000000 — puts the variant-keyed mistake rows back exactly
-- as they were, and takes their counts back out of the rows that absorbed
-- them.
--
-- THIS RESTORES THE DEFECT: the same gap counted twice — once on the original
-- question and again on each variant of it — in the open-mistake total, the
-- recovery trigger, the §6.3 chapter list and "of those, repeated".
--
-- It is exact rather than approximate because the forward migration copied
-- every row it touched into `student_mistakes_variant_merge` whole, as jsonb,
-- before changing anything.

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

  FOR _b IN SELECT merged_into, row_data FROM public.student_mistakes_variant_merge LOOP
    -- The row that absorbed this one gives back exactly what it took.
    IF _b.merged_into IS NOT NULL THEN
      UPDATE public.student_mistakes r
         SET times_wrong = GREATEST(0, r.times_wrong - COALESCE((_b.row_data ->> 'times_wrong')::int, 0))
       WHERE r.id = _b.merged_into;
    END IF;

    -- And the row itself returns, under its own id, keyed on its variant.
    DELETE FROM public.student_mistakes WHERE id = (_b.row_data ->> 'id')::uuid;
    INSERT INTO public.student_mistakes
    SELECT * FROM jsonb_populate_record(NULL::public.student_mistakes, _b.row_data);
    _restored := _restored + 1;
  END LOOP;

  -- Fail closed: every backed-up row must be back, keyed on its variant.
  IF _restored <> (SELECT count(*) FROM public.student_mistakes_variant_merge) THEN
    RAISE EXCEPTION 'restored % of % backed-up rows', _restored,
      (SELECT count(*) FROM public.student_mistakes_variant_merge);
  END IF;
  IF _restored > 0 AND NOT EXISTS (
    SELECT 1 FROM public.student_mistakes sm
      JOIN public.question_bank qb ON qb.id = sm.question_id
     WHERE qb.source_question_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'nothing is keyed on a variant again — the restore did not land';
  END IF;

  RAISE NOTICE 'restored % variant-keyed mistake row(s)', _restored;
END
$rollback$;

DROP TABLE IF EXISTS public.student_mistakes_variant_merge;

DELETE FROM public.schema_migrations
 WHERE version = '20261058000000_a_variant_mistake_belongs_to_the_question_it_came_from';
