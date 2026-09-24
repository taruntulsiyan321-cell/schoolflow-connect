-- Rollback for 20261020010000_the_old_topic_labels_leave_the_bank.sql
--
-- Restores the SHAPE the migration removed: the five question_bank columns and
-- their indexes, question_paper_sections.topics, and every function body as it
-- was live immediately before the migration (dumped from pg_get_functiondef on
-- 2026-09-15, before apply).
--
-- WHAT IT CANNOT RESTORE: the old label VALUES. Removing them was the owner's
-- instruction, and they are not kept anywhere in the database. The restored
-- columns come back NULL. topic_id (20261020000000) still carries every
-- question's topic, so nothing a student can see is lost by rolling back — the
-- old functions simply read NULL labels. Merged concept_mastery rows stay
-- merged; their attempt totals were proven unchanged by the migration.
--
-- Apply AFTER rolling back any client or edge-function deploy that reads the
-- new shapes (question_paper_sections.topic_ids, _practice_grade_from_bank's
-- topic columns, match_question_bank's topic_id).

BEGIN;

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text,
  ADD COLUMN IF NOT EXISTS subtopic text,
  ADD COLUMN IF NOT EXISTS topic_group text;

CREATE INDEX IF NOT EXISTS idx_qb_topic_subtopic ON public.question_bank USING btree (subject, chapter, topic) WHERE is_approved;
CREATE INDEX IF NOT EXISTS question_bank_chapter_topic_group_idx ON public.question_bank USING btree (chapter_id, topic_group) WHERE (topic_group IS NOT NULL);
CREATE INDEX IF NOT EXISTS question_bank_subject_chapter_topic_group_idx ON public.question_bank USING btree (subject, chapter, topic_group) WHERE (topic_group IS NOT NULL);

ALTER TABLE public.question_paper_sections
  ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{}'::text[];
UPDATE public.question_paper_sections sec
   SET topics = COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM public.topics t WHERE t.id = ANY (sec.topic_ids)), '{}'::text[])
 WHERE cardinality(sec.topic_ids) > 0;
ALTER TABLE public.question_paper_sections DROP COLUMN IF EXISTS topic_ids;

DROP FUNCTION IF EXISTS public.match_question_bank(vector, integer, uuid, text[], double precision, integer);
CREATE OR REPLACE FUNCTION public.match_question_bank(p_query_embedding vector, p_class_level integer, p_school_id uuid DEFAULT NULL::uuid, p_subjects text[] DEFAULT NULL::text[], p_match_threshold double precision DEFAULT 0.82, p_match_count integer DEFAULT 3)
 RETURNS TABLE(id uuid, question text, options jsonb, correct_index integer, explanation text, subject text, concept text, chapter text, topic text, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  -- question_bank has no school_id and is shared across all schools and all
  -- users by design -- §10.9, docs/locked-decisions.md:385. (This comment
  -- previously cited §4.2a, which is a different clause in a different
  -- document and governs variant generation, not cross-school sharing.)
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
  -- NULL there) and never true for the reference seed (created_by is NULL on
  -- all 21,696 rows), so it widens the result for exactly one caller: the
  -- teacher who wrote the question.
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.concept, qb.chapter, qb.topic,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
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

DROP FUNCTION IF EXISTS public._practice_grade_from_bank(uuid, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public._practice_grade_from_bank(_bank_question_id uuid, _selected_answer jsonb, _client_correct_answer jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(is_correct boolean, score numeric, correct_answer jsonb, subject text, chapter text, concept text, subconcept text, difficulty text, class_level integer, explanation text, question_text text, options jsonb)
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
  concept := COALESCE(_qb.concept, _qb.chapter, _qb.subject);
  subconcept := COALESCE(_qb.subconcept, _qb.concept, _qb.chapter);
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

CREATE OR REPLACE FUNCTION public.rpc_battle_curriculum(_subject text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('chapter', sub.chapter, 'topic', sub.topic)
    ORDER BY sub.chapter, sub.topic), '[]'::jsonb)
  FROM (
    SELECT DISTINCT
      COALESCE(NULLIF(trim(chapter), ''), 'General') AS chapter,
      NULLIF(trim(topic), '') AS topic
    FROM public.question_bank
    WHERE is_approved AND lower(subject) = lower(_subject)
  ) sub;
$function$;

REVOKE ALL ON FUNCTION public.rpc_battle_curriculum(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_battle_curriculum(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_battle_curriculum(_subject text, _class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'chapter', sub.chapter,
    'topic', sub.topic
  ) ORDER BY sub.chapter, sub.topic), '[]'::jsonb)
  FROM (
    SELECT DISTINCT
      COALESCE(NULLIF(trim(chapter), ''), 'General') AS chapter,
      NULLIF(trim(topic), '') AS topic
    FROM public.question_bank
    WHERE is_approved AND lower(subject) = lower(_subject)
      AND (
        _class_id IS NULL
        OR class_level IS NULL
        OR class_level = public._class_grade(_class_id)
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
      AND (_b.topic IS NULL OR q.topic ILIKE _b.topic)
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
      AND (_b.topic IS NULL OR q.topic ILIKE _b.topic)
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
          SELECT COALESCE(qb2.chapter, qb2.topic, 'General') AS lbl,
                 max(qb2.chapter) AS chapter, max(qb2.topic) AS topic,
                 count(*) FILTER (WHERE ba.is_correct) AS correct,
                 count(*) AS total
          FROM public.battle_answers ba
          JOIN public.battle_questions bq ON bq.id = ba.question_id
          LEFT JOIN public.question_bank qb2 ON qb2.id = bq.bank_question_id
          WHERE ba.participant_id = _participant_id
          GROUP BY COALESCE(qb2.chapter, qb2.topic, 'General')
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
        'chapter', qb.chapter, 'topic', qb.topic, 'explanation', qb.explanation
      ) ORDER BY bq.order_index)
      FROM public.battle_questions bq
      LEFT JOIN public.battle_answers ba
        ON ba.question_id = bq.id AND ba.participant_id = _participant_id
      LEFT JOIN public.question_bank qb ON qb.id = bq.bank_question_id
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
       -- The topic narrowing. Empty means the whole chapter set, exactly as
       -- an empty `chapters` means the whole subject. A row whose topic_group
       -- is NULL -- not yet classified -- is excluded only when the teacher
       -- actually named topics, so an unclassified bank still fills normally.
       AND (cardinality(sec.topics) = 0 OR qb.topic_group = ANY (sec.topics))
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
    'topics_requested', cardinality(sec.topics)
  );
END;
$function$;

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
        topic = COALESCE(topic, _topic),
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
    _topic := COALESCE(_topic, _grade.concept, _chapter);
    _concept_f := COALESCE(_grade.concept, _chapter, _subject);
    _sub_f := COALESCE(_grade.subconcept, _concept_f);
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
        'concept', _concept_f,
        'difficulty', _difficulty,
        'practice_mode', _practice_mode
      );
    ELSE
      _generated_question := COALESCE(_generated_question, '{}'::jsonb)
        || jsonb_build_object(
          'bank_question_id', _bank_id,
          'explanation', COALESCE(_generated_question->>'explanation', _explanation),
          'subject', COALESCE(_generated_question->>'subject', _subject),
          'chapter', COALESCE(_generated_question->>'chapter', _chapter),
          'topic', COALESCE(_generated_question->>'topic', _topic),
          'concept', COALESCE(_generated_question->>'concept', _concept_f),
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

  -- ▼ Practice Engine: project this attempt into current state.
  -- Runs for all three outcomes. Confidence is NOT computed here — it is
  -- recomputed once at session completion.
  IF _bank_id IS NOT NULL THEN
    -- Chunk 7B: question_records retired; per-question correctness is not stored.
  END IF;
  -- ▲

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
    -- Concept grain touched by this session, matching concept_mastery's key.
    SELECT DISTINCT
      COALESCE(qb.subject, 'General')                             AS subject,
      qb.chapter                                                  AS chapter,
      COALESCE(qb.concept, qb.chapter, qb.subject)                AS concept,
      COALESCE(qb.subconcept, qb.concept, qb.chapter, qb.subject) AS subconcept
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    WHERE qa.session_id = _session_id
      AND qa.user_id = _uid
      AND qa.bank_question_id IS NOT NULL
  ),
  agg AS (
    -- Confidence spans ALL of the student's records for each touched concept,
    -- not just this session, so fixing an old mistake raises the score.
    SELECT
      t.subject, t.chapter, t.concept, t.subconcept,
      max(qb.class_level)                                        AS class_level,
      count(*) FILTER (
        WHERE true
      )::int                                                     AS attempted,
      count(*) FILTER (
        WHERE qr.is_correct IS TRUE
      )::int                                                     AS correct
    FROM touched t
    JOIN public.question_bank qb
      ON COALESCE(qb.subject, 'General') = t.subject
     AND qb.chapter IS NOT DISTINCT FROM t.chapter
     AND COALESCE(qb.concept, qb.chapter, qb.subject) = t.concept
     AND COALESCE(qb.subconcept, qb.concept, qb.chapter, qb.subject) = t.subconcept
    JOIN public.question_attempts qr ON qr.bank_question_id = qb.id AND qr.user_id = _uid
    GROUP BY t.subject, t.chapter, t.concept, t.subconcept
  )
  INSERT INTO public.concept_mastery AS cm (
    user_id, student_id, class_level, subject, chapter, concept, subconcept,
    confidence_score, total_attempts, correct_attempts, last_attempt_at, updated_at
  )
  SELECT
    _uid, _sid, a.class_level, a.subject, a.chapter, a.concept, a.subconcept,
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

CREATE OR REPLACE FUNCTION public._backfill_question_bank_concepts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  UPDATE public.question_bank SET
    concept = COALESCE(NULLIF(concept, ''), NULLIF(topic, ''), NULLIF(chapter, ''), subject),
    subconcept = COALESCE(NULLIF(subconcept, ''), NULLIF(topic, ''), concept)
  WHERE concept IS NULL OR concept = '';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $function$;

CREATE OR REPLACE FUNCTION public._backfill_battle_question_concepts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  UPDATE public.battle_questions bq SET
    concept = v.new_concept,
    subconcept = v.new_subconcept
  FROM (
    SELECT
      bq2.id,
      COALESCE(NULLIF(bq2.concept, ''), NULLIF(qb.concept, ''), NULLIF(qb.topic, ''), NULLIF(b.chapter, ''), b.subject) AS new_concept,
      COALESCE(NULLIF(bq2.subconcept, ''), NULLIF(qb.subconcept, ''), NULLIF(qb.topic, ''), bq2.concept) AS new_subconcept
    FROM public.battle_questions bq2
    INNER JOIN public.battles b ON bq2.battle_id = b.id
    LEFT JOIN public.question_bank qb ON qb.id = bq2.bank_question_id
    WHERE bq2.concept IS NULL OR bq2.concept = ''
  ) v
  WHERE bq.id = v.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $function$;

CREATE OR REPLACE FUNCTION public._backfill_template_concepts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  UPDATE public.question_templates SET
    concept = COALESCE(NULLIF(concept, ''), chapter),
    subconcept = COALESCE(NULLIF(subconcept, ''), public._humanize_template_type(template_type))
  WHERE concept IS NULL OR concept = '';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_backfill_question_concepts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'principal') THEN
    RAISE EXCEPTION 'Admin or principal only';
  END IF;
  RETURN jsonb_build_object(
    'question_bank', public._backfill_question_bank_concepts(),
    'test_questions', public._backfill_test_question_concepts(),
    'battle_questions', public._backfill_battle_question_concepts(),
    'question_templates', public._backfill_template_concepts()
  );
END; $function$;

REVOKE ALL ON FUNCTION public._backfill_question_bank_concepts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._backfill_battle_question_concepts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._backfill_template_concepts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_backfill_question_concepts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._backfill_question_bank_concepts() TO service_role;
GRANT EXECUTE ON FUNCTION public._backfill_battle_question_concepts() TO service_role;
GRANT EXECUTE ON FUNCTION public._backfill_template_concepts() TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_backfill_question_concepts() TO service_role;

DELETE FROM public.schema_migrations WHERE version = '20261020010000_the_old_topic_labels_leave_the_bank';

DO $verify$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'question_bank'
         AND column_name IN ('topic', 'concept', 'subconcept', 'subtopic', 'topic_group')) <> 5 THEN
    RAISE EXCEPTION 'rollback: question_bank label columns were not all restored';
  END IF;
  IF to_regprocedure('public.rpc_battle_curriculum(text)') IS NULL THEN
    RAISE EXCEPTION 'rollback: rpc_battle_curriculum(text) was not restored';
  END IF;
END
$verify$;

COMMIT;
