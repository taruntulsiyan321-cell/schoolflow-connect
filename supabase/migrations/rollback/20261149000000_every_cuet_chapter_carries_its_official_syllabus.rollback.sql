-- ROLLBACK of 20261149000000_every_cuet_chapter_carries_its_official_syllabus: the official syllabus text goes.
BEGIN;
ALTER TABLE public.exam_syllabus_chapters DROP COLUMN paper_asks;
ALTER TABLE public.exam_syllabus_chapters DROP COLUMN syllabus_text;
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'exam_syllabus_chapters'
              AND column_name IN ('syllabus_text', 'paper_asks')) THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: the syllabus columns are still there';
  END IF;
END $verify$;
COMMIT;
