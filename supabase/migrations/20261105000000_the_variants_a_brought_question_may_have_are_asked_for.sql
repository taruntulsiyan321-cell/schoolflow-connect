-- ===========================================================================
-- THE VARIANTS A BROUGHT QUESTION MAY HAVE ARE ASKED FOR
--
-- Variants are queued at the end of practice, for the chapters a recovery
-- session is being prepared for (_enqueue_variant_generation). Only a mistake
-- on a BANK question was ever queued. Two kinds of brought question are
-- allowed variants and never got them — measured 2026-09-25: no
-- upload-sourced variant generated or queued, ever; the owner-driven enqueue
-- (rpc_enqueue_upload_variant_generation) has no caller in the app:
--
--   * an upload answered from its own file gets variants of its own
--     (upload spec §10), promoted to the bank only through §10.2's gates;
--   * a capture, or an AI-answered upload, matched to a bank question when it
--     was filed, gets that BANK question's variants — which then serve every
--     student who fails it.
--
-- Nothing is generated from captured content (screen-capture spec §9) or from
-- an AI-answered upload (upload §6.2). A bank mistake is queued exactly as
-- before: only when its rung came up short.
--
-- ROLLBACK: rollback/20261105000000_the_variants_a_brought_question_may_have_are_asked_for.rollback.sql
-- ===========================================================================

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
  _up    uuid;
  _anchor uuid;
BEGIN
  IF _plan IS NULL OR _plan->>'mode' NOT IN ('deep', 'wide') THEN
    RETURN 0;
  END IF;

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    FOR _src IN SELECT value AS v FROM jsonb_array_elements(_plan->'sources') LOOP
      _qid    := NULLIF(_src.v->>'question_id', '')::uuid;
      _up     := NULLIF(_src.v->>'upload_question_id', '')::uuid;
      _anchor := NULLIF(_src.v->>'anchor_question_id', '')::uuid;

      IF _qid IS NOT NULL THEN
        -- A BANK ORIGINAL. Nothing short at this rung means nothing to write:
        -- a plan that filled from the bank is the cache working, and enqueuing
        -- anyway would pay for questions that already exist.
        CONTINUE WHEN COALESCE((_plan->'tiers'->(_tier::text)->>'shortfall')::int, 0) = 0;

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

      ELSIF _up IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.student_upload_questions uq
               WHERE uq.id = _up AND uq.answer_source = 'file') THEN
        -- AN UPLOAD ANSWERED FROM ITS OWN FILE gets variants of its own
        -- (upload spec §10). Asked for even when bank questions filled the
        -- rung meanwhile: those are the chapter's questions, not this one's.
        -- An AI-answered upload never reaches here (§6.2).
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public.question_bank qb
           WHERE qb.source_upload_question_id = _up
             AND qb.variant_tier = _tier
             AND qb.is_active
             AND qb.replaced_by_question_id IS NULL);
        INSERT INTO public.variant_generation_queue (source_upload_question_id, tier)
        VALUES (_up, _tier)
        ON CONFLICT DO NOTHING;
        IF FOUND THEN _added := _added + 1; END IF;

      ELSIF _anchor IS NOT NULL THEN
        -- A CAPTURE, OR AN AI-ANSWERED UPLOAD, matched to a bank question when
        -- it was filed. Nothing is generated from the student's own content
        -- (screen-capture spec §9, upload §6.2); the bank question it matched
        -- is a bank original, and its variants serve everyone who fails it.
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public.question_bank qb
           WHERE qb.source_question_id = _anchor
             AND qb.variant_tier = _tier
             AND qb.is_active
             AND qb.replaced_by_question_id IS NULL);
        INSERT INTO public.variant_generation_queue (source_question_id, tier)
        VALUES (_anchor, _tier)
        ON CONFLICT DO NOTHING;
        IF FOUND THEN _added := _added + 1; END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN _added;
END;
$function$;

-- ── Verify (each check can fail) ─────────────────────────────────────────────
-- Runs the enqueue on hand-built plans inside a block that rolls back, so no
-- job it writes survives.
DO $proof$
DECLARE
  _ai_anchor uuid; _anchor uuid; _bank uuid;
  _n_file int; _n_anchor int; _n_ai_plain int; _n_bank_full int; _n_capture int;
  _tiers jsonb := '{"1": {"shortfall": 1}, "2": {"shortfall": 1}}';
  _full  jsonb := '{"1": {"shortfall": 0}, "2": {"shortfall": 0}}';
BEGIN
  SELECT uq.id, uq.matched_bank_question_id INTO _ai_anchor, _anchor
    FROM public.student_upload_questions uq
   WHERE uq.answer_source = 'ai' AND uq.matched_bank_question_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.question_bank v WHERE v.source_question_id = uq.matched_bank_question_id)
   LIMIT 1;
  SELECT q.id INTO _bank FROM public.question_bank q
   WHERE q.is_active AND q.source_question_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.question_bank v WHERE v.source_question_id = q.id) LIMIT 1;

  BEGIN
    DELETE FROM public.variant_generation_queue WHERE status = 'pending';

    -- An AI-answered upload with no match: nothing (§6.2).
    _n_ai_plain := public._enqueue_variant_generation(jsonb_build_object('mode', 'deep', 'tiers', _tiers,
      'sources', jsonb_build_array(jsonb_build_object('upload_question_id', _ai_anchor))));
    -- The same upload's matched bank question: its variants.
    _n_anchor := public._enqueue_variant_generation(jsonb_build_object('mode', 'deep', 'tiers', _tiers,
      'sources', jsonb_build_array(jsonb_build_object('upload_question_id', _ai_anchor, 'anchor_question_id', _anchor))));
    -- A capture with no match: nothing (§9).
    _n_capture := public._enqueue_variant_generation(jsonb_build_object('mode', 'deep', 'tiers', _tiers,
      'sources', jsonb_build_array(jsonb_build_object('capture_question_id', gen_random_uuid()))));
    -- The same upload, had it been answered from its file: its own variants,
    -- one per rung (the change is rolled back with everything else here).
    UPDATE public.student_upload_questions SET answer_source = 'file' WHERE id = _ai_anchor;
    _n_file := public._enqueue_variant_generation(jsonb_build_object('mode', 'deep', 'tiers', _full,
      'sources', jsonb_build_array(jsonb_build_object('upload_question_id', _ai_anchor))));
    SELECT count(*) INTO _n_file FROM public.variant_generation_queue
     WHERE source_upload_question_id = _ai_anchor AND status = 'pending' AND _n_file = 2;
    -- CONTROL: a bank mistake whose rungs filled is not queued, as before.
    _n_bank_full := public._enqueue_variant_generation(jsonb_build_object('mode', 'deep', 'tiers', _full,
      'sources', jsonb_build_array(jsonb_build_object('question_id', _bank))));

    RAISE EXCEPTION 'proof_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'proof_rollback' THEN RAISE; END IF;
  END;

  IF _ai_anchor IS NULL THEN RAISE EXCEPTION 'no AI-answered upload with a bank match to prove this on'; END IF;
  IF _n_ai_plain <> 0 THEN RAISE EXCEPTION 'an AI-answered upload queued % generation(s) from itself', _n_ai_plain; END IF;
  IF _n_anchor <> 2 THEN RAISE EXCEPTION 'a matched bank question was queued % time(s), expected one per rung (2)', _n_anchor; END IF;
  IF _n_file <> 2 THEN RAISE EXCEPTION 'an upload answered from its file queued % job(s) of its own, expected 2 (even with its rungs filled)', _n_file; END IF;
  IF _n_capture <> 0 THEN RAISE EXCEPTION 'a capture queued % generation(s)', _n_capture; END IF;
  IF _n_bank_full <> 0 THEN RAISE EXCEPTION 'CONTROL: a bank mistake with full rungs was queued'; END IF;
END
$proof$;

COMMIT;
