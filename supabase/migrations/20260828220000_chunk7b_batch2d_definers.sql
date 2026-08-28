-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7B — BATCH 2d: the definers batch 2c did not reach, and the parent path
--
-- Batch 2c narrowed the battle_reports RLS policies, narrowed
-- rpc_ensure_battle_report, and deleted the routed teacher UI page. It did not
-- close the leak.
--
-- RLS does not apply inside a SECURITY DEFINER body. rpc_get_battle_report is
-- SECURITY DEFINER, is EXECUTE-granted to authenticated AND anon, carries its
-- own authorisation clause, and was never touched:
--
--     _allowed := _r.user_id = auth.uid()
--       OR _r.creator_user_id = auth.uid()
--       OR (has_role(auth.uid(),'admin')     AND same_school(_r.school_id))
--       OR (has_role(auth.uid(),'principal') AND same_school(_r.school_id))
--       OR (_r.class_id IS NOT NULL AND teacher_teaches_class(auth.uid(), _r.class_id));
--
-- and then returns 'report', _r.report — the whole blob, topics.weak and the
-- per-question questions[] included. rpc_ensure_battle_report's own last line
-- is RETURN public.rpc_get_battle_report(_participant_id): the wrapper was
-- locked to the owner while the function it wraps stayed independently
-- callable. Deleting BattleTeacherReport.tsx removed a link, not reachability
-- — these are callable directly over PostgREST, and
-- battleExperienceService.ts still calls the two teacher RPCs.
--
-- This is the FIFTH instance of the pattern (rpc_teacher_class_insights,
-- rpc_dpp_pick_from_bank, rpc_ensure_battle_report, Nova's facts bundle, and
-- now this). Policy-level auditing cannot see any of them.
--
-- ── The parent path, which no batch had touched ────────────────────────────
--
-- rpc_parent_child_snapshot (parent- and admin-callable) returns
-- rpc_student_academic_snapshot_internal, which builds:
--
--     weak_topics    _weak_topics_for_user(uid) WHERE accuracy < 65
--     strong_topics  _weak_topics_for_user(uid) WHERE accuracy >= 75
--     mistake_count  count(*) FROM student_mistakes WHERE status = 'open'
--
-- §10.8 makes all three student-only, and "strong areas are never surfaced
-- anywhere in the app" makes strong_topics a violation on its own terms.
--
-- rpc_parent_weekly_digest goes further and makes it DURABLE: it writes
-- "<name> has N topics in their mistake book." into parent_academic_alerts,
-- so the mistake book's size outlives any read gate. Existing rows are purged
-- below — closing the writer while leaving what it wrote is not a closure.
--
-- ── §10.16, applied rather than invented ───────────────────────────────────
--
-- The battle summary block carries both halves of the split:
--     public   score, rank, won, total_participants
--     private  correct_count, answered_count, skipped_count, accuracy_pct
-- §10.16 names "session counts, practice rate ... skipped" as private in so
-- many words, so the private half is dropped from the two teacher-facing
-- battle RPCs and the public half is kept. Battle standings survive.
--
-- ── Reported, NOT decided here ─────────────────────────────────────────────
--
--   * Teacher-CREATED battles (src/gurukul-teacher/TeacherBattleground.tsx)
--     contradict 2c's premise that a battle is student-initiated and therefore
--     practice. If a teacher assigns a battle it is arguably school data, and
--     that would reopen the monitor question. Not settled here.
--   * rpc_student_academic_snapshot_internal also returns exam_readiness and
--     activity_heatmap to parents. Neither is named in §10.8's private list,
--     both are practice-derived. Left in place, flagged.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Prove the leaks are live before closing them ────────────────────────
DO $before$
DECLARE _fail text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname = 'rpc_get_battle_report'
       AND p.prosrc ILIKE '%teacher_teaches_class%'
  ) THEN
    _fail := _fail || 'rpc_get_battle_report no longer authorises a teacher — already closed? ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname = 'rpc_student_academic_snapshot_internal'
       AND p.prosrc ILIKE '%strong_topics%'
  ) THEN
    _fail := _fail || 'snapshot_internal no longer returns strong_topics — already closed? ';
  END IF;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'batch 2d preconditions not met: %', _fail;
  END IF;
END
$before$;

-- ── 2. rpc_get_battle_report — the owning student, and nobody else ──────────
-- Rewritten in full rather than patched. The body is short, and the whole
-- point of the change is the authorisation line, so restating it explicitly
-- is clearer than a substitution that has to be read twice to verify.
CREATE OR REPLACE FUNCTION public.rpc_get_battle_report(_participant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r record;
BEGIN
  SELECT br.*, b.creator_user_id, b.class_id
    INTO _r
    FROM public.battle_reports br
    JOIN public.battles b ON b.id = br.battle_id
    WHERE br.participant_id = _participant_id;

  IF _r IS NULL THEN RETURN NULL; END IF;
  IF _r.expires_at < now() THEN
    RETURN jsonb_build_object('expired', true, 'expires_at', _r.expires_at);
  END IF;

  -- §10.8. The report holds topics.weak and a per-question questions[] list.
  -- A battle is practice, so it is the student's and nobody else's — not the
  -- creator (who may be another student), not the teacher, not the principal,
  -- not the admin. This function is SECURITY DEFINER, so this line is the
  -- only gate there is: the battle_reports policies never run here.
  IF _r.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN jsonb_build_object(
    'id', _r.id, 'participant_id', _r.participant_id, 'battle_id', _r.battle_id,
    'user_id', _r.user_id, 'display_name', _r.display_name,
    'report', _r.report, 'ai_insights', _r.ai_insights,
    'expires_at', _r.expires_at, 'created_at', _r.created_at, 'expired', false
  );
END $function$;

-- ── 3. rpc_teacher_battle_reports — public standings only ──────────────────
-- It listed report->'summary' wholesale, which carries the private half.
-- Narrowed to the §10.16-public keys. The listing survives; the practice rate
-- does not.
DO $tbr$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_teacher_battle_reports';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'batch 2d: rpc_teacher_battle_reports not found.';
  END IF;

  -- Literal, not a regex: the exact text is known, and a literal cannot
  -- over-reach. (The 2c rollback learned this the expensive way — a lazy
  -- quantifier ate the function's own closing END.)
  _new := replace(
    _def,
    E'''summary'', br.report->''summary'',',
    E'''summary'', jsonb_build_object(\n'
    || E'          ''score'',              br.report->''summary''->''score'',\n'
    || E'          ''rank'',               br.report->''summary''->''rank'',\n'
    || E'          ''won'',                br.report->''summary''->''won'',\n'
    || E'          ''total_participants'', br.report->''summary''->''total_participants''\n'
    || E'        ),'
  );

  IF _new = _def THEN
    RAISE EXCEPTION
      'batch 2d: could not narrow the summary block in rpc_teacher_battle_reports — refusing to leave it serving accuracy_pct.';
  END IF;

  EXECUTE _new;
END
$tbr$;

-- ── 4. rpc_battle_monitor — drop the session counts ────────────────────────
DO $mon$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_battle_monitor';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'batch 2d: rpc_battle_monitor not found.';
  END IF;

  -- score, rank, progress_pct, avg_ms, finished and joined_at stay: score and
  -- rank ARE the standings, rank breaks ties on total_time_ms so the timing is
  -- part of the same public fact, and progress_pct is how far through a live
  -- battle someone is.
  --
  -- Four keys go, and the last two are the ones that matter most:
  --   correct_count / answered_count  "session counts", §10.16 verbatim
  --   accuracy                        practice rate, §10.16 verbatim
  --   struggling                      a derived judgement about a NAMED
  --                                   student's practice performance, handed
  --                                   to a teacher. Nothing in §10.16's public
  --                                   list covers it, and it is the single
  --                                   most sensitive field in the payload.
  _new := replace(
    _def,
    E'        ''correct_count'', p.correct_count,\n        ''answered_count'', p.answered_count,\n',
    ''
  );

  _new := replace(
    _new,
    E'        ''accuracy'', CASE WHEN p.answered_count > 0\n'
    || E'                         THEN round(100.0 * p.correct_count / p.answered_count) ELSE NULL END,\n',
    ''
  );

  -- 'struggling' is the LAST key in the object, so removing it alone would
  -- leave avg_ms with a trailing comma before the closing paren. Both lines
  -- are replaced together so the comma goes with it.
  _new := replace(
    _new,
    E'        ''avg_ms'', CASE WHEN p.answered_count > 0\n'
    || E'                       THEN round(p.total_time_ms::numeric / p.answered_count) ELSE NULL END,\n'
    || E'        ''struggling'', (p.answered_count >= 2 AND p.correct_count::numeric / p.answered_count < 0.4)\n',
    E'        ''avg_ms'', CASE WHEN p.answered_count > 0\n'
    || E'                       THEN round(p.total_time_ms::numeric / p.answered_count) ELSE NULL END\n'
  );

  IF _new = _def THEN
    RAISE EXCEPTION
      'batch 2d: could not narrow rpc_battle_monitor — refusing to leave it serving accuracy and a struggling flag per named student.';
  END IF;

  EXECUTE _new;

  -- Scoped to the PARTICIPANT block. A blanket search for 'accuracy' also hits
  -- the separate 'questions' block, which aggregates attempts/correct per
  -- QUESTION across all participants — item difficulty, not a fact about a
  -- named student. That one is left in place and reported rather than decided:
  -- §10.8 does say "or any aggregate", but a question-level difficulty
  -- statistic is a different kind of thing from a student-level one, and in a
  -- two-person battle it may or may not de-anonymise. Not mine to rule on.
  --
  -- So assert on what is unambiguous: no per-participant correctness survives.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_battle_monitor'
       AND (p.prosrc ILIKE '%''struggling''%' OR p.prosrc ILIKE '%p.correct_count%')
  ) THEN
    RAISE EXCEPTION
      'batch 2d: rpc_battle_monitor still exposes per-participant correctness (struggling flag or correct_count).';
  END IF;
END
$mon$;

-- ── 5. rpc_student_academic_snapshot_internal — the parent payload ─────────
-- Its ONLY two callers are rpc_parent_child_snapshot and
-- rpc_parent_weekly_digest, both parent-facing. The student's own screen goes
-- through the separate no-argument rpc_student_academic_snapshot, which is
-- untouched — so removing these three keys costs the student nothing.
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot_internal(_uid uuid, _student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Removed in Chunk 7B batch 2d, and deliberately not replaced with empty
  -- arrays or a zero (G4): a parent receiving weak_topics: [] and
  -- mistake_count: 0 would read it as "my child has no weak areas and no
  -- mistakes", which is a false statement rather than a withheld one. The
  -- keys are absent.
  --   weak_topics    §10.8 practice, student-only
  --   strong_topics  §10.8, and "strong areas are never surfaced anywhere"
  --   mistake_count  the size of the mistake book
  RETURN jsonb_build_object(
    'exam_readiness', public._exam_readiness(_uid, _student_id),
    'activity_heatmap', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', activity_date, 'total', dpp_count+homework_count+battle_count) ORDER BY activity_date), '[]'::jsonb)
      FROM public.academic_daily_activity WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14)
  );
END; $function$;

-- ── 6. rpc_parent_weekly_digest — stop writing the mistake book down ───────
DO $digest$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_parent_weekly_digest';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'batch 2d: rpc_parent_weekly_digest not found.';
  END IF;

  -- (a) The mistake-book alert goes entirely. There is no compliant wording
  --     of it: the disclosure IS the count.
  _new := replace(
    _def,
    E'      IF COALESCE((_snap->''mistake_count'')::int, 0) > 5\n'
    || E'         AND NOT EXISTS (\n'
    || E'           SELECT 1 FROM public.parent_academic_alerts a\n'
    || E'           WHERE a.parent_user_id = _parent AND a.student_id = _child.id\n'
    || E'             AND a.kind = ''weakness'' AND a.title = ''Mistakes need revision''\n'
    || E'             AND a.created_at >= now() - interval ''7 days''\n'
    || E'         ) THEN\n'
    || E'        INSERT INTO public.parent_academic_alerts (parent_user_id, student_id, kind, title, body)\n'
    || E'        VALUES (_parent, _child.id, ''weakness'',\n'
    || E'          ''Mistakes need revision'',\n'
    || E'          _child.full_name || '' has '' || (_snap->>''mistake_count'') || '' topics in their mistake book.'');\n'
    || E'      END IF;\n',
    E'      -- Chunk 7B batch 2d: the "Mistakes need revision" alert is gone.\n'
    || E'      -- It wrote the size of the child''s mistake book into a durable\n'
    || E'      -- parent_academic_alerts row, so the disclosure outlived every read\n'
    || E'      -- gate. §10.8 makes the mistake book student-only.\n'
  );

  -- (b) The improvement alert SURVIVES — exam readiness is not practice — but
  --     loses its strong_topics condition and the phrase that surfaced it.
  _new := replace(
    _new,
    E'      IF (_snap->''exam_readiness''->>''score'')::numeric >= 70\n'
    || E'         AND jsonb_array_length(COALESCE(_snap->''strong_topics'', ''[]''::jsonb)) >= 1\n',
    E'      IF (_snap->''exam_readiness''->>''score'')::numeric >= 70\n'
  );

  _new := replace(
    _new,
    E'''% with strong topics emerging. Celebrate the momentum!''',
    E'''%. Celebrate the momentum!'''
  );
  _new := replace(
    _new,
    E'|| ''% with strong topics emerging. Celebrate the momentum!'');',
    E'|| ''%. Celebrate the momentum!'');'
  );

  IF _new = _def THEN
    RAISE EXCEPTION
      'batch 2d: rpc_parent_weekly_digest did not match — it may have been rewritten since this migration was authored. Re-read it rather than proceeding.';
  END IF;

  EXECUTE _new;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_parent_weekly_digest'
       AND (p.prosrc ILIKE '%mistake_count%' OR p.prosrc ILIKE '%strong_topics%')
  ) THEN
    RAISE EXCEPTION 'batch 2d: rpc_parent_weekly_digest still references mistake_count or strong_topics.';
  END IF;
END
$digest$;

-- ── 7. Purge what the writer already wrote ─────────────────────────────────
-- Closing the writer while leaving its output in place is not a closure.
DELETE FROM public.parent_academic_alerts
 WHERE kind = 'weakness' AND title = 'Mistakes need revision';

-- ── 8. Residual weak/strong topics in student_academic_profiles.metrics ────
-- refresh_student_academic_profile no longer writes these (verified: its
-- current body references neither `metrics` nor `concept_mastery`), but rows
-- written by the old version survive, and fetchParentSummary in aiRouter reads
-- them straight out to a parent. The write path being gone is why this is a
-- one-time purge rather than a trigger.
UPDATE public.student_academic_profiles
   SET metrics = (metrics - 'weakTopics') - 'strongTopics'
 WHERE metrics ?| ARRAY['weakTopics', 'strongTopics'];

-- ── 9. Assert the closure ──────────────────────────────────────────────────
DO $after$
DECLARE _fail text := ''; _n bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_get_battle_report'
       AND (p.prosrc ILIKE '%teacher_teaches_class%' OR p.prosrc ILIKE '%creator_user_id = auth.uid()%')
  ) THEN
    _fail := _fail || 'rpc_get_battle_report still authorises a non-owner. ';
  END IF;

  -- Asserted on CODE tokens, not on the words. prosrc includes comments, and
  -- the rewritten function documents which three keys it dropped and why —
  -- so a search for 'weak_topics' / 'strong_topics' / 'mistake_count' matches
  -- the explanation of the fix and reports the fix as the bug. (Third time
  -- this shape has bitten in this chunk: the 'unmastered' JSON key going
  -- forward, the word 'status' in the 2b rollback, and now this.)
  --
  -- _weak_topics_for_user and a read of student_mistakes are the only ways
  -- this function can produce that data, and neither appears in prose.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname = 'rpc_student_academic_snapshot_internal'
       AND (p.prosrc ILIKE '%_weak_topics_for_user%'
            OR p.prosrc ILIKE '%FROM public.student_mistakes%')
  ) THEN
    _fail := _fail || 'snapshot_internal still reads practice data. ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_battle_monitor'
       AND p.prosrc ILIKE '%p.correct_count%'
  ) THEN
    _fail := _fail || 'rpc_battle_monitor still serves correct_count. ';
  END IF;

  SELECT count(*) INTO _n FROM public.parent_academic_alerts
   WHERE kind = 'weakness' AND title = 'Mistakes need revision';
  IF _n > 0 THEN
    _fail := _fail || format('%s durable mistake-book alert(s) survive. ', _n);
  END IF;

  SELECT count(*) INTO _n FROM public.student_academic_profiles
   WHERE metrics ?| ARRAY['weakTopics', 'strongTopics'];
  IF _n > 0 THEN
    _fail := _fail || format('%s profile(s) still carry weak/strong topics. ', _n);
  END IF;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'batch 2d closure assertion FAILED: %', _fail;
  END IF;

  RAISE NOTICE 'batch 2d: five definer paths closed, durable alerts and residual metrics purged.';
END
$after$;

COMMIT;
