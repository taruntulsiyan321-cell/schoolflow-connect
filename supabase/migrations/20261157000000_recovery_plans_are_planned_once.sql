-- ═══════════════════════════════════════════════════════════════════════════
-- RECOVERY PLANS ARE PLANNED ONCE, NOT ON EVERY CALL (docs/TODO.md E2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 116 item 2: with three to nine browsers on one student, Home,
-- Analysis and Recovery returned 500s. Measured, 2026-10-11:
--
--   * The log store holds 77 statement timeouts (57014, the 8 s
--     statement_timeout of `authenticated`) on 2026-10-03, the day of that
--     audit, and 0 or 1 on every other day from 26 Sep to 10 Oct.
--   * 44 of the 77 were cancelled inside _recovery_session_plan_for, reached
--     through _recovery_queue_for — 38 of those under
--     rpc_student_academic_snapshot, which builds the whole recovery queue to
--     count its startable chapters, and 6 under rpc_student_recovery_queue.
--   * None was a lock wait. log_lock_waits is on (deadlock_timeout 1 s), and
--     a controlled 2.2 s advisory-lock wait shows up in the same log store as
--     "still waiting for … after 1000 ms" — the control — while 2026-10-03
--     has no such line. The statements were slow, not blocked.
--   * Alone and warm, the heaviest student's queue takes 272 ms and their
--     snapshot 362 ms, 75 % of it that queue. Each wide chapter's plan calls
--     _recovery_step_pool 16 times at ~1.2 ms a call, even for a call that
--     returns nothing; EXPLAIN puts planning at 3 ms against 0.8-1.4 ms of
--     execution. The database is Micro compute (2 shared cores, 1 GB): six
--     students' worth of that at once took 7 s, nine took 50 s.
--
-- WHY EVERY CALL WAS PLANNED. _recovery_step_pool, _recovery_variant_pool and
-- _recovery_chapter_is_for are LANGUAGE sql with SET search_path. The SET
-- clause stops PostgreSQL inlining them, and a SQL function that is not
-- inlined is planned afresh on every call before PostgreSQL 18 (this is
-- 17.6). PL/pgSQL keeps each statement's plan for the life of the
-- connection, and PostgREST reuses its connections.
--
-- So the three are rewritten in PL/pgSQL around their IDENTICAL queries —
-- RETURN QUERY / RETURN of the same text, comments included. Same
-- signatures, same volatility, same search_path, same owner and grants
-- (CREATE OR REPLACE keeps the ACL; the proof asserts it). Measured in a
-- rolled-back transaction on live: the heaviest queue 274 ms -> 52 ms.
--
-- AND ONE DEFECT THE COMPARISON FOUND. _recovery_queue_for sorted by
-- (ready, open_mistakes) and nothing else, so chapters tied on both came out
-- in whatever order the plan produced — and the order changed when the plan
-- did (it differed for one student between two runs of the unchanged
-- function). Recovery renders that order as-is. It now ends at chapter_id,
-- which is unique in the queue, after subject and chapter name.
--
-- The proof records, BEFORE the replacement and on live data, every pool for
-- every open mistake at every rung, every variant pool of every source at
-- every rung and difficulty, the entitlement of every student to their own
-- chapters and 40 others, every ready chapter's plan and every queue — and
-- requires each to be unchanged after it.
--
-- ROLLBACK: rollback/20261157000000_recovery_plans_are_planned_once.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── What the live functions answer, before anything changes ────────────────
-- A plain temp table dropped at the end (not ON COMMIT DROP), so the proof
-- reads the same way applied statement by statement as in one transaction.
CREATE TEMP TABLE e2_before (kind text, k text, v jsonb, PRIMARY KEY (kind, k));
CREATE TEMP TABLE e2_acl (fn regprocedure PRIMARY KEY, acl text);

INSERT INTO e2_acl
SELECT p.oid::regprocedure, p.proacl::text
  FROM pg_proc p
 WHERE p.oid IN ('public._recovery_step_pool(uuid,uuid,jsonb,smallint)'::regprocedure,
                 'public._recovery_variant_pool(uuid,smallint,text)'::regprocedure,
                 'public._recovery_chapter_is_for(uuid,uuid)'::regprocedure,
                 'public._recovery_queue_for(uuid)'::regprocedure);

CREATE FUNCTION pg_temp.e2_record(_into text) RETURNS void
LANGUAGE plpgsql AS $rec$
DECLARE
  _u record; _c record; _s record; _tier smallint;
BEGIN
  FOR _u IN SELECT DISTINCT sm.user_id FROM public.student_mistakes sm
             WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL LOOP
    -- the queue as a set, and the sequence of its sort keys: the order of
    -- chapters tied on both keys is the defect fixed below, so it is
    -- compared separately (the determinism check in the proof).
    EXECUTE format('INSERT INTO %I SELECT %L, %L, jsonb_agg(r ORDER BY r->>''chapter_id'')
                      FROM jsonb_array_elements(public._recovery_queue_for(%L)) r',
                   _into, 'queue-as-set', _u.user_id, _u.user_id);
    EXECUTE format('INSERT INTO %I SELECT %L, %L, jsonb_agg(jsonb_build_array(r->''ready'', r->''open_mistakes'') ORDER BY o)
                      FROM jsonb_array_elements(public._recovery_queue_for(%L)) WITH ORDINALITY x(r, o)',
                   _into, 'queue-sort-keys', _u.user_id, _u.user_id);

    FOR _c IN SELECT DISTINCT sm.chapter_id FROM public.student_mistakes sm
               WHERE sm.user_id = _u.user_id AND sm.status = 'open' AND sm.chapter_id IS NOT NULL LOOP
      BEGIN
        EXECUTE format('INSERT INTO %I VALUES (%L, %L, public._recovery_session_plan_for(%L, %L))',
                       _into, 'plan', _u.user_id || '/' || _c.chapter_id, _u.user_id, _c.chapter_id);
      EXCEPTION WHEN OTHERS THEN
        EXECUTE format('INSERT INTO %I VALUES (%L, %L, %L)',
                       _into, 'plan', _u.user_id || '/' || _c.chapter_id, to_jsonb('raised: ' || SQLERRM));
      END;
      -- every open mistake of the chapter as a plan builds its source
      FOR _s IN SELECT sm.id, jsonb_strip_nulls(jsonb_build_object(
                         'question_id', sm.question_id, 'upload_question_id', sm.upload_question_id,
                         'capture_question_id', sm.capture_question_id, 'difficulty', sm.difficulty,
                         'topic_id', COALESCE(uq.topic_id, cq.topic_id),
                         'anchor_question_id', COALESCE(uq.matched_bank_question_id, cq.matched_bank_question_id))) AS v
                  FROM public.student_mistakes sm
                  LEFT JOIN public.student_upload_questions uq ON uq.id = sm.upload_question_id
                  LEFT JOIN public.student_capture_questions cq ON cq.id = sm.capture_question_id
                 WHERE sm.user_id = _u.user_id AND sm.chapter_id = _c.chapter_id AND sm.status = 'open' LOOP
        FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint, 3::smallint] LOOP
          EXECUTE format('INSERT INTO %I SELECT %L, %L, COALESCE(jsonb_agg(p.qid ORDER BY p.ord), ''[]''::jsonb)
                            FROM public._recovery_step_pool(%L, %L, %L::jsonb, %s::smallint) WITH ORDINALITY AS p(qid, ord)',
                         _into, 'pool', _u.user_id || '/' || _c.chapter_id || '/' || _s.id || '/' || _tier,
                         _u.user_id, _c.chapter_id, _s.v, _tier);
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  -- every bank question with variants, at every rung, with and without a
  -- difficulty to mirror
  EXECUTE format($q$
    INSERT INTO %I
    SELECT 'variant', src.id || '/' || t.tier || '/' || COALESCE(d.diff, '-'),
           (SELECT COALESCE(jsonb_agg(p.qid ORDER BY p.ord), '[]'::jsonb)
              FROM public._recovery_variant_pool(src.id, t.tier, d.diff) WITH ORDINALITY AS p(qid, ord))
      FROM (SELECT DISTINCT qb.source_question_id AS id FROM public.question_bank qb
             WHERE qb.source_question_id IS NOT NULL) src
      CROSS JOIN (VALUES (1::smallint), (2::smallint), (3::smallint)) t(tier)
      CROSS JOIN (VALUES (NULL::text), ('easy'), ('medium'), ('hard')) d(diff)$q$, _into);

  -- entitlement, both answers: each student's own chapters and 40 others
  EXECUTE format($q$
    INSERT INTO %I
    SELECT 'is_for', u.user_id || '/' || ch.id, to_jsonb(public._recovery_chapter_is_for(u.user_id, ch.id))
      FROM (SELECT DISTINCT user_id FROM public.student_mistakes) u
      CROSS JOIN LATERAL (
        SELECT DISTINCT x.id FROM (
          SELECT sm.chapter_id AS id FROM public.student_mistakes sm
           WHERE sm.user_id = u.user_id AND sm.chapter_id IS NOT NULL
          UNION SELECT qb.chapter_id FROM public.question_attempts qa
                  JOIN public.question_bank qb ON qb.id = qa.bank_question_id
                 WHERE qa.user_id = u.user_id
          UNION (SELECT c.id FROM public.chapters c ORDER BY c.id LIMIT 40)
        ) x WHERE x.id IS NOT NULL
      ) ch$q$, _into);
END $rec$;

SELECT pg_temp.e2_record('e2_before');

-- ── 1. The step pool: the same query, planned once per connection ──────────
CREATE OR REPLACE FUNCTION public._recovery_step_pool(_uid uuid, _chapter_id uuid, _src jsonb, _tier smallint)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PL/pgSQL, not SQL, so this statement's plan is kept for the connection:
  -- a SQL function with SET search_path is never inlined and, before
  -- PostgreSQL 18, is planned again on every call — 16 times per wide chapter
  -- per read of the recovery queue (20261157000000).
  RETURN QUERY
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
END;
$function$;

-- ── 2. The variant pool: the same query, planned once per connection ───────
CREATE OR REPLACE FUNCTION public._recovery_variant_pool(_source_question_id uuid, _tier smallint, _difficulty text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PL/pgSQL so the plan is kept for the connection (20261157000000).
  RETURN QUERY
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
   ORDER BY qb.created_at;
END;
$function$;

-- ── 3. Entitlement: the same question, planned once per connection ─────────
CREATE OR REPLACE FUNCTION public._recovery_chapter_is_for(_uid uuid, _chapter_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PL/pgSQL so the plan is kept for the connection: every recovery plan
  -- asks this first (20261157000000).
  RETURN (
  -- Taught to the student's own section...
  SELECT EXISTS (
    SELECT 1
      FROM public.chapters ch
      JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
      JOIN public.students st        ON st.class_id = ss.section_id
     WHERE ch.id = _chapter_id
       AND st.user_id = _uid
  )
  -- ...or practised from the bank (20261044000000)...
  OR EXISTS (
    SELECT 1
      FROM public.question_attempts qa
      JOIN public.question_bank qb ON qb.id = qa.bank_question_id
     WHERE qa.user_id = _uid
       AND qb.chapter_id = _chapter_id
  )
  -- ...or practised via a private upload / screen-capture attempt, which
  -- stamps chapter_id onto generated_question (§9 / §7.4) with no bank row.
  OR EXISTS (
    SELECT 1
      FROM public.question_attempts qa
     WHERE qa.user_id = _uid
       AND (qa.generated_question->>'chapter_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       AND (qa.generated_question->>'chapter_id')::uuid = _chapter_id
  )
  -- ...or has a mistake filed against that chapter (covers rows where the
  -- attempt snapshot omitted chapter_id but the mistake writer kept it).
  OR EXISTS (
    SELECT 1
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid
       AND sm.chapter_id = _chapter_id
  ));
END;
$function$;

-- ── 4. The queue in one order ───────────────────────────────────────────────
-- As 20261101000000 left it, but for the last ORDER BY.
CREATE OR REPLACE FUNCTION public._recovery_queue_for(_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _trigger       int;
  _deep_max      int;
  _relearn_above int;
  _out           jsonb := '[]'::jsonb;
  _m             record;
  _plan          jsonb;
  _size          int;
  _startable     boolean;
  _why           text;
BEGIN
  IF _uid IS NULL THEN RETURN '[]'::jsonb; END IF;

  _trigger       := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;

  FOR _m IN
    SELECT m.chapter_id, m.open_mistakes, c.name AS chapter, sub.name AS subject,
           cs.state, cs.last_recovery_readiness, cs.recovered_at, COALESCE(rs.rounds, 0) AS rounds,
           (m.open_mistakes >= _trigger AND m.open_mistakes <= _relearn_above) AS ready
      FROM (
        SELECT sm.chapter_id, count(*)::int AS open_mistakes
          FROM public.student_mistakes sm
         WHERE sm.user_id = _uid
           AND sm.status = 'open'
           AND sm.chapter_id IS NOT NULL
           AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL OR sm.capture_question_id IS NOT NULL)
         GROUP BY sm.chapter_id
      ) m
      LEFT JOIN public.chapters c ON c.id = m.chapter_id
      LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
      LEFT JOIN public.chapter_state cs ON cs.user_id = _uid AND cs.chapter_id = m.chapter_id
      LEFT JOIN (
        SELECT chapter_id, count(*)::int AS rounds
          FROM public.recovery_sessions
         WHERE user_id = _uid AND completed_at IS NOT NULL
         GROUP BY chapter_id
      ) rs ON rs.chapter_id = m.chapter_id
  LOOP
    _size := 0; _startable := false; _why := NULL;
    IF _m.ready THEN
      BEGIN
        _plan := public._recovery_session_plan_for(_uid, _m.chapter_id);
        SELECT COALESCE(sum((t.value->>'filled')::int), 0)::int INTO _size
          FROM jsonb_each(COALESCE(_plan->'tiers', '{}'::jsonb)) t;
        _startable := public._recovery_plan_startable(_plan);
        IF NOT _startable THEN
          _why := COALESCE(_plan->>'not_offerable_reason',
                           'not enough material to produce a diagnosis for this chapter yet');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        _why := SQLERRM;
      END;
    END IF;

    _out := _out || jsonb_build_array(jsonb_build_object(
      'chapter_id',     _m.chapter_id,
      'chapter',        _m.chapter,
      'subject',        _m.subject,
      'open_mistakes',  _m.open_mistakes,
      'trigger_count',  _trigger,
      'ready',          _m.ready,
      'mode',           CASE
                          WHEN _m.open_mistakes > _relearn_above THEN 'relearn'
                          WHEN _m.open_mistakes < _trigger       THEN 'none'
                          WHEN _m.open_mistakes <= _deep_max     THEN 'deep'
                          ELSE 'wide' END,
      'planned_size',   _size,
      'startable',      _startable,
      'blocked_reason', _why,
      'relearn_above',  _relearn_above,
      'state',          COALESCE(_m.state, 'has_mistakes'),
      'in_recovery',    (_m.state = 'in_recovery'),
      'last_recovery_readiness', _m.last_recovery_readiness,
      'recovered_at',   _m.recovered_at,
      'rounds_taken',   _m.rounds
    ));
  END LOOP;

  -- Readiest first, and then a fixed order: chapters tied on both counts
  -- used to come out in whatever order the plan produced, and Recovery
  -- renders this order as-is (20261157000000). chapter_id is unique here.
  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'ready')::boolean DESC, (r->>'open_mistakes')::int DESC,
                                       r->>'subject', r->>'chapter', r->>'chapter_id'), '[]'::jsonb)
    INTO _out FROM jsonb_array_elements(_out) r;
  RETURN _out;
END;
$function$;

-- ── PROOF ───────────────────────────────────────────────────────────────────
CREATE TEMP TABLE e2_after (kind text, k text, v jsonb, PRIMARY KEY (kind, k));
SELECT pg_temp.e2_record('e2_after');

DO $proof$
DECLARE
  _n      int;
  _diff   int;
  _bad    text;
  _u      record;
  _custom jsonb;
  _generic jsonb;
BEGIN
  -- 0. The proof read real data: every kind, in numbers that mean something.
  FOR _bad IN SELECT k FROM (VALUES ('pool'), ('variant'), ('is_for'), ('plan'), ('queue-as-set')) v(k)
               WHERE (SELECT count(*) FROM e2_before b WHERE b.kind = v.k) < 5 LOOP
    RAISE EXCEPTION 'VERIFY FAILED: fewer than 5 % rows recorded — the comparison would prove nothing', _bad;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM e2_before WHERE kind = 'is_for' AND v = 'true'::jsonb)
     OR NOT EXISTS (SELECT 1 FROM e2_before WHERE kind = 'is_for' AND v = 'false'::jsonb) THEN
    RAISE EXCEPTION 'VERIFY FAILED: entitlement was not exercised both ways';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM e2_before WHERE kind = 'pool' AND jsonb_array_length(v) > 1) THEN
    RAISE EXCEPTION 'VERIFY FAILED: no pool held two questions, so its order was never compared';
  END IF;

  -- 1. Nothing any of them answers has changed.
  SELECT count(*), min(COALESCE(b.kind, a.kind) || ' ' || COALESCE(b.k, a.k))
    INTO _diff, _bad
    FROM e2_before b FULL JOIN e2_after a USING (kind, k)
   WHERE b.v IS DISTINCT FROM a.v;
  IF _diff > 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % answers changed, first %', _diff, _bad;
  END IF;

  -- 2. The three are PL/pgSQL now, and nobody's access moved.
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN ('public._recovery_step_pool(uuid,uuid,jsonb,smallint)'::regprocedure,
                   'public._recovery_variant_pool(uuid,smallint,text)'::regprocedure,
                   'public._recovery_chapter_is_for(uuid,uuid)'::regprocedure)
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.prosecdef
     AND p.proconfig = ARRAY['search_path=public'];
  IF _n <> 3 THEN RAISE EXCEPTION 'VERIFY FAILED: % of 3 rewritten as STABLE INVOKER PL/pgSQL with search_path', _n; END IF;
  SELECT count(*) INTO _n FROM e2_acl e JOIN pg_proc p ON p.oid = e.fn
   WHERE p.proacl::text IS DISTINCT FROM e.acl;
  IF _n > 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % grants changed', _n; END IF;

  -- 3. The queue's order no longer depends on the plan: forced custom and
  --    forced generic plans give the same order, for every student.
  FOR _u IN SELECT DISTINCT sm.user_id FROM public.student_mistakes sm
             WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL LOOP
    SET LOCAL plan_cache_mode = force_custom_plan;
    _custom := public._recovery_queue_for(_u.user_id);
    SET LOCAL plan_cache_mode = force_generic_plan;
    _generic := public._recovery_queue_for(_u.user_id);
    IF _custom IS DISTINCT FROM _generic THEN
      RAISE EXCEPTION 'VERIFY FAILED: the queue for % depends on the plan', _u.user_id;
    END IF;
    -- and it is in the one total order: the same elements sorted afresh on
    -- the full key, which ends at the unique chapter_id, come out the same
    IF _custom IS DISTINCT FROM (
      SELECT jsonb_agg(r ORDER BY (r->>'ready')::boolean DESC, (r->>'open_mistakes')::int DESC,
                                  r->>'subject', r->>'chapter', r->>'chapter_id')
        FROM jsonb_array_elements(_custom) r) THEN
      RAISE EXCEPTION 'VERIFY FAILED: the queue for % is not in its total order', _u.user_id;
    END IF;
  END LOOP;
  SET LOCAL plan_cache_mode = auto;
END $proof$;

DROP TABLE e2_before, e2_after, e2_acl;
DROP FUNCTION pg_temp.e2_record(text);

COMMIT;
