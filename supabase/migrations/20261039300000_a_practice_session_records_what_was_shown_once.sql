-- ═══════════════════════════════════════════════════════════════════════════
-- A PRACTICE SESSION RECORDS WHAT THE STUDENT WAS SHOWN — ONCE
--
-- Driven end to end on 2026-09-17, as arjun.mehta in a real browser against
-- this database, every Practice mode and the result/save screens. Five server
-- defects came out of it; this migration fixes each where it is decided and
-- repairs the rows each one wrote.
--
-- ── 1. ONE ANSWER, TWO ROWS ────────────────────────────────────────────────
--
-- The client records each answer the moment it is given, and the finish
-- re-sends every answer so nothing is lost. rpc_record_question_attempt
-- de-duplicates a re-send by looking for an existing row for (session, bank
-- question) — a SELECT and then an INSERT, with nothing holding the two
-- together. Skipping the LAST question sends both calls within milliseconds,
-- each transaction looks, neither sees the other's row, and both insert.
-- Measured the same afternoon, two sessions out of seven that ended on a skip:
--
--     topic session   1 question served   2 attempt rows   question_count 2
--     custom session 10 questions served 11 attempt rows   question_count 10
--
-- which is also why three LOOP_END_TO_END_VERIFY checks went red today
-- ("question_attempts rows = question_count", "session summary = its own
-- attempts", "session time = its own questions' timings").
--
-- Both functions now take the practice_sessions row FOR UPDATE before they
-- read anything. Every write for one session therefore queues behind the one
-- before it, and in READ COMMITTED the queued call's de-duplication query
-- sees the row the first call committed. The finish holds the same lock for
-- its whole run, so an answer arriving mid-finish lands after the roll-up it
-- would otherwise have missed, and is folded in by its own re-send.
--
-- ── 2. A TIMED SESSION RECORDED QUESTIONS NOBODY SAW ───────────────────────
--
-- Custom Practice with a time goal loads a generous pool of 50. When the clock
-- ran out the client recorded every UNSHOWN question as a timed-out skip —
-- one run: 2 questions seen, 48 recorded as skipped. Those rows then:
--
--     wrote 13 chapter_tally rows (the §3.1 denominator) for questions never asked
--     started or pushed the revision clock on 12 chapters (7 rows created)
--     re-scored 38 topics, ~30 of them brand new at confidence 0 — "weak"
--
-- The client fix (Practice.tsx) records only the question on screen. The rows
-- are repaired here: within a session only ONE question can have been on
-- screen when time ran out, and it is the first one the loop wrote (the old
-- loop walked forward from the first unlogged question), so every timed-out
-- row after the first in a session is removed. Before today no attempt had
-- ever timed out; the proof below pins the repair to the one session it is
-- written for, so the rule cannot quietly reach anything else.
--
-- ── 3. A SKIP COUNTED AS A WRONG ANSWER IN TOPIC CONFIDENCE ────────────────
--
-- 20261021000000 ruled that a skipped question is not a wrong answer,
-- ANYWHERE: accuracy = correct / (correct + wrong). The topic confidence that
-- Weak Areas Practice reads (_recompute_concept_confidence_for_session) was
-- not brought along — it divided by every attempt, skips included, so a topic
-- the student only skipped scored 0% and was served back as a weak area.
-- §6.6: "a skipped question is not a proven gap". It now divides by the
-- questions answered, and a topic with none answered gets no confidence rather
-- than zero. Existing rows are re-scored to the same rule.
--
-- ── 4. PRACTICE HISTORY LISTED SESSIONS NOBODY SAT ─────────────────────────
--
-- _practice_session_attempted is the one rule for "did anything happen in this
-- session", and 20260929000000 put it on the trend line and the snapshot.
-- rpc_list_practice_history never took it, so the history list showed every
-- shell — "Previous Year Questions · Completed · 0 Qs · 1m · 0 XP". It does now.
--
-- ── 5. THE SUBJECT LIST WAS A SAMPLE ───────────────────────────────────────
--
-- The Practice subject and chapter pickers read 800 question rows, in no
-- order, and listed the subjects that happened to be in them. Class 10 has
-- 3,045 servable rows: Social Science (953 questions) was not offered at all.
-- Class 12 commerce lost Hindi and English. rpc_practice_bank_catalog answers
-- the question in the database — one row per subject and chapter a class can
-- be served, with its count. SECURITY INVOKER: it is the student's own read of
-- question_bank under its own policies, only grouped.
--
-- Rollback: supabase/migrations/rollback/20261039300000_a_practice_session_records_what_was_shown_once.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. the lock ─────────────────────────────────────────────────────────────
DO $lock$
DECLARE
  _def text;
  _new text;
  _record_old text := E'  SELECT * INTO _ps\n  FROM public.practice_sessions\n  WHERE id = _session_id AND user_id = _uid;\n';
  _record_new text := E'  -- One writer per session at a time: the de-duplication below is a read\n'
                   || E'  -- followed by a write, and two calls racing it both inserted.\n'
                   || E'  SELECT * INTO _ps\n  FROM public.practice_sessions\n  WHERE id = _session_id AND user_id = _uid\n  FOR UPDATE;\n';
  _finish_old text := E'  SELECT * INTO _s\n  FROM public.practice_sessions\n  WHERE id = _session_id AND user_id = auth.uid();\n';
  _finish_new text := E'  -- Held for the whole finish: an answer recorded while this runs waits,\n'
                   || E'  -- then finds the row this re-send wrote instead of inserting a second.\n'
                   || E'  SELECT * INTO _s\n  FROM public.practice_sessions\n  WHERE id = _session_id AND user_id = auth.uid()\n  FOR UPDATE;\n';
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_question_attempt';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_record_question_attempt is not defined'; END IF;
  IF position(_record_old IN _def) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the session read in rpc_record_question_attempt was not found verbatim';
  END IF;
  _new := replace(_def, _record_old, _record_new);
  EXECUTE _new;

  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_practice_session';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_finish_practice_session is not defined'; END IF;
  IF position(_finish_old IN _def) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the session read in rpc_finish_practice_session was not found verbatim';
  END IF;
  _new := replace(_def, _finish_old, _finish_new);
  EXECUTE _new;
END
$lock$;

-- ── 3. confidence divides by what was answered ──────────────────────────────
DO $confidence$
DECLARE
  _def text;
  _old text := E'      count(*)::int                                       AS attempted,\n';
  _new text := E'      -- Answered, not attempted: a skip is not a wrong answer (20261021000000,\n'
            || E'      -- §6.6). A topic with nothing answered gets no confidence at all.\n'
            || E'      count(*) FILTER (WHERE NOT COALESCE(qr.skipped, false))::int AS attempted,\n';
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_recompute_concept_confidence_for_session';
  IF _def IS NULL THEN RAISE EXCEPTION '_recompute_concept_confidence_for_session is not defined'; END IF;
  IF position(_old IN _def) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the confidence denominator was not found verbatim';
  END IF;
  EXECUTE replace(_def, _old, _new);
END
$confidence$;

-- ── 4. history lists sessions that were sat ─────────────────────────────────
DO $history$
DECLARE
  _def text;
  _old text := E'    AND ps.finished_at IS NOT NULL\n';
  _new text := E'    AND ps.finished_at IS NOT NULL\n'
            || E'    -- The one rule for "did anything happen" (20260929000000).\n'
            || E'    AND public._practice_session_attempted(ps.correct_count, ps.wrong_count, ps.skipped_count)\n';
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_list_practice_history';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_list_practice_history is not defined'; END IF;
  IF (length(_def) - length(replace(_def, _old, ''))) / length(_old) <> 1 THEN
    RAISE EXCEPTION 'would have failed open: the finished filter in rpc_list_practice_history is not there exactly once';
  END IF;
  EXECUTE replace(_def, _old, _new);
END
$history$;

-- ── 5. the catalog ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer,
  _board text,
  _stream text DEFAULT NULL,
  _subject text DEFAULT NULL
)
RETURNS TABLE (subject text, chapter text, questions integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $catalog$
  -- The same scope listBankQuestions serves from: approved, active, this
  -- class, this board (or both, or unset), this stream (or unset).
  SELECT qb.subject, qb.chapter, count(*)::int
    FROM public.question_bank qb
   WHERE qb.is_approved
     AND qb.is_active
     AND qb.class_level = _class_level
     AND (qb.board = _board OR qb.board = 'both' OR qb.board IS NULL)
     AND (_stream IS NULL OR qb.stream = _stream OR qb.stream IS NULL)
     AND (_subject IS NULL OR lower(qb.subject) = lower(_subject))
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
   GROUP BY qb.subject, qb.chapter
   ORDER BY qb.subject, qb.chapter
$catalog$;

COMMENT ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text) IS
  'Subjects and chapters a class can be served, with question counts — computed, not sampled. Practice subject/chapter pickers.';

REVOKE ALL ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text) TO authenticated;

-- ── 1 + 2. the rows ─────────────────────────────────────────────────────────
DO $repair$
DECLARE
  _dup_sessions    uuid[];
  _unseen_sessions uuid[];
  _unseen_rows     int;
  _touched         uuid[];
  _tally_sessions  uuid[];
  _sid             uuid;
  _engage_min      int := public._recovery_const('REVISION_ENGAGEMENT_MIN')::int;
  _n               int;
BEGIN
  IF _engage_min IS NULL THEN RAISE EXCEPTION 'REVISION_ENGAGEMENT_MIN is missing'; END IF;

  -- Pinned. No answer had been recorded twice before 2026-09-17 (measured:
  -- 0 pairs); every pair since was made by the drive that found this, or by
  -- the race probe that proves the lock. Anything older is a case this repair
  -- was not written for.
  IF EXISTS (
    SELECT 1 FROM public.question_attempts qa
      JOIN public.practice_sessions ps ON ps.id = qa.session_id
     WHERE qa.bank_question_id IS NOT NULL
       AND ps.created_at < timestamptz '2026-09-17 00:00:00+00'
     GROUP BY qa.session_id, qa.bank_question_id
    HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'a duplicate answer older than 2026-09-17 exists; this repair was not written for it';
  END IF;

  -- One row per (session, bank question): the first one written stays.
  WITH ranked AS (
    SELECT id, session_id,
           row_number() OVER (PARTITION BY session_id, bank_question_id ORDER BY created_at, id) AS rn
      FROM public.question_attempts
     WHERE session_id IS NOT NULL AND bank_question_id IS NOT NULL
  ), gone AS (
    DELETE FROM public.question_attempts qa
     USING ranked r
     WHERE qa.id = r.id AND r.rn > 1
    RETURNING qa.session_id
  )
  SELECT array_agg(DISTINCT session_id) INTO _dup_sessions FROM gone;

  -- Only one question can have been on screen when the clock ran out.
  WITH ranked AS (
    SELECT id, session_id,
           row_number() OVER (PARTITION BY session_id ORDER BY attempt_number NULLS LAST, created_at, id) AS rn
      FROM public.question_attempts
     WHERE timed_out AND session_id IS NOT NULL
  ), gone AS (
    DELETE FROM public.question_attempts qa
     USING ranked r
     WHERE qa.id = r.id AND r.rn > 1
    RETURNING qa.session_id
  )
  SELECT array_agg(DISTINCT session_id), count(*) INTO _unseen_sessions, _unseen_rows FROM gone;

  -- Pinned: the timed-out repair is written for the one session that ever
  -- timed out. Anything wider means the rule met a case it was not built for.
  IF COALESCE(array_length(_unseen_sessions, 1), 0) > 1 THEN
    RAISE EXCEPTION 'the timed-out repair reached % sessions; it is written for one', array_length(_unseen_sessions, 1);
  END IF;
  RAISE NOTICE 'duplicate attempts removed from % session(s); % unseen timed-out row(s) removed from % session(s)',
    COALESCE(array_length(_dup_sessions, 1), 0), COALESCE(_unseen_rows, 0), COALESCE(array_length(_unseen_sessions, 1), 0);

  SELECT array_agg(DISTINCT s) INTO _touched
    FROM unnest(COALESCE(_dup_sessions, '{}') || COALESCE(_unseen_sessions, '{}')) AS s;

  -- The roll-up, by the finish's own rules (and 20261021000000, 20261037000000,
  -- 20261038000000): counts from the attempts, accuracy over answered only,
  -- time from the timings that remain.
  UPDATE public.practice_sessions ps
     SET question_count = a.total,
         correct_count  = a.correct,
         score          = a.correct,
         wrong_count    = a.wrong,
         skipped_count  = a.skipped,
         total_time_ms  = NULLIF(a.ms, 0),
         accuracy       = CASE WHEN a.correct + a.wrong > 0
                               THEN round((a.correct::numeric / (a.correct + a.wrong)) * 100, 2) END
    FROM (
      SELECT qa.session_id,
             count(*)::int AS total,
             count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
             count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int AS skipped,
             count(*) FILTER (WHERE NOT qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS wrong,
             COALESCE(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0), 0)::bigint AS ms
        FROM public.question_attempts qa
       WHERE qa.session_id = ANY (COALESCE(_touched, '{}'))
       GROUP BY qa.session_id
    ) a
   WHERE ps.id = a.session_id
     AND ps.finished_at IS NOT NULL;

  -- The §3.1 tally, rewritten from the attempts that remain — for these
  -- sessions, and for the four 20261032000000 left behind: it deleted five
  -- attempts on withdrawn variants and re-synced every session column
  -- (20261038000000 finished the time), but not the tally, which still counts
  -- them (edc28dea 20 vs 17, c3a8b85d 20 vs 19, f700969f 13 vs 12, b9abd7b8
  -- 10 vs 9). Deleting first: the writer upserts, so a chapter whose every row
  -- is gone would keep its old count otherwise.
  SELECT array_agg(DISTINCT s) INTO _tally_sessions
    FROM (
      SELECT unnest(COALESCE(_touched, '{}')) AS s
      UNION
      SELECT ct.session_id
        FROM public.chapter_tally ct
        JOIN LATERAL (
          SELECT count(*)::int AS attempted,
                 count(*) FILTER (WHERE qa.is_correct IS TRUE)::int AS correct
            FROM public.question_attempts qa
            JOIN public.question_bank qb ON qb.id = qa.bank_question_id
           WHERE qa.session_id = ct.session_id AND qb.chapter_id = ct.chapter_id) a ON true
       WHERE ct.attempted <> a.attempted OR ct.correct <> a.correct
    ) x;
  DELETE FROM public.chapter_tally WHERE session_id = ANY (COALESCE(_tally_sessions, '{}'));
  FOREACH _sid IN ARRAY COALESCE(_tally_sessions, '{}') LOOP
    PERFORM public._write_chapter_tally(_sid);
  END LOOP;
  RAISE NOTICE 'chapter tally rewritten for % session(s)', COALESCE(array_length(_tally_sessions, 1), 0);

  -- Revision clocks the unseen rows started. A chapter_state row created by
  -- that session's finish, still untouched by anything since, whose chapter
  -- this student has never really worked in, was never earned.
  DELETE FROM public.chapter_state cs
   USING public.practice_sessions ps
   WHERE ps.id = ANY (COALESCE(_unseen_sessions, '{}'))
     AND cs.user_id = ps.user_id
     AND cs.created_at = ps.finished_at
     AND cs.updated_at = ps.finished_at
     AND cs.state = 'untouched'
     AND cs.recovered_at IS NULL
     AND COALESCE(cs.consecutive_revision_passes, 0) = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.chapter_tally ct
        WHERE ct.user_id = cs.user_id
          AND ct.chapter_id = cs.chapter_id
          AND ct.attempted >= _engage_min);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE '% unearned revision clock(s) removed', _n;

  SELECT count(*) INTO _n
    FROM public.chapter_state cs
    JOIN public.practice_sessions ps ON ps.id = ANY (COALESCE(_unseen_sessions, '{}'))
   WHERE cs.user_id = ps.user_id
     AND cs.updated_at = ps.finished_at
     AND cs.created_at < ps.finished_at;
  -- Their previous date was overwritten in place and is not recoverable; the
  -- only effect is a check pushed back by up to one interval.
  RAISE NOTICE '% existing revision clock(s) were pushed by that session and are left as they are', _n;

  -- Topic rows that exist only because of the unseen rows: re-scored by that
  -- session's finish, and now without a single attempt by this student.
  DELETE FROM public.concept_mastery cm
   USING public.practice_sessions ps
   WHERE ps.id = ANY (COALESCE(_unseen_sessions, '{}'))
     AND cm.user_id = ps.user_id
     AND cm.updated_at = ps.finished_at
     AND NOT EXISTS (
       SELECT 1
         FROM public.question_attempts qa
         JOIN public.question_bank qb ON qb.id = qa.bank_question_id
         JOIN public.topics t        ON t.id = qb.topic_id
        WHERE qa.user_id = cm.user_id
          AND t.name = cm.concept
          AND qb.chapter IS NOT DISTINCT FROM cm.chapter);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE '% topic row(s) that only unseen questions had created removed', _n;
END
$repair$;

-- ── 3. every topic confidence, re-scored to the rule ────────────────────────
-- The recompute's own shape: counts span every question of the topic, keyed by
-- each (subject, chapter, name) the topic's questions carry.
WITH per_topic AS (
  SELECT qa.user_id, qb.topic_id,
         count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
         count(*) FILTER (WHERE qa.is_correct IS TRUE)::int           AS correct
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE qb.topic_id IS NOT NULL
   GROUP BY qa.user_id, qb.topic_id
), keys AS (
  SELECT DISTINCT qb.topic_id, COALESCE(qb.subject, 'General') AS subject, qb.chapter, t.name
    FROM public.question_bank qb
    JOIN public.topics t ON t.id = qb.topic_id
)
UPDATE public.concept_mastery cm
   SET confidence_score = CASE WHEN p.answered > 0
                               THEN round((p.correct::numeric / p.answered) * 100, 1) END,
       total_attempts   = p.answered,
       correct_attempts = p.correct
  FROM per_topic p
  JOIN keys k ON k.topic_id = p.topic_id
 WHERE cm.user_id = p.user_id
   AND cm.subject = k.subject
   AND cm.chapter IS NOT DISTINCT FROM k.chapter
   AND cm.concept = k.name
   AND COALESCE(cm.subconcept, '') = k.name
   AND cm.confidence_score IS NOT NULL
   AND (cm.confidence_score IS DISTINCT FROM CASE WHEN p.answered > 0
                                                  THEN round((p.correct::numeric / p.answered) * 100, 1) END
        OR cm.total_attempts IS DISTINCT FROM p.answered
        OR cm.correct_attempts IS DISTINCT FROM p.correct);

-- ── proof ───────────────────────────────────────────────────────────────────
DO $proof$
DECLARE
  _def text;
  _n   int;
  _arjun uuid := 'd1000003-0001-4000-8000-000000000001';
  _shell uuid := '1a452fbe-046d-46b7-b8be-3d98c88fecb0';
  _sat   uuid := 'd3690568-2f0c-4cf7-bd1e-2ba89b00cee7';
  _rows  uuid[];
  _subjects text[];
BEGIN
  -- the bodies say what they now do, and the old forms are gone
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def FROM pg_proc p
   WHERE p.oid = 'public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)'::regprocedure;
  IF position(E'WHERE id = _session_id AND user_id = _uid\n  FOR UPDATE;' IN _def) = 0 THEN
    RAISE EXCEPTION 'proof: rpc_record_question_attempt does not lock the session';
  END IF;
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def FROM pg_proc p
   WHERE p.oid = 'public.rpc_finish_practice_session(uuid,jsonb,boolean,boolean)'::regprocedure;
  IF position(E'WHERE id = _session_id AND user_id = auth.uid()\n  FOR UPDATE;' IN _def) = 0 THEN
    RAISE EXCEPTION 'proof: rpc_finish_practice_session does not lock the session';
  END IF;
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def FROM pg_proc p
   WHERE p.oid = 'public._recompute_concept_confidence_for_session(uuid)'::regprocedure;
  IF position('count(*)::int                                       AS attempted' IN _def) > 0
     OR position('FILTER (WHERE NOT COALESCE(qr.skipped, false))::int AS attempted' IN _def) = 0 THEN
    RAISE EXCEPTION 'proof: confidence still divides by skipped questions';
  END IF;

  -- no answer is on record twice, and no session holds two timed-out questions
  SELECT count(*) INTO _n FROM (
    SELECT 1 FROM public.question_attempts
     WHERE session_id IS NOT NULL AND bank_question_id IS NOT NULL
     GROUP BY session_id, bank_question_id HAVING count(*) > 1) d;
  IF _n > 0 THEN RAISE EXCEPTION 'proof: % answer(s) still recorded twice', _n; END IF;
  SELECT count(*) INTO _n FROM (
    SELECT 1 FROM public.question_attempts WHERE timed_out
     GROUP BY session_id HAVING count(*) > 1) d;
  IF _n > 0 THEN RAISE EXCEPTION 'proof: % session(s) still hold more than one timed-out question', _n; END IF;

  -- LOOP_END_TO_END_VERIFY's three session checks, green again
  SELECT count(*) INTO _n
    FROM public.practice_sessions ps
    JOIN LATERAL (
      SELECT count(*)::int AS attempts,
             count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
             count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int AS skipped
        FROM public.question_attempts qa WHERE qa.session_id = ps.id) a ON true
   WHERE ps.finished_at IS NOT NULL
     AND (ps.question_count <> a.attempts OR ps.correct_count <> a.correct OR ps.skipped_count <> a.skipped);
  IF _n > 0 THEN RAISE EXCEPTION 'proof: % finished session(s) disagree with their attempts', _n; END IF;
  SELECT count(*) INTO _n
    FROM public.practice_sessions ps
    JOIN LATERAL (
      SELECT sum(qa.time_taken_ms)::bigint AS ms FROM public.question_attempts qa
       WHERE qa.session_id = ps.id AND COALESCE(qa.time_taken_ms, 0) > 0) t ON true
   WHERE ps.finished_at IS NOT NULL
     AND t.ms > 0 AND ps.total_time_ms IS DISTINCT FROM t.ms;
  IF _n > 0 THEN RAISE EXCEPTION 'proof: % session(s) disagree with their own timings', _n; END IF;
  SELECT count(*) INTO _n
    FROM public.chapter_tally ct
    JOIN LATERAL (
      SELECT count(*)::int AS attempted FROM public.question_attempts qa
        JOIN public.question_bank qb ON qb.id = qa.bank_question_id
       WHERE qa.session_id = ct.session_id AND qb.chapter_id = ct.chapter_id) a ON true
   WHERE ct.attempted <> a.attempted;
  IF _n > 0 THEN RAISE EXCEPTION 'proof: % chapter tally row(s) disagree with their attempts', _n; END IF;

  -- no confidence counts a skip, and a topic nobody answered is not weak
  SELECT count(*) INTO _n
    FROM public.concept_mastery cm
   WHERE cm.confidence_score IS NOT NULL AND cm.classification = 'weak'
     AND cm.total_attempts = 0;
  IF _n > 0 THEN RAISE EXCEPTION 'proof: % topic(s) are weak with nothing answered', _n; END IF;

  -- history: as arjun, the shell is gone and a sat session is there
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
  SELECT array_agg(h.id) INTO _rows
    FROM public.rpc_list_practice_history(200, NULL, NULL, now() - interval '30 days', NULL, NULL, 'finished_at_desc') h;
  PERFORM set_config('request.jwt.claims', '', true);
  IF _rows IS NULL OR NOT (_sat = ANY (_rows)) THEN
    RAISE EXCEPTION 'proof: history no longer lists a session the student sat (control)';
  END IF;
  IF _shell = ANY (_rows) THEN
    RAISE EXCEPTION 'proof: history still lists a session nobody sat';
  END IF;
  IF EXISTS (SELECT 1 FROM public.practice_sessions ps WHERE ps.id = ANY (_rows)
              AND NOT public._practice_session_attempted(ps.correct_count, ps.wrong_count, ps.skipped_count)) THEN
    RAISE EXCEPTION 'proof: history lists a session with nothing attempted';
  END IF;

  -- the catalog offers what the sample dropped
  SELECT array_agg(DISTINCT c.subject) INTO _subjects FROM public.rpc_practice_bank_catalog(10, 'rbse', 'commerce') c;
  IF NOT ('Social Science' = ANY (_subjects) AND 'Mathematics' = ANY (_subjects)) THEN
    RAISE EXCEPTION 'proof: class 10 catalog is missing subjects: %', _subjects;
  END IF;
  SELECT array_agg(DISTINCT c.subject) INTO _subjects FROM public.rpc_practice_bank_catalog(12, 'rbse', 'commerce') c;
  IF NOT ('Hindi' = ANY (_subjects) AND 'English' = ANY (_subjects) AND 'Accountancy' = ANY (_subjects)) THEN
    RAISE EXCEPTION 'proof: class 12 catalog is missing subjects: %', _subjects;
  END IF;
  SELECT count(*) INTO _n FROM public.rpc_practice_bank_catalog(10, 'rbse', 'commerce', 'social science');
  IF _n <> (SELECT count(DISTINCT chapter) FROM public.question_bank
             WHERE is_approved AND is_active AND class_level = 10 AND subject = 'Social Science'
               AND (board IN ('rbse', 'both') OR board IS NULL)
               AND (stream = 'commerce' OR stream IS NULL)) THEN
    RAISE EXCEPTION 'proof: Social Science chapter list is not the whole list';
  END IF;
  -- control: a class with no bank has no catalog
  SELECT count(*) INTO _n FROM public.rpc_practice_bank_catalog(3, 'rbse', NULL);
  IF _n <> 0 THEN RAISE EXCEPTION 'proof control: a class with no questions returned % rows', _n; END IF;

  RAISE NOTICE 'practice records each shown question once, history lists what was sat, and the pickers list the whole bank';
END
$proof$;

COMMIT;
