-- Priority 2 (student panel data correctness) finding: 3 seeded demo
-- student_xp rows (Ishaan Gupta, Rohan Singh, Kabir Khan — all in the demo
-- school) had league_code stuck at 'bronze' despite xp already past the
-- Silver threshold (300), because their rows were bulk-inserted directly by
-- the seed script instead of going through rpc_apply_progression -- the
-- ONLY function that ever writes league_code/highest_league_code (confirmed
-- via prosrc search: no other function touches these columns). Real
-- gameplay always routes through rpc_apply_progression (rpc_finish_battle,
-- rpc_finish_practice_session both call it), so this cannot recur for real
-- student activity -- it is a one-time seed-data artifact, not a code
-- defect, and self-heals for any of these 3 accounts on their next real
-- XP-earning event regardless. Fixing now because it was visibly wrong on
-- the live Class Rankings leaderboard (Bronze badge shown for students with
-- more XP than a Silver-badged classmate).
--
-- Uses the existing progression_league_for_xp(xp) function (not a
-- reimplementation) so this stays correct if the league ladder ever changes.

UPDATE public.student_xp sx
SET
  league_code = public.progression_league_for_xp(sx.xp),
  highest_league_code = CASE
    WHEN (SELECT tier FROM public.progression_leagues WHERE code = public.progression_league_for_xp(sx.xp))
       > (SELECT tier FROM public.progression_leagues WHERE code = COALESCE(sx.highest_league_code, 'bronze'))
    THEN public.progression_league_for_xp(sx.xp)
    ELSE COALESCE(sx.highest_league_code, 'bronze')
  END,
  updated_at = now()
WHERE public.progression_league_for_xp(sx.xp) IS DISTINCT FROM sx.league_code;
