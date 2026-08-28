-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7B — BATCH 2e: item difficulty, at a participant floor
--
-- §10.8, as ruled:
--
--   "Compute the aggregate at battle finish, store the aggregate, then purge
--    the per-question rows. Item difficulty survives; per-student correctness
--    does not."
--
--   "Per-question attempts-and-correct across participants may be shown only
--    when the battle had 5 or more participants. Below that it identifies
--    individuals — in a two-person battle it is simply two students' answers
--    with a chart around them."
--
-- ── The bug this also fixes ────────────────────────────────────────────────
--
-- rpc_battle_monitor computed item difficulty LIVE from battle_answers. Batch
-- 2c then started deleting correct rows when a participant finishes. So after
-- a battle ended the monitor reported every question at 0% correct — not a
-- privacy bug, a correctness one, and one that would have looked like a
-- teaching signal ("the class got everything wrong") rather than a defect.
-- Reading a stored aggregate instead fixes it by construction.
--
-- ── Why accumulate per participant rather than once at the end ─────────────
--
-- The purge is per participant, at their own finish. By the time the LAST
-- participant finishes, the earlier ones' correct rows are already gone, so a
-- single aggregate computed at battle close would undercount every finisher
-- but the last. The aggregate is therefore accumulated at each participant's
-- finish, immediately BEFORE their purge, while their rows still exist.
--
-- ── The floor is enforced by deletion, not only by hiding ──────────────────
--
-- The doc says "nothing is shown" below 5. Hiding at read time would leave a
-- two-person aggregate sitting in the table, and "1 of 2 correct" plus one
-- participant's knowledge of their own answer discloses the other's exactly.
-- So when a battle closes below the floor its stats rows are DELETED. Nothing
-- shown, and nothing retained to show later.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The aggregate ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.battle_question_stats (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id    uuid NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
  question_id  uuid NOT NULL REFERENCES public.battle_questions(id) ON DELETE CASCADE,
  school_id    uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  correct      integer NOT NULL DEFAULT 0 CHECK (correct >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battle_question_stats_correct_le_attempts CHECK (correct <= attempts),
  CONSTRAINT battle_question_stats_unique UNIQUE (battle_id, question_id)
);

CREATE INDEX IF NOT EXISTS battle_question_stats_battle_idx
  ON public.battle_question_stats (battle_id);

-- ── 2. RLS — the 6.6/6.7 pattern ───────────────────────────────────────────
-- No per-student rows here at all: the grain is (battle, question), so there
-- is no owner to fence to. The institution fence is the whole fence, and the
-- participant floor below is what keeps a small battle from being readable as
-- individual answers.
ALTER TABLE public.battle_question_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY battle_question_stats_tenant_fence ON public.battle_question_stats
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IN (SELECT public.my_accessible_school_ids()));

CREATE POLICY battle_question_stats_read ON public.battle_question_stats
  FOR SELECT TO authenticated
  USING (school_id IN (SELECT public.my_accessible_school_ids()));

-- ── 3. Accumulate at each participant's finish, before their purge ─────────
-- Inserted immediately ahead of the 2c purge block, matched literally. A
-- regex was tried here first and is not used: on this same function a lazy
-- quantifier previously consumed its closing END.
DO $accum$
DECLARE _def text; _new text; _anchor text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_battle';

  IF _def IS NULL THEN RAISE EXCEPTION 'batch 2e: rpc_finish_battle not found.'; END IF;

  _anchor := E'  -- §10.8 transient rule: per-question correctness may exist while the\n';

  IF position(_anchor in _def) = 0 THEN
    RAISE EXCEPTION 'batch 2e: the batch 2c purge block is not where this migration expects it. Re-read rpc_finish_battle rather than inserting blind.';
  END IF;

  _new := replace(
    _def,
    _anchor,
    E'  -- §10.8 item difficulty. Accumulated HERE, before the purge below, because\n'
    || E'  -- the purge is per participant: by the last finisher, earlier participants''\n'
    || E'  -- correct rows are already gone, so a single end-of-battle aggregate would\n'
    || E'  -- undercount everyone but the last.\n'
    || E'  BEGIN\n'
    || E'    INSERT INTO public.battle_question_stats (battle_id, question_id, school_id, attempts, correct)\n'
    || E'    SELECT _battle, ba.question_id, b.school_id,\n'
    || E'           count(*)::int,\n'
    || E'           count(*) FILTER (WHERE ba.is_correct IS TRUE)::int\n'
    || E'      FROM public.battle_answers ba\n'
    || E'      JOIN public.battles b ON b.id = _battle\n'
    || E'     WHERE ba.participant_id = _participant_id\n'
    || E'     GROUP BY ba.question_id, b.school_id\n'
    || E'    ON CONFLICT (battle_id, question_id) DO UPDATE SET\n'
    || E'      attempts   = public.battle_question_stats.attempts + EXCLUDED.attempts,\n'
    || E'      correct    = public.battle_question_stats.correct  + EXCLUDED.correct,\n'
    || E'      updated_at = now();\n'
    || E'  EXCEPTION WHEN OTHERS THEN\n'
    || E'    RAISE WARNING ''rpc_finish_battle(%): item-difficulty accumulation failed: %'', _participant_id, SQLERRM;\n'
    || E'  END;\n'
    || E'\n'
    || E'  -- §10.8 the participant floor. Item difficulty is only shown at 5 or more\n'
    || E'  -- participants; below that it is individual answers with a chart around\n'
    || E'  -- them. Enforced by DELETING rather than by hiding, so a two-person\n'
    || E'  -- aggregate is not left sitting in the table to be read later.\n'
    || E'  BEGIN\n'
    || E'    IF (SELECT count(*) FROM public.battle_participants WHERE battle_id = _battle) < 5 THEN\n'
    || E'      DELETE FROM public.battle_question_stats WHERE battle_id = _battle;\n'
    || E'    END IF;\n'
    || E'  EXCEPTION WHEN OTHERS THEN\n'
    || E'    RAISE WARNING ''rpc_finish_battle(%): participant-floor enforcement failed: %'', _participant_id, SQLERRM;\n'
    || E'  END;\n'
    || E'\n'
    || _anchor
  );

  IF _new = _def THEN
    RAISE EXCEPTION 'batch 2e: could not insert the accumulation block into rpc_finish_battle.';
  END IF;

  EXECUTE _new;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='rpc_finish_battle'
       AND p.prosrc ~ 'battle_question_stats'
  ) THEN
    RAISE EXCEPTION 'batch 2e: accumulation is not present in rpc_finish_battle after the rewrite.';
  END IF;
END
$accum$;

-- ── 4. rpc_battle_monitor reads the stored aggregate ───────────────────────
-- Replaces the live aggregation over battle_answers, which now reports 0%
-- after a battle ends because the correct rows have been purged.
DO $mon$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_battle_monitor';

  IF _def IS NULL THEN RAISE EXCEPTION 'batch 2e: rpc_battle_monitor not found.'; END IF;

  _new := replace(
    _def,
    E'      LEFT JOIN (\n'
    || E'        SELECT ba.question_id,\n'
    || E'               count(*) AS attempts,\n'
    || E'               count(*) FILTER (WHERE ba.is_correct) AS correct\n'
    || E'        FROM public.battle_answers ba\n'
    || E'        JOIN public.battle_questions bq2 ON bq2.id = ba.question_id\n'
    || E'        WHERE bq2.battle_id = _battle_id\n'
    || E'        GROUP BY ba.question_id\n'
    || E'      ) s ON s.question_id = q.id\n',
    E'      -- Chunk 7B batch 2e: read the stored aggregate rather than\n'
    || E'      -- recomputing from battle_answers. The live version reported every\n'
    || E'      -- question at 0% once a battle ended, because batch 2c purges the\n'
    || E'      -- correct rows at finish. Rows exist here only for battles that\n'
    || E'      -- reached 5 participants, so a small battle shows nothing at all.\n'
    || E'      LEFT JOIN public.battle_question_stats s\n'
    || E'             ON s.question_id = q.id AND s.battle_id = _battle_id\n'
  );

  IF _new = _def THEN
    RAISE EXCEPTION 'batch 2e: could not repoint rpc_battle_monitor onto battle_question_stats.';
  END IF;

  EXECUTE _new;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='rpc_battle_monitor'
       AND p.prosrc ~ 'FILTER \(WHERE ba\.is_correct\)'
  ) THEN
    RAISE EXCEPTION 'batch 2e: rpc_battle_monitor still aggregates battle_answers directly.';
  END IF;
END
$mon$;

COMMIT;
