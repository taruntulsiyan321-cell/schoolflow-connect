-- DRAFT MIGRATION — NOT YET APPLIED — save for repair batch after Phase 1.5 close
-- See docs/production-audit/GLITCHES_AND_PROBLEMS.md G1-1..G1-20, G2-1..2-27
-- Do not apply until 12:30 IST 3h audit closes and team approves blast radius per table.
-- This file is the persistent repair backlog (rule #17 use proper migrations, rule #18 inspect existing data first).
-- All statements are idempotent (IF NOT EXISTS / coalesce) and preserve production data (no DROP TABLE).

-- G1-2 class_level outside 6..12: add CHECK and archive off-scope rows (do not delete, just is_active=false for honest empty)
ALTER TABLE public.question_bank ADD CONSTRAINT question_bank_class_level_check CHECK (class_level BETWEEN 6 AND 12) NOT VALID;
-- Backfill: class 5 -> is_active=false (2204 rows: 2189 +15 null)
UPDATE public.question_bank SET is_active = false, updated_at = now() WHERE class_level = 5 AND is_active = true;
UPDATE public.question_bank SET is_active = false, updated_at = now() WHERE class_level IS NULL AND is_active = true;
-- Validate after backfill: ALTER TABLE public.question_bank VALIDATE CONSTRAINT question_bank_class_level_check;

-- G1-1 + G1-13 + G1-14 + G2-12 mojibake: use SSOT _repair_utf8_mojibake (docs/ENCODING_SSOT.md, src/lib/utf8MojibakeRepair.ts)
-- Repair question_bank first (69% = 15087 rows contain �)
-- UPDATE public.question_bank SET question = public._repair_utf8_mojibake(question), chapter = public._repair_utf8_mojibake(chapter) WHERE question LIKE '%�%' OR chapter LIKE '%�%' OR question LIKE '%�?%' OR title LIKE '%�?%';
-- Then set is_active=false for still-corrupt after repair attempt: WHERE question LIKE '%�%' (remaining)
-- Apply same to dpp_questions.question ("axA�") and homework.title ("�?? Euclid")
-- UPDATE public.dpp_questions SET question = public._repair_utf8_mojibake(question) WHERE question LIKE '%�%';
-- UPDATE public.homework SET title = public._repair_utf8_mojibake(title) WHERE title LIKE '%�%';

-- G1-3 dup question: dedup leaving earliest id per (question,class_level,subject)
-- DELETE FROM public.question_bank a USING public.question_bank b WHERE a.id > b.id AND a.question = b.question AND a.class_level = b.class_level AND a.subject = b.subject AND a.is_active = true AND b.is_active = true;
-- Then partial unique index to prevent re-gen dup (only active rows):
-- CREATE UNIQUE INDEX IF NOT EXISTS question_bank_unique_active ON public.question_bank (question, class_level, subject) WHERE is_active = true;

-- G1-12 dpp_attempts null student_id orphan: backfill or delete orphan, then NOT NULL
-- Orphan id 73af48f5-506b-4bef-87d2-143d8825cade is_published false draft — safe to delete:
-- DELETE FROM public.dpp_attempts WHERE id = '73af48f5-506b-4bef-87d2-143d8825cade' AND student_id IS NULL;
-- ALTER TABLE public.dpp_attempts ALTER COLUMN student_id SET NOT NULL; -- after orphan removed

-- G1-20 homework is_late bypass: add trigger to compute is_late server-side (cannot be forged via REST)
-- CREATE OR REPLACE FUNCTION public.tg_homework_compute_is_late() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.is_late := (SELECT (h.due_date + COALESCE(h.due_time,'00:00')::time) < NEW.submitted_at::timestamp FROM public.homework h WHERE h.id=NEW.homework_id); RETURN NEW; END; $$;
-- DROP TRIGGER IF EXISTS trg_homework_is_late ON public.homework_submissions; CREATE TRIGGER trg_homework_is_late BEFORE INSERT OR UPDATE ON public.homework_submissions FOR EACH ROW EXECUTE FUNCTION public.tg_homework_compute_is_late();

-- G2-25 + G2-9 brain/revision school_id null 2/2 each: backfill from students
-- UPDATE public.revision_queue rq SET school_id = s.school_id FROM public.students s WHERE rq.student_id = s.id AND rq.school_id IS NULL;
-- UPDATE public.student_academic_brain b SET school_id = s.school_id FROM public.students s WHERE b.student_id = s.id AND b.school_id IS NULL;
-- UPDATE public.student_academic_brain b SET school_id = (SELECT school_id FROM public.students WHERE id=b.student_id) WHERE school_id IS NULL; -- fallback

-- G2-8 recovery_assignments dup 2x Polynomials: add unique to enforce idempotency
-- DELETE FROM public.recovery_assignments a USING public.recovery_assignments b WHERE a.ctid > b.ctid AND a.user_id=b.user_id AND a.subject=b.subject AND a.concept=b.concept AND a.status='pending';
-- CREATE UNIQUE INDEX IF NOT EXISTS recovery_unique_pending ON public.recovery_assignments (user_id, subject, concept) WHERE status='pending';

-- G2-1 XP level drift 5/9: recompute levels via progression_level_for_xp (seed inserted manually)
-- UPDATE public.student_xp SET level = public.progression_level_for_xp(xp) WHERE level != public.progression_level_for_xp(xp);
-- League already correct via league_code, but verify: UPDATE public.student_xp SET league_code = public.progression_league_for_xp(xp) WHERE league_code != public.progression_league_for_xp(xp);

-- G1-10 subjects 0: backfill catalog from distinct bank subjects (text until subject_id FK migration)
-- INSERT INTO public.subjects (id, name, code, school_id) SELECT gen_random_uuid(), display, lower(display), '00000000-0000-4000-8000-000000000001' FROM (SELECT DISTINCT subject as display FROM public.question_bank WHERE subject IS NOT NULL) s ON CONFLICT DO NOTHING; -- adjust per actual subjects table cols

-- G1-6 marks published gate: demo seed should publish exams for verification (honest empty otherwise)
-- UPDATE public.exams SET results_published_at = now() WHERE school_id='00000000-0000-4000-8000-000000000001' AND results_published_at IS NULL; -- demo only, team to confirm before apply

-- After all: refresh types: npm run db:types --project-id psqxykzqfvxgsvkmgurn > src/integrations/supabase/types.ts
