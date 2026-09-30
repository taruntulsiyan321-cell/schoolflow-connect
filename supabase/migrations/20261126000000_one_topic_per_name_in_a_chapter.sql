-- ═══════════════════════════════════════════════════════════════════════════
-- ONE TOPIC PER NAME IN A CHAPTER — AND ONE SPELLING OF IT EVERYWHERE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 106. The CUET import of 2026-09-23 created the same topic twice
-- in 16 Accountancy and Business Studies chapters, differing only in case —
-- "Share capital" (9 questions) beside "Share Capital" (72), "Ratio analysis"
-- (15) beside "Ratio Analysis" (47). `UNIQUE (chapter_id, name)` is exact, so
-- it admitted them. Topic-wise analysis — a paid feature — then counted each
-- spelling on its own: a student's attempts on one topic split across two
-- rows, each half judged against the evidence floor alone.
--
-- A SECOND WAY TO THE SAME SPLIT. Measured while proving this migration: a
-- practice attempt on a question that had no topic yet was filed under its
-- CHAPTER's name (rpc_record_question_attempt: topic := COALESCE(topic,
-- chapter)). In "Money and Banking" that is "Money and Banking", and the
-- question's topic now is "Money and banking" — the panel listed both. So the
-- rule this migration enforces is not only "one topic row per name": it is
-- that every copy of a topic's name in a chapter is spelled as that chapter's
-- topic is. Measured 2026-09-30: every case-split in the data resolves to a
-- topic of its chapter; none is left without one.
--
-- WHAT A TOPIC'S NAME IS COPIED INTO. Measured before writing this:
--
--   by id      question_bank.topic_id (149 questions on the losing twins);
--              student_upload_questions, student_upload_notes, homework and
--              student_capture_questions carry topic_id too — none points at
--              a losing twin today; they are re-pointed anyway.
--   by NAME    the writers copy the name as text, and readers group by it:
--                question_attempts.topic/concept/subconcept — the practice
--                  analytics' by_topic (the paid "time per topic") GROUPs BY
--                  qa.topic, so re-pointing ids alone would leave it split;
--                student_mistakes.topic/concept/subconcept — recurring
--                  mistakes and _weak_topics_for_user read them;
--                revision_queue.topic — one OPEN row per (student, subject,
--                  chapter, topic), enforced by revision_queue_open_unique;
--                concept_mastery.concept/subconcept — its key.
--   JSON       question_attempts.generated_question keeps the topic it was
--              shown under. Nothing reads its topic or topic_id
--              (_recovery_step_pool and store_generated_questions read a
--              topic_id from live plans and live rows). It is the record of
--              what was shown, and is left as it was.
--
-- A ROW'S CHAPTER. A text copy is only ever matched to a topic OF ITS OWN
-- CHAPTER — "Share capital" is also a distinct, correct topic in four other
-- chapters. The chapter comes from the live question the row is about — a
-- bank question, an upload question or a capture — because the attempt's own
-- JSON can name a chapter that no longer exists (measured: eight upload
-- attempts name "Macroeconomics", which 20261090000000 deleted; their upload
-- questions are in "Money and Banking" now). Then the row's own chapter_id.
-- Then its subject and chapter text, which is ambiguous for 136 mastery and 91
-- revision rows ("Money and Banking" is a CUET chapter and a school one): the
-- student's board decides — an exam account's exam, a school student's
-- school's board — and the class level after that. A row still not pinned to
-- one chapter is left as it is.
--
-- THE KEEPER. Of each twin pair, the one holding more bank questions — its id
-- AND its spelling (then the older, then the lower id). The chapters mix both
-- styles (the import added Title Case beside older sentence case), so there is
-- no convention to follow instead; 15 of the 16 keepers are Title Case, and
-- "Issue of debentures" (35 questions) keeps its spelling over "Issue of
-- Debentures" (5).
--
-- WHEN TWO MASTERY ROWS MEET (one student holds "Ratio analysis" with 8
-- attempts and "Ratio Analysis" with 3; most rows are one spelling and are
-- only respelled):
--
--   events             total_attempts, correct_attempts, recovery_attempts,
--                      recovery_correct, forgetting_events_count — SUMMED:
--                      every event was recorded under exactly one spelling.
--   derived            mistake_count — recounted exactly as
--                      _upsert_concept_mastery counts it, after the mistakes
--                      are respelled; mastery_score — _compute_mastery_score,
--                      the writers' own formula, over the merged counts;
--                      confidence_score — correct / answered, the definition
--                      _recompute_concept_confidence_for_session writes (NULL
--                      if neither row had one); classification is GENERATED
--                      from confidence_score and follows by itself.
--   the latest attempt last_attempt_at and last_outcome_correct — from the more
--                      recently attempted row: they are facts about that one.
--   half_life_estimate the SMALLER. It is a product of every recall the writer
--                      saw, and that history is not stored: the row with 8
--                      attempts and 2 right holds 3.24 = 1.8^2, so the wrong
--                      answers never passed through the writer, and no replay
--                      of question_attempts reproduces it. The smaller
--                      estimate schedules revision sooner; a merge must not
--                      make a student look better retained than either
--                      history shows. The next attempt carries on from it.
--
-- Two open revision rows for one topic become one: due as soon as either, as
-- urgent as either.
--
-- THE RULE, FIXED. A unique index on (chapter_id, lower(btrim(name))), so a
-- case twin cannot be created again. topics_chapter_name_key (exact) stays:
-- the new index implies it, but earlier migrations say ON CONFLICT (chapter_id,
-- name), which needs an index of exactly that shape to infer from, and a
-- replay of them must not fail on it. addChapterTopic
-- (src/academic/repository/curriculumRepository.ts) changes in the same commit:
-- it re-read an existing topic by EXACT name after a 23505.
--
-- Every change is recorded in public.topic_merge_20261126000000, which the
-- rollback reads.
--
-- ROLLBACK: rollback/20261126000000_one_topic_per_name_in_a_chapter.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.topic_merge_20261126000000 (
  seq         bigserial PRIMARY KEY,
  kind        text NOT NULL,
  table_name  text NOT NULL,
  row_id      uuid NOT NULL,
  row_before  jsonb,
  note        text
);
ALTER TABLE public.topic_merge_20261126000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.topic_merge_20261126000000 FROM anon, authenticated;
COMMENT ON TABLE public.topic_merge_20261126000000 IS
  'Rollback source for 20261126000000: every row the topic merge changed or deleted, as it was. kind: topic_deleted | repointed | respelled | revision_folded | revision_kept | mastery_folded | mastery_kept | mastery_respelled. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

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

-- The spelling of the topic of a chapter that a text names, case aside; NULL
-- when no topic of that chapter matches. One at most, by the unique index.
CREATE FUNCTION pg_temp.spelling(_chapter_id uuid, _text text)
RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT t.name FROM public.topics t
   WHERE t.chapter_id = _chapter_id AND lower(btrim(t.name)) = lower(btrim(_text))
$f$;

-- ── The twin map ───────────────────────────────────────────────────────────
CREATE TEMP TABLE _map ON COMMIT DROP AS
WITH g AS (
  SELECT t.id, t.chapter_id, t.name, t.created_at, lower(btrim(t.name)) AS k,
         (SELECT count(*) FROM public.question_bank q WHERE q.topic_id = t.id) AS nq
    FROM public.topics t
   WHERE (t.chapter_id, lower(btrim(t.name))) IN (
           SELECT chapter_id, lower(btrim(name)) FROM public.topics GROUP BY 1, 2 HAVING count(*) > 1)
), r AS (
  SELECT g.*, row_number() OVER (PARTITION BY chapter_id, k ORDER BY nq DESC, created_at, id) AS rn FROM g
)
SELECT l.id AS loser_id, l.name AS loser_name, l.nq AS loser_nq,
       k.id AS keeper_id, k.name AS keeper_name, k.nq AS keeper_nq, l.chapter_id
  FROM r l
  JOIN r k ON k.chapter_id = l.chapter_id AND k.k = l.k AND k.rn = 1
 WHERE l.rn > 1;

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
    SELECT DISTINCT qa.user_id FROM public.question_attempts qa
     WHERE COALESCE(btrim(qa.topic), '') <> ''
     GROUP BY qa.user_id, qa.chapter, lower(btrim(qa.topic))
    HAVING count(DISTINCT qa.topic) > 1
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _pa := public.rpc_student_practice_analytics();
    RESET ROLE;
    SELECT count(*) INTO _n FROM (
      SELECT e->>'chapter', lower(btrim(e->>'topic'))
        FROM jsonb_array_elements(COALESCE(_pa->'by_topic', '[]'::jsonb)) e
       GROUP BY 1, 2 HAVING count(*) > 1) d;
    INSERT INTO _split_before VALUES (_u, _n);
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);
END
$split_before$;

-- ── 1. Re-point every topic_id from a losing twin to its keeper ───────────
INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'question_bank', q.id, jsonb_build_object('topic_id', q.topic_id)
  FROM public.question_bank q JOIN _map m ON q.topic_id = m.loser_id;
UPDATE public.question_bank q SET topic_id = m.keeper_id FROM _map m WHERE q.topic_id = m.loser_id;

INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'student_upload_questions', x.id, jsonb_build_object('topic_id', x.topic_id)
  FROM public.student_upload_questions x JOIN _map m ON x.topic_id = m.loser_id;
UPDATE public.student_upload_questions x SET topic_id = m.keeper_id FROM _map m WHERE x.topic_id = m.loser_id;

INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'student_upload_notes', x.id, jsonb_build_object('topic_id', x.topic_id)
  FROM public.student_upload_notes x JOIN _map m ON x.topic_id = m.loser_id;
UPDATE public.student_upload_notes x SET topic_id = m.keeper_id FROM _map m WHERE x.topic_id = m.loser_id;

INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'student_capture_questions', x.id, jsonb_build_object('topic_id', x.topic_id)
  FROM public.student_capture_questions x JOIN _map m ON x.topic_id = m.loser_id;
UPDATE public.student_capture_questions x SET topic_id = m.keeper_id FROM _map m WHERE x.topic_id = m.loser_id;

INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
SELECT 'repointed', 'homework', x.id, jsonb_build_object('topic_id', x.topic_id)
  FROM public.homework x JOIN _map m ON x.topic_id = m.loser_id;
UPDATE public.homework x SET topic_id = m.keeper_id FROM _map m WHERE x.topic_id = m.loser_id;

-- ── 2. The losing twins go; the rule that let them in is fixed ────────────
INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
SELECT 'topic_deleted', 'topics', t.id, to_jsonb(t) || jsonb_build_object('merged_into', m.keeper_id)
  FROM public.topics t JOIN _map m ON m.loser_id = t.id;
DELETE FROM public.topics t USING _map m WHERE t.id = m.loser_id;

CREATE UNIQUE INDEX topics_chapter_lower_name_key ON public.topics (chapter_id, lower(btrim(name)));
COMMENT ON INDEX public.topics_chapter_lower_name_key IS
  'One topic per name in a chapter, whatever its case or surrounding space (20261126000000). topics_chapter_name_key (exact) is kept for ON CONFLICT (chapter_id, name) in earlier migrations.';

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

INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
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

INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
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
      INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
      VALUES ('revision_kept', 'revision_queue', k.id, to_jsonb(k)),
             ('revision_folded', 'revision_queue', r.id, to_jsonb(r) - 'topic_to');
      UPDATE public.revision_queue
         SET priority = GREATEST(k.priority, r.priority),
             due_date = LEAST(k.due_date, r.due_date)
       WHERE id = k.id;
      DELETE FROM public.revision_queue WHERE id = r.id;
    ELSE
      INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
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
      INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
      VALUES ('mastery_respelled', 'concept_mastery', r.id,
              jsonb_build_object('concept', r.concept, 'subconcept', r.subconcept));
      UPDATE public.concept_mastery SET concept = r.concept_to, subconcept = r.subconcept_to WHERE id = r.id;
      CONTINUE;
    END IF;

    SELECT * INTO k FROM public.concept_mastery WHERE id = _kid;
    INSERT INTO public.topic_merge_20261126000000 (kind, table_name, row_id, row_before)
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

  -- 1. No chapter holds two spellings of one topic.
  SELECT count(*) INTO _n FROM (SELECT chapter_id, lower(btrim(name)) FROM public.topics GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF _n <> 0 THEN RAISE EXCEPTION '% twin group(s) remain', _n; END IF;

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
  IF (SELECT count(*) FROM public.question_attempts) <> b.qa_rows
     OR (SELECT count(*) FROM public.student_mistakes) <> b.sm_rows
     OR (SELECT count(*) FROM public.question_bank) <> b.qb_rows THEN
    RAISE EXCEPTION 'attempts, mistakes or questions changed in number — a respelling must not lose a row';
  END IF;

  -- 4. Mastery events are conserved; the only rows gone are the folded ones.
  SELECT count(*) INTO _folded FROM public.topic_merge_20261126000000 WHERE kind = 'mastery_folded';
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
    RAISE EXCEPTION 'CONTROL FAILED: no student''s analytics listed a topic twice before, so the check below proves nothing';
  END IF;
  FOR _u IN SELECT user_id FROM _split_before LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _u.user_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _pa := public.rpc_student_practice_analytics();
    RESET ROLE;
    SELECT count(*) INTO _n FROM (
      SELECT e->>'chapter', lower(btrim(e->>'topic'))
        FROM jsonb_array_elements(COALESCE(_pa->'by_topic', '[]'::jsonb)) e
       GROUP BY 1, 2 HAVING count(*) > 1) d;
    IF _n <> 0 THEN
      RAISE EXCEPTION 'student % still sees % topic(s) twice in their practice analytics', _u.user_id, _n;
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

  RAISE NOTICE 'merged % twin pair(s); respelled % attempt(s), % mistake(s), % revision row(s), % mastery row(s); folded % mastery row(s)',
    b.pairs, (SELECT count(*) FROM _qa), (SELECT count(*) FROM _sm), (SELECT count(*) FROM _rq),
    (SELECT count(*) FROM _cm), _folded;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261126000000_one_topic_per_name_in_a_chapter')
ON CONFLICT (version) DO NOTHING;

COMMIT;
