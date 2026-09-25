-- ROLLBACK of 20261099000000_a_cut_off_copy_is_not_served: every reference
-- back to the cut-off copy it was moved from, the seen-history rows it added
-- deleted, and each cut-off copy served again as it was. The mistake copies
-- repointed are rewritten from their question on the way back.

BEGIN;

DELETE FROM public.student_question_history h
 USING public.cuet_ref_repoint_20261099 r
 WHERE r.ref_table = 'student_question_history' AND r.inserted
   AND h.user_id = split_part(r.ref_key, ':', 1)::uuid AND h.question_id = r.new_question_id;

UPDATE public.variant_generation_queue j SET source_question_id = r.old_question_id
  FROM public.cuet_ref_repoint_20261099 r
 WHERE r.ref_table = 'variant_generation_queue' AND j.id = r.ref_key::uuid;

UPDATE public.question_bank v SET source_question_id = r.old_question_id
  FROM public.cuet_ref_repoint_20261099 r
 WHERE r.ref_table = 'question_bank.source_question_id' AND v.id = r.ref_key::uuid;

UPDATE public.practice_bookmarks pb SET question_id = r.old_question_id
  FROM public.cuet_ref_repoint_20261099 r
 WHERE r.ref_table = 'practice_bookmarks' AND pb.id = r.ref_key::uuid;

UPDATE public.question_bank q
   SET is_active = c.old_is_active, replaced_by_question_id = c.old_replaced_by, updated_at = now()
  FROM public.cuet_cutoff_repair_20261099 c
 WHERE q.id = c.question_id;

UPDATE public.student_mistakes sm
   SET question_id = r.old_question_id, question_text = q.question, options = q.options
  FROM public.cuet_ref_repoint_20261099 r JOIN public.question_bank q ON q.id = r.old_question_id
 WHERE r.ref_table = 'student_mistakes' AND sm.id = r.ref_key::uuid;

DROP TABLE public.cuet_ref_repoint_20261099;
DROP TABLE public.cuet_cutoff_repair_20261099;

DELETE FROM public.schema_migrations WHERE version = '20261099000000_a_cut_off_copy_is_not_served';

COMMIT;
