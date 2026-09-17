-- PASSING A REVISION CHECK IS ALLOWED TO SUCCEED.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- Driven in the live school on 2026-09-17: a student sat the Polynomials
-- revision check and scored 12 of 13 — 92%, against a REVISION_PASS_THRESHOLD
-- of 0.70. The screen said "Accuracy 92%". The ladder did not move, no
-- revision_sessions row was written, and chapter_state still read
-- revision_failed, stage 1, 0 consecutive passes.
--
-- The server had refused the whole transaction:
--
--   new row for relation "chapter_state" violates check constraint
--   "chapter_state_recovered_has_timestamp"
--   Failing row: (..., state='recovered', recovered_at=NULL,
--                 next_revision_at=2026-09-24, revision_stage=2,
--                 consecutive_revision_passes=1, ...)
--
-- The constraint is CHECK ((state = 'recovered') <= (recovered_at IS NOT
-- NULL)): calling a chapter recovered obliges you to say when. Both pass
-- branches of rpc_submit_revision_session set state = 'recovered' and neither
-- sets recovered_at.
--
-- For a chapter that came through RECOVERY this never bites: recovered_at was
-- already stamped by rpc_submit_recovery_session. For a chapter that reached
-- revision through ENGAGEMENT it always bites, because there was no recovery
-- to stamp it — and the same function knows this, three lines earlier:
--
--   _trigger := CASE WHEN _cs.recovered_at IS NOT NULL THEN 'recovery'
--                    ELSE 'engagement' END;
--
-- It identifies the chapter as engagement-triggered by the absence of the
-- timestamp, then writes a state that requires it.
--
-- SCOPE, measured before applying: 4 of the 5 chapter_state rows on this
-- database have recovered_at IS NULL. Four chapters in five could not pass a
-- revision check at all, and the INSERT into revision_sessions happens before
-- the UPDATE in the same transaction, so every such attempt rolled back and
-- left no trace that it had ever been made. That is why revision_sessions
-- holds nothing but failures.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
--   state = 'recovered', recovered_at = COALESCE(_cs.recovered_at, now())
--
-- COALESCE, not now(): a chapter that genuinely came out of recovery keeps the
-- date it did so, and only a chapter that never had one is stamped with the
-- moment it first proved itself. The alternative — inventing a sixth state for
-- "in good standing but never in recovery" — would mean teaching every reader
-- of chapter_state.state a new word (rpc_student_chapter_states,
-- rpc_student_recovery_queue, Recovery.tsx, Analysis.tsx and
-- deriveRevisionData all branch on 'recovered') to describe a chapter that is,
-- for every purpose any of them has, in the same condition.
--
-- Both pass branches carry the identical UPDATE, so the substitution below
-- hits both; the guard counts them.
--
-- Live bodies on this database are stored with CRLF; normalised first.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
  _old_stmt text := E'        state = ''recovered'', updated_at = now()\n      WHERE user_id = _uid AND chapter_id = _chapter_id;';
  _new_stmt text := E'        state = ''recovered'', recovered_at = COALESCE(_cs.recovered_at, now()), updated_at = now()\n      WHERE user_id = _uid AND chapter_id = _chapter_id;';
  _hits int;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_submit_revision_session';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_submit_revision_session is not defined on this database';
  END IF;

  -- BOTH branches, or neither. Patching one would leave a student who reaches
  -- the third pass hitting the same constraint at the exact moment the
  -- chapter should go solid — the rarest path and the worst place to find it.
  _hits := (length(_def) - length(replace(_def, _old_stmt, ''))) / length(_old_stmt);
  IF _hits <> 2 THEN
    RAISE EXCEPTION 'would have failed open: expected the pass UPDATE twice, found % occurrence(s)', _hits;
  END IF;

  _new := replace(_def, _old_stmt, _new_stmt);
  IF _new = _def THEN
    RAISE EXCEPTION 'would have failed open: nothing was substituted';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'a passed revision check now stamps recovered_at and is allowed to commit';
END $$;

-- POSITIVE CONTROL. The unstamped form must be gone and the stamped form
-- present twice. Checking only that the new text appears would pass on a body
-- that still carried one of the old ones.
DO $$
DECLARE
  _def text;
  _old_hits int;
  _new_hits int;
  _old_stmt text := E'        state = ''recovered'', updated_at = now()\n';
  _new_stmt text := 'recovered_at = COALESCE(_cs.recovered_at, now())';
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_submit_revision_session';

  _old_hits := (length(_def) - length(replace(_def, _old_stmt, ''))) / length(_old_stmt);
  _new_hits := (length(_def) - length(replace(_def, _new_stmt, ''))) / length(_new_stmt);

  IF _old_hits <> 0 THEN
    RAISE EXCEPTION 'would have failed open: % unstamped pass UPDATE(s) remain', _old_hits;
  END IF;
  IF _new_hits <> 2 THEN
    RAISE EXCEPTION 'would have failed open: expected 2 stamped pass UPDATEs, found %', _new_hits;
  END IF;
END $$;

COMMIT;
