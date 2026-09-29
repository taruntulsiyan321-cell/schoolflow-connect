-- ===========================================================================
-- A FAILED RECOVERY ROUND GETS NEW QUESTIONS
--
-- §4.6: a recovery session below readiness fails and a new one is generated,
-- with new questions in rounds 1-3 so the student cannot pass by remembering
-- answers; after round three generation stops and rounds draw from what was
-- built. Owner's ruling (2026-09-28): every round keeps the size of the first
-- — the same ladder, one question per rung per mistake — and swaps in
-- questions no earlier round used.
--
-- None of it was built. RECOVERY_GENERATION_ROUNDS was declared and read
-- nowhere. The plan did not know the round; each variant job asks for one
-- variant; _enqueue_variant_generation stopped once one variant per tier
-- existed; and dispatch_variant_generation closed a job as done as soon as
-- ANY variant of its question existed, so a request for a second one would
-- have been closed without writing anything. Every round after the first was
-- the same questions in the same order (KNOWN_ISSUES 98).
--
-- Written on a branch where 20261117000000 had pointed the relearn boundary at
-- RECOVERY_RELEARN_ABOVE. That item was withdrawn (see that file): the constant
-- has not existed since 20261010000000 deleted it, and this body now reads the
-- one boundary that does, RECOVERY_WIDE_MAX_MISTAKES. Nothing else about this
-- migration changes — the two are the same number by construction.
--
-- Two paths also never asked for anything: a round that failed prepared no
-- next round (rpc_submit_recovery_session only set the state), and a student
-- starting a chapter with nothing waiting got a plan built by
-- rpc_start_recovery_session's own copy of the builder, which refused a short
-- plan without queuing its missing rungs. Only a finished practice session
-- ever queued generation.
--
-- NOW
--   _recovery_session_plan_for   knows its round: 1 + the rounds finished
--       since the chapter was last cleared. Every rung is filled least-
--       recently-used first (never used this recovery, then the round longest
--       ago). In rounds 2 to RECOVERY_GENERATION_ROUNDS a mistake's variant
--       rungs take only questions no earlier round used; while one is missing
--       the plan is not offered ("being written"), unless generating it has
--       failed since the last round — then the least recently used is taken
--       rather than the chapter being blocked (§4.1a: degrade by taking
--       longer, never by failing). Tier 0 is always the mistakes themselves.
--       The plan carries round, generate and used_before.
--   _enqueue_variant_generation  asks for a variant when the plan's own pool
--       (_recovery_variant_pool) has none this recovery has not used, and
--       asks for nothing past round RECOVERY_GENERATION_ROUNDS.
--   dispatch_variant_generation  a job is done when a variant written AFTER
--       it exists, not when any variant exists.
--   rpc_submit_recovery_session  a round that is not ready prepares the next
--       one through _ensure_recovery_session, which queues what it lacks.
--   rpc_start_recovery_session   builds a new session through
--       _ensure_recovery_session instead of its own copy.
--
-- A first round is planned exactly as before; the proof checks it on every
-- live plan.
--
-- ROLLBACK: rollback/20261118000000_a_failed_recovery_round_gets_new_questions.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.routines_pre_20261118000000 (
  object text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20261118000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261118000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261118000000 IS
  'Rollback source for 20261118000000: the five functions it changes, as they were. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261118000000 (object, definition)
SELECT o, pg_get_functiondef(o::regprocedure)
  FROM unnest(ARRAY[
    'public._recovery_session_plan_for(uuid,uuid)',
    'public._enqueue_variant_generation(jsonb)',
    'public.dispatch_variant_generation()',
    'public.rpc_submit_recovery_session(uuid,uuid)',
    'public.rpc_start_recovery_session(uuid)']) AS o;

-- Every first-round plan as it was: the proof requires them unchanged.
CREATE TEMP TABLE _first_round_before ON COMMIT DROP AS
SELECT m.user_id, m.chapter_id,
       public._recovery_session_plan_for(m.user_id, m.chapter_id)->'tiers' AS tiers
  FROM (SELECT sm.user_id, sm.chapter_id
          FROM public.student_mistakes sm
         WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
           AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL
                OR sm.capture_question_id IS NOT NULL)
         GROUP BY sm.user_id, sm.chapter_id
        HAVING count(*) <= public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int) m
 WHERE public._recovery_chapter_is_for(m.user_id, m.chapter_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.recovery_sessions rs
      LEFT JOIN public.chapter_state cs ON cs.user_id = rs.user_id AND cs.chapter_id = rs.chapter_id
      WHERE rs.user_id = m.user_id AND rs.chapter_id = m.chapter_id
        AND rs.completed_at IS NOT NULL
        AND rs.completed_at > COALESCE(cs.recovered_at, '-infinity'::timestamptz));

-- ── The plan ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._recovery_session_plan_for(_uid uuid, _chapter_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _n             int;
  _deep_max      int;
  _wide_max      int;
  _relearn_above int;
  _max_rounds    int;
  _mode          text;
  _per           int[] := ARRAY[0, 0, 0, 0];
  _sources       jsonb := '[]'::jsonb;
  _tiers         jsonb := '{}'::jsonb;
  _used          uuid[] := ARRAY[]::uuid[];
  _used_upload   uuid[] := ARRAY[]::uuid[];
  _used_capture  uuid[] := ARRAY[]::uuid[];
  _m             record;
  _src           record;
  _tier          smallint;
  _need          int;
  _got           uuid[];
  _ids           uuid[];
  _short         int;
  _total_short   int := 0;
  _proc_filled   int := 0;
  _conc_filled   int := 0;
  _min_proc      int;
  _min_conc      int;
  _filled        int;
  _offerable     boolean;
  _up_ok         boolean;
  _cap_ok        boolean;
  _since         timestamptz;
  _last_done     timestamptz;
  _round         int;
  _seen          jsonb;
  _gen_src       uuid;
  _fresh_only    boolean;
  _waiting       int := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT public._recovery_chapter_is_for(_uid, _chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id
      USING HINT = 'The curriculum filter is enforced here, in the query layer, not in the UI.';
  END IF;

  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _wide_max      := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;
  _min_proc      := public._recovery_const('RECOVERY_MIN_PROCEDURAL_TO_OFFER')::int;
  _min_conc      := public._recovery_const('RECOVERY_MIN_CONCEPTUAL_TO_OFFER')::int;
  _max_rounds    := public._recovery_const('RECOVERY_GENERATION_ROUNDS')::int;

  SELECT count(*)::int INTO _n
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid
     AND sm.chapter_id = _chapter_id
     AND sm.status = 'open'
     AND (sm.question_id IS NOT NULL
          OR sm.upload_question_id IS NOT NULL
          OR sm.capture_question_id IS NOT NULL);

  IF _n = 0 THEN
    RETURN jsonb_build_object(
      'mode', 'none', 'open_mistakes', 0,
      'sources', '[]'::jsonb, 'tiers', '{}'::jsonb,
      'shortfall', 0, 'complete', false,
      'offerable_if_generation_exhausted', false,
      'not_offerable_reason',
        'nothing is open in this chapter — there is no mistake to build a session from');
  END IF;

  IF _n > _relearn_above THEN
    RETURN jsonb_build_object(
      'mode', 'relearn', 'open_mistakes', _n, 'relearn_above', _relearn_above,
      'sources', '[]'::jsonb, 'tiers', '{}'::jsonb,
      'shortfall', 0, 'complete', false,
      'offerable_if_generation_exhausted', false,
      'not_offerable_reason',
        format('%s open mistakes in one chapter is not a set of slips to drill away. '
               'Practising %s variant questions would not teach the chapter. '
               'Work through the material again first.', _n, _n * 3));
  END IF;

  -- §4.6: WHICH ROUND OF THIS RECOVERY. The rounds finished since the chapter
  -- was last cleared (recovered_at is stamped by a ready round and by "clear
  -- anyway"); a chapter that returns later with new mistakes starts again at
  -- round one. _seen maps every question those rounds asked at tiers 1-3 to
  -- the latest round (1 = the first) that asked it.
  SELECT cs.recovered_at INTO _since
    FROM public.chapter_state cs
   WHERE cs.user_id = _uid AND cs.chapter_id = _chapter_id;

  SELECT count(*)::int, max(rs.completed_at) INTO _round, _last_done
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id
     AND rs.completed_at IS NOT NULL
     AND rs.completed_at > COALESCE(_since, '-infinity'::timestamptz);
  _round := _round + 1;

  SELECT COALESCE(jsonb_object_agg(q.id, q.last_round), '{}'::jsonb) INTO _seen
    FROM (
      SELECT x.id, max(r.n)::int AS last_round
        FROM (
          SELECT rs.plan, row_number() OVER (ORDER BY rs.completed_at) AS n
            FROM public.recovery_sessions rs
           WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id
             AND rs.completed_at IS NOT NULL
             AND rs.completed_at > COALESCE(_since, '-infinity'::timestamptz)
             AND rs.plan IS NOT NULL
        ) r
        CROSS JOIN LATERAL (
          SELECT jsonb_array_elements_text(t.value->'from_bank') AS id
            FROM jsonb_each(COALESCE(r.plan->'tiers', '{}'::jsonb)) t
           WHERE t.key IN ('1', '2', '3')
        ) x
       GROUP BY x.id
    ) q;

  IF _n <= _deep_max THEN
    _mode := 'deep';
    _per := ARRAY[
      public._recovery_const('RECOVERY_DEEP_TIER0')::int,
      public._recovery_const('RECOVERY_DEEP_TIER1')::int,
      public._recovery_const('RECOVERY_DEEP_TIER2')::int,
      public._recovery_const('RECOVERY_DEEP_TIER3')::int];
  ELSE
    _mode := 'wide';
    _per := ARRAY[
      public._recovery_const('RECOVERY_WIDE_TIER0')::int,
      public._recovery_const('RECOVERY_WIDE_TIER1')::int,
      public._recovery_const('RECOVERY_WIDE_TIER2')::int,
      public._recovery_const('RECOVERY_WIDE_TIER3')::int];
  END IF;

  FOR _m IN
    SELECT sm.question_id, sm.upload_question_id, sm.capture_question_id,
           sm.difficulty, sm.times_wrong,
           -- A question the student brought (upload or capture) has no
           -- variants of its own to ladder on; these two say where its steps
           -- come from instead (_recovery_step_pool).
           COALESCE(uq.topic_id, cq.topic_id) AS src_topic_id,
           COALESCE(uq.matched_bank_question_id, cq.matched_bank_question_id) AS src_anchor_id
      FROM public.student_mistakes sm
      LEFT JOIN public.student_upload_questions uq
             ON uq.id = sm.upload_question_id AND uq.owner_id = _uid
      LEFT JOIN public.student_capture_questions cq
             ON cq.id = sm.capture_question_id AND cq.owner_id = _uid
     WHERE sm.user_id = _uid AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND (sm.question_id IS NOT NULL
            OR sm.upload_question_id IS NOT NULL
            OR sm.capture_question_id IS NOT NULL)
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
  LOOP
    _sources := _sources || (jsonb_build_object(
      'question_id', _m.question_id,
      'upload_question_id', _m.upload_question_id,
      'capture_question_id', _m.capture_question_id,
      'difficulty', _m.difficulty,
      'times_wrong', _m.times_wrong)
      || jsonb_strip_nulls(jsonb_build_object(
           'topic_id', _m.src_topic_id,
           'anchor_question_id', _m.src_anchor_id)));

    IF _per[1] <= 0 THEN
      CONTINUE;
    END IF;

    IF _m.question_id IS NOT NULL THEN
      -- Only a question the student can be shown: a bank question withdrawn
      -- after the mistake (retired, or its key disputed) is not an original
      -- that can be asked again (20261093000000).
      IF NOT (_m.question_id = ANY (_used)) AND EXISTS (
           SELECT 1 FROM public.question_bank q
            WHERE q.id = _m.question_id AND q.is_active AND q.is_approved) THEN
        _used := _used || _m.question_id;
      END IF;
    ELSIF _m.upload_question_id IS NOT NULL
          AND NOT (_m.upload_question_id = ANY (_used_upload)) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.student_upload_questions uq
         WHERE uq.id = _m.upload_question_id
           AND uq.owner_id = _uid
      ) INTO _up_ok;
      IF _up_ok THEN
        _used_upload := _used_upload || _m.upload_question_id;
      END IF;
    ELSIF _m.capture_question_id IS NOT NULL
          AND NOT (_m.capture_question_id = ANY (_used_capture)) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.student_capture_questions cq
         WHERE cq.id = _m.capture_question_id
           AND cq.owner_id = _uid
      ) INTO _cap_ok;
      IF _cap_ok THEN
        _used_capture := _used_capture || _m.capture_question_id;
      END IF;
    END IF;
  END LOOP;

  _need := _n * _per[1];
  _filled := COALESCE(array_length(_used, 1), 0)
           + COALESCE(array_length(_used_upload, 1), 0)
           + COALESCE(array_length(_used_capture, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _proc_filled := _proc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{0}', jsonb_build_object(
    'needed', _need,
    'from_bank', to_jsonb(COALESCE(_used, ARRAY[]::uuid[])),
    'from_upload', to_jsonb(COALESCE(_used_upload, ARRAY[]::uuid[])),
    'from_capture', to_jsonb(COALESCE(_used_capture, ARRAY[]::uuid[])),
    'filled', _filled,
    'shortfall', _short,
    'note',
      'own wrongs: bank in from_bank, uploads in from_upload, captures in from_capture'));

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    _need := _n * _per[_tier + 1];
    _got  := ARRAY[]::uuid[];

    IF _need > 0 THEN
      FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
        -- §4.6: in rounds 2 to RECOVERY_GENERATION_ROUNDS a rung that new
        -- variants can be written for takes only a question no earlier round
        -- of this recovery asked — unless writing one has failed since the
        -- last round, when the least recently used is taken instead.
        _gen_src := COALESCE(NULLIF(_src.v->>'question_id', '')::uuid,
                             NULLIF(_src.v->>'anchor_question_id', '')::uuid);
        _fresh_only := _round BETWEEN 2 AND _max_rounds
          AND _gen_src IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.variant_generation_queue g
             WHERE g.source_question_id = _gen_src
               AND g.tier = _tier
               AND g.status = 'failed'
               AND g.created_at >= _last_done);

        SELECT array_agg(t.qid) INTO _ids
          FROM (
            SELECT pool.qid
              FROM public._recovery_step_pool(_uid, _chapter_id, _src.v, _tier)
                   WITH ORDINALITY AS pool(qid, ord)
             WHERE NOT (pool.qid = ANY (_used))
               AND NOT (_fresh_only AND _seen ? pool.qid::text)
             ORDER BY COALESCE((_seen->>pool.qid::text)::int, 0), pool.ord
             LIMIT _per[_tier + 1]
          ) t;
        IF _ids IS NOT NULL THEN
          _got  := _got || _ids;
          _used := _used || _ids;
        END IF;
        IF _fresh_only THEN
          _waiting := _waiting + greatest(0, _per[_tier + 1] - COALESCE(array_length(_ids, 1), 0));
        END IF;
      END LOOP;
    END IF;

    _filled := COALESCE(array_length(_got, 1), 0);
    _short  := greatest(0, _need - _filled);
    _total_short := _total_short + _short;
    IF _tier = 1 THEN _proc_filled := _proc_filled + _filled;
                 ELSE _conc_filled := _conc_filled + _filled; END IF;
    _tiers := jsonb_set(_tiers, ARRAY[_tier::text], jsonb_build_object(
      'needed', _need, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
      'filled', _filled, 'shortfall', _short,
      'note', 'bank checked first; the shortfall is what generation must supply'));
  END LOOP;

  _need := _n * _per[4];
  _got  := ARRAY[]::uuid[];

  IF _need > 0 THEN
    -- §4.2 tier 3, one per mistake, about THAT mistake: its topic, its
    -- difficulty, what the student has not seen (_recovery_step_pool); and
    -- §4.6, what this recovery has used least recently.
    FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
      SELECT array_agg(t.qid) INTO _ids
        FROM (
          SELECT pool.qid
            FROM public._recovery_step_pool(_uid, _chapter_id, _src.v, 3::smallint)
                 WITH ORDINALITY AS pool(qid, ord)
           WHERE NOT (pool.qid = ANY (_used))
           ORDER BY COALESCE((_seen->>pool.qid::text)::int, 0), pool.ord
           LIMIT _per[4]
        ) t;
      IF _ids IS NOT NULL THEN
        _got  := _got || _ids;
        _used := _used || _ids;
      END IF;
    END LOOP;
  END IF;

  _filled := COALESCE(array_length(_got, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _conc_filled := _conc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{3}', jsonb_build_object(
    'needed', _need, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
    'filled', _filled, 'shortfall', _short,
    'note', CASE WHEN _need = 0 THEN 'not asked for in wide mode'
                 ELSE 'bank where coverage allows; AI otherwise' END));

  -- A round waiting on its new questions is not offered short: §4.1a, the
  -- student is not waiting on it, so there is no reason to degrade.
  _offerable := (_proc_filled >= _min_proc) AND (_conc_filled >= _min_conc) AND _waiting = 0;

  RETURN jsonb_build_object(
    'mode', _mode, 'open_mistakes', _n, 'sources', _sources, 'tiers', _tiers,
    'shortfall', _total_short, 'complete', (_total_short = 0),
    'procedural_filled', _proc_filled, 'conceptual_filled', _conc_filled,
    'offerable_if_generation_exhausted', _offerable,
    'round', _round,
    'generate', (_round <= _max_rounds),
    'used_before', _seen,
    'waiting_for_new_questions', _waiting,
    'not_offerable_reason',
      CASE WHEN _offerable THEN NULL
           WHEN _waiting > 0 THEN
             format('new questions for round %s are being written, so it does not repeat the last one — it opens when they are ready', _round)
           WHEN _conc_filled < _min_conc AND _proc_filled < _min_proc THEN
             'the bank holds neither enough procedural nor enough conceptual material for this chapter yet'
           WHEN _conc_filled < _min_conc THEN
             'no conceptual questions exist for these mistakes yet, so the session could not tell you whether you understand it or merely remember the steps'
           ELSE
             'not enough procedural questions exist for these mistakes yet'
      END);
END;
$function$;

-- ── Asking for what the round lacks ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._enqueue_variant_generation(_plan jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _src    record;
  _tier   smallint;
  _added  int := 0;
  _qid    uuid;
  _up     uuid;
  _anchor uuid;
  _diff   text;
  _before jsonb := COALESCE(_plan->'used_before', '{}'::jsonb);
BEGIN
  IF _plan IS NULL OR _plan->>'mode' NOT IN ('deep', 'wide') THEN
    RETURN 0;
  END IF;

  -- §4.6: past round RECOVERY_GENERATION_ROUNDS nothing is written; the
  -- round draws on what the earlier ones built. A plan from before rounds
  -- existed carries no flag and is round one.
  IF NOT COALESCE((_plan->>'generate')::boolean, true) THEN
    RETURN 0;
  END IF;

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    FOR _src IN SELECT value AS v FROM jsonb_array_elements(_plan->'sources') LOOP
      _qid    := NULLIF(_src.v->>'question_id', '')::uuid;
      _up     := NULLIF(_src.v->>'upload_question_id', '')::uuid;
      _anchor := NULLIF(_src.v->>'anchor_question_id', '')::uuid;
      _diff   := NULLIF(_src.v->>'difficulty', '');

      IF _qid IS NOT NULL THEN
        -- A BANK ORIGINAL. Nothing short at this rung means nothing to write:
        -- a plan that filled from the bank is the cache working.
        CONTINUE WHEN COALESCE((_plan->'tiers'->(_tier::text)->>'shortfall')::int, 0) = 0;

        -- Already one the plan could use — its own pool, and not asked by an
        -- earlier round of this recovery? Then this plan's shortfall is at a
        -- different source, and paying again would buy a duplicate.
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public._recovery_variant_pool(_qid, _tier, _diff) AS p(qid)
           WHERE NOT (_before ? p.qid::text));

        -- ON CONFLICT DO NOTHING against the partial unique index: two students
        -- finishing sessions in the same second, having failed the same
        -- question, must produce one job.
        INSERT INTO public.variant_generation_queue (source_question_id, tier)
        VALUES (_qid, _tier)
        ON CONFLICT DO NOTHING;
        IF FOUND THEN _added := _added + 1; END IF;

      ELSIF _up IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.student_upload_questions uq
               WHERE uq.id = _up AND uq.answer_source = 'file') THEN
        -- AN UPLOAD ANSWERED FROM ITS OWN FILE gets variants of its own
        -- (upload spec §10). Asked for even when bank questions filled the
        -- rung meanwhile: those are the chapter's questions, not this one's.
        -- An AI-answered upload never reaches here (§6.2).
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public.question_bank qb
           WHERE qb.source_upload_question_id = _up
             AND qb.variant_tier = _tier
             AND qb.is_active AND qb.is_approved
             AND qb.replaced_by_question_id IS NULL
             AND NOT (_before ? qb.id::text));
        INSERT INTO public.variant_generation_queue (source_upload_question_id, tier)
        VALUES (_up, _tier)
        ON CONFLICT DO NOTHING;
        IF FOUND THEN _added := _added + 1; END IF;

      ELSIF _anchor IS NOT NULL THEN
        -- A CAPTURE, OR AN AI-ANSWERED UPLOAD, matched to a bank question when
        -- it was filed. Nothing is generated from the student's own content
        -- (screen-capture spec §9, upload §6.2); the bank question it matched
        -- is a bank original, and its variants serve everyone who fails it.
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public._recovery_variant_pool(_anchor, _tier, _diff) AS p(qid)
           WHERE NOT (_before ? p.qid::text));
        INSERT INTO public.variant_generation_queue (source_question_id, tier)
        VALUES (_anchor, _tier)
        ON CONFLICT DO NOTHING;
        IF FOUND THEN _added := _added + 1; END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN _added;
END;
$function$;

-- ── In-place edits ───────────────────────────────────────────────────────
DO $edit$
DECLARE
  _def text;
  _n   int;
  _done_old constant text :=
    E'               AND qb.variant_tier = q.tier\n';
  _done_new constant text :=
    E'               AND qb.variant_tier = q.tier\n' ||
    E'               AND qb.created_at >= q.created_at\n';
  _next_old constant text :=
    E'    -- §4.6 lets them go again; the round counter records the repeat.\n' ||
    E'    UPDATE public.chapter_state SET\n' ||
    E'      state = ''in_recovery'', last_recovery_readiness = _ready, updated_at = now()\n' ||
    E'    WHERE user_id = _uid AND chapter_id = _rs.chapter_id;\n';
  _next_new constant text := _next_old ||
    E'\n' ||
    E'    -- §4.6: "Below that it fails, and a new session is generated." The\n' ||
    E'    -- next round is prepared now, and the new questions it needs are asked\n' ||
    E'    -- for, so it is waiting (or being written) when the student comes back.\n' ||
    E'    BEGIN\n' ||
    E'      PERFORM public._ensure_recovery_session(_uid, _rs.student_id, _rs.school_id, _rs.chapter_id);\n' ||
    E'    EXCEPTION WHEN OTHERS THEN\n' ||
    E'      RAISE WARNING ''could not prepare the next recovery round for chapter %: %'', _rs.chapter_id, SQLERRM;\n' ||
    E'    END;\n';
  _start_old constant text := $old$  _ok := public._recovery_plan_startable(_plan);

  IF NOT _ok THEN
    RETURN jsonb_build_object(
      'started', false, 'mode', _mode,
      'reason', COALESCE(_plan->>'not_offerable_reason',
        'not enough material to produce a diagnosis for this chapter yet'),
      'plan', _plan);
  END IF;

  FOR _i IN 0..3 LOOP
    _tot[_i + 1] := COALESCE((_plan->'tiers'->(_i::text)->>'filled')::int, 0);
  END LOOP;

  SELECT COALESCE(max(rs.round), 0) + 1 INTO _round
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id;

  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total, plan)
  VALUES (_uid, _sid, _school, _chapter_id, _round,
          _tot[1], _tot[2], _tot[3], _tot[4], _plan)
  RETURNING id INTO _rid;
$old$;
  _start_new constant text := $new$  -- Built by the one builder, which also asks for whatever the plan lacks —
  -- so a student opening a round whose new questions are not written yet
  -- has them asked for, not only refused (§4.1a, §4.6).
  _rid := public._ensure_recovery_session(_uid, _sid, _school, _chapter_id);

  IF _rid IS NULL THEN
    RETURN jsonb_build_object(
      'started', false, 'mode', _mode,
      'reason', COALESCE(_plan->>'not_offerable_reason',
        'not enough material to produce a diagnosis for this chapter yet'),
      'plan', _plan);
  END IF;

  SELECT rs.round, rs.plan,
         ARRAY[rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total]
    INTO _round, _plan, _tot
    FROM public.recovery_sessions rs WHERE rs.id = _rid;
$new$;
  _ok_decl constant text := E'  _ok     boolean;\n';
BEGIN
  _def := replace(pg_get_functiondef('public.dispatch_variant_generation()'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _done_old, ''))) / length(_done_old);
  IF _n <> 2 THEN RAISE EXCEPTION 'dispatch: expected the done test twice (bank, upload), found %', _n; END IF;
  EXECUTE replace(_def, _done_old, _done_new);

  _def := replace(pg_get_functiondef('public.rpc_submit_recovery_session(uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _next_old, ''))) / length(_next_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'submit: expected the not-ready branch once, found %', _n; END IF;
  EXECUTE replace(_def, _next_old, _next_new);

  _def := replace(pg_get_functiondef('public.rpc_start_recovery_session(uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _start_old, ''))) / length(_start_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'start: expected its own copy of the builder once, found %', _n; END IF;
  _n := (length(_def) - length(replace(_def, _ok_decl, ''))) / length(_ok_decl);
  IF _n <> 1 THEN RAISE EXCEPTION 'start: expected the _ok declaration once, found %', _n; END IF;
  EXECUTE replace(replace(_def, _start_old, _start_new), _ok_decl, '');
END
$edit$;

-- ── THE PROOF ────────────────────────────────────────────────────────────
--
--   1. Every first-round plan the live database can build is unchanged.
--   2. A second round, on a real student's chapter: the plan says round 2;
--      tier 0 is the same mistakes; no variant rung repeats a question the
--      first round asked; where the bank has no unused variant the round
--      is held with that reason and generation is queued for it. Rolled back.
--   3. The dispatcher closes a job only on a variant written after it; submit
--      prepares the next round; start builds through the one builder.
DO $proof$
DECLARE
  _b      record;
  _n      int := 0;
  _uid    uuid;
  _chap   uuid;
  _sid    uuid;
  _school uuid;
  _p1     jsonb;
  _p2     jsonb;
  _queued int;
BEGIN
  FOR _b IN SELECT * FROM _first_round_before LOOP
    _n := _n + 1;
    IF (public._recovery_session_plan_for(_b.user_id, _b.chapter_id)->'tiers') IS DISTINCT FROM _b.tiers THEN
      RAISE EXCEPTION 'a first round is planned differently for % / %', _b.user_id, _b.chapter_id;
    END IF;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'no first-round plan to compare — check 1 proved nothing'; END IF;
  RAISE NOTICE '% first-round plans unchanged', _n;

  -- A real, offerable first round whose mistakes are all on bank questions:
  -- the rounds that can have new variants written. A mistake the student
  -- brought with no bank match has nothing to generate from, and its rounds
  -- take the chapter's least recently used questions by design.
  SELECT f.user_id, f.chapter_id INTO _uid, _chap
    FROM _first_round_before f
   WHERE jsonb_array_length(COALESCE(f.tiers->'1'->'from_bank', '[]')) > 0
     AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                      WHERE sm.user_id = f.user_id AND sm.chapter_id = f.chapter_id
                        AND sm.status = 'open' AND sm.question_id IS NULL)
     AND public._recovery_plan_startable(public._recovery_session_plan_for(f.user_id, f.chapter_id))
   LIMIT 1;
  IF _uid IS NULL THEN
    RAISE WARNING 'no offerable first round with a variant to prove round 2 on — check 2 was not measured';
  ELSE
    SELECT s.id, s.school_id INTO _sid, _school FROM public.students s WHERE s.user_id = _uid LIMIT 1;
    BEGIN
      _p1 := public._recovery_session_plan_for(_uid, _chap);
      INSERT INTO public.recovery_sessions (user_id, student_id, school_id, chapter_id, round,
        tier0_total, tier1_total, tier2_total, tier3_total, plan, completed_at, outcome)
      VALUES (_uid, _sid, _school, _chap, 1, 0, 0, 0, 0, _p1, now(), 'not_ready');
      _p2 := public._recovery_session_plan_for(_uid, _chap);
      PERFORM public._enqueue_variant_generation(_p2);
      SELECT count(*)::int INTO _queued FROM public.variant_generation_queue
       WHERE status = 'pending' AND created_at = now();
      RAISE EXCEPTION 'proof_rollback';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'proof_rollback' THEN RAISE; END IF;
    END;

    IF (_p2->>'round')::int <> 2 THEN
      RAISE EXCEPTION 'after one finished round the plan says round %', _p2->>'round';
    END IF;
    IF (_p2->'tiers'->'0') IS DISTINCT FROM (_p1->'tiers'->'0') THEN
      RAISE EXCEPTION 'round 2 changed the mistakes it asks (tier 0)';
    END IF;
    IF EXISTS (
      SELECT 1 FROM generate_series(1, 2) t,
             jsonb_array_elements_text(COALESCE(_p2->'tiers'->(t::text)->'from_bank', '[]')) x(id)
       WHERE EXISTS (SELECT 1 FROM generate_series(1, 2) u
                      WHERE COALESCE(_p1->'tiers'->(u::text)->'from_bank', '[]') ? x.id)) THEN
      RAISE EXCEPTION 'round 2 repeats a variant round 1 asked';
    END IF;
    IF (_p2->>'waiting_for_new_questions')::int > 0 THEN
      IF public._recovery_plan_startable(_p2) THEN
        RAISE EXCEPTION 'round 2 is waiting on new questions and is offered anyway';
      END IF;
      IF _queued = 0 THEN
        RAISE EXCEPTION 'round 2 is waiting on new questions and none were asked for';
      END IF;
    END IF;
  END IF;

  IF pg_get_functiondef('public.dispatch_variant_generation()'::regprocedure)
       NOT LIKE '%qb.variant_tier = q.tier%AND qb.created_at >= q.created_at%qb.variant_tier = q.tier%AND qb.created_at >= q.created_at%' THEN
    RAISE EXCEPTION 'the dispatcher still closes a job on any variant';
  END IF;
  IF pg_get_functiondef('public.rpc_submit_recovery_session(uuid,uuid)'::regprocedure)
       NOT LIKE '%_ensure_recovery_session(_uid, _rs.student_id, _rs.school_id, _rs.chapter_id)%' THEN
    RAISE EXCEPTION 'a round that is not ready does not prepare the next';
  END IF;
  IF pg_get_functiondef('public.rpc_start_recovery_session(uuid)'::regprocedure) LIKE '%INSERT INTO public.recovery_sessions%'
     OR pg_get_functiondef('public.rpc_start_recovery_session(uuid)'::regprocedure) NOT LIKE '%_ensure_recovery_session(_uid, _sid, _school, _chapter_id)%' THEN
    RAISE EXCEPTION 'start still builds a session with its own copy of the builder';
  END IF;
END
$proof$;

COMMIT;
