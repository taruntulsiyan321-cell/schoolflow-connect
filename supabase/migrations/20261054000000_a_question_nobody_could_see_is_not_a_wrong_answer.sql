-- #17 — a question removed between planning and sitting was scored WRONG.
--
-- rpc_submit_recovery_session divides each tier's correct answers by the
-- tier total stored when the session was PLANNED. If a planned question is
-- withdrawn from the bank before the student sits the session (unapproved or
-- deleted), the student can never be shown it — question_bank_student only
-- serves approved rows — yet it still sat in the denominator, so it counted
-- exactly like a wrong answer and could turn a 'ready' into a 'not_ready'.
-- Measured 2026-09-23: 43 planned sessions, 0 planned questions unservable
-- today, so no stored verdict is wrong; this closes it before one is.
--
-- Now each tier counts only the planned questions that are still servable
-- (is_approved, the view's own filter), for the numerator AND the
-- denominator, and the stored tierN_total is what could actually be asked.
-- A skipped question still counts as not-correct: it WAS shown.
--
-- Revision checks do not have this defect: rpc_submit_revision_session
-- counts from the answers actually given, so an unseen question never enters.
--
-- Edited in place from the live definition (live bodies have drifted from
-- files before); every anchor must match exactly once or this aborts.
DO $mig$
DECLARE
  _def text;
  _n   int;
  PROCEDURE_NAME CONSTANT text := 'public.rpc_submit_recovery_session(uuid,uuid)';
BEGIN
  SELECT replace(pg_get_functiondef(PROCEDURE_NAME::regprocedure), E'\r\n', E'\n') INTO _def;

  -- 1. declare the servable totals
  _n := (length(_def) - length(replace(_def, '  _corr      int[] := ARRAY[0,0,0,0];', ''))) / length('  _corr      int[] := ARRAY[0,0,0,0];');
  IF _n <> 1 THEN RAISE EXCEPTION 'anchor 1 matched % times', _n; END IF;
  _def := replace(_def, '  _corr      int[] := ARRAY[0,0,0,0];',
    E'  _corr      int[] := ARRAY[0,0,0,0];\n  _tot       int[] := ARRAY[0,0,0,0];');

  -- 2. keep only planned questions the student could still be shown
  _n := (length(_def) - length(replace(_def, $a$COALESCE(_rs.plan->'tiers'->(_i::text)->'from_bank', '[]'::jsonb)) AS v;$a$, ''))) / length($a$COALESCE(_rs.plan->'tiers'->(_i::text)->'from_bank', '[]'::jsonb)) AS v;$a$);
  IF _n <> 1 THEN RAISE EXCEPTION 'anchor 2 matched % times', _n; END IF;
  _def := replace(_def, $a$COALESCE(_rs.plan->'tiers'->(_i::text)->'from_bank', '[]'::jsonb)) AS v;$a$,
    $a$COALESCE(_rs.plan->'tiers'->(_i::text)->'from_bank', '[]'::jsonb)) AS v;

    -- #17: a question withdrawn from the bank after planning could never be
    -- shown, so it is neither right nor wrong — it leaves the tier.
    SELECT COALESCE(array_agg(q.id), ARRAY[]::uuid[]) INTO _ids
      FROM public.question_bank q
     WHERE q.id = ANY(_ids) AND q.is_approved;
    _tot[_i + 1] := COALESCE(array_length(_ids, 1), 0);$a$);

  -- 3. clamp to what could be asked, not what was planned
  _n := (length(_def) - length(replace(_def, $a$CASE _i WHEN 0 THEN _rs.tier0_total WHEN 1 THEN _rs.tier1_total
              WHEN 2 THEN _rs.tier2_total ELSE _rs.tier3_total END);$a$, ''))) / length($a$CASE _i WHEN 0 THEN _rs.tier0_total WHEN 1 THEN _rs.tier1_total
              WHEN 2 THEN _rs.tier2_total ELSE _rs.tier3_total END);$a$);
  IF _n <> 1 THEN RAISE EXCEPTION 'anchor 3 matched % times', _n; END IF;
  _def := replace(_def, $a$CASE _i WHEN 0 THEN _rs.tier0_total WHEN 1 THEN _rs.tier1_total
              WHEN 2 THEN _rs.tier2_total ELSE _rs.tier3_total END);$a$, '_tot[_i + 1]);');

  -- 4. denominators
  _n := (length(_def) - length(replace(_def, '_proc_d := _rs.tier0_total + _rs.tier1_total;', ''))) / length('_proc_d := _rs.tier0_total + _rs.tier1_total;');
  IF _n <> 1 THEN RAISE EXCEPTION 'anchor 4 matched % times', _n; END IF;
  _def := replace(_def, '_proc_d := _rs.tier0_total + _rs.tier1_total;', '_proc_d := _tot[1] + _tot[2];');
  _n := (length(_def) - length(replace(_def, '_conc_d := _rs.tier2_total + _rs.tier3_total;', ''))) / length('_conc_d := _rs.tier2_total + _rs.tier3_total;');
  IF _n <> 1 THEN RAISE EXCEPTION 'anchor 5 matched % times', _n; END IF;
  _def := replace(_def, '_conc_d := _rs.tier2_total + _rs.tier3_total;', '_conc_d := _tot[3] + _tot[4];');

  -- 5. the stored totals say what could be asked
  _n := (length(_def) - length(replace(_def, '    tier0_correct = _corr[1], tier1_correct = _corr[2],', ''))) / length('    tier0_correct = _corr[1], tier1_correct = _corr[2],');
  IF _n <> 1 THEN RAISE EXCEPTION 'anchor 6 matched % times', _n; END IF;
  _def := replace(_def, '    tier0_correct = _corr[1], tier1_correct = _corr[2],',
    E'    tier0_total = _tot[1], tier1_total = _tot[2], tier2_total = _tot[3], tier3_total = _tot[4],\n    tier0_correct = _corr[1], tier1_correct = _corr[2],');

  EXECUTE _def;
END
$mig$;
