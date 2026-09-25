-- ROLLBACK 20261084000000 — every CUET copy is served again: the duplicates
-- with their "[<chapter>]" tags, the questions with two keys, the ones that
-- cannot be answered, the stems and options with page furniture. Moves every
-- reference back first, then restores each row from the repair table: kept
-- rows first (their tagged stems cannot collide), then the retired ones.
BEGIN;

UPDATE public.student_mistakes sm SET question_id = r.old_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'student_mistakes' AND sm.id = r.ref_key::uuid;

UPDATE public.practice_bookmarks pb SET question_id = r.old_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'practice_bookmarks' AND pb.id = r.ref_key::uuid;

DELETE FROM public.student_question_history h
 USING public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'student_question_history' AND r.inserted
   AND h.user_id = split_part(r.ref_key, ':', 1)::uuid AND h.question_id = r.new_question_id;

UPDATE public.question_bank v SET source_question_id = r.old_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'question_bank.source_question_id' AND v.id = r.ref_key::uuid;

UPDATE public.variant_generation_queue j SET source_question_id = r.old_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'variant_generation_queue' AND j.id = r.ref_key::uuid;

UPDATE public.question_bank q
   SET question = r.old_question, options = r.old_options, embed_status = r.old_embed_status, updated_at = now()
  FROM public.cuet_bank_repair_20261084 r
 WHERE q.id = r.question_id AND r.action LIKE 'kept%';

UPDATE public.question_bank q
   SET is_active = r.old_is_active, replaced_by_question_id = r.old_replaced_by, updated_at = now()
  FROM public.cuet_bank_repair_20261084 r
 WHERE q.id = r.question_id AND r.action LIKE 'retired%';

DROP TABLE public.cuet_ref_repoint_20261084;
DROP TABLE public.cuet_bank_repair_20261084;

DELETE FROM public.schema_migrations WHERE version = '20261084000000_the_cuet_bank_serves_each_question_once';

COMMIT;
