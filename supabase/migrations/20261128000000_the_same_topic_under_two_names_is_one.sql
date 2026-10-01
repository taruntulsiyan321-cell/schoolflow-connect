-- ═══════════════════════════════════════════════════════════════════════════
-- THE SAME TOPIC UNDER TWO NAMES IS ONE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 107, RULED by the owner on 2026-09-30: "they are same". After
-- 20261126000000 merged the case twins, eight pairs were still one topic under
-- two names — three spellings that differ by an article or a hyphen, and five
-- looser look-alikes the owner ruled the same:
--
--   Admission of a New Partner           New Profit Sharing Ratio | New profit-sharing ratio
--   Retirement and Death of a Partner    Death of partner | Death of a Partner
--   Retirement and Death of a Partner    Retirement of a Partner | Retirement of partner
--   Accounting for Share Capital         Calls | Calls on shares
--   Accounting for Share Capital         Forfeiture and reissue of shares | Forfeiture of Shares
--   Accounting for Share Capital         Oversubscription / Pro-rata | Oversubscription and pro-rata allotment
--   Cash Flow Statement                  Cash Flow Statement | Cash Flow
--   Financial Statements and Tools ...   Tools of analysis | Tools of financial analysis
--
-- This is 20261126000000 with its map built from that list instead of found by
-- case: the same keeper rule (more questions — its id and its name), the same
-- re-pointing, the same respelling of every text copy in the pair's own chapter
-- (found through the row's live question, else its chapter_id, else its text
-- and the student's board), the same folds for revision and mastery rows, and
-- the same proofs. Read that file for why each step is what it is.
--
-- A pair is located by its chapter holding BOTH names; a pair that does not
-- resolve to exactly one chapter stops the migration.
--
-- Every change is recorded in public.topic_merge_20261128000000, which the
-- rollback reads.
--
-- ROLLBACK: rollback/20261128000000_the_same_topic_under_two_names_is_one.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.topic_merge_20261128000000 (
  seq         bigserial PRIMARY KEY,
  kind        text NOT NULL,
  table_name  text NOT NULL,
  row_id      uuid NOT NULL,
  row_before  jsonb,
  note        text
);
ALTER TABLE public.topic_merge_20261128000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.topic_merge_20261128000000 FROM anon, authenticated;
COMMENT ON TABLE public.topic_merge_20261128000000 IS
  'Rollback source for 20261128000000: every row the topic merge changed or deleted, as it was. kind: topic_deleted | repointed | respelled | revision_folded | revision_kept | mastery_folded | mastery_kept | mastery_respelled. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

-- A student's board: an exam account's exam, else their school's board.
CREATE FUNCTION pg_temp.user_board(_uid uuid)
RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(
    (SELECT ce.code FROM public.exam_accounts ea JOIN public.competitive_exams ce ON ce.id = ea.exam_id
      WHERE ea.account_id = _uid ORDER BY ea.created_at LIMIT 1),
    (SELECT sc.board FROM public.students s JOIN public.schools sc ON sc.id = s.school_id
      WHERE s.user_id = _uid AND sc.board IS NOT NULL ORDER BY s.created_at LIMIT 1))
$f$;

-- A row's chapter from its subject and chapter text: only when that names
-- exactly one chapter — alone, or within the student's board, or within the
-- board and class level. NULL otherwise.
CREATE FUNCTION pg_temp.chapter_of(_subject text, _chapter text, _level int, _board text)
RETURNS uuid LANGUAGE sql STABLE AS $f$
  WITH c AS (
    SELECT ch.id, cc.level, b.code
      FROM public.chapters ch
      JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
      JOIN public.curriculum_classes cc ON cc.id = cs.curriculum_class_id
      JOIN public.boards b ON b.id = cc.board_id
     WHERE ch.name = _chapter AND cs.name = _subject
  )
  SELECT CASE
    WHEN (SELECT count(*) FROM c) = 1 THEN (SELECT id FROM c)
    WHEN (SELECT count(*) FROM c WHERE code = _board) = 1 THEN (SELECT id FROM c WHERE code = _board)
    WHEN (SELECT count(*) FROM c WHERE code = _board AND level = _level) = 1
      THEN (SELECT id FROM c WHERE code = _board AND level = _level)
  END
$f$;


-- ── The map, from the owner's list ───────────────────────────────────────────
CREATE TEMP TABLE _pairs (chapter text, a text, b text) ON COMMIT DROP;
INSERT INTO _pairs VALUES
  ('Admission of a New Partner', 'New Profit Sharing Ratio', 'New profit-sharing ratio'),
  ('Retirement and Death of a Partner', 'Death of a Partner', 'Death of partner'),
  ('Retirement and Death of a Partner', 'Retirement of a Partner', 'Retirement of partner'),
  ('Accounting for Share Capital', 'Calls', 'Calls on shares'),
  ('Accounting for Share Capital', 'Forfeiture and reissue of shares', 'Forfeiture of Shares'),
  ('Accounting for Share Capital', 'Oversubscription / Pro-rata', 'Oversubscription and pro-rata allotment'),
  ('Cash Flow Statement', 'Cash Flow', 'Cash Flow Statement'),
  ('Financial Statements and Tools for Financial Analysis', 'Tools of analysis', 'Tools of financial analysis');

CREATE TEMP TABLE _map ON COMMIT DROP AS
WITH located AS (
  SELECT p.*, ch.id AS chapter_id, ta.id AS a_id, tb.id AS b_id,
         ta.created_at AS a_created, tb.created_at AS b_created,
         (SELECT count(*) FROM public.question_bank q WHERE q.topic_id = ta.id) AS a_nq,
         (SELECT count(*) FROM public.question_bank q WHERE q.topic_id = tb.id) AS b_nq
    FROM _pairs p
    JOIN public.chapters ch ON ch.name = p.chapter
    JOIN public.topics ta ON ta.chapter_id = ch.id AND ta.name = p.a
    JOIN public.topics tb ON tb.chapter_id = ch.id AND tb.name = p.b
)
SELECT CASE WHEN keep_a THEN b_id ELSE a_id END AS loser_id,
       CASE WHEN keep_a THEN b ELSE a END AS loser_name,
       CASE WHEN keep_a THEN b_nq ELSE a_nq END AS loser_nq,
       CASE WHEN keep_a THEN a_id ELSE b_id END AS keeper_id,
       CASE WHEN keep_a THEN a ELSE b END AS keeper_name,
       CASE WHEN keep_a THEN a_nq ELSE b_nq END AS keeper_nq,
       chapter_id
  FROM (SELECT l.*, (a_nq > b_nq OR (a_nq = b_nq AND (a_created, a_id) < (b_created, b_id))) AS keep_a
          FROM located l) x;

DO $located$
BEGIN
  IF (SELECT count(*) FROM _map) <> (SELECT count(*) FROM _pairs)
     OR EXISTS (SELECT 1 FROM _map GROUP BY loser_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'every named pair must resolve to exactly one chapter holding both names; % of % did',
      (SELECT count(*) FROM _map), (SELECT count(*) FROM _pairs);
  END IF;
END
$located$;

-- The spelling a text should have in a chapter: a merged-in name becomes its
-- keeper's; otherwise the chapter's topic that the text names, case aside.
CREATE FUNCTION pg_temp.spelling(_chapter_id uuid, _text text)
RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(
    (SELECT m.keeper_name FROM _map m
      WHERE m.chapter_id = _chapter_id AND lower(btrim(m.loser_name)) = lower(btrim(_text))),
    (SELECT t.name FROM public.topics t
      WHERE t.chapter_id = _chapter_id AND lower(btrim(t.name)) = lower(btrim(_text))))
$f$;

-- ── Before, for the proof ─────────────────────────────────────────────────
CREATE TEMP TABLE _before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.question_attempts)  AS qa_rows,
  (SELECT count(*) FROM public.student_mistakes)   AS sm_rows,
  (SELECT count(*) FROM public.question_bank)      AS qb_rows,
  (SELECT count(*) FROM public.concept_mastery)    AS cm_rows,
  (SELECT count(*) FROM _map)                      AS pairs,
  (SELECT COALESCE(sum(total_attempts), 0)          FROM public.concept_mastery) AS cm_attempts,
  (SELECT COALESCE(sum(correct_attempts), 0)        FROM public.concept_mastery) AS cm_correct,
  (SELECT COALESCE(sum(recovery_attempts), 0)       FROM public.concept_mastery) AS cm_recovery,
  (SELECT COALESCE(sum(forgetting_events_count), 0) FROM public.concept_mastery) AS cm_forgetting;

-- Students whose practice analytics list one topic twice in one chapter today
-- (both spellings), and how many such topics each sees — the paid panel this
-- migration repairs.
CREATE TEMP TABLE _split_before (user_id uuid, dup_topics int) ON COMMIT DROP;
DO $split_before$
DECLARE _u uuid; _pa jsonb; _n int;
BEGIN
  FOR _u IN
    SELECT DISTINCT qa.user_id
      FROM public.question_attempts qa
      JOIN public.chapters ch ON ch.name = qa.chapter
      JOIN _map m ON m.chapter_id = ch.id
     WHERE lower(btrim(qa.topic)) IN (lower(btrim(m.loser_name)), lower(btrim(m.keeper_name)))
     GROUP BY qa.user_id, m.loser_id
    HAVING count(DISTINCT lower(btrim(qa.topic))) = 2
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _pa := public.rpc_student_practice_analytics();
    RESET ROLE;
    SELECT count(*) INTO _n FROM _map m
     WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_pa->'by_topic', '[]'::jsonb)) e
                    WHERE lower(btrim(e->>'topic')) = lower(btrim(m.loser_name)))
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_pa->'by_topic', '[]'::jsonb)) e
                    WHERE lower(btrim(e->>'topic')) = lower(btrim(m.keeper_name)));
    INSERT INTO _split_before VALUES (_u, _n);
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);
END
$split_before$;

-- ── 1. Re-point every topic_id from a losing twin to its keeper ───────────
INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'question_bank', q.id, jsonb_build_object('topic_id', q.topic_id)
  FROM public.question_bank q JOIN _map m ON q.topic_id = m.loser_id;
UPDATE public.question_bank q SET topic_id = m.keeper_id FROM _map m WHERE q.topic_id = m.loser_id;

INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'student_upload_questions', x.id, jsonb_build_object('topic_id', x.topic_id)
  FROM public.student_upload_questions x JOIN _map m ON x.topic_id = m.loser_id;
UPDATE public.student_upload_questions x SET topic_id = m.keeper_id FROM _map m WHERE x.topic_id = m.loser_id;

INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'student_upload_notes', x.id, jsonb_build_object('topic_id', x.topic_id)
  FROM public.student_upload_notes x JOIN _map m ON x.topic_id = m.loser_id;
UPDATE public.student_upload_notes x SET topic_id = m.keeper_id FROM _map m WHERE x.topic_id = m.loser_id;

INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'student_capture_questions', x.id, jsonb_build_object('topic_id', x.topic_id)
  FROM public.student_capture_questions x JOIN _map m ON x.topic_id = m.loser_id;
UPDATE public.student_capture_questions x SET topic_id = m.keeper_id FROM _map m WHERE x.topic_id = m.loser_id;

INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'homework', x.id, jsonb_build_object('topic_id', x.topic_id)
  FROM public.homework x JOIN _map m ON x.topic_id = m.loser_id;
UPDATE public.homework x SET topic_id = m.keeper_id FROM _map m WHERE x.topic_id = m.loser_id;

-- ── 2. The merged-in topics go ──────────────────────────────────────────────
INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
SELECT 'topic_deleted', 'topics', t.id, to_jsonb(t) || jsonb_build_object('merged_into', m.keeper_id)
  FROM public.topics t JOIN _map m ON m.loser_id = t.id;
DELETE FROM public.topics t USING _map m WHERE t.id = m.loser_id;


-- ── 3. Every text copy takes its chapter's topic's spelling ───────────────
CREATE TEMP TABLE _qa ON COMMIT DROP AS
SELECT x.id, x.topic_to, x.concept_to, x.subconcept_to FROM (
  SELECT qa.id, qa.topic, qa.concept, qa.subconcept,
         pg_temp.spelling(c.chapter_id, qa.topic)      AS topic_to,
         pg_temp.spelling(c.chapter_id, qa.concept)    AS concept_to,
         pg_temp.spelling(c.chapter_id, qa.subconcept) AS subconcept_to
    FROM public.question_attempts qa
   CROSS JOIN LATERAL (
     SELECT COALESCE(
       (SELECT qb.chapter_id FROM public.question_bank qb WHERE qb.id = qa.bank_question_id),
       (SELECT u.chapter_id FROM public.student_upload_questions u
         WHERE u.id = NULLIF(qa.generated_question->>'upload_question_id', '')::uuid),
       (SELECT c2.chapter_id FROM public.student_capture_questions c2
         WHERE c2.id = NULLIF(qa.generated_question->>'capture_question_id', '')::uuid),
       pg_temp.chapter_of(qa.subject, qa.chapter, qa.class_level, COALESCE(qa.board, pg_temp.user_board(qa.user_id)))
     ) AS chapter_id) c
   WHERE c.chapter_id IS NOT NULL
) x
WHERE (x.topic_to IS NOT NULL AND x.topic_to IS DISTINCT FROM x.topic)
   OR (x.concept_to IS NOT NULL AND x.concept_to IS DISTINCT FROM x.concept)
   OR (x.subconcept_to IS NOT NULL AND x.subconcept_to IS DISTINCT FROM x.subconcept);

INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
SELECT 'respelled', 'question_attempts', qa.id,
       jsonb_build_object('topic', qa.topic, 'concept', qa.concept, 'subconcept', qa.subconcept)
  FROM public.question_attempts qa JOIN _qa x ON x.id = qa.id;
UPDATE public.question_attempts qa SET
  topic      = COALESCE(x.topic_to, qa.topic),
  concept    = COALESCE(x.concept_to, qa.concept),
  subconcept = COALESCE(x.subconcept_to, qa.subconcept)
  FROM _qa x WHERE qa.id = x.id;

CREATE TEMP TABLE _sm ON COMMIT DROP AS
SELECT x.id, x.topic_to, x.concept_to, x.subconcept_to FROM (
  SELECT sm.id, sm.topic, sm.concept, sm.subconcept,
         pg_temp.spelling(c.chapter_id, sm.topic)      AS topic_to,
         pg_temp.spelling(c.chapter_id, sm.concept)    AS concept_to,
         pg_temp.spelling(c.chapter_id, sm.subconcept) AS subconcept_to
    FROM public.student_mistakes sm
   CROSS JOIN LATERAL (
     SELECT COALESCE(
       (SELECT qb.chapter_id FROM public.question_bank qb WHERE qb.id = sm.question_id),
       (SELECT u.chapter_id FROM public.student_upload_questions u WHERE u.id = sm.upload_question_id),
       (SELECT c2.chapter_id FROM public.student_capture_questions c2 WHERE c2.id = sm.capture_question_id),
       sm.chapter_id,
       pg_temp.chapter_of(sm.subject, sm.chapter, sm.class_level, pg_temp.user_board(sm.user_id))
     ) AS chapter_id) c
   WHERE c.chapter_id IS NOT NULL
) x
WHERE (x.topic_to IS NOT NULL AND x.topic_to IS DISTINCT FROM x.topic)
   OR (x.concept_to IS NOT NULL AND x.concept_to IS DISTINCT FROM x.concept)
   OR (x.subconcept_to IS NOT NULL AND x.subconcept_to IS DISTINCT FROM x.subconcept);

INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
SELECT 'respelled', 'student_mistakes', sm.id,
       jsonb_build_object('topic', sm.topic, 'concept', sm.concept, 'subconcept', sm.subconcept)
  FROM public.student_mistakes sm JOIN _sm x ON x.id = sm.id;
UPDATE public.student_mistakes sm SET
  topic      = COALESCE(x.topic_to, sm.topic),
  concept    = COALESCE(x.concept_to, sm.concept),
  subconcept = COALESCE(x.subconcept_to, sm.subconcept)
  FROM _sm x WHERE sm.id = x.id;

-- The revision queue: one OPEN row per (student, subject, chapter, topic), so a
-- respelled open row folds into an open row already spelled right.
CREATE TEMP TABLE _rq ON COMMIT DROP AS
SELECT x.id, x.topic_to FROM (
  SELECT rq.id, rq.topic,
         pg_temp.spelling(pg_temp.chapter_of(rq.subject, rq.chapter, NULL, pg_temp.user_board(rq.user_id)), rq.topic) AS topic_to
    FROM public.revision_queue rq
   WHERE COALESCE(btrim(rq.topic), '') <> ''
) x
WHERE x.topic_to IS NOT NULL AND x.topic_to IS DISTINCT FROM x.topic;

DO $revision$
DECLARE r record; k record; _kid uuid;
BEGIN
  FOR r IN SELECT rq.*, x.topic_to FROM public.revision_queue rq JOIN _rq x ON x.id = rq.id ORDER BY rq.created_at, rq.id LOOP
    _kid := NULL;
    IF NOT r.completed THEN
      SELECT id INTO _kid FROM public.revision_queue
       WHERE user_id = r.user_id AND subject = r.subject
         AND COALESCE(chapter, '') = COALESCE(r.chapter, '')
         AND COALESCE(topic, '') = r.topic_to
         AND NOT completed AND id <> r.id;
    END IF;
    IF _kid IS NOT NULL THEN
      SELECT * INTO k FROM public.revision_queue WHERE id = _kid;
      INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
      VALUES ('revision_kept', 'revision_queue', k.id, to_jsonb(k)),
             ('revision_folded', 'revision_queue', r.id, to_jsonb(r) - 'topic_to');
      UPDATE public.revision_queue
         SET priority = GREATEST(k.priority, r.priority),
             due_date = LEAST(k.due_date, r.due_date)
       WHERE id = k.id;
      DELETE FROM public.revision_queue WHERE id = r.id;
    ELSE
      INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
      VALUES ('respelled', 'revision_queue', r.id, jsonb_build_object('topic', r.topic));
      UPDATE public.revision_queue SET topic = r.topic_to WHERE id = r.id;
    END IF;
  END LOOP;
END
$revision$;

-- Mastery: respell, or fold into the row already spelled right.
CREATE TEMP TABLE _cm ON COMMIT DROP AS
SELECT x.id, COALESCE(x.concept_to, x.concept) AS concept_to, COALESCE(x.subconcept_to, x.subconcept) AS subconcept_to FROM (
  SELECT cm.id, cm.concept, cm.subconcept,
         pg_temp.spelling(c.chapter_id, cm.concept)    AS concept_to,
         pg_temp.spelling(c.chapter_id, cm.subconcept) AS subconcept_to
    FROM public.concept_mastery cm
   CROSS JOIN LATERAL (SELECT pg_temp.chapter_of(cm.subject, cm.chapter, cm.class_level, pg_temp.user_board(cm.user_id)) AS chapter_id) c
   WHERE c.chapter_id IS NOT NULL
) x
WHERE (x.concept_to IS NOT NULL AND x.concept_to IS DISTINCT FROM x.concept)
   OR (x.subconcept_to IS NOT NULL AND x.subconcept_to IS DISTINCT FROM x.subconcept);

DO $mastery$
DECLARE
  r record; k record; _kid uuid;
  _tot int; _cor int; _rat int; _rco int; _fe int; _mist int;
  _last timestamptz; _last_ok boolean; _conf numeric; _hl numeric;
BEGIN
  FOR r IN SELECT cm.*, x.concept_to, x.subconcept_to FROM public.concept_mastery cm JOIN _cm x ON x.id = cm.id ORDER BY cm.id LOOP
    -- A row already folded into an earlier one in this loop is gone.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.concept_mastery WHERE id = r.id);

    _kid := NULL;
    SELECT id INTO _kid FROM public.concept_mastery
     WHERE user_id = r.user_id AND subject = r.subject
       AND COALESCE(chapter, '') = COALESCE(r.chapter, '')
       AND concept = r.concept_to AND COALESCE(subconcept, '') = COALESCE(r.subconcept_to, '')
       AND id <> r.id;

    IF _kid IS NULL THEN
      INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
      VALUES ('mastery_respelled', 'concept_mastery', r.id,
              jsonb_build_object('concept', r.concept, 'subconcept', r.subconcept));
      UPDATE public.concept_mastery SET concept = r.concept_to, subconcept = r.subconcept_to WHERE id = r.id;
      CONTINUE;
    END IF;

    SELECT * INTO k FROM public.concept_mastery WHERE id = _kid;
    INSERT INTO public.topic_merge_20261128000000 (kind, table_name, row_id, row_before)
    VALUES ('mastery_kept', 'concept_mastery', k.id, to_jsonb(k)),
           ('mastery_folded', 'concept_mastery', r.id, to_jsonb(r) - 'concept_to' - 'subconcept_to');

    _tot := k.total_attempts + r.total_attempts;
    _cor := k.correct_attempts + r.correct_attempts;
    _rat := k.recovery_attempts + r.recovery_attempts;
    _rco := k.recovery_correct + r.recovery_correct;
    _fe  := COALESCE(k.forgetting_events_count, 0) + COALESCE(r.forgetting_events_count, 0);
    -- Exactly as _upsert_concept_mastery counts it (the mistakes are respelled).
    SELECT count(*)::int INTO _mist FROM public.student_mistakes
     WHERE user_id = k.user_id AND status = 'open'
       AND subject = k.subject
       AND COALESCE(chapter, '') = COALESCE(k.chapter, '')
       AND COALESCE(concept, topic, '') = COALESCE(k.concept, '');
    IF r.last_attempt_at IS NOT NULL AND (k.last_attempt_at IS NULL OR r.last_attempt_at > k.last_attempt_at) THEN
      _last := r.last_attempt_at; _last_ok := r.last_outcome_correct;
    ELSE
      _last := k.last_attempt_at; _last_ok := k.last_outcome_correct;
    END IF;
    _conf := CASE WHEN (k.confidence_score IS NULL AND r.confidence_score IS NULL) OR _tot = 0 THEN NULL
                  ELSE round((_cor::numeric / _tot) * 100, 1) END;
    _hl := LEAST(COALESCE(k.half_life_estimate, r.half_life_estimate),
                 COALESCE(r.half_life_estimate, k.half_life_estimate));

    UPDATE public.concept_mastery SET
      student_id              = COALESCE(k.student_id, r.student_id),
      class_level             = COALESCE(k.class_level, r.class_level),
      total_attempts          = _tot,
      correct_attempts        = _cor,
      recovery_attempts       = _rat,
      recovery_correct        = _rco,
      mistake_count           = _mist,
      last_attempt_at         = _last,
      last_outcome_correct    = _last_ok,
      forgetting_events_count = _fe,
      half_life_estimate      = _hl,
      confidence_score        = _conf,
      mastery_score           = public._compute_mastery_score(_tot, _cor, _rat, _rco, _mist, _last),
      updated_at              = now()
     WHERE id = k.id;
    DELETE FROM public.concept_mastery WHERE id = r.id;
  END LOOP;
END
$mastery$;

-- ── THE PROOF ─────────────────────────────────────────────────────────────
DO $proof$
DECLARE
  b record; _n bigint; _u record; _pa jsonb; _chapter uuid; _name text; _folded bigint;
BEGIN
  SELECT * INTO b FROM _before;

  -- 1. None of the merged-in topics remains; every keeper does.
  SELECT count(*) INTO _n FROM public.topics WHERE id IN (SELECT loser_id FROM _map);
  IF _n <> 0 THEN RAISE EXCEPTION '% merged-in topic(s) remain', _n; END IF;
  SELECT count(*) INTO _n FROM public.topics WHERE id IN (SELECT keeper_id FROM _map);
  IF _n <> b.pairs THEN RAISE EXCEPTION 'a keeper topic is missing'; END IF;

  -- 2. Each keeper holds exactly the questions both twins held; nothing points at a deleted twin.
  SELECT count(*) INTO _n FROM _map m
   WHERE (SELECT count(*) FROM public.question_bank q WHERE q.topic_id = m.keeper_id) <> m.keeper_nq + m.loser_nq;
  IF _n <> 0 THEN RAISE EXCEPTION '% keeper(s) do not hold both twins'' questions', _n; END IF;
  SELECT (SELECT count(*) FROM public.question_bank WHERE topic_id IN (SELECT loser_id FROM _map))
       + (SELECT count(*) FROM public.student_upload_questions WHERE topic_id IN (SELECT loser_id FROM _map))
       + (SELECT count(*) FROM public.student_upload_notes WHERE topic_id IN (SELECT loser_id FROM _map))
       + (SELECT count(*) FROM public.student_capture_questions WHERE topic_id IN (SELECT loser_id FROM _map))
       + (SELECT count(*) FROM public.homework WHERE topic_id IN (SELECT loser_id FROM _map))
    INTO _n;
  IF _n <> 0 THEN RAISE EXCEPTION '% row(s) still point at a deleted twin', _n; END IF;

  -- 3. No bank attempt spells its topic otherwise than its chapter's topic; nothing was lost.
  SELECT count(*) INTO _n FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE pg_temp.spelling(qb.chapter_id, qa.topic) IS NOT NULL
     AND pg_temp.spelling(qb.chapter_id, qa.topic) IS DISTINCT FROM qa.topic;
  IF _n <> 0 THEN RAISE EXCEPTION '% bank attempt(s) still spell their topic differently from their chapter''s topic', _n; END IF;
  SELECT count(*) INTO _n FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    JOIN _map m ON m.chapter_id = qb.chapter_id
   WHERE lower(btrim(qa.topic)) = lower(btrim(m.loser_name));
  IF _n <> 0 THEN RAISE EXCEPTION '% bank attempt(s) still name a merged-in topic', _n; END IF;
  IF (SELECT count(*) FROM public.question_attempts) <> b.qa_rows
     OR (SELECT count(*) FROM public.student_mistakes) <> b.sm_rows
     OR (SELECT count(*) FROM public.question_bank) <> b.qb_rows THEN
    RAISE EXCEPTION 'attempts, mistakes or questions changed in number — a respelling must not lose a row';
  END IF;

  -- 4. Mastery events are conserved; the only rows gone are the folded ones.
  SELECT count(*) INTO _folded FROM public.topic_merge_20261128000000 WHERE kind = 'mastery_folded';
  IF (SELECT count(*) FROM public.concept_mastery) <> b.cm_rows - _folded THEN
    RAISE EXCEPTION 'mastery rows: % before, % folded, % now', b.cm_rows, _folded, (SELECT count(*) FROM public.concept_mastery);
  END IF;
  IF (SELECT COALESCE(sum(total_attempts), 0) FROM public.concept_mastery) <> b.cm_attempts
     OR (SELECT COALESCE(sum(correct_attempts), 0) FROM public.concept_mastery) <> b.cm_correct
     OR (SELECT COALESCE(sum(recovery_attempts), 0) FROM public.concept_mastery) <> b.cm_recovery
     OR (SELECT COALESCE(sum(forgetting_events_count), 0) FROM public.concept_mastery) <> b.cm_forgetting THEN
    RAISE EXCEPTION 'mastery events were not conserved across the fold';
  END IF;

  -- 5. What the paid panel shows. Every student whose practice analytics listed
  --    a topic twice now sees it once — and the control: at least one did.
  IF NOT EXISTS (SELECT 1 FROM _split_before WHERE dup_topics > 0) THEN
    RAISE EXCEPTION 'CONTROL FAILED: no student''s analytics listed both names of a pair before, so the check below proves nothing';
  END IF;
  FOR _u IN SELECT user_id FROM _split_before LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _u.user_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _pa := public.rpc_student_practice_analytics();
    RESET ROLE;
    SELECT count(*) INTO _n FROM _map m
     WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_pa->'by_topic', '[]'::jsonb)) e
                    WHERE lower(btrim(e->>'topic')) = lower(btrim(m.loser_name)))
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_pa->'by_topic', '[]'::jsonb)) e
                    WHERE lower(btrim(e->>'topic')) = lower(btrim(m.keeper_name)));
    IF _n <> 0 THEN
      RAISE EXCEPTION 'student % still sees both names of % pair(s) in their practice analytics', _u.user_id, _n;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- 6. The index refuses a new case twin.
  IF b.pairs > 0 THEN
    SELECT m.chapter_id, upper(m.keeper_name) INTO _chapter, _name FROM _map m LIMIT 1;
    BEGIN
      INSERT INTO public.topics (chapter_id, name) VALUES (_chapter, '  ' || _name);
      RAISE EXCEPTION 'a case twin was accepted';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;

  RAISE NOTICE 'merged % named pair(s); respelled % attempt(s), % mistake(s), % revision row(s), % mastery row(s); folded % mastery row(s)',
    b.pairs, (SELECT count(*) FROM _qa), (SELECT count(*) FROM _sm), (SELECT count(*) FROM _rq),
    (SELECT count(*) FROM _cm), _folded;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261128000000_the_same_topic_under_two_names_is_one')
ON CONFLICT (version) DO NOTHING;

COMMIT;
