-- ROLLBACK 20261088000000 — the three copies with a stray leading quote are
-- served again, and what referenced them points back at them.
BEGIN;

UPDATE public.student_mistakes sm SET question_id = r.old_question_id
  FROM public.cuet_ref_repoint_20261084 r
  JOIN public.cuet_bank_repair_20261084 b ON b.question_id = r.old_question_id AND b.action = 'retired_duplicate_quote'
 WHERE r.ref_table = 'student_mistakes' AND sm.id = r.ref_key::uuid;

UPDATE public.question_bank v SET source_question_id = r.old_question_id
  FROM public.cuet_ref_repoint_20261084 r
  JOIN public.cuet_bank_repair_20261084 b ON b.question_id = r.old_question_id AND b.action = 'retired_duplicate_quote'
 WHERE r.ref_table = 'question_bank.source_question_id' AND v.id = r.ref_key::uuid;

DELETE FROM public.cuet_ref_repoint_20261084 r
 USING public.cuet_bank_repair_20261084 b
 WHERE b.question_id = r.old_question_id AND b.action = 'retired_duplicate_quote';

UPDATE public.question_bank q
   SET is_active = b.old_is_active, replaced_by_question_id = b.old_replaced_by, updated_at = now()
  FROM public.cuet_bank_repair_20261084 b
 WHERE q.id = b.question_id AND b.action = 'retired_duplicate_quote';

DELETE FROM public.cuet_bank_repair_20261084 WHERE action = 'retired_duplicate_quote';

DELETE FROM public.schema_migrations WHERE version = '20261088000000_the_last_three_cuet_copies_retire';

COMMIT;
