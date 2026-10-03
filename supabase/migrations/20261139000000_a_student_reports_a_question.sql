-- ═══════════════════════════════════════════════════════════════════════════
-- A STUDENT REPORTS A QUESTION, AND THE AI SETTLES IT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- §10.21 (locked), reaffirmed by the owner 2026-10-03 — "fully automatic":
-- one report control in the practice UI; a report goes to the AI, never to the
-- school; the AI handles it and its fix goes live with no human step; a fix is
-- a NEW question and the old one is retired, never overwritten, because a
-- retired question may sit in a student's mistake book.
--
-- Before ruling, the owner was shown that the answer check disputes 178 of the
-- 1,124 CUET questions it has processed, about half of them correctly keyed
-- Accountancy questions that Flash gets conceptually wrong. So a key changes
-- only on the strongest agreement this model can give (section 2).
--
-- 1. question_reports, REBUILT. Chunk 7A made it (0 rows on 2026-10-03;
--    nothing in the app wrote to it) with no status, no outcome and a direct
--    INSERT for anyone signed in. Now: one report per student per question,
--    filed only through rpc_report_question, which checks the student can be
--    served the question, keeps what they saw, and counts the report against
--    the plan (question.report: 10 a day free, unlimited on paid plans).
--
-- 2. THE CHECK. Cron 'check-question-reports' hands each reported question to
--    the question-reports function (dispatch_question_reports), which solves
--    it three times WITHOUT the key:
--      two or more on the key ............. the answer stands;
--      two or more on one other option .... a fourth call, shown the key and
--                                           that option, decides; only if it
--                                           picks the other option is the key
--                                           wrong, and the question is
--                                           replaced with the key corrected;
--      anything else ...................... unresolved: the question joins the
--                                           disputed list.
--    A report that the question itself is broken is reviewed twice — once
--    with the student's note and once without it — and only when both call it
--    broken is it rewritten (the rewrite must be solved to its own key twice)
--    or, failing that, withdrawn.
--
-- 3. apply_question_report_verdict makes a verdict true in one transaction:
--    the replacement, the retirement, every student's record on the old
--    question (_retire_reported_question), the reports, and a notification to
--    each reporter. On the old question: every attempt leaves accuracy and the
--    chapter tallies are written again — rpc_dispute_ai_upload_answer's
--    precedent; an open mistake is cleared, or, when the key was corrected and
--    the student is still wrong under the new key, moved to the corrected
--    question (they did get THAT question wrong, so §10.21's reason against
--    replacing in place does not apply); a bookmark follows the question.
--
-- 4. claim_explanation_rewrites also names the question's exam, class and
--    board, so the checker's label is the question's own, not a constant.
--
-- ROLLBACK: rollback/20261139000000_a_student_reports_a_question.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. question_reports, rebuilt ────────────────────────────────────────────
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.question_reports) THEN
    RAISE EXCEPTION 'question_reports holds rows; this migration rebuilds the table and would lose them';
  END IF;
END $guard$;

DROP TABLE public.question_reports;

CREATE TABLE public.question_reports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id             uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  reason                  text NOT NULL
    CONSTRAINT question_reports_reason_check
    CHECK (reason IN ('wrong_answer', 'question_error', 'explanation_error', 'other')),
  -- The option the student says is right — only for a wrong answer, and only
  -- if they say. The check never sees it: it solves without being told.
  claimed_index           smallint
    CONSTRAINT question_reports_claimed_index_check CHECK (claimed_index BETWEEN 0 AND 7),
  note                    text
    CONSTRAINT question_reports_note_check CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  session_id              uuid REFERENCES public.practice_sessions(id) ON DELETE SET NULL,
  -- What the student saw. Not the key: the student view withholds it, and a
  -- question can be reported before it is answered.
  question_text           text NOT NULL,
  options                 jsonb NOT NULL,
  subject                 text,
  chapter                 text,
  status                  text NOT NULL DEFAULT 'open'
    CONSTRAINT question_reports_status_check
    CHECK (status IN ('open', 'checking', 'answer_stands', 'no_problem', 'explanation_rewritten',
                      'fixed', 'withdrawn', 'unresolved')),
  -- The sentence the student is told, and the worked answer that goes with it.
  outcome                 text,
  outcome_explanation     text,
  replacement_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  checked_at              timestamptz,
  resolved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_reports_one_per_question UNIQUE (user_id, question_id),
  CONSTRAINT question_reports_claim_is_an_answer CHECK (claimed_index IS NULL OR reason = 'wrong_answer'),
  CONSTRAINT question_reports_other_says_what CHECK (reason <> 'other' OR note IS NOT NULL),
  CONSTRAINT question_reports_checking_is_claimed CHECK (status <> 'checking' OR checked_at IS NOT NULL),
  CONSTRAINT question_reports_settled_when_resolved CHECK ((status IN ('open', 'checking')) = (resolved_at IS NULL)),
  CONSTRAINT question_reports_settled_says_why CHECK (resolved_at IS NULL OR outcome IS NOT NULL),
  CONSTRAINT question_reports_replacement_is_a_fix CHECK (replacement_question_id IS NULL OR status = 'fixed')
);

CREATE INDEX question_reports_waiting_idx ON public.question_reports (question_id, created_at)
  WHERE status IN ('open', 'checking');
CREATE INDEX question_reports_user_idx ON public.question_reports (user_id, created_at DESC);

ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;

-- The reporter reads their own report back; the super admin reads them all;
-- the school reads none (§10.21). Nobody writes except through the functions.
CREATE POLICY question_reports_own_read ON public.question_reports
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY question_reports_super_read ON public.question_reports
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()));

REVOKE ALL ON public.question_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.question_reports TO authenticated;
GRANT ALL ON public.question_reports TO service_role;

COMMENT ON TABLE public.question_reports IS
  '§10.21: a student''s report on a bank question, settled by the AI (question-reports function, 20261139000000). Global: no school reads it. Written only through rpc_report_question and apply_question_report_verdict.';

-- ── 2. Reporting ────────────────────────────────────────────────────────────
-- The messages are the student's: the app shows them as they are.
CREATE FUNCTION public.rpc_report_question(
  _question_id   uuid,
  _reason        text,
  _claimed_index integer DEFAULT NULL,
  _note          text DEFAULT NULL,
  _session_id    uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid  uuid := auth.uid();
  _q    public.question_bank%ROWTYPE;
  _note_clean text := nullif(btrim(regexp_replace(coalesce(_note, ''), '\s+', ' ', 'g')), '');
  _row  public.question_reports%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to report a question.' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR _reason NOT IN ('wrong_answer', 'question_error', 'explanation_error', 'other') THEN
    RAISE EXCEPTION 'Choose what is wrong with the question.' USING ERRCODE = '22023';
  END IF;

  -- A question this student can be served: the student view's own rule.
  SELECT q.* INTO _q
    FROM public.question_bank q
   WHERE q.id = _question_id
     AND EXISTS (SELECT 1 FROM public.question_bank_student v WHERE v.id = q.id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That question could not be found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT _q.is_active THEN
    IF _q.replaced_by_question_id IS NOT NULL THEN
      RAISE EXCEPTION 'This question has already been corrected. The corrected version replaces it.' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'This question has been withdrawn.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_q.options) IS DISTINCT FROM 'array' OR _q.correct_index IS NULL THEN
    RAISE EXCEPTION 'Only a multiple-choice question can be reported.' USING ERRCODE = '22023';
  END IF;
  IF _claimed_index IS NOT NULL
     AND (_reason <> 'wrong_answer' OR _claimed_index < 0 OR _claimed_index >= jsonb_array_length(_q.options)) THEN
    RAISE EXCEPTION 'Choose one of the question''s own options.' USING ERRCODE = '22023';
  END IF;
  IF _note_clean IS NOT NULL AND char_length(_note_clean) > 500 THEN
    RAISE EXCEPTION 'A note can be at most 500 characters.' USING ERRCODE = '22023';
  END IF;
  IF _reason = 'other' AND _note_clean IS NULL THEN
    RAISE EXCEPTION 'Say in a few words what is wrong.' USING ERRCODE = '22023';
  END IF;
  IF _session_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.practice_sessions s WHERE s.id = _session_id AND s.user_id = _uid) THEN
    RAISE EXCEPTION 'That practice session could not be found.' USING ERRCODE = 'P0002';
  END IF;

  -- One report per question. While it waits it can be changed; once the check
  -- has it, it stands as filed.
  SELECT * INTO _row FROM public.question_reports
   WHERE user_id = _uid AND question_id = _question_id
   FOR UPDATE;
  IF FOUND THEN
    IF _row.status = 'open' THEN
      UPDATE public.question_reports
         SET reason = _reason, claimed_index = _claimed_index, note = _note_clean,
             session_id = coalesce(_session_id, session_id), updated_at = now()
       WHERE id = _row.id
      RETURNING * INTO _row;
    END IF;
    RETURN jsonb_build_object('created', false, 'report', to_jsonb(_row));
  END IF;

  PERFORM public._premium_require(_uid, 'question.report', 1, true);

  INSERT INTO public.question_reports
    (user_id, question_id, reason, claimed_index, note, session_id, question_text, options, subject, chapter)
  VALUES
    (_uid, _question_id, _reason, _claimed_index, _note_clean, _session_id, _q.question, _q.options, _q.subject, _q.chapter)
  ON CONFLICT (user_id, question_id) DO NOTHING
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    -- Filed a moment ago by another tap.
    SELECT * INTO _row FROM public.question_reports WHERE user_id = _uid AND question_id = _question_id;
    RETURN jsonb_build_object('created', false, 'report', to_jsonb(_row));
  END IF;
  RETURN jsonb_build_object('created', true, 'report', to_jsonb(_row));
END $fn$;

REVOKE ALL ON FUNCTION public.rpc_report_question(uuid, text, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_report_question(uuid, text, integer, text, uuid) TO authenticated;

-- ── 3. The check's queue: claim a question's waiting reports together ──────
CREATE FUNCTION public.claim_question_reports(_limit integer)
RETURNS TABLE (question_id uuid, exam_code text, class_level integer, board text, subject text, chapter text,
               topic text, question text, options jsonb, correct_index integer, explanation text,
               explanation_status text, reports jsonb)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- A run that died holding reports gives them back after 15 minutes.
  UPDATE public.question_reports r
     SET status = 'open', checked_at = NULL, updated_at = now()
   WHERE r.status = 'checking' AND r.checked_at < now() - interval '15 minutes';

  RETURN QUERY
  WITH picked AS (
    SELECT r.question_id AS qid
      FROM public.question_reports r
      JOIN public.question_bank q ON q.id = r.question_id AND q.is_active
     WHERE r.status = 'open'
     GROUP BY r.question_id
     ORDER BY min(r.created_at), r.question_id
     LIMIT greatest(1, least(_limit, 10))
  ), locked AS (
    SELECT r.id AS rid
      FROM public.question_reports r
      JOIN picked p ON p.qid = r.question_id
     WHERE r.status = 'open'
       FOR UPDATE OF r SKIP LOCKED
  ), u AS (
    UPDATE public.question_reports r
       SET status = 'checking', checked_at = now(), updated_at = now()
      FROM locked l
     WHERE r.id = l.rid
    RETURNING r.question_id AS qid, r.id AS rid, r.reason AS rreason, r.claimed_index AS rclaimed,
              r.note AS rnote, r.created_at AS rcreated
  )
  SELECT q.id, ce.code, q.class_level, q.board, q.subject, q.chapter, t.name,
         q.question, q.options, q.correct_index, q.explanation, q.explanation_status,
         jsonb_agg(jsonb_build_object('id', u.rid, 'reason', u.rreason, 'claimed_index', u.rclaimed, 'note', u.rnote)
                   ORDER BY u.rcreated)
    FROM u
    JOIN public.question_bank q ON q.id = u.qid
    LEFT JOIN public.competitive_exams ce ON ce.id = q.exam_id
    LEFT JOIN public.topics t ON t.id = q.topic_id
   GROUP BY q.id, ce.code, t.name;
END $fn$;

REVOKE ALL ON FUNCTION public.claim_question_reports(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_question_reports(integer) TO service_role;

-- ── 4. A verdict made true ──────────────────────────────────────────────────
-- Everyone's record on a retired question. Called only by the verdict below.
CREATE FUNCTION public._retire_reported_question(_old uuid, _new uuid, _same_question boolean, _note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _excluded    integer := 0;
  _sessions    uuid[];
  _cleared     integer := 0;
  _moved       integer := 0;
  _bookmarks   integer := 0;
  _key         integer;
  _options     jsonb;
  _explanation text;
BEGIN
  UPDATE public.question_bank
     SET is_active = false, replaced_by_question_id = _new,
         review_note = concat_ws(E'\n', nullif(btrim(review_note), ''), nullif(btrim(_note), '')),
         updated_at = now()
   WHERE id = _old;

  -- Nobody's answer to it counts any more, either way, and the chapter
  -- tallies those answers fed are written again.
  WITH ex AS (
    UPDATE public.question_attempts qa
       SET excluded_from_accuracy = true
     WHERE qa.bank_question_id = _old AND NOT qa.excluded_from_accuracy
    RETURNING qa.session_id
  )
  SELECT count(*)::int, array_agg(DISTINCT ex.session_id) FILTER (WHERE ex.session_id IS NOT NULL)
    INTO _excluded, _sessions
    FROM ex;
  PERFORM public._write_chapter_tally(s) FROM unnest(coalesce(_sessions, ARRAY[]::uuid[])) s;

  IF _same_question THEN
    SELECT q.correct_index, q.options, q.explanation INTO _key, _options, _explanation
      FROM public.question_bank q WHERE q.id = _new;
    -- Right under the corrected key: there was no mistake.
    UPDATE public.student_mistakes
       SET status = 'cleared', cleared_at = now()
     WHERE question_id = _old AND status = 'open'
       AND student_answer->>'index' ~ '^[0-9]+$'
       AND (student_answer->>'index')::int = _key;
    GET DIAGNOSTICS _cleared = ROW_COUNT;
    -- Still wrong under it: the mistake is on the corrected question now.
    UPDATE public.student_mistakes
       SET question_id = _new,
           correct_answer = jsonb_build_object('text', _options->>_key, 'index', _key),
           explanation = _explanation
     WHERE question_id = _old AND status = 'open';
    GET DIAGNOSTICS _moved = ROW_COUNT;
  ELSE
    -- A broken question proves nothing about anyone; a rewrite is a different
    -- question the student never got wrong.
    UPDATE public.student_mistakes
       SET status = 'cleared', cleared_at = now()
     WHERE question_id = _old AND status = 'open';
    GET DIAGNOSTICS _cleared = ROW_COUNT;
  END IF;

  IF _new IS NOT NULL THEN
    UPDATE public.practice_bookmarks b
       SET question_id = _new
     WHERE b.question_id = _old
       AND NOT EXISTS (SELECT 1 FROM public.practice_bookmarks o WHERE o.user_id = b.user_id AND o.question_id = _new);
    GET DIAGNOSTICS _bookmarks = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'attempts_excluded', _excluded,
    'sessions_retallied', coalesce(array_length(_sessions, 1), 0),
    'mistakes_cleared', _cleared,
    'mistakes_moved', _moved,
    'bookmarks_moved', _bookmarks);
END $fn$;

REVOKE ALL ON FUNCTION public._retire_reported_question(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated, service_role;

-- The verdict, as the question-reports function sends it:
--   kind         keep | correct_key | rewrite | withdraw | unresolved
--   outcome      the sentence for every report it settles (required)
--   reports      [{id, status, outcome}] — the reports this run claimed; for
--                'keep' each carries its own status (answer_stands,
--                no_problem or explanation_rewritten)
--   explanation  keep: written to the question when given; correct_key and
--                rewrite: the replacement's, and it must be proper
--   correct_index, question, options — the replacement's
--   note         the line added to the bank's review_note
-- A correction, a rewrite or a withdrawal settles every report waiting on
-- the question; 'keep' and 'unresolved' settle only the ones checked.
CREATE FUNCTION public.apply_question_report_verdict(_question_id uuid, _verdict jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _kind    text := _verdict->>'kind';
  _default text := nullif(btrim(_verdict->>'outcome'), '');
  _q       public.question_bank%ROWTYPE;
  _claimed uuid[];
  _new     uuid;
  _st      text;
  _status  text;
  _expl    text;
  _key     integer;
  _settled uuid[];
  _effects jsonb := '{}'::jsonb;
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('keep', 'correct_key', 'rewrite', 'withdraw', 'unresolved') THEN
    RAISE EXCEPTION 'verdict kind %', coalesce(_kind, '(none)');
  END IF;
  IF _default IS NULL THEN
    RAISE EXCEPTION 'a verdict needs an outcome for the student';
  END IF;

  SELECT * INTO _q FROM public.question_bank WHERE id = _question_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'question % not found', _question_id;
  END IF;
  PERFORM 1 FROM public.question_reports
   WHERE question_id = _question_id AND status IN ('open', 'checking')
     FOR UPDATE;

  SELECT array_agg((e->>'id')::uuid) INTO _claimed
    FROM jsonb_array_elements(coalesce(_verdict->'reports', '[]'::jsonb)) e;
  IF _claimed IS NULL OR EXISTS (
       SELECT 1 FROM unnest(_claimed) c
        WHERE NOT EXISTS (SELECT 1 FROM public.question_reports r
                           WHERE r.id = c AND r.question_id = _question_id AND r.status = 'checking')) THEN
    RAISE EXCEPTION 'stale claim: a report in this verdict is not being checked for this question';
  END IF;
  IF _kind <> 'unresolved' AND NOT _q.is_active THEN
    RAISE EXCEPTION 'the question was retired while it was checked';
  END IF;

  IF _kind = 'keep' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(_verdict->'reports') e
                WHERE coalesce(e->>'status', '') NOT IN ('answer_stands', 'no_problem', 'explanation_rewritten')) THEN
      RAISE EXCEPTION 'a kept question''s report is answer_stands, no_problem or explanation_rewritten';
    END IF;
    _expl := nullif(btrim(_verdict->>'explanation'), '');
    IF _expl IS NOT NULL AND _expl IS DISTINCT FROM _q.explanation THEN
      UPDATE public.question_bank SET explanation = _expl, updated_at = now()
       WHERE id = _question_id
      RETURNING explanation_status INTO _st;
      IF _st <> 'proper' THEN
        RAISE EXCEPTION 'the explanation written for the report is not proper';
      END IF;
    ELSIF _expl IS NULL AND _q.explanation_status = 'proper' THEN
      _expl := _q.explanation;
    END IF;

  ELSIF _kind IN ('correct_key', 'rewrite') THEN
    _key := (_verdict->>'correct_index')::int;
    IF _kind = 'correct_key' AND (_key IS NULL OR _key = _q.correct_index OR _key < 0
                                  OR _key >= jsonb_array_length(_q.options)) THEN
      RAISE EXCEPTION 'a corrected key must be another of the question''s options';
    END IF;
    IF _kind = 'rewrite' AND (coalesce(btrim(_verdict->>'question'), '') = ''
                              OR jsonb_typeof(_verdict->'options') IS DISTINCT FROM 'array'
                              OR jsonb_array_length(_verdict->'options') NOT BETWEEN 2 AND 8
                              OR _key IS NULL OR _key < 0 OR _key >= jsonb_array_length(_verdict->'options')) THEN
      RAISE EXCEPTION 'a rewrite needs a question, 2 to 8 options and a key among them';
    END IF;

    -- Out of service first: the same text cannot be live twice
    -- (question_bank_unique_active), and a correction keeps the text.
    UPDATE public.question_bank SET is_active = false WHERE id = _question_id;

    INSERT INTO public.question_bank (
      class_level, subject, chapter, difficulty, question, options, correct_index, explanation,
      source, created_by, is_approved, board, source_type, exam_year, stream, question_format,
      is_active, embedding, embedding_basis, embed_status, chapter_id,
      source_question_id, source_upload_question_id, variant_tier, review_note, answer, topic_id, exam_id)
    SELECT q.class_level, q.subject, q.chapter, q.difficulty,
           CASE WHEN _kind = 'rewrite' THEN btrim(_verdict->>'question') ELSE q.question END,
           CASE WHEN _kind = 'rewrite' THEN _verdict->'options' ELSE q.options END,
           _key, _verdict->>'explanation',
           q.source, q.created_by, true, q.board,
           CASE WHEN _kind = 'rewrite' THEN 'ai_generated' ELSE q.source_type END,
           -- A rewrite is no longer that year's paper.
           CASE WHEN _kind = 'rewrite' THEN NULL ELSE q.exam_year END,
           q.stream, q.question_format, true,
           -- The same text keeps its vector; new text waits for the embedding drain.
           CASE WHEN _kind = 'correct_key' THEN q.embedding END,
           CASE WHEN _kind = 'correct_key' THEN q.embedding_basis END,
           CASE WHEN _kind = 'correct_key' THEN q.embed_status ELSE 'pending_embed' END,
           q.chapter_id, q.source_question_id, q.source_upload_question_id, q.variant_tier,
           format('Replaces %s after a student report (%s).', q.id, to_char(now(), 'YYYY-MM-DD')),
           q.answer, q.topic_id, q.exam_id
      FROM public.question_bank q
     WHERE q.id = _question_id
    RETURNING id, explanation_status INTO _new, _st;
    IF _st <> 'proper' THEN
      RAISE EXCEPTION 'the replacement''s explanation is not proper';
    END IF;
    _effects := public._retire_reported_question(_question_id, _new, _kind = 'correct_key', _verdict->>'note');
    _expl := _verdict->>'explanation';
    _status := 'fixed';

  ELSIF _kind = 'withdraw' THEN
    _effects := public._retire_reported_question(_question_id, NULL, false, _verdict->>'note');
    _status := 'withdrawn';

  ELSE
    -- Unresolved: the question joins the disputed list with what was found.
    UPDATE public.question_bank
       SET explanation_status = 'disputed', explanation_claimed_at = NULL,
           review_note = concat_ws(E'\n', nullif(btrim(review_note), ''), nullif(btrim(_verdict->>'note'), '')),
           updated_at = now()
     WHERE id = _question_id;
    _status := 'unresolved';
  END IF;

  WITH per AS (
    SELECT (e->>'id')::uuid AS id, e->>'status' AS status, nullif(btrim(e->>'outcome'), '') AS outcome
      FROM jsonb_array_elements(_verdict->'reports') e
  ), s AS (
    UPDATE public.question_reports r
       SET status = CASE WHEN _kind = 'keep' THEN per.status ELSE _status END,
           outcome = coalesce(per.outcome, _default),
           outcome_explanation = _expl,
           replacement_question_id = _new,
           resolved_at = now(),
           updated_at = now()
      FROM public.question_reports r0
      LEFT JOIN per ON per.id = r0.id
     WHERE r.id = r0.id
       AND r0.question_id = _question_id
       AND (r0.id = ANY (_claimed)
            OR (_kind IN ('correct_key', 'rewrite', 'withdraw') AND r0.status IN ('open', 'checking')))
    RETURNING r.id
  )
  SELECT array_agg(s.id) INTO _settled FROM s;

  INSERT INTO public.notifications (user_id, school_id, type, title, body, link)
  SELECT r.user_id,
         (SELECT st.school_id FROM public.students st WHERE st.user_id = r.user_id ORDER BY st.created_at, st.id LIMIT 1),
         'question_report',
         CASE r.status
           WHEN 'fixed' THEN 'The question you reported is fixed'
           WHEN 'withdrawn' THEN 'The question you reported is withdrawn'
           WHEN 'unresolved' THEN 'Your report needs a closer look'
           ELSE 'Your report was checked'
         END,
         r.outcome,
         '/student/mistakes/reports'
    FROM public.question_reports r
   WHERE r.id = ANY (_settled);

  RETURN jsonb_build_object(
    'kind', _kind,
    'replacement', _new,
    'settled', coalesce(array_length(_settled, 1), 0),
    'effects', _effects);
END $fn$;

REVOKE ALL ON FUNCTION public.apply_question_report_verdict(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_question_report_verdict(uuid, jsonb) TO service_role;

-- ── 5. The cron hand-off: one question per call, a few calls a minute ───────
-- A check can take most of the function's 150 seconds (three thinking solves,
-- a decision, an explanation), so each call takes one question.
CREATE FUNCTION public.dispatch_question_reports()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _drain      text;
  _waiting    integer;
  _calls      integer;
  _per_minute constant integer := 4;
BEGIN
  SELECT count(DISTINCT r.question_id) INTO _waiting
    FROM public.question_reports r
    JOIN public.question_bank q ON q.id = r.question_id AND q.is_active
   WHERE r.status = 'open';
  IF _waiting = 0 THEN RETURN 0; END IF;

  SELECT decrypted_secret INTO _drain
    FROM vault.decrypted_secrets WHERE name = 'variant_generation_drain';
  IF _drain IS NULL THEN
    RAISE WARNING 'dispatch_question_reports: vault secret variant_generation_drain is missing; % question(s) wait', _waiting;
    RETURN 0;
  END IF;

  _calls := least(_waiting, _per_minute);
  FOR i IN 1.._calls LOOP
    PERFORM net.http_post(
      url := 'https://psqxykzqfvxgsvkmgurn.supabase.co/functions/v1/question-reports',
      body := jsonb_build_object('limit', 1),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-variant-drain', _drain),
      timeout_milliseconds := 150000
    );
  END LOOP;
  RETURN _calls;
END $fn$;

REVOKE ALL ON FUNCTION public.dispatch_question_reports() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('check-question-reports', '* * * * *', 'SELECT public.dispatch_question_reports()');

-- ── 6. The explanation queue names the question's exam ──────────────────────
DROP FUNCTION public.claim_explanation_rewrites(integer);

CREATE FUNCTION public.claim_explanation_rewrites(_limit integer)
RETURNS TABLE (id uuid, subject text, chapter text, topic text, question text, options jsonb, correct_index integer,
               explanation text, exam_code text, class_level integer, board text)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- A run that died holding rows gives them back after 15 minutes.
  UPDATE public.question_bank q
     SET explanation_status = 'pending', explanation_claimed_at = NULL
   WHERE q.explanation_status = 'rewriting'
     AND q.explanation_claimed_at < now() - interval '15 minutes';

  RETURN QUERY
  WITH c AS (
    SELECT q.id AS qid
      FROM public.question_bank q
     WHERE q.explanation_status = 'pending'
       AND q.is_active
       AND q.exam_id IS NOT NULL
       AND q.correct_index IS NOT NULL
       AND jsonb_typeof(q.options) = 'array'
       AND jsonb_array_length(q.options) BETWEEN 2 AND 8
     ORDER BY q.id
     LIMIT greatest(1, least(_limit, 50))
     FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE public.question_bank qb
       SET explanation_status = 'rewriting', explanation_claimed_at = now()
      FROM c
     WHERE qb.id = c.qid
    RETURNING qb.id AS rid, qb.subject AS rsubject, qb.chapter AS rchapter, qb.topic_id AS rtopic,
              qb.question AS rquestion, qb.options AS roptions, qb.correct_index AS rindex, qb.explanation AS rexpl,
              qb.exam_id AS rexam, qb.class_level AS rclass, qb.board AS rboard
  )
  SELECT u.rid, u.rsubject, u.rchapter, t.name, u.rquestion, u.roptions, u.rindex, u.rexpl,
         ce.code, u.rclass, u.rboard
    FROM u
    LEFT JOIN public.topics t ON t.id = u.rtopic
    LEFT JOIN public.competitive_exams ce ON ce.id = u.rexam;
END $fn$;

REVOKE ALL ON FUNCTION public.claim_explanation_rewrites(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_explanation_rewrites(integer) TO service_role;

-- ── 7. The limit (owner: every feature has one) ─────────────────────────────
INSERT INTO public.premium_features (code, description) VALUES
  ('question.report', 'A report on a question: the AI checks it and fixes or withdraws it when it is wrong.');

INSERT INTO public.premium_limits (tier_code, feature_code, period, max_uses) VALUES
  ('free',     'question.report', 'day', 10),
  ('starter',  'question.report', 'day', NULL),
  ('standard', 'question.report', 'day', NULL),
  ('premium',  'question.report', 'day', NULL);

-- ── VERIFY: the shape (must be able to fail) ────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-question-reports' AND active) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the report check is not scheduled';
  END IF;
  IF (SELECT count(*) FROM public.premium_limits WHERE feature_code = 'question.report') <> 4 THEN
    RAISE EXCEPTION 'VERIFY FAILED: every plan needs a limit row for question.report';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rpc_report_question(uuid, text, integer, text, uuid)', 'EXECUTE')
     OR NOT has_table_privilege('authenticated', 'public.question_reports', 'SELECT')
     OR NOT has_function_privilege('service_role', 'public.claim_question_reports(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.apply_question_report_verdict(uuid, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_explanation_rewrites(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: a door its caller needs is shut';
  END IF;
  IF has_function_privilege('anon', 'public.rpc_report_question(uuid, text, integer, text, uuid)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.question_reports', 'SELECT')
     OR has_table_privilege('authenticated', 'public.question_reports', 'INSERT')
     OR has_table_privilege('authenticated', 'public.question_reports', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.question_reports', 'DELETE')
     OR has_function_privilege('authenticated', 'public.claim_question_reports(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_question_report_verdict(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._retire_reported_question(uuid, uuid, boolean, text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public._retire_reported_question(uuid, uuid, boolean, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.dispatch_question_reports()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_explanation_rewrites(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: a student or a stranger can reach a server-only door';
  END IF;
END $verify$;

-- ── PROOF: behaviour, as real accounts where it matters; rolled back ────────
DO $proof$
DECLARE
  _exam constant uuid := '5a78f1f8-cf43-4631-a9de-4abc7d6a8d9d';
  _work constant text := E'When there is no partnership deed, the Indian Partnership Act, 1932 applies. Section 13(d) allows interest on a partner''s loan at 6% per annum, so the interest works out from the loan, the rate and the time.';
  _expl_a text; _expl_b text; _expl_c text;
  _fail text := '';
  _sentinel constant text := 'm20261139 proof rolled back';
  _a uuid; _a_school uuid; _b uuid; _b_school uuid; _topic uuid; _hidden uuid;
  _qs uuid[]; _q1 uuid; _q2 uuid; _q3 uuid; _q4 uuid; _q5 uuid; _q6 uuid;
  _sa uuid; _sb uuid; _rep_b uuid; _id uuid; _new1 uuid; _new2 uuid;
  _r jsonb; _n integer; _rec record; _t1 text; _t2 integer; _t3 text;
BEGIN
  -- Proper explanations for the same four options keyed (A), (B) and (C).
  _expl_b := E'Answer: (B) ₹30,000\n\n' || _work || E'\n\nWhy the other options are wrong:\n(A) ₹20,000 is interest at 4%; the Act fixes the rate at 6% per annum.\n(C) ₹40,000 is interest at 8%, a rate the Act does not provide for.\n(D) Interest on a partner''s loan is payable even without a partnership deed.';
  _expl_c := E'Answer: (C) ₹40,000\n\n' || _work || E'\n\nWhy the other options are wrong:\n(A) ₹20,000 is interest at 4%; the Act fixes the rate at 6% per annum.\n(B) ₹30,000 leaves out the part of the year the loan was outstanding.\n(D) Interest on a partner''s loan is payable even without a partnership deed.';
  _expl_a := E'Answer: (A) 6% per annum\n\n' || _work || E'\n\nWhy the other options are wrong:\n(B) 4% per annum is not a rate the Act names for a partner''s loan.\n(C) 8% per annum is not a rate the Act names for a partner''s loan.\n(D) Interest is payable without a deed; it is interest on capital that is not.';

  -- Fixtures: an exam account with a topic in its own syllabus, a second
  -- individual account, and a school question the exam account cannot see.
  SELECT st.user_id, st.school_id, t.id INTO _a, _a_school, _topic
    FROM public.students st
    JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
    JOIN public.exam_accounts ea ON ea.school_id = st.school_id AND ea.exam_id = _exam
    JOIN public.exam_syllabus_chapters sc ON sc.exam_id = ea.exam_id AND sc.stream = ea.stream
    JOIN public.topics t ON t.chapter_id = sc.chapter_id
   WHERE st.user_id IS NOT NULL
   ORDER BY st.user_id, t.id LIMIT 1;
  SELECT st.user_id, st.school_id INTO _b, _b_school
    FROM public.students st JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
   WHERE st.user_id IS NOT NULL AND st.user_id <> _a
   ORDER BY st.user_id LIMIT 1;
  SELECT id INTO _hidden FROM public.question_bank
   WHERE exam_id IS NULL AND is_active AND correct_index IS NOT NULL ORDER BY id LIMIT 1;
  IF _a IS NULL OR _b IS NULL OR _topic IS NULL OR _hidden IS NULL THEN
    RAISE EXCEPTION 'PROOF FAILED: fixture missing (a % b % topic % hidden %)', _a, _b, _topic, _hidden;
  END IF;

  BEGIN
    -- Six questions in that syllabus, all keyed (B).
    _r := public.store_generated_questions((
      SELECT jsonb_agg(jsonb_build_object('topic_id', _topic, 'exam_id', _exam,
               'question', format('Probe 20261139 q%s: how much interest does the Act allow on a partner''s loan of ₹5,00,000 for a year?', n),
               'options', jsonb_build_array('₹20,000', '₹30,000', '₹40,000', 'No interest is payable'),
               'correct_index', 1, 'explanation', _expl_b, 'difficulty', 'medium', 'source', 'ai_practice') ORDER BY n)
        FROM generate_series(1, 6) n));
    IF (_r->>'inserted_count')::int <> 6 THEN
      RAISE EXCEPTION 'PROOF FAILED: fixture questions %', _r;
    END IF;
    SELECT array_agg(q.id ORDER BY q.question) INTO _qs
      FROM public.question_bank q
     WHERE q.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(_r->'inserted') e);
    _q1 := _qs[1]; _q2 := _qs[2]; _q3 := _qs[3]; _q4 := _qs[4]; _q5 := _qs[5]; _q6 := _qs[6];

    -- Their records on q1: A answered (C), B answered (D); both marked wrong.
    INSERT INTO public.practice_sessions (user_id, school_id, subject, question_count, finished_at)
    VALUES (_a, _a_school, 'Accountancy', 1, now()) RETURNING id INTO _sa;
    INSERT INTO public.practice_sessions (user_id, school_id, subject, question_count, finished_at)
    VALUES (_b, _b_school, 'Accountancy', 1, now()) RETURNING id INTO _sb;
    INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id, generated_question,
                                          correct_answer, selected_answer, is_correct, source)
    VALUES (_a, _a_school, _sa, _q1, '{}', '{"index":1,"text":"₹30,000"}', '{"index":2,"text":"₹40,000"}', false, 'practice'),
           (_b, _b_school, _sb, _q1, '{}', '{"index":1,"text":"₹30,000"}', '{"index":3,"text":"No interest is payable"}', false, 'practice');
    PERFORM public._write_chapter_tally(_sa);
    IF (SELECT attempted FROM public.chapter_tally WHERE session_id = _sa) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'PROOF FAILED: fixture: the planted answer is not in its chapter tally';
    END IF;
    INSERT INTO public.student_mistakes (user_id, school_id, source, question_id, question_text, options, student_answer, correct_answer, subject)
    VALUES (_a, _a_school, 'practice', _q1, 'probe', '[]', '{"index":2}', '{"index":1}', 'Accountancy'),
           (_b, _b_school, 'practice', _q1, 'probe', '[]', '{"index":3}', '{"index":1}', 'Accountancy'),
           (_b, _b_school, 'practice', _q2, 'probe', '[]', '{"index":0}', '{"index":1}', 'Accountancy');
    INSERT INTO public.practice_bookmarks (user_id, school_id, question_id)
    VALUES (_a, _a_school, _q1), (_a, _a_school, _q2);

    -- 1. Reporting, as the student.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO _n FROM public.question_bank_student WHERE id = _q1;
    IF _n <> 1 THEN RAISE EXCEPTION 'PROOF FAILED: fixture: the exam account cannot see its own syllabus question'; END IF;

    _r := public.rpc_report_question(_q1, 'wrong_answer', 2, E'  The answer \n  should be C  ', _sa);
    IF NOT (_r->>'created')::boolean OR _r->'report'->>'status' <> 'open'
       OR _r->'report'->>'note' <> 'The answer should be C' OR (_r->'report'->>'claimed_index')::int <> 2
       OR _r->'report'->>'question_text' NOT LIKE 'Probe 20261139 q1:%' THEN
      _fail := _fail || ' [1 a filed report ' || _r::text || ']';
    END IF;
    _r := public.rpc_report_question(_q1, 'question_error', NULL, 'Missing data', NULL);
    IF (_r->>'created')::boolean OR _r->'report'->>'reason' <> 'question_error'
       OR (_r->'report'->>'session_id')::uuid IS DISTINCT FROM _sa THEN
      _fail := _fail || ' [1 a waiting report was not changed in place ' || _r::text || ']';
    END IF;
    PERFORM public.rpc_report_question(_q1, 'wrong_answer', 2, NULL, NULL);
    BEGIN
      PERFORM public.rpc_report_question(_q2, 'other', NULL, '   ', NULL);
      _fail := _fail || ' [1 "something else" with no words was filed]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Say in a few words what is wrong.' THEN _fail := _fail || ' [1 other: ' || SQLERRM || ']'; END IF;
    END;
    BEGIN
      PERFORM public.rpc_report_question(_q2, 'question_error', 1, NULL, NULL);
      _fail := _fail || ' [1 a claimed answer on a non-answer report was filed]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Choose one of the question''s own options.' THEN _fail := _fail || ' [1 claim: ' || SQLERRM || ']'; END IF;
    END;
    BEGIN
      PERFORM public.rpc_report_question(_q2, 'wrong_answer', 4, NULL, NULL);
      _fail := _fail || ' [1 a claimed option the question does not have was filed]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Choose one of the question''s own options.' THEN _fail := _fail || ' [1 option: ' || SQLERRM || ']'; END IF;
    END;
    BEGIN
      PERFORM public.rpc_report_question(_hidden, 'question_error', NULL, NULL, NULL);
      _fail := _fail || ' [1 a question the student cannot be served was reported]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'That question could not be found.' THEN _fail := _fail || ' [1 hidden: ' || SQLERRM || ']'; END IF;
    END;
    BEGIN
      PERFORM public.rpc_report_question(_q2, 'question_error', NULL, NULL, _sb);
      _fail := _fail || ' [1 another student''s session was attached]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'That practice session could not be found.' THEN _fail := _fail || ' [1 session: ' || SQLERRM || ']'; END IF;
    END;
    PERFORM public.rpc_report_question(_q2, 'question_error', NULL, 'The case data is missing', NULL);
    PERFORM public.rpc_report_question(_q3, 'explanation_error', NULL, NULL, NULL);
    PERFORM public.rpc_report_question(_q4, 'wrong_answer', NULL, NULL, NULL);
    PERFORM public.rpc_report_question(_q5, 'other', NULL, 'Two options look right', NULL);
    BEGIN
      INSERT INTO public.question_reports (user_id, question_id, reason, question_text, options)
      VALUES (_a, _q6, 'question_error', 'forged', '[]');
      _fail := _fail || ' [1 a student wrote a report row directly]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    SELECT count(*) INTO _n FROM public.question_reports WHERE user_id = _a;
    IF _n <> 5 THEN _fail := _fail || format(' [1 the reporter reads %s of 5 reports]', _n); END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO _n FROM public.question_reports WHERE user_id = _a;
    IF _n <> 0 THEN _fail := _fail || ' [1 another student reads the reports]'; END IF;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', NULL, true);

    -- Counted against the plan: 5 filed (a change in place is not a new one),
    -- and the free plan's 11th of the day is over.
    SELECT used INTO _n FROM public.premium_usage
     WHERE account_id = _a AND feature_code = 'question.report' AND period_key = public._premium_period_key('day', now());
    IF coalesce(_n, 0) <> 5 THEN _fail := _fail || format(' [1 %s reports counted, not 5]', coalesce(_n, 0)); END IF;
    PERFORM public._premium_decide(_a, 'question.report', 1, true) FROM generate_series(1, 5);
    _r := public._premium_decide(_a, 'question.report', 1, true);
    IF (_r->>'tier') = 'free' THEN
      IF (_r->>'limit')::int <> 10 OR coalesce(_r->>'would_deny', _r->>'reason') IS DISTINCT FROM 'limit_reached' THEN
        _fail := _fail || ' [1 a free 11th report ' || _r::text || ']';
      END IF;
    ELSIF _r->>'limit' IS NOT NULL THEN
      _fail := _fail || ' [1 a paid plan is limited ' || _r::text || ']';
    END IF;

    -- 2. The claim: a question's waiting reports together, never twice; an
    --    abandoned claim comes back.
    _n := 0;
    FOR _rec IN SELECT * FROM public.claim_question_reports(10) LOOP
      IF _rec.question_id = ANY (_qs) THEN
        _n := _n + 1;
        IF _rec.exam_code IS DISTINCT FROM 'cuet' OR _rec.correct_index <> 1
           OR jsonb_array_length(_rec.reports) <> 1 OR _rec.explanation_status <> 'proper' THEN
          _fail := _fail || ' [2 a claimed question ' || row_to_json(_rec)::text || ']';
        END IF;
      END IF;
    END LOOP;
    IF _n <> 5 THEN _fail := _fail || format(' [2 claimed %s of 5 reported questions]', _n); END IF;
    SELECT count(*) INTO _n FROM public.claim_question_reports(10);
    IF _n <> 0 THEN _fail := _fail || format(' [2 a second claim took %s already claimed]', _n); END IF;
    UPDATE public.question_reports SET checked_at = now() - interval '1 hour' WHERE question_id = _q5;
    SELECT count(*) INTO _n FROM public.claim_question_reports(10) c WHERE c.question_id = _q5;
    IF _n <> 1 THEN _fail := _fail || ' [2 an abandoned claim was not given back]'; END IF;

    -- A second student reports q1 while the check has it: that report waits,
    -- and the next claim takes it alone — never the one already being checked.
    INSERT INTO public.question_reports (user_id, question_id, reason, question_text, options)
    VALUES (_b, _q1, 'wrong_answer', 'probe', '[]') RETURNING id INTO _rep_b;
    SELECT count(*), max(c.reports::text) INTO _n, _t1 FROM public.claim_question_reports(10) c;
    IF _n <> 1 OR _t1 IS DISTINCT FROM jsonb_build_array(jsonb_build_object('id', _rep_b, 'reason', 'wrong_answer', 'claimed_index', NULL, 'note', NULL))::text THEN
      _fail := _fail || format(' [2 a report arriving mid-check was claimed as %s question(s): %s]', _n, _t1);
    END IF;

    -- 3. Verdicts that must be refused. Each attempt is undone whether or not
    --    it is refused, so one that wrongly goes through is reported here and
    --    does not disturb what follows.
    SELECT id INTO _id FROM public.question_reports WHERE question_id = _q1 AND user_id = _a;
    SELECT id INTO _t3 FROM public.question_reports WHERE question_id = _q3;
    FOR _rec IN
      SELECT * FROM (VALUES
        ('a correction with an improper explanation', '%not proper%',
         jsonb_build_object('kind', 'correct_key', 'correct_index', 2, 'explanation', 'Short.', 'outcome', 'x',
                            'reports', jsonb_build_array(jsonb_build_object('id', _id)))),
        ('a "correction" to the same key', '%another of the question%',
         jsonb_build_object('kind', 'correct_key', 'correct_index', 1, 'explanation', _expl_b, 'outcome', 'x',
                            'reports', jsonb_build_array(jsonb_build_object('id', _id)))),
        ('a verdict on another question''s report', 'stale claim%',
         jsonb_build_object('kind', 'keep', 'outcome', 'x',
                            'reports', jsonb_build_array(jsonb_build_object('id', _t3, 'status', 'answer_stands')))),
        ('a kept question''s report called fixed', '%answer_stands, no_problem%',
         jsonb_build_object('kind', 'keep', 'outcome', 'x',
                            'reports', jsonb_build_array(jsonb_build_object('id', _id, 'status', 'fixed')))),
        ('a verdict with nothing to tell the student', '%needs an outcome%',
         jsonb_build_object('kind', 'withdraw', 'outcome', '  ', 'reports', jsonb_build_array(jsonb_build_object('id', _id))))
      ) v(what, refusal, verdict)
    LOOP
      BEGIN
        PERFORM public.apply_question_report_verdict(_q1, _rec.verdict);
        _fail := _fail || ' [3 ' || _rec.what || ' went through]';
        RAISE EXCEPTION USING MESSAGE = 'm20261139 undo';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'm20261139 undo' AND SQLERRM NOT LIKE _rec.refusal THEN
          _fail := _fail || ' [3 ' || _rec.what || ': ' || SQLERRM || ']';
        END IF;
      END;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.question_bank WHERE id = _q1 AND is_active AND replaced_by_question_id IS NULL)
       OR (SELECT count(*) FROM public.question_bank WHERE question LIKE 'Probe 20261139 q1:%') <> 1
       OR (SELECT status FROM public.question_reports WHERE id = _id) <> 'checking' THEN
      _fail := _fail || ' [3 a refused verdict changed something]';
    END IF;

    -- 4. The key was wrong: (C), not (B).
    _r := public.apply_question_report_verdict(_q1, jsonb_build_object('kind', 'correct_key', 'correct_index', 2,
      'explanation', _expl_c, 'outcome', 'You were right: the answer is (C).', 'note', 'Report check: the key (B) is (C).',
      'reports', jsonb_build_array(jsonb_build_object('id', _id))));
    _new1 := (_r->>'replacement')::uuid;
    IF _new1 IS NULL OR (_r->>'settled')::int <> 2 THEN _fail := _fail || ' [4 ' || _r::text || ']'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.question_bank WHERE id = _q1 AND NOT is_active
                     AND replaced_by_question_id = _new1 AND review_note LIKE '%is (C).%') THEN
      _fail := _fail || ' [4 the old question is not retired to its replacement]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.question_bank n JOIN public.question_bank o ON o.id = _q1
                    WHERE n.id = _new1 AND n.is_active AND n.is_approved AND n.question = o.question
                      AND n.options = o.options AND n.correct_index = 2 AND n.explanation = _expl_c
                      AND n.explanation_status = 'proper' AND n.topic_id = o.topic_id AND n.exam_id = o.exam_id
                      AND n.chapter_id = o.chapter_id AND n.replaced_by_question_id IS NULL) THEN
      _fail := _fail || ' [4 the replacement is not the same question with the key corrected]';
    END IF;
    IF EXISTS (SELECT 1 FROM public.question_attempts WHERE bank_question_id = _q1 AND NOT excluded_from_accuracy) THEN
      _fail := _fail || ' [4 an answer to the old key still counts]';
    END IF;
    IF (SELECT attempted FROM public.chapter_tally WHERE session_id = _sa) IS DISTINCT FROM 0 THEN
      _fail := _fail || ' [4 the chapter tally still counts the answer]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.student_mistakes WHERE user_id = _a AND question_id = _q1 AND status = 'cleared') THEN
      _fail := _fail || ' [4 a student right under the corrected key still has the mistake]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.student_mistakes WHERE user_id = _b AND question_id = _new1 AND status = 'open'
                     AND (correct_answer->>'index')::int = 2 AND explanation = _expl_c) THEN
      _fail := _fail || ' [4 a student still wrong was not moved to the corrected question]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.practice_bookmarks WHERE user_id = _a AND question_id = _new1) THEN
      _fail := _fail || ' [4 the bookmark did not follow the question]';
    END IF;
    SELECT count(*) INTO _n FROM public.question_reports
     WHERE question_id = _q1 AND status = 'fixed' AND replacement_question_id = _new1
       AND resolved_at IS NOT NULL AND outcome = 'You were right: the answer is (C).' AND outcome_explanation = _expl_c;
    IF _n <> 2 THEN _fail := _fail || format(' [4 %s of 2 reports on q1 settled fixed]', _n); END IF;
    SELECT count(*) INTO _n FROM public.notifications
     WHERE type = 'question_report' AND user_id IN (_a, _b) AND title = 'The question you reported is fixed'
       AND link = '/student/mistakes/reports';
    IF _n <> 2 THEN _fail := _fail || format(' [4 %s of 2 reporters told]', _n); END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO _n FROM public.question_bank_student WHERE id = _new1 AND is_active;
    IF _n <> 1 THEN _fail := _fail || ' [4 the student is not served the corrected question]'; END IF;
    SELECT status INTO _t1 FROM public.question_reports WHERE question_id = _q1;
    IF _t1 IS DISTINCT FROM 'fixed' THEN _fail := _fail || ' [4 the student reads their report as ' || coalesce(_t1, 'nothing') || ']'; END IF;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', NULL, true);

    -- 5. The question was broken: rewritten, and nobody's mistake moves to it.
    SELECT id INTO _id FROM public.question_reports WHERE question_id = _q2 AND status = 'checking';
    _r := public.apply_question_report_verdict(_q2, jsonb_build_object('kind', 'rewrite',
      'question', 'Probe 20261139 q2 rewritten: at what rate does the Act allow interest on a partner''s loan?',
      'options', jsonb_build_array('6% per annum', '4% per annum', '8% per annum', 'No interest is payable'),
      'correct_index', 0, 'explanation', _expl_a, 'outcome', 'The question had a mistake and has been rewritten.',
      'note', 'Report check: rewritten.', 'reports', jsonb_build_array(jsonb_build_object('id', _id))));
    _new2 := (_r->>'replacement')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.question_bank WHERE id = _new2 AND is_active AND correct_index = 0
                     AND question LIKE 'Probe 20261139 q2 rewritten%' AND embed_status = 'pending_embed'
                     AND embedding IS NULL AND source_type = 'ai_generated' AND exam_year IS NULL
                     AND explanation_status = 'proper') THEN
      _fail := _fail || ' [5 the rewrite is not a new question waiting for its vector]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.question_bank WHERE id = _q2 AND NOT is_active AND replaced_by_question_id = _new2) THEN
      _fail := _fail || ' [5 the broken question is still served]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.student_mistakes WHERE user_id = _b AND question_id = _q2 AND status = 'cleared')
       OR EXISTS (SELECT 1 FROM public.student_mistakes WHERE question_id = _new2) THEN
      _fail := _fail || ' [5 a mistake on a broken question was not cleared, or moved to a question never answered]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.practice_bookmarks WHERE user_id = _a AND question_id = _new2) THEN
      _fail := _fail || ' [5 the bookmark did not follow the rewrite]';
    END IF;

    -- 6. The answer stands, and the explanation is rewritten.
    UPDATE public.question_bank SET explanation = 'Short.' WHERE id = _q3;
    SELECT id INTO _id FROM public.question_reports WHERE question_id = _q3 AND status = 'checking';
    PERFORM public.apply_question_report_verdict(_q3, jsonb_build_object('kind', 'keep', 'explanation', _expl_b,
      'outcome', 'Checked: (B) is right.', 'reports',
      jsonb_build_array(jsonb_build_object('id', _id, 'status', 'explanation_rewritten', 'outcome', 'The explanation has been rewritten.'))));
    IF NOT EXISTS (SELECT 1 FROM public.question_bank WHERE id = _q3 AND is_active AND explanation = _expl_b
                     AND explanation_status = 'proper' AND correct_index = 1) THEN
      _fail := _fail || ' [6 the kept question did not get its explanation]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.question_reports WHERE id = _id AND status = 'explanation_rewritten'
                     AND outcome = 'The explanation has been rewritten.' AND outcome_explanation = _expl_b
                     AND replacement_question_id IS NULL) THEN
      _fail := _fail || ' [6 the report is not settled with its own outcome]';
    END IF;

    -- 7. Unresolved: the question stays, and joins the disputed list.
    SELECT id INTO _id FROM public.question_reports WHERE question_id = _q4 AND status = 'checking';
    PERFORM public.apply_question_report_verdict(_q4, jsonb_build_object('kind', 'unresolved',
      'outcome', 'We could not settle this one automatically.', 'note', 'Report check: solved as (B), (C), (D).',
      'reports', jsonb_build_array(jsonb_build_object('id', _id))));
    IF NOT EXISTS (SELECT 1 FROM public.question_bank WHERE id = _q4 AND is_active AND explanation_status = 'disputed'
                     AND review_note LIKE '%(B), (C), (D).%') THEN
      _fail := _fail || ' [7 an unresolved question is not on the disputed list]';
    END IF;
    IF (SELECT status FROM public.question_reports WHERE id = _id) <> 'unresolved' THEN
      _fail := _fail || ' [7 the report is not unresolved]';
    END IF;

    -- 8. Withdrawn: no replacement, and nothing is served in its place.
    SELECT id INTO _id FROM public.question_reports WHERE question_id = _q5 AND status = 'checking';
    _r := public.apply_question_report_verdict(_q5, jsonb_build_object('kind', 'withdraw',
      'outcome', 'The question could not be fixed and has been withdrawn.', 'note', 'Report check: withdrawn.',
      'reports', jsonb_build_array(jsonb_build_object('id', _id))));
    IF (_r->>'replacement') IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.question_bank WHERE id = _q5 AND NOT is_active AND replaced_by_question_id IS NULL)
       OR (SELECT status FROM public.question_reports WHERE id = _id) <> 'withdrawn' THEN
      _fail := _fail || ' [8 ' || _r::text || ']';
    END IF;

    -- 9. A retired question cannot be reported again; its replacement can.
    UPDATE public.question_bank SET is_active = false, replaced_by_question_id = _new1 WHERE id = _q6;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.rpc_report_question(_q6, 'question_error', NULL, NULL, NULL);
      _fail := _fail || ' [9 a replaced question was reported]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'This question has already been corrected%' THEN _fail := _fail || ' [9 replaced: ' || SQLERRM || ']'; END IF;
    END;
    BEGIN
      PERFORM public.rpc_report_question(_q5, 'question_error', NULL, NULL, NULL);
      _fail := _fail || ' [9 a withdrawn question was reported]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'This question has been withdrawn.' THEN _fail := _fail || ' [9 withdrawn: ' || SQLERRM || ']'; END IF;
    END;
    _r := public.rpc_report_question(_new1, 'question_error', NULL, NULL, NULL);
    IF NOT (_r->>'created')::boolean THEN _fail := _fail || ' [9 the replacement could not be reported]'; END IF;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', NULL, true);

    -- 10. The cron hand-off calls once per waiting question, and not at all
    --     when nothing waits.
    SELECT public.dispatch_question_reports() INTO _n;
    IF _n <> 1 THEN _fail := _fail || format(' [10 one waiting question made %s calls]', _n); END IF;
    UPDATE public.question_reports SET status = 'withdrawn', outcome = 'x', resolved_at = now() WHERE status = 'open' AND user_id = _a;
    SELECT public.dispatch_question_reports() INTO _n;
    IF _n <> 0 THEN _fail := _fail || format(' [10 nothing waiting made %s calls]', _n); END IF;

    -- 11. The explanation queue names the question's exam.
    UPDATE public.question_bank SET explanation = 'Short.' WHERE id = _new2;
    SELECT c.exam_code, c.class_level, c.board INTO _t1, _t2, _t3
      FROM public.claim_explanation_rewrites(50) c WHERE c.id = _new2;
    IF _t1 IS DISTINCT FROM 'cuet' OR _t2 IS DISTINCT FROM 12 OR _t3 IS DISTINCT FROM 'cuet' THEN
      _fail := _fail || format(' [11 the queue named %s, %s, %s]', _t1, _t2, _t3);
    END IF;

    RAISE EXCEPTION USING MESSAGE = _sentinel;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> _sentinel THEN
      RAISE EXCEPTION 'PROOF FAILED (unexpected %): %', SQLSTATE, SQLERRM;
    END IF;
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'PROOF FAILED:%', _fail;
  END IF;
END $proof$;

COMMIT;
