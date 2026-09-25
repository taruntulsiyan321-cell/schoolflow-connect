-- ===========================================================================
-- RECOVERY VARIANTS ARE STORED WITHOUT OPTION LETTERS
--
-- The variant writer (ai-recovery-variants) stored options as the model wrote
-- them, sometimes lettered: ["A. 12:8:5", "B. 9:6:5", …]. The app letters
-- options itself, so a recovery question read "AA. 12:8:5" (measured
-- 2026-09-25, CUET audit account; 15 active variants). The writer now strips
-- them (_shared/optionLabels.ts); this strips the ones already stored, by the
-- same rule: only when EVERY option carries its label, in order.
--
-- ROLLBACK: rollback/20261095000000_recovery_variants_are_stored_without_option_letters.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.variant_option_letters_20261095 (question_id uuid PRIMARY KEY, old_options jsonb NOT NULL);
ALTER TABLE public.variant_option_letters_20261095 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.variant_option_letters_20261095 FROM PUBLIC, anon, authenticated;

-- Every option lettered in order: A, B, C, D (any of "A." "A)" "(A)" "A:").
INSERT INTO public.variant_option_letters_20261095 (question_id, old_options)
SELECT q.id, q.options FROM public.question_bank q
 WHERE q.source = 'ai_recovery_variant'
   AND jsonb_array_length(q.options) >= 2
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements_text(q.options) WITH ORDINALITY o(t, i)
      WHERE upper(substring(o.t FROM '^\s*[(\[]?\s*([A-Za-z])\s*[).\]:]\s')) IS DISTINCT FROM chr(64 + o.i::int));

UPDATE public.question_bank q
   SET options = (SELECT jsonb_agg(btrim(regexp_replace(o.t, '^\s*[(\[]?\s*[A-Za-z]\s*[).\]:]\s*', '')) ORDER BY o.i)
                    FROM jsonb_array_elements_text(q.options) WITH ORDINALITY o(t, i)),
       updated_at = now()
  FROM public.variant_option_letters_20261095 v
 WHERE q.id = v.question_id;

DO $proof$
DECLARE _n int; _left int;
BEGIN
  SELECT count(*) INTO _n FROM public.variant_option_letters_20261095;
  IF _n = 0 THEN RAISE EXCEPTION 'no lettered variants found — the measurement said 15 active'; END IF;
  SELECT count(*) INTO _left FROM public.question_bank q
   WHERE q.source = 'ai_recovery_variant' AND q.is_active
     AND q.options->>0 ~ '^\s*[(\[]?[A-D][).\]:]\s' AND q.options->>1 ~ '^\s*[(\[]?[A-D][).\]:]\s';
  IF _left <> 0 THEN RAISE EXCEPTION '% active variants still lettered', _left; END IF;
  RAISE NOTICE 'stripped letters from % variants', _n;
END
$proof$;

COMMIT;
