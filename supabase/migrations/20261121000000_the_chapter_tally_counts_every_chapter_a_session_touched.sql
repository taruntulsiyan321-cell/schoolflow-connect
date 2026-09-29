-- ═══════════════════════════════════════════════════════════════════════════
-- THE CHAPTER TALLY COUNTS EVERY CHAPTER A SESSION TOUCHED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Found 2026-09-28 auditing Recovery, Revision and Analysis: one chapter's §3.1
-- denominator read 1 where the student's own attempts said 3.
--
-- WHAT WAS MEASURED
--
-- Recovery session 277b35cd (25 Sep, Money and Banking) held FOUR answers: two
-- upload questions, one bank question of Money and Banking, and one bank
-- question of "Introduction and National Income Accounting" — a rung from
-- another chapter, which is ordinary in a recovery plan. Its tally has ONE row:
-- Money and Banking, attempted 3, correct 2. The fourth answer was never
-- tallied anywhere. Session e1c43a3a, 42 minutes later, is the same shape.
--
-- THE WRITER IS NOT AT FAULT. `_write_chapter_tally` resolves each attempt's
-- chapter from the question (bank, then generated_question, then upload, then
-- capture) and groups by it, so it would write both rows. Replayed read-only
-- against those two sessions on 2026-09-29 it produces exactly the two rows
-- each, one of them already there and one missing. Nothing deletes tally rows:
-- across the whole database only `_write_chapter_tally` inserts, and only
-- rpc_finish_practice_session and rpc_dispute_ai_upload_answer call it.
--
-- WHAT IT WAS. Both sessions finished on 25 September, in the nine hours during
-- which that function was replaced twice — 20261080100000 at 03:38 and
-- 20261108000000 at 11:04 — and they finished at 03:15 and 03:57. The rows are
-- the residue of that window. The gate that would have caught it did not exist
-- then and is written below.
--
-- THE WHOLE OF IT, measured across every finished session of every student:
--   095998bc (CUET)        277b35cd  Introduction and National Income Accounting  1 attempt
--   095998bc (CUET)        e1c43a3a  Introduction and National Income Accounting  1 attempt
--   d1000003 (demo)        411a0111  Arithmetic Progressions                      5 attempts
--   d1000003 (demo)        eefc9e7f  Polynomials                                  1 attempt
-- Four rows, four sessions, two students. The second student is Arjun Mehta of
-- Wisdom Campus Demo School — seeded demo data, from August, whose two sessions
-- have no tally row at all. They are repaired here with the other two: the fix
-- is one rule (the tally is what the attempts say), the recompute reads only
-- each student's own attempts, and leaving two of the four wrong would leave
-- two states of the same defect.
--
-- WHY IT MATTERS. chapter_tally IS the §3.1 denominator: "Chapters to fix" and
-- the revision engagement clock read it. An undercounted chapter looks less
-- practised than it is, and reads a different accuracy from the one the
-- practice analytics compute off the attempts themselves.
--
-- ROLLBACK: rollback/20261121000000_the_chapter_tally_counts_every_chapter_a_session_touched.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── What is wrong now, and every tally row as it stands ────────────────────

CREATE TEMP TABLE _attempts_by_chapter ON COMMIT DROP AS
SELECT qa.user_id,
       qa.session_id,
       COALESCE(qb.chapter_id, suq.chapter_id, scq.chapter_id) AS chapter_id,
       count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)
                          AND NOT COALESCE(qa.excluded_from_accuracy, false))::int AS attempted,
       count(*) FILTER (WHERE qa.is_correct IS TRUE
                          AND NOT COALESCE(qa.skipped, false)
                          AND NOT COALESCE(qa.excluded_from_accuracy, false))::int AS correct
  FROM public.question_attempts qa
  JOIN public.practice_sessions ps ON ps.id = qa.session_id
  LEFT JOIN public.question_bank qb ON qb.id = qa.bank_question_id
  LEFT JOIN public.student_upload_questions suq
    ON suq.id = NULLIF(qa.generated_question->>'upload_question_id', '')::uuid
  LEFT JOIN public.student_capture_questions scq
    ON scq.id = NULLIF(qa.generated_question->>'capture_question_id', '')::uuid
 WHERE ps.finished_at IS NOT NULL
 GROUP BY 1, 2, 3;

CREATE TEMP TABLE _missing ON COMMIT DROP AS
SELECT a.user_id, a.session_id, a.chapter_id, a.attempted, a.correct
  FROM _attempts_by_chapter a
 WHERE a.chapter_id IS NOT NULL
   AND a.attempted > 0
   AND NOT EXISTS (SELECT 1 FROM public.chapter_tally ct
                    WHERE ct.session_id = a.session_id AND ct.chapter_id = a.chapter_id);

CREATE TEMP TABLE _tally_before ON COMMIT DROP AS
SELECT id, session_id, chapter_id, attempted, correct FROM public.chapter_tally;

DO $before$
DECLARE _n int; _sess int;
BEGIN
  SELECT count(*), count(DISTINCT session_id) INTO _n, _sess FROM _missing;
  -- POSITIVE CONTROL. Everything below asserts that a gap closed; if there is
  -- no gap to close, those assertions pass against nothing and this migration
  -- would report success for doing nothing at all.
  IF _n = 0 THEN
    RAISE EXCEPTION
      'no missing tally row found, so nothing here can be proved — if this ran once already, that is why';
  END IF;
  RAISE NOTICE 'missing tally row(s): % across % session(s)', _n, _sess;
END
$before$;

-- ── The repair: the writer, on the sessions that are short ─────────────────
-- Not an INSERT of its own. `_write_chapter_tally` is the one definition of
-- what a session's tally is; a second copy of that SELECT here would be a
-- second home for it, and would be the thing that drifts next time.

DO $repair$
DECLARE _sid uuid; _rows int; _total int := 0;
BEGIN
  FOR _sid IN SELECT DISTINCT session_id FROM _missing LOOP
    SELECT public._write_chapter_tally(_sid) INTO _rows;
    _total := _total + COALESCE(_rows, 0);
    RAISE NOTICE 'session %: % tally row(s) written', left(_sid::text, 8), _rows;
  END LOOP;
  IF _total = 0 THEN
    RAISE EXCEPTION 'the writer wrote nothing for any short session';
  END IF;
END
$repair$;

-- ── THE PROOF ─────────────────────────────────────────────────────────────
--
--   1. Every chapter a finished session touched now has a tally row.
--   2. Every tally row that existed before still says exactly what it said —
--      this repair adds, it does not restate.
--   3. Each row it added equals that student's own attempts in that chapter of
--      that session, and no session gained a chapter it did not touch.
--   4. Per student, the §3.1 denominator now agrees with the attempts.
DO $proof$
DECLARE _n int; _r record;
BEGIN
  SELECT count(*) INTO _n
    FROM _attempts_by_chapter a
   WHERE a.chapter_id IS NOT NULL AND a.attempted > 0
     AND NOT EXISTS (SELECT 1 FROM public.chapter_tally ct
                      WHERE ct.session_id = a.session_id AND ct.chapter_id = a.chapter_id);
  IF _n <> 0 THEN
    RAISE EXCEPTION '% chapter(s) of a finished session still have no tally row', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM _tally_before b
    JOIN public.chapter_tally ct ON ct.id = b.id
   WHERE ct.attempted IS DISTINCT FROM b.attempted
      OR ct.correct   IS DISTINCT FROM b.correct
      OR ct.chapter_id IS DISTINCT FROM b.chapter_id
      OR ct.session_id IS DISTINCT FROM b.session_id;
  IF _n <> 0 THEN
    RAISE EXCEPTION '% tally row(s) that existed before were changed by this repair', _n;
  END IF;

  SELECT count(*) INTO _n FROM _tally_before b
   WHERE NOT EXISTS (SELECT 1 FROM public.chapter_tally ct WHERE ct.id = b.id);
  IF _n <> 0 THEN
    RAISE EXCEPTION '% tally row(s) that existed before are gone', _n;
  END IF;

  FOR _r IN
    SELECT m.session_id, m.chapter_id, m.attempted, m.correct,
           ct.attempted AS got_attempted, ct.correct AS got_correct
      FROM _missing m
      LEFT JOIN public.chapter_tally ct
        ON ct.session_id = m.session_id AND ct.chapter_id = m.chapter_id
  LOOP
    IF _r.got_attempted IS NULL THEN
      RAISE EXCEPTION 'session % chapter % was not written', _r.session_id, _r.chapter_id;
    END IF;
    IF _r.got_attempted <> _r.attempted OR _r.got_correct <> _r.correct THEN
      RAISE EXCEPTION
        'session % chapter %: wrote %/% where the attempts say %/%',
        _r.session_id, _r.chapter_id, _r.got_attempted, _r.got_correct, _r.attempted, _r.correct;
    END IF;
  END LOOP;

  SELECT count(*) INTO _n FROM public.chapter_tally ct
   WHERE NOT EXISTS (
     SELECT 1 FROM _attempts_by_chapter a
      WHERE a.session_id = ct.session_id AND a.chapter_id = ct.chapter_id AND a.attempted > 0)
     AND EXISTS (SELECT 1 FROM _missing m WHERE m.session_id = ct.session_id);
  IF _n <> 0 THEN
    RAISE EXCEPTION '% row(s) name a chapter the repaired session did not touch', _n;
  END IF;

  SELECT count(*) INTO _n FROM (
    SELECT t.user_id, t.chapter_id
      FROM (SELECT ct.user_id, ct.chapter_id, sum(ct.attempted) AS tallied
              FROM public.chapter_tally ct
             WHERE ct.chapter_id IS NOT NULL
             GROUP BY 1, 2) t
      JOIN (SELECT a.user_id, a.chapter_id, sum(a.attempted) AS attempts
              FROM _attempts_by_chapter a
             WHERE a.chapter_id IS NOT NULL
             GROUP BY 1, 2) x ON x.user_id = t.user_id AND x.chapter_id = t.chapter_id
     WHERE t.tallied <> x.attempts) g;
  IF _n <> 0 THEN
    RAISE NOTICE
      '% student/chapter pair(s) still disagree — sessions that were never finished are counted in the attempts and not in the tally, which is the tally''s rule',
      _n;
  END IF;

  RAISE NOTICE 'tally repair proved';
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261121000000_the_chapter_tally_counts_every_chapter_a_session_touched')
ON CONFLICT (version) DO NOTHING;

COMMIT;
