-- ════════════════════════════════════════════════════════════════════════════
-- THE QUESTION KNOWS ITS OWN CHAPTER
-- ════════════════════════════════════════════════════════════════════════════
--
-- 20261024000000 gave _weak_topics_for_user a real topic and deliberately left
-- the chapter key alone, so that a regression could be attributed to one change
-- rather than two. Measuring the result showed why the second change is needed:
-- the same topic comes back TWICE.
--
--   Mathematics | Matrices | Order and Types of Matrices | 7 attempts
--   (empty)     | (null)   | Order and Types of Matrices | 4 attempts
--
-- WHY
--
-- The subject and chapter came from the SESSION, and a session only knows them
-- when the student picked them. Measured on production:
--
--   weak        14 sessions   all null chapter, all empty subject
--   subject     11 sessions   all null chapter
--   bookmarked   3 sessions   all null chapter, all empty subject
--   skipped      2 sessions   all null chapter, all empty subject
--   recovery     2 sessions   all null chapter, all empty subject
--   chapter      3 of 22      null chapter
--
-- Thirty-five sessions, every one of them a mode where the student did not
-- name a chapter up front. Their attempts land in a phantom (subject '',
-- chapter null) bucket, so practising a topic through weak-areas and through
-- its chapter produces two rows and neither shows the real total. The accuracy
-- on both is wrong, and a topic can be under the weak margin on one row while
-- above it on the other.
--
-- THE FIX
--
-- The question carries its own subject and chapter — all 21,711 bank rows have
-- them — and it is the thing that was actually answered. So they are read from
-- the question, and the session is the fallback for the 4,800 legacy attempts
-- that carry no bank_question_id.
--
-- This does not change what a CHAPTER means anywhere else: chapter_state,
-- recovery and revision are keyed on chapter_id and are untouched. It changes
-- only which chapter an ATTEMPT is counted under, and only in the direction of
-- the question's own truth.
--
-- ROLLBACK: supabase/migrations/rollback/20261025000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = '_weak_topics_for_user';
  IF _def IS NULL THEN RAISE EXCEPTION '_weak_topics_for_user not found'; END IF;

  _new := replace(_def,
    '      ps.subject                   AS subject,
      ps.chapter                   AS chapter,
      COALESCE(t.name, ps.chapter) AS topic,',
    '      -- From the QUESTION first: a weak/subject/bookmarked/skipped/recovery
      -- session names no chapter, and 35 such sessions put every topic they
      -- touched into a second, phantom row.
      COALESCE(NULLIF(qb.subject, ''''), NULLIF(ps.subject, ''''))  AS subject,
      COALESCE(NULLIF(qb.chapter, ''''), ps.chapter)                AS chapter,
      COALESCE(t.name, NULLIF(qb.chapter, ''''), ps.chapter)        AS topic,');

  IF _new = _def THEN
    RAISE EXCEPTION 'the practice-CTE anchor matched nothing — the substitution would have failed open';
  END IF;
  EXECUTE _new;
END $rewrite$;

DO $check$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_weak_topics_for_user';
  IF position('COALESCE(NULLIF(qb.chapter' IN _def) = 0 THEN
    RAISE EXCEPTION 'the chapter still comes from the session alone';
  END IF;
  IF position('c.chapter AS topic' IN _def) > 0 THEN
    RAISE EXCEPTION 'topic is flattened to the chapter again';
  END IF;
END $check$;

COMMIT;
