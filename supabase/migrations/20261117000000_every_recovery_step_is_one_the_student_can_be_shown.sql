-- ===========================================================================
-- EVERY RECOVERY STEP IS ONE THE STUDENT CAN BE SHOWN, AND THE FAR STEP IS
-- ABOUT THE MISTAKE
--
-- Found auditing Recovery and Revision end to end, 2026-09-28.
--
-- 1. The far rung (tier 3) was the chapter's OLDEST questions.
--    §4.2: tier 3 is "same topic, different application", one per mistake in
--    the deep shape, and "variants mirror the difficulty of what was failed".
--    _recovery_session_plan_for filled it with
--        chapter questions ... ORDER BY created_at LIMIT n
--    — the same rows for every student who ever failed anything in the
--    chapter, whatever topic the mistake was in, at whatever difficulty, and
--    including questions the student had already answered. It also skipped two
--    filters every other rung applies: it did not require is_approved, and it
--    did not exclude upload-promoted variants (source_upload_question_id),
--    which are variants, not "a different application".
--
--    _recovery_step_pool already knows how to choose a chapter question for a
--    mistake: its topic first, then its difficulty, then what the student has
--    not seen, then age — that is how a brought question's rungs are filled
--    (20261104000000). Tier 3 now asks it, per mistake, instead of carrying a
--    second, worse copy of that choice. Its count is unchanged: one per
--    mistake in the deep shape, none in the wide.
--
-- 2. A step the app will not show was planned and counted.
--    Practice loads a recovery session through question_bank_student, which
--    serves approved questions only; a planned question that is not approved
--    silently drops out, so the session shows fewer questions than the plan
--    said (the defect 20261093000000 fixed for tier 0 only). The variant pool
--    and an upload's own variants did not require is_approved.
--    _recovery_variant_pool said "the board / is_approved policy applies to it
--    as the caller", which stopped being true when it came to be called only
--    under the definer rpc_start_recovery_session; the filter is now written.
--    The revision check's misses had the same gap and get the same filter.
--
-- 3. "Relearn above" had two homes.
--    The plan and the Recovery card read RECOVERY_WIDE_MAX_MISTAKES where they
--    mean RECOVERY_RELEARN_ABOVE (20261007000000 read the right one;
--    20261104000000 and 20261101000000 regressed it). Both are 8 today, so no
--    student sees a difference; changing either constant would have split the
--    card from the plan.
--
-- 4. Practising a solid chapter brought its check forward.
--    §5.2: re-engaging with a chapter resets the clock. _apply_chapter_state
--    reset it to the FIRST interval (7 days) whatever the chapter's stage, so
--    a chapter proven three times (checked every 30 days) was pulled back to a
--    weekly check by the practice that showed it was still being worked on.
--    The reset now uses the interval of the stage the chapter is at.
--
-- In-place edits of the live bodies (pg_get_functiondef + replace, each
-- anchor asserted), because _recovery_session_plan_for, _recovery_queue_for,
-- _apply_chapter_state and rpc_revision_session_plan are otherwise unchanged
-- and the files that last defined them are not guaranteed to be the live
-- text. The previous definitions are saved for the rollback.
--
-- ROLLBACK: rollback/20261117000000_every_recovery_step_is_one_the_student_can_be_shown.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.routines_pre_20261117000000 (
  object text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20261117000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261117000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261117000000 IS
  'Rollback source for 20261117000000: the six functions it changes, as they were. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261117000000 (object, definition)
SELECT o, pg_get_functiondef(o::regprocedure)
  FROM unnest(ARRAY[
    'public._recovery_variant_pool(uuid,smallint,text)',
    'public._recovery_step_pool(uuid,uuid,jsonb,smallint)',
    'public._recovery_session_plan_for(uuid,uuid)',
    'public._recovery_queue_for(uuid)',
    'public._apply_chapter_state(uuid)',
    'public.rpc_revision_session_plan(uuid)']) AS o;

-- Every plan as it was, so the proof can show what moved and what did not.
CREATE TEMP TABLE _plan_before ON COMMIT DROP AS
SELECT m.user_id, m.chapter_id,
       public._recovery_session_plan_for(m.user_id, m.chapter_id) AS plan
  FROM (SELECT sm.user_id, sm.chapter_id
          FROM public.student_mistakes sm
         WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
           AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL
                OR sm.capture_question_id IS NOT NULL)
         GROUP BY sm.user_id, sm.chapter_id
        HAVING count(*) <= public._recovery_const('RECOVERY_RELEARN_ABOVE')::int) m
 WHERE public._recovery_chapter_is_for(m.user_id, m.chapter_id);

-- ── 2. The variant pool serves what the app will show ────────────────────
CREATE OR REPLACE FUNCTION public._recovery_variant_pool(
  _source_question_id uuid,
  _tier               smallint,
  _difficulty         text
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  -- Existing bank variants of one source question at one tier. Variants are
  -- ordinary bank questions (§4.2a), and a recovery session is loaded through
  -- question_bank_student, which serves approved, active questions only — so
  -- that is what is offered here, written out: this runs under the definer
  -- rpc_start_recovery_session, where no policy filters it. Retired questions
  -- are excluded: a rewrite creates a NEW question and retires the old one
  -- (§10.21).
  SELECT qb.id
    FROM public.question_bank qb
   WHERE qb.source_question_id = _source_question_id
     AND qb.variant_tier       = _tier
     AND qb.is_active
     AND qb.is_approved
     AND qb.replaced_by_question_id IS NULL
     -- §4.2: "variants mirror the difficulty of what was failed." When the
     -- mistake recorded no difficulty there is nothing to mirror, so the
     -- constraint is dropped rather than guessed at.
     AND (_difficulty IS NULL OR qb.difficulty = _difficulty)
   ORDER BY qb.created_at
$fn$;

COMMENT ON FUNCTION public._recovery_variant_pool(uuid, smallint, text) IS
  'Existing approved, active bank variants of one source question at one tier, difficulty-matched. The default path of §4.2a; generation is the fallback.';

-- ── 1 and 2. One home for where every rung comes from ───────────────────
CREATE OR REPLACE FUNCTION public._recovery_step_pool(_uid uuid, _chapter_id uuid, _src jsonb, _tier smallint)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- The questions a recovery rung can be filled from for ONE mistake, best
  -- first. Every one is a question the app will show: approved, active, not
  -- replaced.
  --
  --   rungs 1 and 2 (procedural, conceptual)
  --     a mistake on a bank question    its own generated variants
  --     a mistake on a question the student brought (upload or capture):
  --       1. the variants generated from that upload (answered from its file)
  --       2. the variants of the bank question it matched when it was filed,
  --          and, for the procedural rung, that question itself
  --       3. the chapter's own questions, as for rung 3
  --
  --   rung 3 (far — §4.2 "same topic, different application")
  --     the chapter's own questions for every mistake: its topic first, then
  --     its difficulty, then what the student has not seen yet, then age.
  --     Originals only: a variant is the same question, not another use of it.
  --
  -- A question the student already got wrong is never a step for another
  -- mistake: it is a mistake of its own, not new practice.
  WITH s AS (
    SELECT NULLIF(_src->>'question_id', '')::uuid        AS bank_id,
           NULLIF(_src->>'upload_question_id', '')::uuid AS upload_id,
           NULLIF(_src->>'anchor_question_id', '')::uuid AS anchor_id,
           -- A brought question carries its topic in the source; a bank
           -- mistake's topic is its question's.
           COALESCE(NULLIF(_src->>'topic_id', '')::uuid,
                    (SELECT qb.topic_id FROM public.question_bank qb
                      WHERE qb.id = NULLIF(_src->>'question_id', '')::uuid)) AS topic_id,
           NULLIF(_src->>'difficulty', '')               AS difficulty
  ),
  cand AS (
    SELECT p.qid, 1 AS rk, p.n AS ord
      FROM s CROSS JOIN LATERAL public._recovery_variant_pool(s.bank_id, _tier, s.difficulty)
           WITH ORDINALITY AS p(qid, n)
     WHERE s.bank_id IS NOT NULL
    UNION ALL
    SELECT qb.id, 2, row_number() OVER (ORDER BY qb.created_at)
      FROM s JOIN public.question_bank qb ON qb.source_upload_question_id = s.upload_id
     WHERE s.bank_id IS NULL
       AND qb.variant_tier = _tier
       AND qb.is_active AND qb.is_approved AND qb.replaced_by_question_id IS NULL
    UNION ALL
    SELECT p.qid, 3, p.n
      FROM s CROSS JOIN LATERAL public._recovery_variant_pool(s.anchor_id, _tier, s.difficulty)
           WITH ORDINALITY AS p(qid, n)
     WHERE s.bank_id IS NULL AND s.anchor_id IS NOT NULL
    UNION ALL
    SELECT qb.id, 4, 1
      FROM s JOIN public.question_bank qb ON qb.id = s.anchor_id
     WHERE s.bank_id IS NULL AND _tier = 1
       AND qb.is_active AND qb.is_approved AND qb.replaced_by_question_id IS NULL
    UNION ALL
    SELECT qb.id,
           CASE WHEN qb.topic_id = s.topic_id THEN 5 ELSE 6 END,
           row_number() OVER (
             ORDER BY (qb.topic_id IS NOT DISTINCT FROM s.topic_id) DESC,
                      (qb.difficulty IS NOT DISTINCT FROM s.difficulty) DESC,
                      EXISTS (SELECT 1 FROM public.question_attempts qa
                               WHERE qa.user_id = _uid AND qa.bank_question_id = qb.id),
                      qb.created_at)
      FROM s JOIN public.question_bank qb ON qb.chapter_id = _chapter_id
     WHERE (s.bank_id IS NULL OR _tier = 3)
       AND qb.is_active AND qb.is_approved AND qb.replaced_by_question_id IS NULL
       AND qb.source_question_id IS NULL AND qb.source_upload_question_id IS NULL
  )
  SELECT c.qid
    FROM cand c
   WHERE c.rk = 1
      OR NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                      WHERE sm.user_id = _uid AND sm.question_id = c.qid)
   GROUP BY c.qid
   ORDER BY min(c.rk * 1000000 + c.ord);
$function$;

COMMENT ON FUNCTION public._recovery_step_pool(uuid, uuid, jsonb, smallint) IS
  'Where a recovery rung is filled from for one mistake: rungs 1-2 from its variants (a brought question: upload variants, matched question, then chapter questions); rung 3 from chapter originals, topic then difficulty then unseen first. Approved, active questions only.';
REVOKE ALL ON FUNCTION public._recovery_step_pool(uuid, uuid, jsonb, smallint) FROM PUBLIC, anon, authenticated;

-- ── In-place edits ───────────────────────────────────────────────────────
DO $edit$
DECLARE
  _def text;
  _n   int;
  _relearn_old constant text :=
    E'  _relearn_above := public._recovery_const(\'RECOVERY_WIDE_MAX_MISTAKES\')::int;';
  _relearn_new constant text :=
    E'  _relearn_above := public._recovery_const(\'RECOVERY_RELEARN_ABOVE\')::int;';
  _far_old constant text := $old$  IF _need > 0 THEN
    SELECT array_agg(id) INTO _got
      FROM (
        SELECT qb.id FROM public.question_bank qb
         WHERE qb.chapter_id = _chapter_id
           AND qb.is_active
           AND qb.source_question_id IS NULL
           AND qb.replaced_by_question_id IS NULL
           AND NOT (qb.id = ANY (_used))
           AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                            WHERE sm.user_id = _uid AND sm.question_id = qb.id)
         ORDER BY qb.created_at LIMIT _need
      ) t;
    IF _got IS NOT NULL THEN _used := _used || _got; END IF;
  END IF;$old$;
  _far_new constant text := $new$  IF _need > 0 THEN
    -- §4.2 tier 3, one per mistake, about THAT mistake: its topic, its
    -- difficulty, what the student has not seen (_recovery_step_pool).
    FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
      SELECT array_agg(t.qid) INTO _ids
        FROM (
          SELECT qid
            FROM public._recovery_step_pool(_uid, _chapter_id, _src.v, 3::smallint) AS pool(qid)
           WHERE NOT (qid = ANY (_used))
           LIMIT _per[4]
        ) t;
      IF _ids IS NOT NULL THEN
        _got  := _got || _ids;
        _used := _used || _ids;
      END IF;
    END LOOP;
  END IF;$new$;
  _clock_old constant text :=
    E'      SET next_revision_at = now() + (_interval_1 || \' days\')::interval,';
  _clock_new constant text :=
    E'      -- §5.2: re-engaging resets the clock, at the interval of the stage\n' ||
    E'      -- the chapter is at — a solid chapter keeps its 30 days.\n' ||
    E'      SET next_revision_at = now() + (public._revision_interval_days(\n' ||
    E'            GREATEST(COALESCE(public.chapter_state.revision_stage, 1), 1)) || \' days\')::interval,';
  _miss_old constant text :=
    E'       AND qb.is_active\n       AND qb.replaced_by_question_id IS NULL\n     ORDER BY sm.times_wrong DESC';
  _miss_new constant text :=
    E'       AND qb.is_active\n       AND qb.is_approved\n       AND qb.replaced_by_question_id IS NULL\n     ORDER BY sm.times_wrong DESC';
BEGIN
  -- The plan: relearn constant, and the far rung.
  _def := replace(pg_get_functiondef('public._recovery_session_plan_for(uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _relearn_old, ''))) / length(_relearn_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'plan: expected the relearn line once, found %', _n; END IF;
  _n := (length(_def) - length(replace(_def, _far_old, ''))) / length(_far_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'plan: expected the oldest-first tier-3 block once, found %', _n; END IF;
  EXECUTE replace(replace(_def, _relearn_old, _relearn_new), _far_old, _far_new);

  -- The Recovery card: the same relearn constant as the plan.
  _def := replace(pg_get_functiondef('public._recovery_queue_for(uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _relearn_old, ''))) / length(_relearn_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'queue: expected the relearn line once, found %', _n; END IF;
  EXECUTE replace(_def, _relearn_old, _relearn_new);

  -- The revision clock.
  _def := replace(pg_get_functiondef('public._apply_chapter_state(uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _clock_old, ''))) / length(_clock_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'clock: expected the stage-1 reset once, found %', _n; END IF;
  EXECUTE replace(_def, _clock_old, _clock_new);

  -- The revision check's misses.
  _def := replace(pg_get_functiondef('public.rpc_revision_session_plan(uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _miss_old, ''))) / length(_miss_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'revision: expected the misses filter once, found %', _n; END IF;
  EXECUTE replace(_def, _miss_old, _miss_new);
END
$edit$;

-- ── THE PROOF ────────────────────────────────────────────────────────────
--
-- Against every plan the live database can build, before and after:
--   1. Tier 0 is unchanged.
--   2. Tiers 1 and 2 lost only questions the app would not have shown, and
--      every planned step in tiers 1-3 is one it will show.
--   3. Every tier-3 question is an approved, active original of the chapter
--      that the student never got wrong, and no question appears twice.
--   4. Tier 3 asks as many as before, or the chapter has no more to give.
--   5. Where the chapter has a question in a mistake's topic, tier 3 is in a
--      mistake's topic — the oldest-first rule failed this whenever the
--      chapter's oldest questions were in another topic.
--   6. The card and the plan read RECOVERY_RELEARN_ABOVE; the clock resets at
--      the chapter's own stage; the revision misses require approval.
DO $proof$
DECLARE
  _b record;
  _after jsonb;
  _n int := 0;
  _far uuid[];
  _topics uuid[];
  _eligible int;
  _src text;
BEGIN
  FOR _b IN SELECT * FROM _plan_before LOOP
    _n := _n + 1;
    _after := public._recovery_session_plan_for(_b.user_id, _b.chapter_id);

    IF (_after->'tiers'->'0') IS DISTINCT FROM (_b.plan->'tiers'->'0') THEN
      RAISE EXCEPTION 'tier 0 changed for % / %', _b.user_id, _b.chapter_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM generate_series(1, 2) t,
             jsonb_array_elements_text(COALESCE(_b.plan->'tiers'->(t::text)->'from_bank', '[]')) old(id)
       WHERE NOT (COALESCE(_after->'tiers'->(t::text)->'from_bank', '[]') ? old.id)
         AND EXISTS (SELECT 1 FROM public.question_bank qb
                      WHERE qb.id = old.id::uuid AND qb.is_active AND qb.is_approved)) THEN
      RAISE EXCEPTION 'tiers 1-2 lost a question the app would show, for % / %', _b.user_id, _b.chapter_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM generate_series(1, 3) t,
             jsonb_array_elements_text(COALESCE(_after->'tiers'->(t::text)->'from_bank', '[]')) x(id)
       WHERE NOT EXISTS (SELECT 1 FROM public.question_bank qb
                          WHERE qb.id = x.id::uuid AND qb.is_active AND qb.is_approved
                            AND qb.replaced_by_question_id IS NULL)) THEN
      RAISE EXCEPTION 'a planned step is one the app will not show, for % / %', _b.user_id, _b.chapter_id;
    END IF;

    SELECT array_agg(v::uuid) INTO _far
      FROM jsonb_array_elements_text(COALESCE(_after->'tiers'->'3'->'from_bank', '[]')) v;
    IF EXISTS (
      SELECT 1 FROM unnest(COALESCE(_far, ARRAY[]::uuid[])) f(id)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.question_bank qb
          WHERE qb.id = f.id AND qb.chapter_id = _b.chapter_id
            AND qb.is_active AND qb.is_approved AND qb.replaced_by_question_id IS NULL
            AND qb.source_question_id IS NULL AND qb.source_upload_question_id IS NULL)
          OR EXISTS (SELECT 1 FROM public.student_mistakes sm
                      WHERE sm.user_id = _b.user_id AND sm.question_id = f.id)) THEN
      RAISE EXCEPTION 'a tier-3 question is not a servable original the student never got wrong (% / %)', _b.user_id, _b.chapter_id;
    END IF;

    IF (SELECT count(*) <> count(DISTINCT x) FROM (
          SELECT jsonb_array_elements_text(t.value->'from_bank') AS x
            FROM jsonb_each(_after->'tiers') t) q) THEN
      RAISE EXCEPTION 'a question is planned twice for % / %', _b.user_id, _b.chapter_id;
    END IF;

    SELECT count(*)::int INTO _eligible
      FROM public.question_bank qb
     WHERE qb.chapter_id = _b.chapter_id
       AND qb.is_active AND qb.is_approved AND qb.replaced_by_question_id IS NULL
       AND qb.source_question_id IS NULL AND qb.source_upload_question_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                        WHERE sm.user_id = _b.user_id AND sm.question_id = qb.id)
       AND NOT EXISTS (SELECT 1 FROM jsonb_each(_after->'tiers') t
                        WHERE t.key IN ('1', '2') AND t.value->'from_bank' ? qb.id::text);
    IF COALESCE((_after->'tiers'->'3'->>'filled')::int, 0)
       < LEAST(COALESCE((_after->'tiers'->'3'->>'needed')::int, 0), _eligible) THEN
      RAISE EXCEPTION 'tier 3 asks % of %, with % eligible, for % / %',
        _after->'tiers'->'3'->>'filled', _after->'tiers'->'3'->>'needed', _eligible, _b.user_id, _b.chapter_id;
    END IF;

    SELECT array_agg(DISTINCT t) INTO _topics FROM (
      SELECT COALESCE(NULLIF(s->>'topic_id', '')::uuid,
                      (SELECT qb.topic_id FROM public.question_bank qb
                        WHERE qb.id = NULLIF(s->>'question_id', '')::uuid)) AS t
        FROM jsonb_array_elements(_after->'sources') s) q
     WHERE t IS NOT NULL;
    IF _far IS NOT NULL AND _topics IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.question_bank qb
                    WHERE qb.chapter_id = _b.chapter_id AND qb.topic_id = ANY (_topics)
                      AND qb.is_active AND qb.is_approved AND qb.replaced_by_question_id IS NULL
                      AND qb.source_question_id IS NULL AND qb.source_upload_question_id IS NULL
                      AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                                       WHERE sm.user_id = _b.user_id AND sm.question_id = qb.id)
                      -- Still free: not already asked at another rung of this
                      -- plan (a brought mistake's rungs 1-2 draw on the same
                      -- chapter questions, topic first).
                      AND NOT EXISTS (SELECT 1 FROM jsonb_each(_after->'tiers') t
                                       WHERE t.key IN ('0', '1', '2')
                                         AND t.value->'from_bank' ? qb.id::text))
       AND NOT EXISTS (SELECT 1 FROM public.question_bank qb
                        WHERE qb.id = ANY (_far) AND qb.topic_id = ANY (_topics)) THEN
      RAISE EXCEPTION 'tier 3 is in none of the mistakes'' topics though the chapter has one (% / %)', _b.user_id, _b.chapter_id;
    END IF;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'no plan to compare — the checks above proved nothing'; END IF;
  RAISE NOTICE '% recovery plans re-checked', _n;

  FOREACH _src IN ARRAY ARRAY['public._recovery_session_plan_for(uuid,uuid)', 'public._recovery_queue_for(uuid)'] LOOP
    IF pg_get_functiondef(_src::regprocedure) LIKE '%_relearn_above := public._recovery_const(''RECOVERY_WIDE_MAX_MISTAKES'')%' THEN
      RAISE EXCEPTION '% still reads relearn from RECOVERY_WIDE_MAX_MISTAKES', _src;
    END IF;
    IF pg_get_functiondef(_src::regprocedure) NOT LIKE '%_relearn_above := public._recovery_const(''RECOVERY_RELEARN_ABOVE'')%' THEN
      RAISE EXCEPTION '% does not read RECOVERY_RELEARN_ABOVE', _src;
    END IF;
  END LOOP;
  IF pg_get_functiondef('public._apply_chapter_state(uuid)'::regprocedure)
       NOT LIKE '%_revision_interval_days(%GREATEST(COALESCE(public.chapter_state.revision_stage, 1), 1))%' THEN
    RAISE EXCEPTION 'the clock does not reset at the chapter''s own stage';
  END IF;
  IF pg_get_functiondef('public.rpc_revision_session_plan(uuid)'::regprocedure)
       NOT LIKE '%sm.question_id IS NOT NULL%AND qb.is_active%AND qb.is_approved%ORDER BY sm.times_wrong DESC%' THEN
    RAISE EXCEPTION 'the revision misses do not require an approved question';
  END IF;
END
$proof$;

COMMIT;
