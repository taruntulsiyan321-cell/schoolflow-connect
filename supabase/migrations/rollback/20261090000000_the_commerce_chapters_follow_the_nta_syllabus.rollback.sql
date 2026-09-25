-- ROLLBACK 20261090000000 — the CUET catalog as it was: "Macroeconomics",
-- "Microeconomics", Algebra, Calculus, Grammar, Vocabulary, "Partnership
-- Accounts" and "Financial Statements" come back, every row moves back to
-- them, the five retired seed questions are served again, and the NTA
-- chapters, topics and the General Aptitude Test subject this created go.
BEGIN;

-- The deleted chapters and topics, as they were (ids kept).
INSERT INTO public.chapters
SELECT (jsonb_populate_record(NULL::public.chapters, payload)).*
  FROM public.cuet_chapter_rebuild_20261090 WHERE kind = 'deleted_chapter';
INSERT INTO public.topics
SELECT (jsonb_populate_record(NULL::public.topics, payload)).*
  FROM public.cuet_chapter_rebuild_20261090 WHERE kind = 'deleted_topic';

-- Every change undone, newest first.
DO $undo$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.cuet_chapter_rebuild_20261090 WHERE kind = 'set' ORDER BY seq DESC LOOP
    EXECUTE format('UPDATE public.%I SET %I = $1::%s WHERE id = $2', r.table_name, r.column_name,
                   (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
                     WHERE a.attrelid = ('public.' || r.table_name)::regclass AND a.attname = r.column_name))
      USING r.old_value, r.row_id;
  END LOOP;
END $undo$;

DELETE FROM public.topics
 WHERE id IN (SELECT row_id FROM public.cuet_chapter_rebuild_20261090 WHERE kind = 'created_topic');
DELETE FROM public.chapters
 WHERE id IN (SELECT row_id FROM public.cuet_chapter_rebuild_20261090 WHERE kind = 'created_chapter');
DELETE FROM public.curriculum_subjects
 WHERE id IN (SELECT row_id FROM public.cuet_chapter_rebuild_20261090 WHERE kind = 'created_subject');

DROP TABLE public.cuet_chapter_rebuild_20261090;

DELETE FROM public.schema_migrations WHERE version = '20261090000000_the_commerce_chapters_follow_the_nta_syllabus';

COMMIT;
