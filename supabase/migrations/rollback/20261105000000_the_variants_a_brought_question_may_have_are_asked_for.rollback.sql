-- ROLLBACK of 20261105000000_the_variants_a_brought_question_may_have_are_asked_for:
-- the enqueue as it stood (bank mistakes only). Jobs already queued for
-- uploads or matched bank questions stay queued.

BEGIN;

CREATE OR REPLACE FUNCTION public._enqueue_variant_generation(_plan jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _src   record;
  _tier  smallint;
  _added int := 0;
  _qid   uuid;
BEGIN
  IF _plan IS NULL OR _plan->>'mode' NOT IN ('deep', 'wide') THEN
    RETURN 0;
  END IF;

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    -- Nothing short at this rung means nothing to write. A plan that filled
    -- from the bank is the cache working, and enqueuing anyway would pay for
    -- questions that already exist.
    CONTINUE WHEN COALESCE((_plan->'tiers'->(_tier::text)->>'shortfall')::int, 0) = 0;

    FOR _src IN SELECT value AS v FROM jsonb_array_elements(_plan->'sources') LOOP
      _qid := (_src.v->>'question_id')::uuid;
      CONTINUE WHEN _qid IS NULL;

      -- Already have one for this question at this tier? Then this plan's
      -- shortfall is at a DIFFERENT source, and paying again would buy a
      -- duplicate. Checked against the bank rather than the queue because the
      -- bank is the truth.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.question_bank qb
         WHERE qb.source_question_id = _qid
           AND qb.variant_tier = _tier
           AND qb.is_active
           AND qb.replaced_by_question_id IS NULL);

      -- ON CONFLICT DO NOTHING against the partial unique index: two students
      -- finishing sessions in the same second, having failed the same
      -- question, must produce one job.
      INSERT INTO public.variant_generation_queue (source_question_id, tier)
      VALUES (_qid, _tier)
      ON CONFLICT DO NOTHING;

      IF FOUND THEN _added := _added + 1; END IF;
    END LOOP;
  END LOOP;

  RETURN _added;
END;
$function$;

DELETE FROM public.schema_migrations WHERE version = '20261105000000_the_variants_a_brought_question_may_have_are_asked_for';

COMMIT;
