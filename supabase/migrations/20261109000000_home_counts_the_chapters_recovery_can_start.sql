-- ===========================================================================
-- HOME COUNTS THE CHAPTERS RECOVERY CAN START
--
-- Measured 2026-09-26 on www.gurukul.study as the CUET audit account: Home
-- said "14 chapters ready to recover", Analysis "Recovery pending: 14", the
-- Learning hub "14 To Recover" — and Recovery itself said "10 ready". The
-- snapshot counted queue rows with `ready` (the trigger reached); Recovery
-- counted rows a round can start. Four chapters had reached the trigger but
-- cannot build a plan (Money and Banking has no conceptual question in the
-- bank), so Recovery shows them with "can't start here yet" and Home promised
-- them anyway.
--
-- `startable` is set only on a ready chapter whose plan can be built, so it is
-- the one fact both count. rpc_student_academic_snapshot is 5 KB and only this
-- clause changes, so it is substituted in place; the guard makes a clause that
-- has moved fatal instead of silent.
--
-- ROLLBACK: rollback/20261109000000_home_counts_the_chapters_recovery_can_start.rollback.sql
-- ===========================================================================

BEGIN;

DO $snap$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef('public.rpc_student_academic_snapshot()'::regprocedure) INTO _def;
  _new := replace(_def,
    $old$  SELECT count(*)::int INTO _recovery_pending
    FROM jsonb_array_elements(public.rpc_student_recovery_queue()) q
   WHERE (q->>'ready')::boolean;$old$,
    $new$  SELECT count(*)::int INTO _recovery_pending
    FROM jsonb_array_elements(public.rpc_student_recovery_queue()) q
   WHERE (q->>'startable')::boolean;$new$);
  IF _new = _def THEN
    RAISE EXCEPTION 'could not find the recovery_pending count in rpc_student_academic_snapshot';
  END IF;
  EXECUTE _new;
END $snap$;

COMMIT;
