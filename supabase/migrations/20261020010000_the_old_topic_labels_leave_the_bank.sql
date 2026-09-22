-- ═══════════════════════════════════════════════════════════════════════════
-- THE OLD TOPIC LABELS LEAVE THE BANK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Spec: docs/locked-decisions.md §10.9, §10.22; docs/gurukul-spec-rules.md
-- rule 31 as amended 2026-09-15 (owner: "don't leave the trace of old topics,
-- remove them, because they can create problems in future").
--
-- 20261020000000 gave every chaptered question a real topic (topic_id). This
-- file makes topic_id the ONLY home for a question's topic.
--
-- WHAT IS REMOVED FROM question_bank
--
--   topic        11,917 per-question strings
--   concept      the same string on 21,660 of 21,710 rows
--   subconcept   empty on every row
--   subtopic     empty on every row
--   topic_group  the 2026-09-10 attempt to group `topic`; median 1 per group
--   and their three indexes
--
-- WHAT READ THEM, AND WHAT EACH NOW READS
--
--   match_question_bank ............ returns topic_id + the topic's name
--                                     (the unread `concept` column is gone)
--   rpc_battle_curriculum(text,uuid)  chapter + topic names from topics
--   rpc_battle_curriculum(text) ..... DROPPED: no caller anywhere
--   rpc_generate_battle ............. a battle's topic matched to topics.name
--   _fill_featured_battle_questions . same
--   _snapshot_battle_report ......... topic names from topics
--   rpc_fill_paper_section_from_bank  question_paper_sections.topic_ids
--   _practice_grade_from_bank ....... returns topic_id + topic
--   rpc_record_question_attempt ..... the BANK's topic wins over any topic
--                                     string the client sends
--   _recompute_concept_confidence_for_session  groups by topic_id
--   _backfill_question_bank_concepts, _backfill_battle_question_concepts,
--   _backfill_template_concepts, rpc_backfill_question_concepts
--                                     DROPPED: they existed only to copy
--                                     `topic` into `concept`; nothing calls them
--
-- question_paper_sections.topics (text[] of topic_group names) becomes
-- topic_ids (uuid[]). Names cannot do this job: a section spanning chapters
-- that both teach "Journal Entries" could not tell the two apart by name.
--
-- THE COPIES DOWNSTREAM
--
-- Practice, mistakes, mastery, battles and the old revision queue copied the
-- question's label into their own text columns. Those columns keep their names
-- for now — renaming the mastery engine's key is its own change — but none of
-- them may keep an OLD label:
--
--   * a row that names its bank question takes that question's topic name;
--   * a row that only carries a label takes the topic that label's questions
--     were filed under in the same subject and chapter (the majority, when a
--     label's questions were split);
--   * concept_mastery rows that now name the same topic are MERGED — counts
--     summed, mastery recomputed by _compute_mastery_score, confidence
--     recomputed as correct/total, half-life weighted by attempts;
--   * open revision_queue rows that now collide keep the one with the highest
--     priority.
--
-- Labels that were never bank labels ("Concept 2" scale fixtures, hand-written
-- seed concepts) are not bank topics and are left as they are.
--
-- The convention `subconcept = concept` is the one rpc_record_question_attempt
-- has always written (question_bank.subconcept was empty, so it fell back to
-- concept); it is kept so a new attempt lands on the merged row.
--
-- Rollback: supabase/migrations/rollback/20261020010000_the_old_topic_labels_leave_the_bank.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Every chaptered question already has a topic, or none of this is safe

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM public.question_bank WHERE chapter_id IS NOT NULL AND topic_id IS NULL) THEN
    RAISE EXCEPTION 'precondition: % chaptered questions have no topic — apply 20261020000000 first',
      (SELECT count(*) FROM public.question_bank WHERE chapter_id IS NOT NULL AND topic_id IS NULL);
  END IF;
END
$pre$;


-- ── 1. What every old label means now, measured from the bank before it goes

CREATE TABLE public._label_topic_map_20261020 AS
WITH labels AS (
  SELECT qb.subject, qb.chapter, btrim(v.lbl) AS label, qb.topic_id
    FROM public.question_bank qb
    CROSS JOIN LATERAL (VALUES (qb.topic), (qb.concept), (qb.subconcept), (qb.subtopic), (qb.topic_group)) AS v(lbl)
   WHERE qb.topic_id IS NOT NULL AND v.lbl IS NOT NULL AND btrim(v.lbl) <> ''
), counted AS (
  SELECT subject, chapter, label, topic_id, count(*) AS n
    FROM labels GROUP BY subject, chapter, label, topic_id
)
SELECT DISTINCT ON (c.subject, c.chapter, c.label)
       c.subject, c.chapter, c.label, c.topic_id, t.name AS topic_name
  FROM counted c JOIN public.topics t ON t.id = c.topic_id
 ORDER BY c.subject, c.chapter, c.label, c.n DESC, t.name;

CREATE INDEX ON public._label_topic_map_20261020 (subject, chapter, label);

-- A stale label is a bank label that differs from the topic it now means.
CREATE TABLE public._stale_counts_20261020 (what text PRIMARY KEY, n bigint NOT NULL);

INSERT INTO public._stale_counts_20261020 (what, n)
SELECT 'before', (
    (SELECT count(*) FROM public.question_attempts qa JOIN public._label_topic_map_20261020 m
       ON m.subject = qa.subject AND m.chapter IS NOT DISTINCT FROM qa.chapter
      AND m.label IN (qa.topic, qa.concept, qa.subconcept) AND m.label <> m.topic_name)
  + (SELECT count(*) FROM public.student_mistakes sm JOIN public._label_topic_map_20261020 m
       ON m.subject = sm.subject AND m.chapter IS NOT DISTINCT FROM sm.chapter
      AND m.label IN (sm.topic, sm.concept, sm.subconcept) AND m.label <> m.topic_name)
  + (SELECT count(*) FROM public.concept_mastery cm JOIN public._label_topic_map_20261020 m
       ON m.subject = cm.subject AND m.chapter IS NOT DISTINCT FROM cm.chapter
      AND m.label = cm.concept AND m.label <> m.topic_name)
  + (SELECT count(*) FROM public.revision_queue rq JOIN public._label_topic_map_20261020 m
       ON m.subject = rq.subject AND m.chapter IS NOT DISTINCT FROM rq.chapter
      AND m.label = rq.topic AND m.label <> m.topic_name));

INSERT INTO public._stale_counts_20261020 (what, n)
SELECT 'mastery_attempts_before', COALESCE(sum(total_attempts), 0) FROM public.concept_mastery;


-- ── 2. The copies take the real topic ──────────────────────────────────────

-- 2a. Rows that name their bank question: the question decides.
UPDATE public.question_attempts qa
   SET topic = t.name, concept = t.name, subconcept = t.name
  FROM public.question_bank qb JOIN public.topics t ON t.id = qb.topic_id
 WHERE qb.id = qa.bank_question_id
   AND (qa.topic IS DISTINCT FROM t.name OR qa.concept IS DISTINCT FROM t.name OR qa.subconcept IS DISTINCT FROM t.name);

UPDATE public.student_mistakes sm
   SET topic = t.name, concept = t.name, subconcept = t.name
  FROM public.question_bank qb JOIN public.topics t ON t.id = qb.topic_id
 WHERE qb.id = sm.question_id
   AND (sm.topic IS DISTINCT FROM t.name OR sm.concept IS DISTINCT FROM t.name OR sm.subconcept IS DISTINCT FROM t.name);

UPDATE public.battle_questions bq
   SET concept = t.name, subconcept = t.name
  FROM public.question_bank qb JOIN public.topics t ON t.id = qb.topic_id
 WHERE qb.id = bq.bank_question_id
   AND (bq.concept IS NOT NULL OR bq.subconcept IS NOT NULL)
   AND (bq.concept IS DISTINCT FROM t.name OR bq.subconcept IS DISTINCT FROM t.name);

-- 2b. Rows that carry only a label: the label's topic in the same chapter.
UPDATE public.question_attempts qa SET topic = m.topic_name
  FROM public._label_topic_map_20261020 m
 WHERE m.subject = qa.subject AND m.chapter IS NOT DISTINCT FROM qa.chapter AND m.label = qa.topic AND qa.topic <> m.topic_name;
UPDATE public.question_attempts qa SET concept = m.topic_name
  FROM public._label_topic_map_20261020 m
 WHERE m.subject = qa.subject AND m.chapter IS NOT DISTINCT FROM qa.chapter AND m.label = qa.concept AND qa.concept <> m.topic_name;
UPDATE public.question_attempts qa SET subconcept = m.topic_name
  FROM public._label_topic_map_20261020 m
 WHERE m.subject = qa.subject AND m.chapter IS NOT DISTINCT FROM qa.chapter AND m.label = qa.subconcept AND qa.subconcept <> m.topic_name;

UPDATE public.student_mistakes sm SET topic = m.topic_name
  FROM public._label_topic_map_20261020 m
 WHERE m.subject = sm.subject AND m.chapter IS NOT DISTINCT FROM sm.chapter AND m.label = sm.topic AND sm.topic <> m.topic_name;
UPDATE public.student_mistakes sm SET concept = m.topic_name
  FROM public._label_topic_map_20261020 m
 WHERE m.subject = sm.subject AND m.chapter IS NOT DISTINCT FROM sm.chapter AND m.label = sm.concept AND sm.concept <> m.topic_name;
UPDATE public.student_mistakes sm SET subconcept = m.topic_name
  FROM public._label_topic_map_20261020 m
 WHERE m.subject = sm.subject AND m.chapter IS NOT DISTINCT FROM sm.chapter AND m.label = sm.subconcept AND sm.subconcept <> m.topic_name;

-- 2c. The old revision queue. Its open rows are UNIQUE on (user, subject,
-- chapter, topic), so rows about to collide are resolved first: an untouched
-- row is always kept, then the highest priority, then the earliest due.
CREATE TABLE public._rq_target_20261020 AS
SELECT rq.id, m.topic_name
  FROM public.revision_queue rq
  JOIN public._label_topic_map_20261020 m
    ON m.subject = rq.subject AND m.chapter IS NOT DISTINCT FROM rq.chapter
   AND m.label = rq.topic AND rq.topic <> m.topic_name;

DELETE FROM public.revision_queue d
 USING (
   SELECT rq.id,
          row_number() OVER (
            PARTITION BY rq.user_id, rq.subject, COALESCE(rq.chapter, ''), COALESCE(t.topic_name, rq.topic, '')
            ORDER BY (t.id IS NULL) DESC, rq.priority DESC, rq.due_date, rq.created_at, rq.id) AS rn,
          t.id AS mapped
     FROM public.revision_queue rq
     LEFT JOIN public._rq_target_20261020 t ON t.id = rq.id
    WHERE NOT rq.completed
 ) r
 WHERE d.id = r.id AND r.rn > 1 AND r.mapped IS NOT NULL;

UPDATE public.revision_queue rq SET topic = t.topic_name
  FROM public._rq_target_20261020 t WHERE t.id = rq.id;

-- 2d. Mastery. Rows that now name the same topic are one row.
CREATE TABLE public._cm_target_20261020 AS
SELECT cm.id, m.topic_name
  FROM public.concept_mastery cm
  JOIN public._label_topic_map_20261020 m
    ON m.subject = cm.subject AND m.chapter IS NOT DISTINCT FROM cm.chapter
   AND m.label = cm.concept AND cm.concept <> m.topic_name;

CREATE TABLE public._cm_merge_20261020 AS
WITH members AS (
  -- the mapped rows, plus any row that already sits under the target name
  SELECT cm.*, t.topic_name AS new_concept
    FROM public.concept_mastery cm JOIN public._cm_target_20261020 t ON t.id = cm.id
  UNION ALL
  SELECT cm.*, cm.concept AS new_concept
    FROM public.concept_mastery cm
   WHERE NOT EXISTS (SELECT 1 FROM public._cm_target_20261020 t WHERE t.id = cm.id)
     AND COALESCE(cm.subconcept, '') IN ('', cm.concept)
     AND EXISTS (SELECT 1 FROM public._cm_target_20261020 t JOIN public.concept_mastery c2 ON c2.id = t.id
                  WHERE c2.user_id = cm.user_id AND c2.subject = cm.subject
                    AND COALESCE(c2.chapter, '') = COALESCE(cm.chapter, '')
                    AND t.topic_name = cm.concept)
)
SELECT user_id, subject, chapter, new_concept,
       (array_agg(id ORDER BY last_attempt_at DESC NULLS LAST, updated_at DESC, id))[1] AS keep_id,
       array_agg(id) AS member_ids,
       sum(total_attempts)::int      AS total_attempts,
       sum(correct_attempts)::int    AS correct_attempts,
       sum(recovery_attempts)::int   AS recovery_attempts,
       sum(recovery_correct)::int    AS recovery_correct,
       sum(forgetting_events_count)::int AS forgetting_events_count,
       max(last_attempt_at)          AS last_attempt_at,
       bool_or(confidence_score IS NOT NULL) AS had_confidence,
       CASE WHEN sum(total_attempts) > 0
            THEN sum(half_life_estimate * total_attempts) / sum(total_attempts)
            ELSE avg(half_life_estimate) END AS half_life_estimate
  FROM members
 GROUP BY user_id, subject, chapter, new_concept;

DELETE FROM public.concept_mastery cm
 USING public._cm_merge_20261020 g
 WHERE cm.id = ANY (g.member_ids) AND cm.id <> g.keep_id;

UPDATE public.concept_mastery cm
   SET concept                 = g.new_concept,
       subconcept              = g.new_concept,
       total_attempts          = g.total_attempts,
       correct_attempts        = g.correct_attempts,
       recovery_attempts       = g.recovery_attempts,
       recovery_correct        = g.recovery_correct,
       forgetting_events_count = g.forgetting_events_count,
       last_attempt_at         = g.last_attempt_at,
       half_life_estimate      = g.half_life_estimate,
       confidence_score        = CASE WHEN g.had_confidence AND g.total_attempts > 0
                                      THEN round((g.correct_attempts::numeric / g.total_attempts) * 100, 1) END,
       mistake_count           = (SELECT count(*)::int FROM public.student_mistakes sm
                                   WHERE sm.user_id = g.user_id AND sm.status = 'open' AND sm.subject = g.subject
                                     AND COALESCE(sm.chapter, '') = COALESCE(g.chapter, '')
                                     AND COALESCE(sm.concept, sm.topic, '') = g.new_concept),
       updated_at              = now()
  FROM public._cm_merge_20261020 g
 WHERE cm.id = g.keep_id;

UPDATE public.concept_mastery cm
   SET mastery_score = public._compute_mastery_score(
         cm.total_attempts, cm.correct_attempts, cm.recovery_attempts,
         cm.recovery_correct, cm.mistake_count, cm.last_attempt_at)
  FROM public._cm_merge_20261020 g
 WHERE cm.id = g.keep_id;


-- ── 3. A paper section names topics by id ──────────────────────────────────

ALTER TABLE public.question_paper_sections
  ADD COLUMN topic_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

UPDATE public.question_paper_sections sec
   SET topic_ids = COALESCE((
         SELECT array_agg(DISTINCT qb.topic_id ORDER BY qb.topic_id)
           FROM public.question_bank qb
           JOIN public.question_papers pap ON pap.id = sec.paper_id
          WHERE qb.topic_group = ANY (sec.topics)
            AND qb.subject = pap.subject
            AND qb.class_level = pap.class_level
            AND (cardinality(sec.chapters) = 0 OR qb.chapter = ANY (sec.chapters))
            AND qb.topic_id IS NOT NULL), '{}'::uuid[])
 WHERE cardinality(sec.topics) > 0;

DO $sections$
BEGIN
  IF EXISTS (SELECT 1 FROM public.question_paper_sections
              WHERE cardinality(topics) > 0 AND cardinality(topic_ids) = 0) THEN
    RAISE EXCEPTION 'a paper section named topics that map to no topic — it would silently widen to the whole chapter set';
  END IF;
END
$sections$;

ALTER TABLE public.question_paper_sections DROP COLUMN topics;

COMMENT ON COLUMN public.question_paper_sections.topic_ids IS
  'Topics this section is narrowed to (topics.id). Empty means the whole chapter set, never "no topics".';


-- ── 4. The readers ──────────────────────────────────────────────────────────

DROP FUNCTION public.match_question_bank(vector, integer, uuid, text[], double precision, integer);

CREATE FUNCTION public.match_question_bank(
  p_query_embedding vector, p_class_level integer, p_school_id uuid DEFAULT NULL::uuid,
  p_subjects text[] DEFAULT NULL::text[], p_match_threshold double precision DEFAULT 0.82,
  p_match_count integer DEFAULT 3)
RETURNS TABLE(id uuid, question text, options jsonb, correct_index integer, explanation text,
              subject text, chapter text, topic_id uuid, topic text, similarity double precision)
LANGUAGE sql
STABLE
AS $function$
  -- question_bank has no school_id and is shared across all schools and all
  -- users by design -- §10.9, docs/locked-decisions.md:385.
  --
  -- The tenancy dimension is BOARD, and this is the same test the RLS policy
  -- qb_select_approved_board makes -- written here against p_school_id so that
  -- it also holds for service_role, which bypasses RLS entirely and is the
  -- caller aiRouter.ts uses.
  --
  -- No `p_school_id IS NULL OR ...` escape: an unknown school narrows the
  -- result to board-agnostic rows rather than opening it (G14).
  --
  -- `created_by = auth.uid()` is never true for service_role (auth.uid() is
  -- NULL there), so it widens the result for exactly one caller: the teacher
  -- who wrote the question.
  --
  -- The topic is the question's topics row (20261020010000); the old
  -- per-question `concept` string this used to return was read by no caller.
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.chapter, qb.topic_id, t.name,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  LEFT JOIN public.topics t ON t.id = qb.topic_id
  WHERE qb.embed_status = 'embedded'
    AND qb.is_active = true
    AND (qb.is_approved = true OR qb.created_by = auth.uid())
    AND qb.class_level = p_class_level
    AND (qb.board IS NULL
         OR qb.board = 'both'
         OR qb.board = (SELECT s.board FROM public.schools s WHERE s.id = p_school_id))
    AND (p_subjects IS NULL OR qb.subject = ANY(p_subjects))
    AND (1 - (qb.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY qb.embedding <=> p_query_embedding
  LIMIT p_match_count;
$function$;

REVOKE ALL ON FUNCTION public.match_question_bank(vector, integer, uuid, text[], double precision, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_question_bank(vector, integer, uuid, text[], double precision, integer) TO authenticated, service_role;


DROP FUNCTION public.rpc_battle_curriculum(text);

CREATE OR REPLACE FUNCTION public.rpc_battle_curriculum(_subject text, _class_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Chapter and topic NAMES, because a battle stores both as text and the
  -- picker shows them. The topic is the question's real topic, so the list is
  -- a chapter's handful of sections rather than one entry per question.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'chapter', sub.chapter,
    'topic', sub.topic
  ) ORDER BY sub.chapter, sub.topic), '[]'::jsonb)
  FROM (
    SELECT DISTINCT
      COALESCE(NULLIF(trim(qb.chapter), ''), 'General') AS chapter,
      t.name AS topic
    FROM public.question_bank qb
    LEFT JOIN public.topics t ON t.id = qb.topic_id
    WHERE qb.is_approved AND lower(qb.subject) = lower(_subject)
      AND (
        _class_id IS NULL
        OR qb.class_level IS NULL
        OR qb.class_level = public._class_grade(_class_id)
      )
    UNION
    SELECT DISTINCT
      qt.chapter,
      NULL::text AS topic
    FROM public.question_templates qt
    WHERE qt.is_active
      AND lower(qt.subject) = lower(_subject)
      AND (
        _class_id IS NULL
        OR qt.class = public._class_grade(_class_id)
        OR public._class_grade(_class_id) IS NULL
      )
  ) sub;
$function$;


CREATE OR REPLACE FUNCTION public.rpc_generate_battle(_battle_id uuid, _count integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _b   record;
  _uid uuid := auth.uid();
  _inserted int := 0;
  _board text;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;
  IF _b.creator_user_id <> _uid
     AND NOT has_role(_uid,'admin') AND NOT has_role(_uid,'teacher')
     AND NOT (
       coalesce(_b.source, '') LIKE 'featured_%'
       AND _b.class_id IS NOT NULL
       AND public.student_class_id(_uid) IS NOT DISTINCT FROM _b.class_id
     ) THEN
    RAISE EXCEPTION 'Not your battle';
  END IF;

  SELECT s.board INTO _board FROM public.schools s WHERE s.id = _b.school_id;

  IF _b.class_level IS NULL THEN
    RAISE EXCEPTION 'Battle % has no class level, so questions cannot be drawn safely', _battle_id;
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty,
           COALESCE(h.times_seen, 0) AS seen,
           COALESCE(h.last_seen_at, 'epoch'::timestamptz) AS last_seen
    FROM public.question_bank q
    LEFT JOIN public.student_question_history h
      ON h.question_id = q.id AND h.user_id = _uid
    WHERE q.is_approved
      AND q.is_active
      AND q.class_level = _b.class_level
      AND (q.board IS NULL OR q.board = 'both' OR q.board = _board)
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      -- The battle's topic is a topic NAME picked from rpc_battle_curriculum;
      -- it matches the question's topics row, case-insensitively.
      AND (_b.topic IS NULL OR EXISTS (
            SELECT 1 FROM public.topics t
             WHERE t.id = q.topic_id AND lower(t.name) = lower(_b.topic)))
  ), picked AS (
    SELECT id, question, options, correct_index FROM pool
    ORDER BY seen ASC,
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      last_seen ASC, random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id, school_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id, _b.school_id
    FROM picked RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
    SET
      source = CASE
        WHEN nullif(trim(source), '') IS NULL THEN 'bank'
        ELSE source
      END,
      question_count = _inserted,
      duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $function$;


CREATE OR REPLACE FUNCTION public._fill_featured_battle_questions(_battle_id uuid, _count integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _b record;
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _battle_id LIMIT 1) THEN
    SELECT count(*) INTO _inserted FROM public.battle_questions WHERE battle_id = _battle_id;
    RETURN _inserted;
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.topic IS NULL OR EXISTS (
            SELECT 1 FROM public.topics t
             WHERE t.id = q.topic_id AND lower(t.name) = lower(_b.topic)))
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index
    FROM pool
    ORDER BY
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id, school_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id, _b.school_id
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
  SET
    source = CASE
      WHEN nullif(trim(source), '') IS NULL THEN 'bank'
      ELSE source
    END,
    question_count = GREATEST(_inserted, 1),
    duration_sec = per_question_sec * GREATEST(_inserted, 1)
  WHERE id = _battle_id;

  RETURN _inserted;
END;
$function$;


CREATE OR REPLACE FUNCTION public._snapshot_battle_report(_participant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _p record; _report jsonb; _rid uuid;
  _total int; _won boolean; _max_score int;
  _class_avg_acc numeric; _class_avg_score numeric;
BEGIN
  SELECT p.*, b.title, b.subject, b.chapter, b.topic, b.difficulty, b.question_count, b.per_question_sec
    INTO _p
    FROM public.battle_participants p
    JOIN public.battles b ON b.id = p.battle_id
    WHERE p.id = _participant_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT count(*), max(score) INTO _total, _max_score
    FROM public.battle_participants WHERE battle_id = _p.battle_id AND finished_at IS NOT NULL;
  _won := (_p.score = _max_score AND _p.score > 0);

  SELECT
    round(avg(CASE WHEN answered_count > 0 THEN 100.0 * correct_count / answered_count END)),
    round(avg(score))
  INTO _class_avg_acc, _class_avg_score
  FROM public.battle_participants
  WHERE battle_id = _p.battle_id AND finished_at IS NOT NULL;

  _report := jsonb_build_object(
    'participant_id', _participant_id,
    'battle', jsonb_build_object(
      'id', _p.battle_id, 'title', _p.title, 'subject', _p.subject,
      'chapter', _p.chapter, 'topic', _p.topic, 'difficulty', _p.difficulty,
      'question_count', _p.question_count, 'per_question_sec', _p.per_question_sec
    ),
    'summary', jsonb_build_object(
      'score', _p.score, 'rank', _p.rank, 'total_participants', _total, 'won', _won,
      'correct_count', _p.correct_count, 'answered_count', _p.answered_count,
      'skipped_count', GREATEST(0, _p.question_count - _p.answered_count),
      'accuracy_pct', CASE WHEN _p.answered_count > 0
        THEN round(100.0 * _p.correct_count / _p.answered_count) ELSE 0 END,
      'avg_time_ms', CASE WHEN _p.answered_count > 0
        THEN round(_p.total_time_ms::numeric / _p.answered_count) ELSE 0 END,
      'total_time_sec', round(_p.total_time_ms::numeric / 1000)
    ),
    'topics', jsonb_build_object(
      'strong', '[]'::jsonb,
      'weak', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'label', sub.lbl, 'chapter', sub.chapter, 'topic', sub.topic,
          'correct', sub.correct, 'total', sub.total,
          'accuracy', round(100.0 * sub.correct / NULLIF(sub.total, 0))
        ) ORDER BY sub.correct ASC)
        FROM (
          SELECT COALESCE(qb2.chapter, t2.name, 'General') AS lbl,
                 max(qb2.chapter) AS chapter, max(t2.name) AS topic,
                 count(*) FILTER (WHERE ba.is_correct) AS correct,
                 count(*) AS total
          FROM public.battle_answers ba
          JOIN public.battle_questions bq ON bq.id = ba.question_id
          LEFT JOIN public.question_bank qb2 ON qb2.id = bq.bank_question_id
          LEFT JOIN public.topics t2 ON t2.id = qb2.topic_id
          WHERE ba.participant_id = _participant_id
          GROUP BY COALESCE(qb2.chapter, t2.name, 'General')
          HAVING count(*) FILTER (WHERE ba.is_correct) < count(*)
        ) sub
        LIMIT 5
      ), '[]'::jsonb)
    ),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_index', bq.order_index, 'question_id', bq.id,
        'question', bq.question, 'options', bq.options,
        'correct_index', bq.correct_index, 'selected_index', ba.selected_index,
        'is_correct', COALESCE(ba.is_correct, false),
        'time_ms', COALESCE(ba.time_ms, 0),
        'skipped', (ba.id IS NULL),
        'chapter', qb.chapter, 'topic', t.name, 'explanation', qb.explanation
      ) ORDER BY bq.order_index)
      FROM public.battle_questions bq
      LEFT JOIN public.battle_answers ba
        ON ba.question_id = bq.id AND ba.participant_id = _participant_id
      LEFT JOIN public.question_bank qb ON qb.id = bq.bank_question_id
      LEFT JOIN public.topics t ON t.id = qb.topic_id
      WHERE bq.battle_id = _p.battle_id
    ), '[]'::jsonb),
    'speed', (
      SELECT jsonb_build_object(
        'fastest_ms', min(ba.time_ms),
        'slowest_ms', max(ba.time_ms),
        'under_pressure_accuracy', (
          SELECT round(100.0 * count(*) FILTER (WHERE ba2.is_correct) / NULLIF(count(*),0))
          FROM public.battle_answers ba2
          WHERE ba2.participant_id = _participant_id
            AND ba2.time_ms >= (_p.per_question_sec * 1000 * 0.75)
        ),
        'comfort_zone_accuracy', (
          SELECT round(100.0 * count(*) FILTER (WHERE ba3.is_correct) / NULLIF(count(*),0))
          FROM public.battle_answers ba3
          WHERE ba3.participant_id = _participant_id
            AND ba3.time_ms < (_p.per_question_sec * 1000 * 0.75)
        )
      )
      FROM public.battle_answers ba WHERE ba.participant_id = _participant_id
    ),
    'comparison', jsonb_build_object(
      'class_avg_accuracy', _class_avg_acc,
      'class_avg_score', _class_avg_score,
      'vs_avg_accuracy', CASE WHEN _p.answered_count > 0 AND _class_avg_acc IS NOT NULL
        THEN round(100.0 * _p.correct_count / _p.answered_count) - _class_avg_acc ELSE NULL END
    )
  );

  INSERT INTO public.battle_reports
    (participant_id, battle_id, user_id, display_name, report, expires_at)
  VALUES
    (_participant_id, _p.battle_id, _p.user_id, _p.display_name, _report, now() + interval '24 hours')
  ON CONFLICT (participant_id) DO UPDATE SET
    report = EXCLUDED.report,
    expires_at = EXCLUDED.expires_at,
    display_name = EXCLUDED.display_name
  RETURNING id INTO _rid;

  RETURN _rid;
END $function$;


CREATE OR REPLACE FUNCTION public.rpc_fill_paper_section_from_bank(_section_id uuid, _bank_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  sec       public.question_paper_sections%ROWTYPE;
  pap       public.question_papers%ROWTYPE;
  present   int;
  wanted    int;
  pool      int;
  inserted  int;
  next_ix   int;
  semantic  boolean := _bank_ids IS NOT NULL AND cardinality(_bank_ids) > 0;
BEGIN
  SELECT * INTO sec FROM public.question_paper_sections WHERE id = _section_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your question paper section' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO pap FROM public.question_papers WHERE id = sec.paper_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your question paper' USING ERRCODE = '42501';
  END IF;

  IF pap.status <> 'draft' THEN
    RAISE EXCEPTION 'This paper is final - reopen it before changing its questions'
      USING ERRCODE = '22023';
  END IF;

  IF sec.question_format <> 'mcq' THEN
    RAISE EXCEPTION
      'The question bank holds multiple-choice questions only, so a % section cannot be filled from it',
      sec.question_format
      USING ERRCODE = '22023';
  END IF;

  IF pap.class_level IS NULL THEN
    RAISE EXCEPTION 'This paper has no class level, so the bank cannot be narrowed to it'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO present
    FROM public.question_paper_questions q WHERE q.section_id = _section_id;

  wanted := GREATEST(sec.target_count - present, 0);

  SELECT COALESCE(max(q.order_index), -1) + 1 INTO next_ix
    FROM public.question_paper_questions q WHERE q.section_id = _section_id;

  -- ONE statement, ONE definition of the candidate pool, used for both the
  -- count and the pick. The semantic list narrows that pool; it never widens
  -- it - every structural filter below applies in both paths.
  --
  -- `wanted` may be 0 (the section is already full). `LIMIT 0` then picks
  -- nothing and the INSERT inserts nothing, while the pool is still counted,
  -- so there is no second copy of this query behind an IF.
  WITH candidates AS (
    SELECT qb.id, qb.question, qb.options, qb.correct_index, qb.explanation, qb.chapter,
           CASE WHEN semantic THEN array_position(_bank_ids, qb.id) END AS rank_ix,
           row_number() OVER (
             PARTITION BY qb.chapter
             ORDER BY md5(qb.id::text || _section_id::text)
           ) AS rn_in_chapter
      FROM public.question_bank qb
     WHERE qb.is_active
       AND qb.is_approved
       AND qb.class_level = pap.class_level
       AND qb.subject = pap.subject
       AND (pap.board IS NULL OR qb.board = pap.board OR qb.board = 'both')
       AND (cardinality(sec.chapters) = 0 OR qb.chapter = ANY (sec.chapters))
       -- The topic narrowing, by topic id. Empty means the whole chapter set,
       -- exactly as an empty `chapters` means the whole subject.
       AND (cardinality(sec.topic_ids) = 0 OR qb.topic_id = ANY (sec.topic_ids))
       AND (sec.difficulty IS NULL OR qb.difficulty = sec.difficulty)
       AND (NOT semantic OR qb.id = ANY (_bank_ids))
       AND NOT EXISTS (
             SELECT 1 FROM public.question_paper_questions q
              WHERE q.paper_id = sec.paper_id AND q.bank_id = qb.id)
  ), ordered AS (
    SELECT c.*,
           row_number() OVER (
             -- Semantic rank first when there is one; otherwise the
             -- deterministic chapter round-robin the structured path has always
             -- used. `random()` is deliberately absent from both - a fill that
             -- cannot be repeated cannot be tested.
             ORDER BY c.rank_ix NULLS LAST,
                      c.rn_in_chapter,
                      c.chapter,
                      md5(c.id::text || _section_id::text)
           ) AS pick_ix
      FROM candidates c
  ), picked AS (
    SELECT * FROM ordered ORDER BY pick_ix LIMIT wanted
  ), ins AS (
    INSERT INTO public.question_paper_questions
      (paper_id, section_id, school_id, order_index, origin, bank_id,
       question, options, correct_index, explanation, chapter, marks)
    SELECT sec.paper_id, _section_id, sec.school_id,
           next_ix + (p.pick_ix - 1)::int, 'retrieved', p.id,
           p.question, p.options, p.correct_index, p.explanation, p.chapter,
           sec.marks_per_question
      FROM picked p
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM ins)
    INTO pool, inserted;

  RETURN jsonb_build_object(
    'section_id', _section_id,
    'target_count', sec.target_count,
    'already_present', present,
    'requested', wanted,
    'pool_size', pool,
    'inserted', inserted,
    'shortfall', GREATEST(wanted - inserted, 0),
    -- Which path chose these. A teacher who asked for a semantic fill and
    -- silently got the structured one has been told something false about
    -- their own paper.
    'strategy', CASE WHEN semantic THEN 'semantic' ELSE 'structured' END,
    'ranked_candidates', CASE WHEN semantic THEN cardinality(_bank_ids) ELSE 0 END,
    -- So a teacher can see the narrowing was applied, and a shortfall of zero
    -- pool is legible as "no questions carry that topic yet" rather than as a
    -- silent empty section.
    'topics_requested', cardinality(sec.topic_ids)
  );
END;
$function$;


DROP FUNCTION public._practice_grade_from_bank(uuid, jsonb, jsonb);

CREATE FUNCTION public._practice_grade_from_bank(_bank_question_id uuid, _selected_answer jsonb, _client_correct_answer jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(is_correct boolean, score numeric, correct_answer jsonb, subject text, chapter text,
              topic_id uuid, topic text, difficulty text, class_level integer, explanation text,
              question_text text, options jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _qb public.question_bank%ROWTYPE;
  _sel_idx int;
  _ok boolean;
BEGIN
  IF _bank_question_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO _qb
  FROM public.question_bank
  WHERE id = _bank_question_id AND is_approved = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_question_not_found';
  END IF;

  _sel_idx := COALESCE(
    NULLIF(_selected_answer->>'index', '')::int,
    NULLIF(_selected_answer->>'selected_index', '')::int,
    NULLIF(_selected_answer->>'correct_index', '')::int
  );

  _ok := (_sel_idx IS NOT NULL AND _sel_idx = _qb.correct_index);

  is_correct := _ok;
  score := CASE WHEN _ok THEN 1 ELSE 0 END;
  correct_answer := jsonb_build_object(
    'index', _qb.correct_index,
    'text', COALESCE((_qb.options ->> _qb.correct_index), '')
  );
  subject := _qb.subject;
  chapter := _qb.chapter;
  -- The question's own topic. NULL only for the handful of chapterless,
  -- inactive legacy rows, which no session can serve.
  topic_id := _qb.topic_id;
  topic := (SELECT t.name FROM public.topics t WHERE t.id = _qb.topic_id);
  difficulty := COALESCE(_qb.difficulty, 'medium');
  class_level := COALESCE(_qb.class_level, 12);
  explanation := COALESCE(_qb.explanation, '');
  question_text := _qb.question;
  options := COALESCE(_qb.options, '[]'::jsonb);
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public._practice_grade_from_bank(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._practice_grade_from_bank(uuid, jsonb, jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(_correct_answer jsonb, _generated_question jsonb, _is_correct boolean, _selected_answer jsonb, _session_id uuid, _score numeric DEFAULT 0, _skipped boolean DEFAULT false, _template_id uuid DEFAULT NULL::uuid, _time_taken_ms integer DEFAULT NULL::integer, _bank_question_id uuid DEFAULT NULL::uuid, _hint_used boolean DEFAULT false, _source text DEFAULT 'practice'::text, _meta jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid;
  _aid uuid;
  _ps record;
  _tm record;
  _subject text;
  _chapter text;
  _topic text;
  _class int := 12;
  _concept_f text;
  _sub_f text;
  _difficulty text := 'medium';
  _explanation text;
  _resolved_correct boolean := false;
  _resolved_score numeric := 0;
  _resolved_correct_answer jsonb := COALESCE(_correct_answer, '{}'::jsonb);
  _grade record;
  _bank_id uuid := COALESCE(
    _bank_question_id,
    NULLIF(_generated_question->>'bank_question_id', '')::uuid,
    NULLIF(_generated_question->>'question_id', '')::uuid
  );
  _src text := COALESCE(NULLIF(trim(_source), ''), 'practice');
  _m jsonb := COALESCE(_meta, '{}'::jsonb);
  _school uuid;
  _board text;
  _stream text;
  _practice_mode text;
  _source_id uuid;
  _solution_viewed boolean := COALESCE((_m->>'solution_viewed')::boolean, false);
  _confidence numeric := NULLIF(_m->>'confidence', '')::numeric;
  _attempt_number int := NULLIF(_m->>'attempt_number', '')::int;
  _timed_out boolean := COALESCE((_m->>'timed_out')::boolean, false);
  _answered_at timestamptz := COALESCE(NULLIF(_m->>'answered_at', '')::timestamptz, now());
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT id, school_id INTO _sid, _school
  FROM public.students WHERE user_id = _uid LIMIT 1;

  SELECT * INTO _ps
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = _uid;

  IF _ps IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  _school := COALESCE(
    NULLIF(_m->>'school_id', '')::uuid,
    _ps.school_id,
    _school
  );
  _board := COALESCE(NULLIF(_m->>'board', ''), _ps.board);
  _stream := COALESCE(NULLIF(_m->>'stream', ''), _ps.stream);
  _practice_mode := COALESCE(
    NULLIF(_m->>'practice_mode', ''),
    _ps.practice_mode,
    NULLIF(_generated_question->>'practice_mode', '')
  );
  _source_id := COALESCE(
    NULLIF(_m->>'source_id', '')::uuid,
    _session_id
  );
  -- A topic string from the client is honoured ONLY for a question that is not
  -- in the bank. A bank question's topic is the bank's (below): a client that
  -- sends a stale or display-cleaned label must not file the attempt under a
  -- topic the question does not belong to.
  _topic := COALESCE(
    NULLIF(_m->>'topic', ''),
    NULLIF(_generated_question->>'topic', '')
  );
  IF _m ? 'hint_used' THEN
    _hint_used := COALESCE((_m->>'hint_used')::boolean, _hint_used);
  END IF;

  -- Same-session re-entry: update the existing attempt and return early, so
  -- counters are not double-counted within one session.
  IF _bank_id IS NOT NULL THEN
    SELECT id INTO _aid
    FROM public.question_attempts
    WHERE session_id = _session_id
      AND user_id = _uid
      AND bank_question_id = _bank_id
    LIMIT 1;
    IF _aid IS NOT NULL THEN
      UPDATE public.question_attempts SET
        hint_used = hint_used OR COALESCE(_hint_used, false),
        solution_viewed = solution_viewed OR _solution_viewed,
        timed_out = timed_out OR _timed_out,
        time_taken_ms = COALESCE(time_taken_ms, _time_taken_ms),
        confidence = COALESCE(confidence, _confidence),
        attempt_number = COALESCE(attempt_number, _attempt_number),
        practice_mode = COALESCE(practice_mode, _practice_mode),
        board = COALESCE(board, _board),
        stream = COALESCE(stream, _stream),
        class_level = COALESCE(class_level, NULLIF(_m->>'class_level', '')::int, _ps.class_level),
        school_id = COALESCE(school_id, _school),
        source_id = COALESCE(source_id, _source_id),
        answered_at = COALESCE(answered_at, _answered_at)
      WHERE id = _aid;
      RETURN _aid;
    END IF;
  END IF;

  -- Same fix, for the template path (bank_id IS NULL): Class12MathSession.tsx
  -- / Class12AiSession.tsx persist each answer live via
  -- recordPracticeAttemptBestEffort, then rpc_finish_practice_session
  -- unconditionally re-sends the same attempt again at session finish. The
  -- bank-path check above can't catch this (bank_question_id is null for a
  -- template attempt by definition) -- attempt_number is the equivalent
  -- natural key here, set by the client on every attempt regardless of
  -- source.
  IF _bank_id IS NULL AND _attempt_number IS NOT NULL THEN
    SELECT id INTO _aid
    FROM public.question_attempts
    WHERE session_id = _session_id
      AND user_id = _uid
      AND bank_question_id IS NULL
      AND attempt_number = _attempt_number
    LIMIT 1;
    IF _aid IS NOT NULL THEN
      UPDATE public.question_attempts SET
        hint_used = hint_used OR COALESCE(_hint_used, false),
        solution_viewed = solution_viewed OR _solution_viewed,
        timed_out = timed_out OR _timed_out,
        time_taken_ms = COALESCE(time_taken_ms, _time_taken_ms),
        confidence = COALESCE(confidence, _confidence),
        practice_mode = COALESCE(practice_mode, _practice_mode),
        topic = COALESCE(topic, _topic),
        board = COALESCE(board, _board),
        stream = COALESCE(stream, _stream),
        school_id = COALESCE(school_id, _school),
        source_id = COALESCE(source_id, _source_id),
        answered_at = COALESCE(answered_at, _answered_at)
      WHERE id = _aid;
      RETURN _aid;
    END IF;
  END IF;

  IF _bank_id IS NOT NULL THEN
    SELECT * INTO _grade
    FROM public._practice_grade_from_bank(_bank_id, COALESCE(_selected_answer, '{}'::jsonb), _correct_answer);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_question_not_found';
    END IF;
    IF COALESCE(_skipped, false) OR _timed_out THEN
      _resolved_correct := false;
      _resolved_score := 0;
    ELSE
      _resolved_correct := _grade.is_correct;
      _resolved_score := _grade.score;
    END IF;
    _resolved_correct_answer := _grade.correct_answer;
    _subject := COALESCE(_grade.subject, _ps.subject, 'General');
    _chapter := COALESCE(_grade.chapter, _ps.chapter);
    -- The bank's topic, and nothing the client said. Mastery and mistakes key
    -- on it (as concept, with subconcept = concept, the shape this function
    -- has always written).
    _topic := COALESCE(_grade.topic, _chapter);
    _concept_f := COALESCE(_grade.topic, _chapter, _subject);
    _sub_f := _concept_f;
    _class := COALESCE(
      NULLIF(_m->>'class_level', '')::int,
      _grade.class_level,
      _ps.class_level,
      12
    );
    _difficulty := COALESCE(NULLIF(_m->>'difficulty', ''), _grade.difficulty, 'medium');
    _explanation := COALESCE(_grade.explanation, '');
    IF COALESCE(_generated_question->>'question', '') = '' THEN
      _generated_question := jsonb_build_object(
        'question', _grade.question_text,
        'options', _grade.options,
        'explanation', _explanation,
        'bank_question_id', _bank_id,
        'subject', _subject,
        'chapter', _chapter,
        'topic', _topic,
        'topic_id', _grade.topic_id,
        'difficulty', _difficulty,
        'practice_mode', _practice_mode
      );
    ELSE
      _generated_question := COALESCE(_generated_question, '{}'::jsonb)
        - 'concept'
        || jsonb_build_object(
          'bank_question_id', _bank_id,
          'explanation', COALESCE(_generated_question->>'explanation', _explanation),
          'subject', COALESCE(_generated_question->>'subject', _subject),
          'chapter', COALESCE(_generated_question->>'chapter', _chapter),
          'topic', _topic,
          'topic_id', _grade.topic_id,
          'practice_mode', COALESCE(_generated_question->>'practice_mode', _practice_mode)
        );
    END IF;
  ELSE
    IF _template_id IS NOT NULL THEN
      SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
    END IF;
    _subject := COALESCE(
      NULLIF(_generated_question->>'subject', ''),
      _tm.subject, _ps.subject, 'General'
    );
    _chapter := COALESCE(
      NULLIF(_generated_question->>'chapter', ''),
      _tm.chapter, _ps.chapter
    );
    _topic := COALESCE(_topic, NULLIF(_generated_question->>'topic', ''), _tm.chapter, _chapter);
    _concept_f := COALESCE(
      NULLIF(_generated_question->>'concept', ''),
      _tm.concept, _tm.chapter, _ps.chapter, _ps.subject
    );
    _sub_f := COALESCE(_tm.subconcept, _concept_f);
    _class := COALESCE(
      NULLIF(_m->>'class_level', '')::int,
      _tm.class, _ps.class_level, 12
    );
    _difficulty := COALESCE(
      NULLIF(_m->>'difficulty', ''),
      _tm.difficulty, _tm.template_data->>'difficulty', 'medium'
    );
    _resolved_correct := CASE
      WHEN COALESCE(_skipped, false) OR _timed_out THEN false
      ELSE COALESCE(_is_correct, false)
    END;
    _resolved_score := CASE WHEN _resolved_correct THEN COALESCE(_score, 1) ELSE 0 END;
    _resolved_correct_answer := COALESCE(_correct_answer, '{}'::jsonb);
  END IF;

  IF COALESCE(_skipped, false) OR _timed_out THEN
    _resolved_correct := false;
    _resolved_score := 0;
    _skipped := true;
  END IF;

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, school_id, template_id, bank_question_id,
    generated_question, selected_answer, correct_answer, score, is_correct,
    time_taken_ms, skipped, subject, chapter, topic, concept, subconcept, difficulty,
    hint_used, solution_viewed, confidence, attempt_number, source, source_id,
    practice_mode, class_level, board, stream, timed_out, answered_at
  ) VALUES (
    _session_id, _sid, _uid, _school, _template_id, _bank_id,
    COALESCE(_generated_question, '{}'::jsonb),
    COALESCE(_selected_answer, '{}'::jsonb),
    _resolved_correct_answer,
    _resolved_score,
    _resolved_correct,
    _time_taken_ms,
    COALESCE(_skipped, false),
    _subject, _chapter, _topic, _concept_f, _sub_f, _difficulty,
    COALESCE(_hint_used, false),
    _solution_viewed,
    _confidence,
    _attempt_number,
    _src,
    _source_id,
    _practice_mode,
    _class,
    _board,
    _stream,
    _timed_out,
    _answered_at
  ) RETURNING id INTO _aid;

  IF _resolved_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1,
          score = score + COALESCE(_resolved_score, 1)
      WHERE id = _session_id AND user_id = _uid;
    PERFORM public._upsert_concept_mastery(
      _uid, _sid, _class, _subject, _chapter, _concept_f, _sub_f, true, false
    );
    BEGIN
      PERFORM public.rpc_refresh_academic_brain();
    EXCEPTION WHEN others THEN
      NULL;
    END;
  ELSIF NOT COALESCE(_skipped, false) THEN
    _explanation := COALESCE(
      NULLIF(_explanation, ''),
      NULLIF(_generated_question->>'explanation', ''),
      ''
    );
    IF _explanation = '' AND _template_id IS NOT NULL THEN
      SELECT explanation_template INTO _explanation
      FROM public.question_templates WHERE id = _template_id LIMIT 1;
    END IF;
    _explanation := COALESCE(_explanation, '');
    PERFORM public.rpc_record_concept_mistake(
      'practice', _session_id, _bank_id,
      _subject, _chapter, _concept_f, _sub_f, _class,
      COALESCE(_generated_question->>'question', ''),
      COALESCE(_generated_question->'options', '[]'::jsonb),
      COALESCE(_selected_answer, '{}'::jsonb),
      _resolved_correct_answer,
      _explanation
    );
  END IF;

  RETURN _aid;
END;
$function$;


CREATE OR REPLACE FUNCTION public._recompute_concept_confidence_for_session(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
  _sid uuid;
BEGIN
  SELECT user_id, student_id
  INTO _uid, _sid
  FROM public.practice_sessions
  WHERE id = _session_id;

  IF _uid IS NULL THEN RETURN; END IF;

  WITH touched AS (
    -- The topics this session touched, keyed the way concept_mastery is
    -- (subject, chapter text, concept = topic name, subconcept = concept).
    SELECT DISTINCT
      qb.topic_id,
      COALESCE(qb.subject, 'General') AS subject,
      qb.chapter                      AS chapter,
      t.name                          AS topic
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    JOIN public.topics t         ON t.id = qb.topic_id
    WHERE qa.session_id = _session_id
      AND qa.user_id = _uid
      AND qa.bank_question_id IS NOT NULL
  ),
  agg AS (
    -- Confidence spans ALL of the student's attempts in each touched topic,
    -- not just this session, so fixing an old mistake raises the score.
    SELECT
      t.subject, t.chapter, t.topic,
      max(qb.class_level)                                 AS class_level,
      count(*)::int                                       AS attempted,
      count(*) FILTER (WHERE qr.is_correct IS TRUE)::int  AS correct
    FROM touched t
    JOIN public.question_bank qb     ON qb.topic_id = t.topic_id
    JOIN public.question_attempts qr ON qr.bank_question_id = qb.id AND qr.user_id = _uid
    GROUP BY t.subject, t.chapter, t.topic
  )
  INSERT INTO public.concept_mastery AS cm (
    user_id, student_id, class_level, subject, chapter, concept, subconcept,
    confidence_score, total_attempts, correct_attempts, last_attempt_at, updated_at
  )
  SELECT
    _uid, _sid, a.class_level, a.subject, a.chapter, a.topic, a.topic,
    round((a.correct::numeric / a.attempted) * 100, 1),
    a.attempted, a.correct, now(), now()
  FROM agg a
  WHERE a.attempted > 0
  -- Must match the expression index concept_mastery_user_concept exactly.
  ON CONFLICT (user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, ''))
  DO UPDATE SET
    confidence_score = EXCLUDED.confidence_score,
    total_attempts   = EXCLUDED.total_attempts,
    correct_attempts = EXCLUDED.correct_attempts,
    student_id       = COALESCE(EXCLUDED.student_id, cm.student_id),
    class_level      = COALESCE(EXCLUDED.class_level, cm.class_level),
    last_attempt_at  = now(),
    updated_at       = now();
    -- mastery_score deliberately untouched: still owned by _upsert_concept_mastery.
END;
$function$;


DROP FUNCTION public.rpc_backfill_question_concepts();
DROP FUNCTION public._backfill_question_bank_concepts();
DROP FUNCTION public._backfill_battle_question_concepts();
DROP FUNCTION public._backfill_template_concepts();


-- ── 5. The columns go ───────────────────────────────────────────────────────

DROP INDEX public.idx_qb_topic_subtopic;
DROP INDEX public.question_bank_chapter_topic_group_idx;
DROP INDEX public.question_bank_subject_chapter_topic_group_idx;

ALTER TABLE public.question_bank
  DROP COLUMN topic,
  DROP COLUMN concept,
  DROP COLUMN subconcept,
  DROP COLUMN subtopic,
  DROP COLUMN topic_group;


-- ── 6. Proof ────────────────────────────────────────────────────────────────

DO $proof$
DECLARE
  _before  bigint;
  _after   bigint;
  _control bigint;
  _q       public.question_bank%ROWTYPE;
  _g       record;
  _cur     jsonb;
  _m       record;
  _missing text;
BEGIN
  -- The columns are gone, and nothing named like them is left on the table.
  SELECT string_agg(column_name, ',') INTO _missing
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'question_bank'
     AND column_name IN ('topic', 'concept', 'subconcept', 'subtopic', 'topic_group');
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'proof: question_bank still has %', _missing;
  END IF;

  -- No copy downstream still carries an old bank label.
  SELECT n INTO _before FROM public._stale_counts_20261020 WHERE what = 'before';
  SELECT (
      (SELECT count(*) FROM public.question_attempts qa JOIN public._label_topic_map_20261020 m
         ON m.subject = qa.subject AND m.chapter IS NOT DISTINCT FROM qa.chapter
        AND m.label IN (qa.topic, qa.concept, qa.subconcept) AND m.label <> m.topic_name)
    + (SELECT count(*) FROM public.student_mistakes sm JOIN public._label_topic_map_20261020 m
         ON m.subject = sm.subject AND m.chapter IS NOT DISTINCT FROM sm.chapter
        AND m.label IN (sm.topic, sm.concept, sm.subconcept) AND m.label <> m.topic_name)
    + (SELECT count(*) FROM public.concept_mastery cm JOIN public._label_topic_map_20261020 m
         ON m.subject = cm.subject AND m.chapter IS NOT DISTINCT FROM cm.chapter
        AND m.label = cm.concept AND m.label <> m.topic_name)
    + (SELECT count(*) FROM public.revision_queue rq JOIN public._label_topic_map_20261020 m
         ON m.subject = rq.subject AND m.chapter IS NOT DISTINCT FROM rq.chapter
        AND m.label = rq.topic AND m.label <> m.topic_name)) INTO _after;
  -- Control: the counter saw stale labels before the remap. A counter that
  -- reads zero on both sides has proved nothing.
  IF _before = 0 THEN
    RAISE EXCEPTION 'proof control: no stale labels were counted before the remap — the counter is blind';
  END IF;
  IF _after <> 0 THEN
    RAISE EXCEPTION 'proof: % downstream rows still carry an old label (were %)', _after, _before;
  END IF;

  -- Merging mastery rows lost no attempts.
  SELECT n INTO _before FROM public._stale_counts_20261020 WHERE what = 'mastery_attempts_before';
  SELECT COALESCE(sum(total_attempts), 0) INTO _after FROM public.concept_mastery;
  IF _after <> _before THEN
    RAISE EXCEPTION 'proof: concept_mastery attempts were % and are now %', _before, _after;
  END IF;
  IF EXISTS (SELECT 1 FROM public.concept_mastery
              GROUP BY user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, '') HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'proof: a mastery key is duplicated after the merge';
  END IF;

  -- Grading returns the question's real topic.
  SELECT qb.* INTO _q FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.options IS NOT NULL AND qb.topic_id IS NOT NULL
   ORDER BY qb.id LIMIT 1;
  SELECT * INTO _g FROM public._practice_grade_from_bank(_q.id, jsonb_build_object('index', _q.correct_index));
  IF _g.topic_id IS DISTINCT FROM _q.topic_id
     OR _g.topic IS DISTINCT FROM (SELECT name FROM public.topics WHERE id = _q.topic_id)
     OR _g.is_correct IS NOT TRUE THEN
    RAISE EXCEPTION 'proof: _practice_grade_from_bank returned % for question %', to_jsonb(_g), _q.id;
  END IF;
  -- Control: a wrong answer grades wrong through the same call.
  SELECT * INTO _g FROM public._practice_grade_from_bank(_q.id, jsonb_build_object('index', _q.correct_index + 1));
  IF _g.is_correct IS NOT FALSE THEN
    RAISE EXCEPTION 'proof control: a wrong answer graded %', _g.is_correct;
  END IF;

  -- The battle picker lists real topics of real chapters, and only those.
  _cur := public.rpc_battle_curriculum(_q.subject, NULL);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_cur) e
                  WHERE e->>'topic' = (SELECT name FROM public.topics WHERE id = _q.topic_id)) THEN
    RAISE EXCEPTION 'proof: rpc_battle_curriculum(%) does not list the topic of question %', _q.subject, _q.id;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_cur) e
              WHERE e->>'topic' IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.topics t WHERE t.name = e->>'topic')) THEN
    RAISE EXCEPTION 'proof: rpc_battle_curriculum lists a topic that is not a topics row';
  END IF;

  -- The semantic path finds a question by its own vector, with its topic.
  -- Asked as a school on the question's board: with no school the function
  -- narrows to board-agnostic rows by design (G14), which would hide it.
  SELECT * INTO _m FROM public.match_question_bank(
      (SELECT embedding FROM public.question_bank WHERE id = _q.id), _q.class_level,
      (SELECT s.id FROM public.schools s WHERE s.board = _q.board OR _q.board = 'both' ORDER BY s.id LIMIT 1),
      NULL, 0.99, 1);
  IF _m.id IS DISTINCT FROM _q.id OR _m.topic_id IS DISTINCT FROM _q.topic_id THEN
    RAISE EXCEPTION 'proof: match_question_bank did not return question % with its topic (got %)', _q.id, to_jsonb(_m);
  END IF;

  -- The dropped functions are gone.
  IF to_regprocedure('public.rpc_battle_curriculum(text)') IS NOT NULL
     OR to_regprocedure('public.rpc_backfill_question_concepts()') IS NOT NULL THEN
    RAISE EXCEPTION 'proof: a function meant to be dropped still exists';
  END IF;

  -- Grants on the recreated functions are what they were.
  IF NOT has_function_privilege('authenticated', 'public.match_question_bank(vector,integer,uuid,text[],double precision,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.match_question_bank(vector,integer,uuid,text[],double precision,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._practice_grade_from_bank(uuid,jsonb,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public._practice_grade_from_bank(uuid,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'proof: grants on the recreated functions changed';
  END IF;
END
$proof$;

DROP TABLE public._label_topic_map_20261020;
DROP TABLE public._stale_counts_20261020;
DROP TABLE public._rq_target_20261020;
DROP TABLE public._cm_target_20261020;
DROP TABLE public._cm_merge_20261020;

COMMIT;
