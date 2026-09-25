-- ===========================================================================
-- THE LAST THREE CUET COPIES RETIRE
--
-- 20261084000000 grouped copies on the stem with quote marks removed and
-- spacing collapsed, but not trimmed, so a copy that opens with a quote and a
-- space ("‘ Apex Softwares’ sends…") kept a leading space after the quote was
-- removed and was grouped apart from "Apex Softwares’ sends…". Measured after
-- it ran: three such pairs still served (Apex Softwares, AutoGear Ltd., Glow
-- Cosmetics) — same question, same options, same key.
--
-- Retires the copy with the stray quote in each pair, pointing it at the
-- other, and moves what referenced it — recorded in the same repair tables
-- (action 'retired_duplicate_quote'), so 20261084000000's rollback undoes this
-- too.
--
-- ROLLBACK: rollback/20261088000000_the_last_three_cuet_copies_retire.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TEMP TABLE _pair ON COMMIT DROP AS
WITH b AS (
  SELECT q.id, q.question, q.correct_index, q.options, q.created_at,
         lower(regexp_replace(q.question, '[‘’''“”"`\s]', '', 'g')) AS k
    FROM public.question_bank q JOIN public.competitive_exams ce ON ce.id = q.exam_id
   WHERE ce.code = 'cuet' AND q.is_active AND q.source_question_id IS NULL
), g AS (
  SELECT k FROM b GROUP BY k HAVING count(*) > 1 AND count(DISTINCT correct_index) = 1
), ranked AS (
  SELECT b.*, row_number() OVER (PARTITION BY b.k ORDER BY (b.question ~ '^[‘’''“”"`]\s') , b.created_at, b.id) AS rn
    FROM b JOIN g USING (k)
)
SELECT r.id AS old_id, (SELECT r2.id FROM ranked r2 WHERE r2.k = r.k AND r2.rn = 1) AS new_id,
       r.question, r.options
  FROM ranked r WHERE r.rn > 1;

INSERT INTO public.cuet_bank_repair_20261084
  (question_id, action, kept_id, old_question, old_options, old_is_active, old_replaced_by, old_embed_status)
SELECT q.id, 'retired_duplicate_quote', p.new_id, q.question, q.options, q.is_active, q.replaced_by_question_id, q.embed_status
  FROM _pair p JOIN public.question_bank q ON q.id = p.old_id;

UPDATE public.question_bank q SET is_active = false, replaced_by_question_id = p.new_id, updated_at = now()
  FROM _pair p WHERE q.id = p.old_id;

INSERT INTO public.cuet_ref_repoint_20261084 (ref_table, ref_key, old_question_id, new_question_id)
SELECT 'student_mistakes', sm.id::text, p.old_id, p.new_id
  FROM public.student_mistakes sm JOIN _pair p ON p.old_id = sm.question_id
 WHERE sm.status = 'open'
   AND NOT EXISTS (SELECT 1 FROM public.student_mistakes x
                    WHERE x.user_id = sm.user_id AND x.source = sm.source AND x.question_id = p.new_id);
UPDATE public.student_mistakes sm SET question_id = r.new_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'student_mistakes' AND sm.id = r.ref_key::uuid AND r.old_question_id IN (SELECT old_id FROM _pair);

INSERT INTO public.cuet_ref_repoint_20261084 (ref_table, ref_key, old_question_id, new_question_id)
SELECT 'question_bank.source_question_id', v.id::text, p.old_id, p.new_id
  FROM public.question_bank v JOIN _pair p ON p.old_id = v.source_question_id;
UPDATE public.question_bank v SET source_question_id = r.new_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'question_bank.source_question_id' AND v.id = r.ref_key::uuid AND r.old_question_id IN (SELECT old_id FROM _pair);

DO $proof$
DECLARE _n int; _moved int;
BEGIN
  SELECT count(*) INTO _moved FROM _pair;
  IF _moved <> 3 THEN RAISE EXCEPTION 'expected the 3 measured pairs, found %', _moved; END IF;

  -- The key that found them: quotes and ALL whitespace removed.
  SELECT count(*) INTO _n FROM (
    SELECT 1 FROM public.question_bank q JOIN public.competitive_exams ce ON ce.id = q.exam_id
     WHERE ce.code = 'cuet' AND q.is_active AND q.source_question_id IS NULL
     GROUP BY lower(regexp_replace(q.question, '[‘’''“”"`\s]', '', 'g')) HAVING count(*) > 1) x;
  IF _n <> 0 THEN RAISE EXCEPTION '% CUET stems still served more than once', _n; END IF;
END
$proof$;

COMMIT;
