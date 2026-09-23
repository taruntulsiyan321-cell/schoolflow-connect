-- A VARIANT'S MISTAKE BELONGS TO THE QUESTION IT CAME FROM.
--
-- 20261051000000 made this true going forward: `rpc_record_question_attempt`
-- keys a mistake on the SOURCE question, so failing a recovery variant marks
-- the original rather than minting a mistake nobody will ever be served
-- again. What it could not do is fix the rows already written.
--
-- Measured on production 2026-09-23:
--
--   student_mistakes rows keyed on a VARIANT ............ 10  (1 student)
--   of those, variants OF a variant (two deep) .......... 2
--   roots that ALSO have their own mistake row .......... 8 of 8
--
-- So the same gap is recorded twice — four times for one root that carries
-- three variant rows — and every count built on the mistake book inherits it:
-- the open-mistake total on Home, the recovery trigger (one mistake is enough
-- since 2026-09-15), the §6.3 chapter list, and "of those, repeated".
--
-- THE MERGE RULE, and it is the only one that loses nothing:
--   * the ROOT is the question at the top of the chain, walked all the way up
--     (a variant of a variant resolves to the original, not to its parent);
--   * times_wrong ADDS — the student really did get it wrong that many times;
--   * last_wrong_at is the LATEST and created_at the EARLIEST, because the
--     gap opened when it first showed and it is as recent as the last miss;
--   * the row is OPEN if any of its parts was open: a cleared variant does
--     not clear the mistake the student still has;
--   * a variant row whose root has no row of its own is REPOINTED rather than
--     deleted, so nothing is lost when the original was never missed directly.
--
-- Every row this touches is copied into `student_mistakes_variant_merge`
-- first, which is what makes the rollback exact rather than approximate.

CREATE TABLE IF NOT EXISTS public.student_mistakes_variant_merge (
  backed_up_at    timestamptz NOT NULL DEFAULT now(),
  merged_into     uuid,                 -- the root row that absorbed it, when it was absorbed
  row_data        jsonb       NOT NULL  -- the whole row, exactly as it stood
);

COMMENT ON TABLE public.student_mistakes_variant_merge IS
  'Rows 20261058000000 merged into their source question''s mistake. The rollback restores from here.';

ALTER TABLE public.student_mistakes_variant_merge ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.student_mistakes_variant_merge FROM PUBLIC, anon, authenticated;

DO $merge$
DECLARE
  _variant_rows  int;
  _merged        int := 0;
  _repointed     int := 0;
  _before_total  bigint;
  _after_total   bigint;
  _r             record;
BEGIN
  -- Every mistake keyed on a question that came from another question, with
  -- the top of its chain. The walk is recursive: a variant of a variant
  -- resolves to the original.
  CREATE TEMP TABLE _to_merge ON COMMIT DROP AS
  WITH RECURSIVE up(mistake_id, user_id, question_id, current_id, depth) AS (
    SELECT sm.id, sm.user_id, sm.question_id, qb.source_question_id, 1
      FROM public.student_mistakes sm
      JOIN public.question_bank qb ON qb.id = sm.question_id
     WHERE qb.source_question_id IS NOT NULL
    UNION ALL
    SELECT u.mistake_id, u.user_id, u.question_id, qb.source_question_id, u.depth + 1
      FROM up u
      JOIN public.question_bank qb ON qb.id = u.current_id
     WHERE qb.source_question_id IS NOT NULL
       AND u.depth < 10          -- a cycle cannot run away
  )
  SELECT DISTINCT ON (mistake_id)
         mistake_id, user_id, question_id AS variant_id, current_id AS root_id
    FROM up
   ORDER BY mistake_id, depth DESC;

  SELECT count(*) INTO _variant_rows FROM _to_merge;
  SELECT coalesce(sum(times_wrong), 0) INTO _before_total FROM public.student_mistakes;

  -- Everything about to change, kept whole.
  INSERT INTO public.student_mistakes_variant_merge (merged_into, row_data)
  SELECT (SELECT root.id FROM public.student_mistakes root
           WHERE root.user_id = m.user_id AND root.source = sm.source AND root.question_id = m.root_id LIMIT 1),
         to_jsonb(sm)
    FROM _to_merge m
    JOIN public.student_mistakes sm ON sm.id = m.mistake_id;

  -- ONE ROW PER (user, source, root question), because that is the key the
  -- table itself enforces (student_mistakes_user_source_q). A mistake made in
  -- practice and the same question missed in a test are deliberately separate
  -- rows (§8 keeps school data apart), so the merge never crosses `source`.
  --
  -- For each target key: the surviving row is the root's own if it has one,
  -- otherwise the OLDEST of its variant rows, repointed. Every other row in
  -- the group folds into it and goes.
  FOR _r IN
    SELECT m.user_id, sm.source, m.root_id,
           array_agg(sm.id ORDER BY sm.created_at) AS variant_rows
      FROM _to_merge m
      JOIN public.student_mistakes sm ON sm.id = m.mistake_id
     GROUP BY m.user_id, sm.source, m.root_id
  LOOP
    DECLARE
      _keep      uuid;
      _add_wrong int;
      _latest    timestamptz;
      _earliest  timestamptz;
      _any_open  boolean;
      _repoint   boolean := false;
    BEGIN
      SELECT root.id INTO _keep
        FROM public.student_mistakes root
       WHERE root.user_id = _r.user_id AND root.source = _r.source AND root.question_id = _r.root_id
       LIMIT 1;

      IF _keep IS NULL THEN
        _keep := _r.variant_rows[1];      -- the oldest variant row survives
        _repoint := true;
      END IF;

      SELECT coalesce(sum(sm.times_wrong), 0), max(sm.last_wrong_at), min(sm.created_at), bool_or(sm.status = 'open')
        INTO _add_wrong, _latest, _earliest, _any_open
        FROM public.student_mistakes sm
       WHERE sm.id = ANY (_r.variant_rows) AND sm.id <> _keep;

      IF _repoint THEN
        -- The question TEXT travels with the id, so it comes from the root
        -- question rather than being left describing a variant.
        UPDATE public.student_mistakes sm
           SET question_id    = _r.root_id,
               question_text  = COALESCE(qb.question, sm.question_text),
               options        = COALESCE(qb.options, sm.options),
               correct_answer = COALESCE(qb.options -> qb.correct_index, sm.correct_answer),
               explanation    = COALESCE(qb.explanation, sm.explanation),
               chapter_id     = COALESCE(qb.chapter_id, sm.chapter_id),
               chapter        = COALESCE(qb.chapter, sm.chapter),
               subject        = COALESCE(qb.subject, sm.subject),
               difficulty     = COALESCE(qb.difficulty, sm.difficulty)
          FROM public.question_bank qb
         WHERE sm.id = _keep AND qb.id = _r.root_id;
        _repointed := _repointed + 1;
      END IF;

      IF _add_wrong > 0 OR _latest IS NOT NULL OR _any_open THEN
        UPDATE public.student_mistakes r
           SET times_wrong   = r.times_wrong + COALESCE(_add_wrong, 0),
               last_wrong_at = GREATEST(COALESCE(r.last_wrong_at, _latest), COALESCE(_latest, r.last_wrong_at)),
               created_at    = LEAST(r.created_at, COALESCE(_earliest, r.created_at)),
               status        = CASE WHEN _any_open THEN 'open' ELSE r.status END
         WHERE r.id = _keep;
        _merged := _merged + 1;
      END IF;

      DELETE FROM public.student_mistakes sm
       WHERE sm.id = ANY (_r.variant_rows) AND sm.id <> _keep;
    END;
  END LOOP;

  SELECT coalesce(sum(times_wrong), 0) INTO _after_total FROM public.student_mistakes;

  -- ── THE PROOF ──────────────────────────────────────────────────────────
  --
  -- Nothing is lost and nothing is invented: every miss the student made is
  -- still counted, and no mistake is keyed on a variant any more. The third
  -- assertion is the control — a mistake on an ORIGINAL question must be
  -- exactly as it was, so this cannot have rewritten the book wholesale.
  IF _after_total <> _before_total THEN
    RAISE EXCEPTION 'times_wrong total changed: % before, % after — a merge must move misses, never mint or lose them',
      _before_total, _after_total;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.student_mistakes sm
      JOIN public.question_bank qb ON qb.id = sm.question_id
     WHERE qb.source_question_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'a mistake is still keyed on a variant';
  END IF;

  IF (SELECT count(*) FROM public.student_mistakes_variant_merge) <> _variant_rows THEN
    RAISE EXCEPTION 'the backup holds % rows for % merged', (SELECT count(*) FROM public.student_mistakes_variant_merge), _variant_rows;
  END IF;

  -- CONTROL: a row on an original question is untouched by all of this.
  IF EXISTS (
    SELECT 1 FROM public.student_mistakes_variant_merge b
     WHERE (b.row_data ->> 'id')::uuid IN (
       SELECT sm.id FROM public.student_mistakes sm
         JOIN public.question_bank qb ON qb.id = sm.question_id
        WHERE qb.source_question_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'the merge touched a mistake that was never keyed on a variant';
  END IF;

  RAISE NOTICE 'variant mistakes: % found, % roots absorbed them, % repointed, times_wrong total % unchanged',
    _variant_rows, _merged, _repointed, _after_total;
END
$merge$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261058000000_a_variant_mistake_belongs_to_the_question_it_came_from')
ON CONFLICT (version) DO NOTHING;
