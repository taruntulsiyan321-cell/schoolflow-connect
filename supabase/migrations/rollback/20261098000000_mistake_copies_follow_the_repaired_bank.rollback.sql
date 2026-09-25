-- ROLLBACK of 20261098000000_mistake_copies_follow_the_repaired_bank:
-- every repaired row's question_text, options and student_answer as logged.

BEGIN;

UPDATE public.student_mistakes sm
   SET question_text = r.before->>'question_text',
       options = r.before->'options',
       student_answer = r.before->'student_answer'
  FROM public.mistake_copy_repair_20261098 r
 WHERE r.mistake_id = sm.id;

DROP TABLE public.mistake_copy_repair_20261098;

DELETE FROM public.schema_migrations WHERE version = '20261098000000_mistake_copies_follow_the_repaired_bank';

COMMIT;
