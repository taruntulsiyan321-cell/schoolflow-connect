-- ===========================================================================
-- PLACEHOLDER VARIANTS ARE NOT SERVED
--
-- Measured 2026-09-25 (live Subject Practice, CUET audit account): a question
-- read "[T1 conceptual] Investments valued ₹20,000 were taken over by the
-- creditors…". 11 active rows with source 'ai_recovery_variant' were all
-- created at one instant (2026-09-23 15:57:06) as "[T<n> conceptual] <the
-- original stem> — restated for recovery": hand-inserted placeholders, not the
-- AI writer's output (the text appears nowhere in the repository or its
-- history). They are served to students as if they were questions — 14
-- attempts so far.
--
-- Retires them. Recovery's scoring already treats a withdrawn planned
-- question as neither right nor wrong (#17), and the ladder regenerates a
-- real variant for any tier they leave short.
--
-- ROLLBACK: rollback/20261089000000_placeholder_variants_are_not_served.rollback.sql
-- ===========================================================================
BEGIN;

CREATE TABLE public.placeholder_variants_20261089 (question_id uuid PRIMARY KEY, old_question text NOT NULL);
ALTER TABLE public.placeholder_variants_20261089 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.placeholder_variants_20261089 FROM PUBLIC, anon, authenticated;

INSERT INTO public.placeholder_variants_20261089 (question_id, old_question)
SELECT id, question FROM public.question_bank
 WHERE source = 'ai_recovery_variant' AND is_active
   AND question ~ '^\[T\d conceptual\]' AND question ~ '— restated for recovery\s*$';

UPDATE public.question_bank q SET is_active = false, updated_at = now()
  FROM public.placeholder_variants_20261089 p WHERE q.id = p.question_id;

DO $proof$
DECLARE _n int; _moved int;
BEGIN
  SELECT count(*) INTO _moved FROM public.placeholder_variants_20261089;
  IF _moved <> 11 THEN RAISE EXCEPTION 'expected the 11 measured placeholders, found %', _moved; END IF;
  SELECT count(*) INTO _n FROM public.question_bank WHERE is_active AND question ~ '^\[T\d';
  IF _n <> 0 THEN RAISE EXCEPTION '% labelled placeholder rows still served', _n; END IF;
END
$proof$;

COMMIT;
