-- =====================================================================
-- CHUNK 5 (correction) — homework.topic_id
--
-- The doc update that approved Chunk 5 also changed the homework column list
-- from `topic (free text)` to `chapter_id (nullable) · topic_id (nullable)`.
-- chapter_id was already added; topic_id is added here.
--
-- WHAT EACH OF THE THREE IS FOR, because they look overlapping and are not:
--   chapter_id  the chapter this homework covers. Picked from a list filtered
--               to the teacher's own subject and class (§10.22), never typed.
--   topic_id    a structured topic for homework that has no questions to hang
--               one on — the `upload` and `none` submission modes. Digital
--               homework carries topic per ANSWER, on homework_answers.topic_id,
--               because §10.22 says topic is chosen "per question, not per test".
--   topic       the free-text label §10.22 still allows "where no chapter fits".
--               It is a CHAPTER fallback, not a topic fallback; the column name
--               is inherited from the older spec and reads misleadingly.
--
-- FLAGGED: a homework-level topic_id sits in mild tension with §10.22's "per
-- question, not per test". It is reconciled above — non-digital homework has no
-- questions — but if topic is meant to be per-question only, this column should
-- go and §10.22 should say so. Raised rather than resolved unilaterally.
--
-- Reverse: supabase/migrations/rollback/20260826230000_chunk5_topic_id_down.sql
-- =====================================================================

ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.topics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS homework_topic_idx ON public.homework (topic_id);

COMMENT ON COLUMN public.homework.topic_id IS
  'Structured topic for homework with no questions (upload/none modes). Digital homework carries topic per answer on homework_answers.topic_id — §10.22: per question, not per test.';

COMMENT ON COLUMN public.homework.topic IS
  'Free-text label for the case where no CHAPTER fits (§10.22). Despite the name this is a chapter fallback, not a topic fallback; topic_id is the structured topic.';

-- A topic must belong to the chapter the homework is on. Otherwise the pair
-- can drift into naming a topic from an unrelated chapter, which would corrupt
-- every rollup that trusts the pair.
CREATE OR REPLACE FUNCTION public.tg_homework_topic_matches_chapter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _topic_chapter uuid;
BEGIN
  IF NEW.topic_id IS NULL THEN RETURN NEW; END IF;

  SELECT t.chapter_id INTO _topic_chapter FROM public.topics t WHERE t.id = NEW.topic_id;

  IF NEW.chapter_id IS NULL THEN
    RAISE EXCEPTION 'homework has a topic but no chapter; a topic only means something inside its chapter';
  END IF;

  IF _topic_chapter IS DISTINCT FROM NEW.chapter_id THEN
    RAISE EXCEPTION 'topic % belongs to chapter %, not the homework''s chapter %',
      NEW.topic_id, _topic_chapter, NEW.chapter_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_homework_topic_matches_chapter ON public.homework;
CREATE TRIGGER trg_homework_topic_matches_chapter
  BEFORE INSERT OR UPDATE OF topic_id, chapter_id ON public.homework
  FOR EACH ROW EXECUTE FUNCTION public.tg_homework_topic_matches_chapter();

REVOKE EXECUTE ON FUNCTION public.tg_homework_topic_matches_chapter() FROM public, anon, authenticated;

-- The same rule for answers: a topic is only meaningful inside its chapter.
CREATE OR REPLACE FUNCTION public.tg_homework_answer_topic_matches_chapter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _topic_chapter uuid;
BEGIN
  IF NEW.topic_id IS NULL THEN RETURN NEW; END IF;
  SELECT t.chapter_id INTO _topic_chapter FROM public.topics t WHERE t.id = NEW.topic_id;
  IF NEW.chapter_id IS NOT NULL AND _topic_chapter IS DISTINCT FROM NEW.chapter_id THEN
    RAISE EXCEPTION 'answer topic % belongs to chapter %, not %',
      NEW.topic_id, _topic_chapter, NEW.chapter_id;
  END IF;
  -- Derive the chapter from the topic when only the topic was supplied.
  IF NEW.chapter_id IS NULL THEN NEW.chapter_id := _topic_chapter; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_homework_answer_topic_matches_chapter ON public.homework_answers;
CREATE TRIGGER trg_homework_answer_topic_matches_chapter
  BEFORE INSERT OR UPDATE OF topic_id, chapter_id ON public.homework_answers
  FOR EACH ROW EXECUTE FUNCTION public.tg_homework_answer_topic_matches_chapter();

REVOKE EXECUTE ON FUNCTION public.tg_homework_answer_topic_matches_chapter() FROM public, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='homework' AND column_name='topic_id') THEN
    RAISE EXCEPTION 'Chunk 5 correction: homework.topic_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_homework_topic_matches_chapter' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Chunk 5 correction: the topic/chapter consistency trigger is missing';
  END IF;
END $$;
