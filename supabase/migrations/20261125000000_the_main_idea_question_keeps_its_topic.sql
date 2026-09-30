-- ═══════════════════════════════════════════════════════════════════════════
-- THE MAIN-IDEA QUESTION KEEPS ITS TOPIC
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Rule 31 (amended 2026-09-15): every chaptered question names one topic of
-- its own chapter. Measured 2026-09-30, exactly one active question does not:
--
--   a45db281-b60b-4bb2-b2c9-5654eedefde1   CUET English, "Reading Comprehension"
--   "In a passage, the central idea is best described as"
--
-- 20261090000000 put it there. Its own comment says "the seed questions' own
-- topics carried to their NTA chapters", and its per-question list gave every
-- kept seed question a topic — except this one, listed with topic NULL. Its
-- chapter did not change ("Reading Comprehension" already existed and became
-- the NTA chapter as it was), and its own topic, "Main idea"
-- (e3c430c9-a01c-46a7-a485-c805cca465c1), is still a topic of that chapter —
-- with no question left in it. public.cuet_chapter_rebuild_20261090 records
-- the change: topic_id e3c430c9… -> NULL. The question is about the main idea
-- of a passage; the topic is "Main idea". It goes back.
--
-- Nothing enforces rule 31's "every chaptered question names a topic" at the
-- table (the composite key onto topics (id, chapter_id) accepts a NULL), which
-- is how a migration could leave one behind silently. The check that does is
-- CHUNK2_VERIFY §5, rewritten on the same day to assert rule 31 as amended.
--
-- ROLLBACK: rollback/20261125000000_the_main_idea_question_keeps_its_topic.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $fix$
DECLARE
  _q     constant uuid := 'a45db281-b60b-4bb2-b2c9-5654eedefde1';
  _topic constant uuid := 'e3c430c9-a01c-46a7-a485-c805cca465c1';
  _row   record;
BEGIN
  SELECT qb.id, qb.chapter_id, qb.topic_id, t.chapter_id AS topic_chapter, t.name AS topic_name
    INTO _row
    FROM public.question_bank qb
    LEFT JOIN public.topics t ON t.id = _topic
   WHERE qb.id = _q;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'the question % is gone — nothing to restore', _q;
  END IF;
  IF _row.topic_chapter IS DISTINCT FROM _row.chapter_id THEN
    RAISE EXCEPTION 'topic % (%) is not a topic of the question''s chapter %', _topic, _row.topic_name, _row.chapter_id;
  END IF;

  -- Idempotent: a re-run finds it already filed and changes nothing.
  IF _row.topic_id IS NULL THEN
    UPDATE public.question_bank SET topic_id = _topic WHERE id = _q AND topic_id IS NULL;
  ELSIF _row.topic_id <> _topic THEN
    RAISE EXCEPTION 'the question has since been filed under % — not overwriting a later decision', _row.topic_id;
  END IF;

  -- The proof: it names the topic, and the topic is its own chapter's.
  IF NOT EXISTS (
    SELECT 1 FROM public.question_bank qb JOIN public.topics t ON t.id = qb.topic_id
     WHERE qb.id = _q AND t.chapter_id = qb.chapter_id AND t.name = 'Main idea'
  ) THEN
    RAISE EXCEPTION 'the question does not name "Main idea" of its own chapter after the update';
  END IF;
END
$fix$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261125000000_the_main_idea_question_keeps_its_topic')
ON CONFLICT (version) DO NOTHING;

COMMIT;
