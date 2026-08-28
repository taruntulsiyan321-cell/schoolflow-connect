-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7B — BATCH 2e FIX: the participant floor was evaluated too early
--
-- Batch 2e enforced the 5-participant floor inside rpc_finish_battle, on every
-- participant's finish:
--
--     IF (SELECT count(*) FROM battle_participants WHERE battle_id = _battle) < 5
--     THEN DELETE FROM battle_question_stats WHERE battle_id = _battle;
--
-- That is the right rule at the wrong moment. Participants finish one at a
-- time, and the count is taken at the moment of THAT finish — so in any battle
-- where the fifth participant has not yet joined or finished, each earlier
-- finisher accumulates its rows and the very next check deletes them again.
-- Only the last finisher's contribution survives.
--
-- Found by CHUNK7B_BATCH2E_VERIFY item 2, which seeds a real 5-participant
-- battle and asserts the aggregate reads 5/5 and 0/5. It read 1/1 and 0/1 —
-- with all 9 finishes reporting success, which is what made it a real finding
-- rather than a seeding artefact: nothing errored, the number was just wrong.
-- A count-only check ("are there rows?") would have passed.
--
-- The doc says "compute the aggregate at battle FINISH". A battle finishes
-- when it closes, not when one player does. So the floor is now evaluated only
-- once the battle itself is finished, which is also the only moment the
-- participant count is final.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $fix$
DECLARE _def text; _new text; _old text; _repl text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_battle';

  IF _def IS NULL THEN RAISE EXCEPTION 'batch 2e fix: rpc_finish_battle not found.'; END IF;

  _old :=
       E'    IF (SELECT count(*) FROM public.battle_participants WHERE battle_id = _battle) < 5 THEN\n'
    || E'      DELETE FROM public.battle_question_stats WHERE battle_id = _battle;\n'
    || E'    END IF;\n';

  -- Evaluated only once the BATTLE is finished. _maybe_finish_battle() has
  -- already run further up, so by here the status reflects whether this was
  -- the last finisher. While the battle is still live the aggregate simply
  -- accumulates; nothing reads it, because rpc_battle_monitor joins on rows
  -- that only survive past the floor check.
  _repl :=
       E'    IF (SELECT b.status FROM public.battles b WHERE b.id = _battle) = ''finished''\n'
    || E'       AND (SELECT count(*) FROM public.battle_participants WHERE battle_id = _battle) < 5 THEN\n'
    || E'      DELETE FROM public.battle_question_stats WHERE battle_id = _battle;\n'
    || E'    END IF;\n';

  IF position(_old in _def) = 0 THEN
    RAISE EXCEPTION 'batch 2e fix: the floor block is not where batch 2e left it. Re-read rpc_finish_battle rather than patching blind.';
  END IF;

  _new := replace(_def, _old, _repl);
  IF _new = _def THEN RAISE EXCEPTION 'batch 2e fix: substitution produced no change.'; END IF;

  EXECUTE _new;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='rpc_finish_battle'
       AND p.prosrc ~ 'status FROM public\.battles b WHERE b\.id = _battle\) = ''finished'''
  ) THEN
    RAISE EXCEPTION 'batch 2e fix: the battle-closed guard is not present after the rewrite.';
  END IF;
END
$fix$;

-- Any sub-floor rows already stored by the pre-fix behaviour are removed, so
-- the invariant "no stored aggregate below the floor" holds from here on
-- regardless of how the rows got there.
DELETE FROM public.battle_question_stats s
 WHERE (SELECT count(*) FROM public.battle_participants p WHERE p.battle_id = s.battle_id) < 5;

COMMIT;
