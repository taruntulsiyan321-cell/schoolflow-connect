-- Rollback for 20261025000000_the_question_knows_its_own_chapter.sql
--
-- Puts subject and chapter back on the session.
--
-- What this re-introduces: attempts made in any mode where the student did not
-- name a chapter up front (weak, subject, bookmarked, skipped, recovery — 35
-- sessions on production) fall into a phantom (subject '', chapter null)
-- bucket, so the same topic returns twice and neither row carries its real
-- attempt count or accuracy.

BEGIN;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.proname='_weak_topics_for_user';

  _new := replace(_def,
    '      -- From the QUESTION first: a weak/subject/bookmarked/skipped/recovery
      -- session names no chapter, and 35 such sessions put every topic they
      -- touched into a second, phantom row.
      COALESCE(NULLIF(qb.subject, ''''), NULLIF(ps.subject, ''''))  AS subject,
      COALESCE(NULLIF(qb.chapter, ''''), ps.chapter)                AS chapter,
      COALESCE(t.name, NULLIF(qb.chapter, ''''), ps.chapter)        AS topic,',
    '      ps.subject                   AS subject,
      ps.chapter                   AS chapter,
      COALESCE(t.name, ps.chapter) AS topic,');

  IF _new = _def THEN RAISE EXCEPTION 'anchor matched nothing'; END IF;
  EXECUTE _new;
END $rewrite$;

COMMIT;
