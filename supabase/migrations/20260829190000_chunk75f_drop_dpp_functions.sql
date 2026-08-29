-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5f — drop the five DPP-named functions
--
-- Dependency-checked before dropping, not assumed:
--
--   _backfill_dpp_question_concepts  called by rpc_backfill_question_concepts
--   _capture_dpp_mistakes            called by rpc_dpp_submit (also dropped)
--   rpc_dpp_pick_from_bank           no callers
--   rpc_dpp_start                    no callers (the client now uses rpc_test_start)
--   rpc_dpp_submit                   no callers
--
-- _backfill_dpp_question_concepts has a live caller, so it is NOT dropped
-- blind: rpc_backfill_question_concepts loses that branch first, in 7.5g with
-- the other eleven branch removals. Dropping it here would break a function
-- that still calls it.
--
-- The other four go. The tables stay until 7.5h — the doc's ordering is
-- repoint, then functions, then tables last, precisely so that a mistake at
-- any step is still recoverable from live data.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE _bad text;
BEGIN
  -- G15: assert the precondition, then use the construct. A DROP that silently
  -- matched nothing would leave the gate reporting success over a live door.
  SELECT string_agg(p.proname, ', ') INTO _bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname IN ('rpc_dpp_pick_from_bank', 'rpc_dpp_start', 'rpc_dpp_submit', '_capture_dpp_mistakes');
  IF _bad IS NULL THEN
    RAISE EXCEPTION 'none of the four DPP functions exist — refusing to report a no-op drop as success';
  END IF;
  RAISE NOTICE 'dropping: %', _bad;
END
$guard$;

DROP FUNCTION IF EXISTS public.rpc_dpp_submit(uuid, jsonb);
DROP FUNCTION IF EXISTS public.rpc_dpp_start(uuid);
-- Signature read from pg_proc, not guessed: DROP FUNCTION matches on it,
-- and a four-argument guess silently matched nothing (G15). The assertion
-- below is what caught it.
DROP FUNCTION IF EXISTS public.rpc_dpp_pick_from_bank(uuid, integer, text);
DROP FUNCTION IF EXISTS public._capture_dpp_mistakes(uuid);

DO $assert$
DECLARE _n int;
BEGIN
  SELECT count(*)::int INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname IN ('rpc_dpp_pick_from_bank', 'rpc_dpp_start', 'rpc_dpp_submit', '_capture_dpp_mistakes');
  IF _n > 0 THEN
    RAISE EXCEPTION '% DPP function(s) survived the drop — check the signature, DROP FUNCTION matches on it', _n;
  END IF;
END
$assert$;

COMMIT;
