-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Chunk 7B batch 2e + its floor-timing fix
--   20260829100000_chunk7b_batch2e_item_difficulty
--   20260829110000_chunk7b_batch2e_fix_floor_timing
--
-- Reverses both together, because the fix only edits a block the first one
-- inserted; rolling back 2e alone would leave nothing for the fix to have
-- fixed.
--
-- LIMIT — reverting rpc_battle_monitor to live aggregation REINTRODUCES A
-- KNOWN BUG. Batch 2c purges correct battle_answers rows when a participant
-- finishes, so recomputing item difficulty from that table reports every
-- question at 0% correct once a battle ends. That reads as a teaching signal
-- ("the class got everything wrong") rather than as a defect, which is what
-- makes it worth stating here rather than discovering later.
--
-- The stored aggregates are dropped with the table. They can be rebuilt for
-- any battle that still HAS its answers, but for finished battles the correct
-- rows are gone, so the aggregate is not recoverable. Nothing is lost that the
-- app shows: below 5 participants nothing was shown anyway.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. rpc_finish_battle — drop accumulation and the floor block ───────────
DO $undo$
DECLARE _def text; _new text; _n int := 0;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_battle';
  IF _def IS NULL THEN RAISE EXCEPTION 'batch 2e rollback: rpc_finish_battle not found.'; END IF;

  -- Literal removal, not a regex: on this exact function a lazy quantifier
  -- previously consumed its closing END. Everything from the accumulation
  -- comment down to the blank line before the 2c purge comment.
  _new := regexp_replace(
    _def,
    '  -- §10\.8 item difficulty\. Accumulated HERE.*?  -- §10\.8 transient rule',
    '  -- §10.8 transient rule',
    's'
  );

  IF _new = _def THEN
    RAISE EXCEPTION 'batch 2e rollback: could not find the accumulation + floor blocks. Inspect pg_get_functiondef(''public.rpc_finish_battle''::regproc) and remove them by hand rather than guessing.';
  END IF;

  EXECUTE _new;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='rpc_finish_battle'
       AND p.prosrc ~ 'battle_question_stats'
  ) THEN
    RAISE EXCEPTION 'batch 2e rollback: rpc_finish_battle still references battle_question_stats.';
  END IF;
END
$undo$;

-- ── 2. rpc_battle_monitor — back to live aggregation (see LIMIT above) ─────
DO $mon$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_battle_monitor';
  IF _def IS NULL THEN RAISE EXCEPTION 'batch 2e rollback: rpc_battle_monitor not found.'; END IF;

  _new := regexp_replace(
    _def,
    '      -- Chunk 7B batch 2e: read the stored aggregate.*?ON s\.question_id = q\.id AND s\.battle_id = _battle_id\n',
    E'      LEFT JOIN (\n'
    || E'        SELECT ba.question_id,\n'
    || E'               count(*) AS attempts,\n'
    || E'               count(*) FILTER (WHERE ba.is_correct) AS correct\n'
    || E'        FROM public.battle_answers ba\n'
    || E'        JOIN public.battle_questions bq2 ON bq2.id = ba.question_id\n'
    || E'        WHERE bq2.battle_id = _battle_id\n'
    || E'        GROUP BY ba.question_id\n'
    || E'      ) s ON s.question_id = q.id\n',
    's'
  );

  IF _new = _def THEN
    RAISE EXCEPTION 'batch 2e rollback: could not repoint rpc_battle_monitor back onto battle_answers.';
  END IF;

  EXECUTE _new;
END
$mon$;

-- ── 3. The table ───────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.battle_question_stats;

COMMIT;
