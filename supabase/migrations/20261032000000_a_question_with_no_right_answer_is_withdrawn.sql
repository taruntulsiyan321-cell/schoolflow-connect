-- A QUESTION WITH NO RIGHT ANSWER IS WITHDRAWN, AND SO IS THE MISTAKE IT MADE.
--
-- ── WHAT WAS FOUND ──────────────────────────────────────────────────────────
--
-- ai-recovery-variants has produced 40 questions (21 tier 1, 19 tier 2). Read
-- and solved by hand on 2026-09-17, FOUR of them are mathematically wrong —
-- not badly worded, wrong:
--
-- 1. 0c17acaf  "S_n = 3n^2 + 5n. What is the 10th term?"
--    a_n = S_n - S_(n-1) = 6n + 2, so a_10 = 62.
--    Options are 47, 57, 67, 77. The right answer is not among them.
--    Marked correct: 57.
--
-- 2. 0df19259  "The sum of a certain number of terms of an AP is 216. First
--    term 8, last term 56. How many terms?"
--    n = 2S/(a+l) = 432/64 = 6.75. There is no such AP.
--    Marked correct: 6, which sums to 192.
--
-- 3. c0a682d4  "S_n = 3n^2 + 5n. If the nth term is 107, what is n?"
--    6n + 2 = 107 gives n = 17.5. There is no such term.
--    Marked correct: 8, whose term is 50.
--
-- 4. fc19f881  "a^3 + b^3 + c^3 = 3abc and abc != 0. What must a+b+c be?"
--    The identity gives (a+b+c) * ((a-b)^2+(b-c)^2+(c-a)^2) / 2 = 0, so
--    EITHER a+b+c = 0 OR a = b = c. a = b = c = 1 satisfies every condition
--    and gives a+b+c = 3 — which is also on the option list. Two options are
--    correct and the question says "must".
--
-- Three of the four are the same failure: the generator invents numbers, does
-- not solve what it invented, and picks a plausible integer.
--
-- ── THE DAMAGE, MEASURED ────────────────────────────────────────────────────
--
--     question   served   marked right   mistake-book rows it created
--     0c17acaf        1              0                              1
--     0df19259        3              1                              3
--     c0a682d4        1              0                              1
--     fc19f881        0              0                              0
--
-- Five attempts, five open mistakes, and one student marked CORRECT for
-- choosing 6 on a question whose answer is 6.75. These are recovery
-- questions: they are served to the student who already failed this topic,
-- and the mistakes they create feed weak-topic detection, the recovery
-- ladder and the revision schedule. A student cannot recover from a chapter
-- by failing questions that have no right answer.
--
-- ── WHAT THIS DOES ──────────────────────────────────────────────────────────
--
-- 1. Withdraws the four questions — is_active = false, which is what every
--    serving path filters on. Not DELETE: question_attempts references
--    bank_question_id and the attempt record is evidence. And is_active only,
--    not is_approved: tg_question_bank_approval_is_super_admin_only refuses a
--    change to is_approved from anyone but a super admin (§10.20, "manage the
--    central question bank"), and it is right to — approval is an editorial
--    judgement a person owns, while is_active is whether the row is servable.
-- 2. Clears the mistakes they created. A mistake on an unanswerable question
--    is not the student's mistake.
-- 3. Removes those attempts and re-syncs the affected session summaries with
--    the same formula 20261029000000 used, so the student's accuracy is not
--    permanently depressed by questions that could not be answered.
--
-- The generator gate that lets this class through is fixed separately in
-- supabase/functions/ai-recovery-variants/index.ts: shape validation passed
-- all four, because all four are well-formed. Nothing checked the arithmetic.

BEGIN;

CREATE TEMP TABLE _withdrawn(id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _withdrawn(id) VALUES
  ('0c17acaf-3306-4b3b-be00-f4677daa9916'),
  ('0df19259-ddc5-42d9-acca-5988082a25e8'),
  ('c0a682d4-7608-4d45-ac34-a8c7b1507144'),
  ('fc19f881-29ce-44df-a47b-689d1a4ea9cc');

-- FAIL CLOSED ON THE WRONG ROWS. These ids were read off this database; if
-- any of them is not the question described above, this migration must not
-- silently withdraw something else.
DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
  FROM public.question_bank qb JOIN _withdrawn w ON w.id = qb.id
  WHERE qb.source = 'ai_recovery_variant' AND qb.variant_tier IN (1, 2);
  IF _n <> 4 THEN
    RAISE EXCEPTION 'would have failed open: expected 4 generated variants, matched %', _n;
  END IF;
END $$;

UPDATE public.question_bank qb
   SET is_active = false
  FROM _withdrawn w
 WHERE w.id = qb.id;

DELETE FROM public.student_mistakes sm USING _withdrawn w WHERE sm.question_id = w.id;

CREATE TEMP TABLE _touched(session_id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _touched(session_id)
SELECT DISTINCT qa.session_id
FROM public.question_attempts qa JOIN _withdrawn w ON w.id = qa.bank_question_id
WHERE qa.session_id IS NOT NULL;

DELETE FROM public.question_attempts qa USING _withdrawn w WHERE qa.bank_question_id = w.id;

-- Same formula as 20261029000000. A session that now has no attempts left
-- claims no questions.
WITH counted AS (
  SELECT t.session_id,
         count(qa.id)::int AS attempts,
         count(qa.id) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
         count(qa.id) FILTER (WHERE COALESCE(qa.skipped, false))::int AS skipped
  FROM _touched t
  LEFT JOIN public.question_attempts qa ON qa.session_id = t.session_id
  GROUP BY t.session_id
)
UPDATE public.practice_sessions ps
   SET correct_count  = c.correct,
       wrong_count    = c.attempts - c.correct - c.skipped,
       skipped_count  = c.skipped,
       question_count = c.attempts,
       score          = c.correct,
       accuracy = CASE WHEN (c.attempts - c.skipped) > 0
                       THEN round(100.0 * c.correct / (c.attempts - c.skipped), 2) END
  FROM counted c
 WHERE c.session_id = ps.id
   AND ps.finished_at IS NOT NULL;

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.question_bank qb JOIN _withdrawn w ON w.id = qb.id
   WHERE qb.is_active;
  IF _n > 0 THEN RAISE EXCEPTION 'would have failed open: % withdrawn question(s) are still servable', _n; END IF;

  SELECT count(*) INTO _n FROM public.student_mistakes sm JOIN _withdrawn w ON w.id = sm.question_id;
  IF _n > 0 THEN RAISE EXCEPTION 'would have failed open: % mistake(s) still point at a withdrawn question', _n; END IF;

  SELECT count(*) INTO _n FROM public.question_attempts qa JOIN _withdrawn w ON w.id = qa.bank_question_id;
  IF _n > 0 THEN RAISE EXCEPTION 'would have failed open: % attempt(s) on a withdrawn question remain', _n; END IF;

  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  JOIN _touched t ON t.session_id = ps.id
  JOIN LATERAL (
    SELECT count(*)::int AS attempts,
           count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
           count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int AS skipped
    FROM public.question_attempts qa WHERE qa.session_id = ps.id
  ) a ON true
  WHERE ps.finished_at IS NOT NULL
    AND (ps.question_count <> a.attempts OR ps.correct_count <> a.correct OR ps.skipped_count <> a.skipped);
  IF _n > 0 THEN RAISE EXCEPTION 'would have failed open: % re-synced session(s) still disagree with their attempts', _n; END IF;

  RAISE NOTICE 'four unanswerable variants withdrawn; their mistakes and attempts are gone and the sessions agree again';
END $$;

COMMIT;
