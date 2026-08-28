-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Chunk 7B batch 2c (20260828210000_chunk7b_batch2c_battles)
--
-- ⚠ This rollback REOPENS A KNOWN PRIVACY LEAK, and it cannot restore the
-- data the migration deleted. Read both limits before running it.
--
-- LIMIT 1 — the purged battle_answers rows do not come back.
--   The migration deleted every correct battle_answers row belonging to a
--   participant who had already finished, and appended a purge to
--   rpc_finish_battle so new ones are deleted at finish. Those rows were a
--   durable record of what each student got RIGHT, which the storage rule
--   forbids. They are gone. There is no version of this rollback that
--   restores them without re-creating the violation the migration existed to
--   remove. Scores, XP and mistakes were all captured before the delete and
--   are unaffected, so nothing the app displays is lost — only the forbidden
--   per-question correctness.
--
-- LIMIT 2 — three function bodies were patched in place, not replaced.
--   _snapshot_battle_report, rpc_finish_battle and rpc_ensure_battle_report
--   were rewritten by substitution on pg_get_functiondef() output, so their
--   pre-migration bodies are not reproduced here. Sections 3-5 below say
--   exactly how to restore each. Hand-copying a SECURITY DEFINER body risks
--   losing its search_path, volatility or grants, which is how a definer
--   quietly loses its fence — so those are pointed at their source migrations
--   rather than retyped.
--
-- The policies ARE restored here, because policies are what gate the data.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. battle_reports read policy, back to the wide form ────────────────────
-- Verbatim from 20260820130000_battle_family_school_id_root_cause.sql.
-- Note what this restores: creator_user_id = auth.uid() means a STUDENT who
-- created a public battle can read other participants' topic breakdowns, not
-- just staff. That was part of the leak, and it comes back with this.
DROP POLICY IF EXISTS "br teacher read" ON public.battle_reports;
CREATE POLICY "br teacher read" ON public.battle_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM battles b
      WHERE b.id = battle_reports.battle_id
        AND (
          (b.creator_user_id = auth.uid())
          OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(b.school_id))
          OR (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(b.school_id))
          OR ((b.class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), b.class_id))
        )
    )
  );

-- ── 2. battle_reports update policy, back to the wide form ──────────────────
DROP POLICY IF EXISTS "br ai update self" ON public.battle_reports;
CREATE POLICY "br ai update self" ON public.battle_reports FOR UPDATE
  USING (
    (user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM battles b
      WHERE b.id = battle_reports.battle_id
        AND (
          (b.creator_user_id = auth.uid())
          OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(b.school_id))
          OR ((b.class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), b.class_id))
        )
    )
  )
  WITH CHECK (
    (user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM battles b
      WHERE b.id = battle_reports.battle_id
        AND (
          (b.creator_user_id = auth.uid())
          OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(b.school_id))
          OR ((b.class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), b.class_id))
        )
    )
  );

-- ── 3. Remove the purge from rpc_finish_battle ──────────────────────────────
-- This is the one in-place patch that CAN be reversed mechanically, because
-- the migration appended a self-contained block rather than editing existing
-- logic. Strip it back out and the function is byte-identical to its
-- pre-migration form.
DO $unpurge$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_battle';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'batch 2c rollback: rpc_finish_battle not found.';
  END IF;

  -- Deterministic literal removal, NOT a regex.
  --
  -- The regex form was written first and was wrong. `.*?\n\s*END;\n` over-
  -- matched and consumed the function's OWN closing END; along with the
  -- purge's, producing a body that ended at `$function$` with one END too
  -- few — "syntax error at end of input", 230 lines in. The forward migration
  -- hit the neighbouring version of this (the 'n' flag, which makes `.` stop
  -- matching newlines in Postgres — the opposite of what a multi-line pattern
  -- needs).
  --
  -- Both bugs come from reaching for a pattern when the exact text is known.
  -- The appended block is fixed, known, and written by the forward migration
  -- itself, so match it literally: a literal cannot over-reach, and if the
  -- body ever changes this simply fails the guard below instead of silently
  -- removing the wrong lines.
  _new := replace(
    _def,
    E'\n  -- §10.8 transient rule: per-question correctness may exist while the\n'
    || E'  -- session is in flight, because a battle cannot be scored without it,\n'
    || E'  -- but it must not persist once the session closes. The score is on\n'
    || E'  -- battle_participants, the totals on student_xp, and the mistakes in\n'
    || E'  -- student_mistakes — all captured above. What is left here is the\n'
    || E'  -- record of what the student got RIGHT, which nothing may keep.\n'
    || E'  -- Wrong and skipped rows survive (skipped are is_correct = false).\n'
    || E'  BEGIN\n'
    || E'    DELETE FROM public.battle_answers\n'
    || E'     WHERE participant_id = _participant_id AND is_correct IS TRUE;\n'
    || E'  EXCEPTION WHEN OTHERS THEN\n'
    || E'    RAISE WARNING ''rpc_finish_battle(%): correct-answer purge failed: %'', _participant_id, SQLERRM;\n'
    || E'  END;\n',
    ''
  );

  IF _new = _def THEN
    RAISE EXCEPTION
      'batch 2c rollback: could not find the appended purge block in rpc_finish_battle. Refusing to guess — inspect pg_get_functiondef(''public.rpc_finish_battle''::regproc) and remove the DELETE FROM public.battle_answers block by hand.';
  END IF;

  EXECUTE _new;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_battle'
       AND p.prosrc ~ 'DELETE FROM public\.battle_answers'
  ) THEN
    RAISE EXCEPTION 'batch 2c rollback: the purge is still present after the rewrite.';
  END IF;

  RAISE NOTICE 'batch 2c rollback: purge removed from rpc_finish_battle.';
END
$unpurge$;

COMMIT;

-- ── 4. _snapshot_battle_report — restore by re-applying its source ──────────
-- The migration blanked the topics.strong aggregate to '[]'::jsonb. To bring
-- strong-area computation back, re-apply the function definition from the
-- migration that last defined it. Find it with:
--
--   grep -rln "_snapshot_battle_report" supabase/migrations/*.sql | tail -3
--
-- Do NOT hand-edit the live body back: the aggregate that was removed is
--   HAVING count(*) FILTER (WHERE ba.is_correct) = count(*)
-- and it will produce nothing anyway until LIMIT 1 above is addressed, since
-- there are no correct battle_answers rows left for finished participants to
-- aggregate over.

-- ── 5. rpc_ensure_battle_report — restore by re-applying its source ─────────
-- The migration narrowed its internal authorisation from
-- {owner, creator, admin, principal, teacher-of-class} to the owning student.
-- Re-apply from the migration that last defined it, located the same way.
-- With the policies in sections 1-2 restored, the underlying rows are already
-- reachable again; this function is a call site on top of them.
