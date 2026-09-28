-- ===========================================================================
-- A REVISION CHECK RE-ASKS WHAT THE STUDENT BROUGHT — the ruling recovery has,
-- and revision did not (KNOWN_ISSUES 90).
--
-- §5 calls a revision check "the misses and the unseen". Its misses half was
-- bank-only:
--
--     SELECT sm.question_id FROM student_mistakes sm
--       JOIN question_bank qb ON qb.id = sm.question_id
--      WHERE ... AND sm.question_id IS NOT NULL AND qb.is_active
--
-- A screen capture's mistake and an upload's mistake both have `question_id
-- IS NULL`, so neither could ever be in that list — and the unseen half reads
-- question_bank only. A chapter the student recovered from captured mistakes
-- therefore got a check that never asked about the thing they got wrong.
--
-- Recovery was given exactly this ruling on 2026-09-25 (20261104000000): a
-- chapter whose mistakes were all captures or uploads could never reach a
-- startable plan, so the ladder now serves the brought question itself.
-- Measured on production 2026-09-28 — a captured question re-asked inside a
-- recovery session three times, at round 4, source 'screen_capture'. The two
-- engines disagreed about the same content; they no longer do.
--
-- THE CLIENT ALREADY KNOWS HOW. The recovery runner loads a mixed set of ids
-- from three places (question_bank, student_upload_questions,
-- student_capture_questions) because tier 0 may carry an upload or a capture.
-- The revision branch loaded from the bank alone; it now uses the same
-- resolver, so `mistake_ids` may carry any of the three kinds of id.
--
-- WHAT STAYS. The cap (REVISION_MISTAKE_MAX), the order (most-repeated first,
-- then most recent), and the exclusions that matter:
--   * a BANK mistake is skipped when its question is inactive or replaced —
--     a withdrawn question must not be served again (KNOWN_ISSUES 91 is about
--     what that leaves behind, and is fixed where the student can see it);
--   * a BROUGHT mistake is skipped when its own row is gone — a deleted
--     capture or a withdrawn upload question cannot be asked either;
--   * the fresh half is untouched: still `question_bank` only, still never a
--     question this student has seen, and a check with no fresh question left
--     is still refused rather than padded.
--
-- ROLLBACK: rollback/20261118000000_a_revision_check_re_asks_what_the_student_brought.sql
-- ===========================================================================

BEGIN;

-- ── Before: what each affected chapter's check would ask ────────────────────
CREATE TEMP TABLE _plan_before (
  uid uuid, chapter_id uuid, brought_open int, misses int, fresh int, err text,
  PRIMARY KEY (uid, chapter_id)
) ON COMMIT DROP;

DO $capture$
DECLARE
  _c    record;
  _plan jsonb;
  _err  text;
BEGIN
  FOR _c IN
    SELECT sm.user_id, sm.chapter_id,
           count(*) FILTER (WHERE sm.question_id IS NULL)::int AS brought
      FROM public.student_mistakes sm
     WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.exam_accounts ea WHERE ea.account_id = sm.user_id)
     GROUP BY sm.user_id, sm.chapter_id
    HAVING count(*) FILTER (WHERE sm.question_id IS NULL) > 0
  LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _c.user_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _plan := NULL; _err := NULL;
    BEGIN
      _plan := public.rpc_revision_session_plan(_c.chapter_id);
    EXCEPTION WHEN others THEN
      _err := SQLERRM;
    END;
    -- The role goes back BEFORE anything is written: an exception handler here
    -- still runs as `authenticated`, which holds nothing on a temp table
    -- (measured — the first dry run failed on exactly that).
    RESET ROLE;
    INSERT INTO _plan_before VALUES (
      _c.user_id, _c.chapter_id, _c.brought,
      CASE WHEN _err IS NULL THEN jsonb_array_length(_plan->'mistake_ids') END,
      CASE WHEN _err IS NULL THEN jsonb_array_length(_plan->'fresh_ids') END,
      _err);
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT EXISTS (SELECT 1 FROM _plan_before) THEN
    RAISE WARNING 'no individual account has an open mistake on a question they brought, so the change below cannot be demonstrated on this database.';
  END IF;
END
$capture$;

-- ── The plan ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_revision_session_plan(_chapter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid        uuid := auth.uid();
  _want_fresh int;
  _want_miss  int;
  _fresh      uuid[];
  _misses     uuid[];
  _n_fresh    int;
  _n_miss     int;
  _level      int;
  _cs         public.chapter_state%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  -- Same curriculum fence as recovery, in the query layer, raising rather than
  -- returning an empty list — an empty list is indistinguishable from "this
  -- chapter has no questions" and would hide a permissions bug as a content
  -- problem.
  IF NOT public._recovery_chapter_is_mine(_chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id;
  END IF;

  SELECT * INTO _cs FROM public.chapter_state
   WHERE user_id = _uid AND chapter_id = _chapter_id;

  _want_fresh := public._recovery_const('REVISION_COUNT')::int;
  _want_miss  := public._recovery_const('REVISION_MISTAKE_MAX')::int;
  _level      := public._student_difficulty_rank(_chapter_id);

  -- ── The misses ─────────────────────────────────────────────────────────
  -- Most-repeated first: a question missed four times is the one the check
  -- most needs to ask about. Their difficulty is not chosen — these are the
  -- student's own questions.
  --
  -- A question the student BROUGHT counts as one of their own. It is asked by
  -- its own id — an upload question's or a capture question's — which the
  -- runner resolves from the same three places the recovery ladder's tier 0
  -- does. Before 20261118000000 this half joined question_bank and so could
  -- only ever return bank ids, which left a chapter recovered from captured
  -- mistakes with a check that asked about none of them.
  --
  -- Each kind keeps its own liveness test: a bank question must still be
  -- active and not replaced, and a brought question's row must still exist.
  SELECT array_agg(qid) INTO _misses FROM (
    SELECT COALESCE(sm.question_id, sm.upload_question_id, sm.capture_question_id) AS qid
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid
       AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND (
         (sm.question_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.question_bank qb
             WHERE qb.id = sm.question_id
               AND qb.is_active
               AND qb.replaced_by_question_id IS NULL))
         OR (sm.question_id IS NULL AND sm.upload_question_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.student_upload_questions uq
             WHERE uq.id = sm.upload_question_id AND uq.owner_id = _uid))
         OR (sm.question_id IS NULL AND sm.upload_question_id IS NULL
             AND sm.capture_question_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.student_capture_questions cq
             WHERE cq.id = sm.capture_question_id AND cq.owner_id = _uid))
       )
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
     LIMIT _want_miss
  ) t;

  -- ── The unseen ─────────────────────────────────────────────────────────
  -- §5.4, enforced. Two exclusions, and both are needed:
  --   * question_attempts — anything they have ever answered, in any session,
  --     including one they abandoned. Having seen it is what disqualifies it,
  --     not having got it right.
  --   * student_mistakes — a question they got wrong. It would otherwise
  --     arrive in the "fresh" half and be counted as new material.
  --
  -- Ordered by distance from the level this student works at in this chapter,
  -- then by age. Insertion order alone decided this until 20261100000000.
  SELECT array_agg(qid) INTO _fresh FROM (
    SELECT qb.id AS qid
      FROM public.question_bank qb
     WHERE qb.chapter_id = _chapter_id
       AND qb.is_active
       AND qb.is_approved
       AND qb.replaced_by_question_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.question_attempts qa
          WHERE qa.user_id = _uid AND qa.bank_question_id = qb.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.student_mistakes sm
          WHERE sm.user_id = _uid AND sm.question_id = qb.id)
     ORDER BY abs(public._difficulty_rank(qb.difficulty) - _level), qb.created_at
     LIMIT _want_fresh
  ) t;

  _n_fresh := COALESCE(array_length(_fresh, 1), 0);

  -- §5.4: a revision check is made of questions this student has NEVER
  -- SEEN. With none left there is no check to give, and building one out
  -- of the mistake book alone produces a sitting that
  -- rpc_submit_revision_session will refuse to score — measured live on
  -- 2026-09-17, twice, after the student had answered every question.
  -- Refusing here costs them nothing; refusing there costs them the
  -- sitting.
  IF _n_fresh = 0 THEN
    RAISE EXCEPTION 'there is nothing new left in this chapter to check you on — every question in it has already come up';
  END IF;
  _n_miss  := COALESCE(array_length(_misses, 1), 0);

  RETURN jsonb_build_object(
    'chapter_id',      _chapter_id,
    'mistake_ids',     to_jsonb(COALESCE(_misses, ARRAY[]::uuid[])),
    'fresh_ids',       to_jsonb(COALESCE(_fresh, ARRAY[]::uuid[])),
    'question_ids',    to_jsonb(COALESCE(_misses, ARRAY[]::uuid[]) || COALESCE(_fresh, ARRAY[]::uuid[])),
    'mistakes',        _n_miss,
    'fresh',           _n_fresh,
    'fresh_wanted',    _want_fresh,
    -- The level the fresh half was drawn around, so a screen (or a session
    -- report) can say what the check was set at rather than implying it.
    'level',           CASE _level WHEN 1 THEN 'easy' WHEN 3 THEN 'hard' ELSE 'medium' END,
    -- Short is reported, never padded. A chapter whose bank is exhausted for
    -- this student gives a shorter check and says so; filling the gap with
    -- questions they have already seen would quietly turn a retention check
    -- into a recall check.
    'fresh_short',     greatest(0, _want_fresh - _n_fresh),
    'total',           _n_miss + _n_fresh,
    'stage',           COALESCE(_cs.revision_stage, 1),
    'next_revision_at', _cs.next_revision_at,
    'due',             (_cs.next_revision_at IS NOT NULL AND _cs.next_revision_at <= now()),
    'scheduled',       (_cs.user_id IS NOT NULL));
END;
$function$;

-- ── Proof, and every check can fail ─────────────────────────────────────────
DO $proof$
DECLARE
  _b        record;
  _plan     jsonb;
  _ids      uuid[];
  _brought  int;
  _gained   int := 0;
  _checked  int := 0;
  _inactive int := 0;
BEGIN
  FOR _b IN SELECT * FROM _plan_before LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _b.uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      _plan := public.rpc_revision_session_plan(_b.chapter_id);
    EXCEPTION WHEN others THEN
      _plan := NULL;
      IF _b.err IS NULL THEN
        RESET ROLE;
        RAISE EXCEPTION 'chapter % could be planned before and cannot now: %', _b.chapter_id, SQLERRM;
      END IF;
    END;
    RESET ROLE;

    IF _plan IS NULL THEN
      -- It refused before and refuses now, for the same reason (no fresh
      -- question left). That is not this migration's business.
      CONTINUE;
    END IF;

    _checked := _checked + 1;
    SELECT array_agg((e)::text::uuid) INTO _ids FROM jsonb_array_elements_text(_plan->'mistake_ids') e;

    -- 1. Every brought mistake whose row still exists is now askable, up to
    --    the cap. Counted directly, not inferred from the total.
    SELECT count(*) INTO _brought
      FROM public.student_mistakes sm
     WHERE sm.user_id = _b.uid AND sm.chapter_id = _b.chapter_id AND sm.status = 'open'
       AND sm.question_id IS NULL
       AND COALESCE(sm.upload_question_id, sm.capture_question_id) = ANY (COALESCE(_ids, ARRAY[]::uuid[]));
    IF _brought = 0 THEN
      RESET ROLE;
      RAISE EXCEPTION 'chapter % still asks about none of its % brought mistake(s)', _b.chapter_id, _b.brought_open;
    END IF;
    _gained := _gained + _brought;

    -- 2. The check grew by exactly what it gained, and lost nothing: the
    --    fresh half is untouched.
    IF jsonb_array_length(_plan->'fresh_ids') <> _b.fresh THEN
      RESET ROLE;
      RAISE EXCEPTION 'chapter %: the fresh half changed, % → %',
        _b.chapter_id, _b.fresh, jsonb_array_length(_plan->'fresh_ids');
    END IF;
    IF jsonb_array_length(_plan->'mistake_ids') < _b.misses THEN
      RESET ROLE;
      RAISE EXCEPTION 'chapter %: it now asks about FEWER of their mistakes, % → %',
        _b.chapter_id, _b.misses, jsonb_array_length(_plan->'mistake_ids');
    END IF;

    -- 3. CONTROL: a withdrawn question is still not asked. A bank mistake whose
    --    question is inactive or replaced must NOT be in the list — otherwise
    --    this migration would have widened the wrong thing.
    IF EXISTS (
      SELECT 1 FROM public.student_mistakes sm
        JOIN public.question_bank qb ON qb.id = sm.question_id
       WHERE sm.user_id = _b.uid AND sm.chapter_id = _b.chapter_id AND sm.status = 'open'
         AND (NOT qb.is_active OR qb.replaced_by_question_id IS NOT NULL)
         AND sm.question_id = ANY (COALESCE(_ids, ARRAY[]::uuid[]))
    ) THEN
      RAISE EXCEPTION 'chapter %: a withdrawn bank question is being asked again', _b.chapter_id;
    END IF;
    SELECT count(*) INTO _inactive
      FROM public.student_mistakes sm
      JOIN public.question_bank qb ON qb.id = sm.question_id
     WHERE sm.user_id = _b.uid AND sm.chapter_id = _b.chapter_id AND sm.status = 'open'
       AND (NOT qb.is_active OR qb.replaced_by_question_id IS NOT NULL);
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF (SELECT count(*) FROM _plan_before) > 0 AND _checked = 0 THEN
    RAISE WARNING 'every affected chapter refuses for want of a fresh question, so the new misses half is unproven on this database.';
  ELSIF _checked > 0 AND _gained = 0 THEN
    RAISE EXCEPTION 'CONTROL: % chapter(s) were checked and not one gained a brought question — the new arm is not in force', _checked;
  ELSE
    RAISE NOTICE 'revision checks re-asking a brought question: % chapter(s), % brought mistake(s) now askable; withdrawn bank questions still excluded (% seen)',
      _checked, _gained, _inactive;
  END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261118000000_a_revision_check_re_asks_what_the_student_brought')
ON CONFLICT (version) DO NOTHING;

COMMIT;
