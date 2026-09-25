-- ROLLBACK 20261054000000 — scores recovery against the PLANNED totals again.
--
-- A planned question withdrawn from the bank before the sitting then counts
-- as a wrong answer once more. Undone the same way it was done: in place,
-- from the live definition, every anchor matching exactly once.
DO $mig$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef('public.rpc_submit_recovery_session(uuid,uuid)'::regprocedure), E'\r\n', E'\n') INTO _def;
  IF position('_tot[_i + 1] := COALESCE(array_length(_ids, 1), 0);' IN _def) = 0 THEN
    RAISE EXCEPTION 'rpc_submit_recovery_session does not carry 20261054000000';
  END IF;
  _def := replace(_def, E'  _corr      int[] := ARRAY[0,0,0,0];\n  _tot       int[] := ARRAY[0,0,0,0];', '  _corr      int[] := ARRAY[0,0,0,0];');
  _def := replace(_def, $a$

    -- #17: a question withdrawn from the bank after planning could never be
    -- shown, so it is neither right nor wrong — it leaves the tier.
    SELECT COALESCE(array_agg(q.id), ARRAY[]::uuid[]) INTO _ids
      FROM public.question_bank q
     WHERE q.id = ANY(_ids) AND q.is_approved;
    _tot[_i + 1] := COALESCE(array_length(_ids, 1), 0);$a$, '');
  _def := replace(_def, '_tot[_i + 1]);', $a$CASE _i WHEN 0 THEN _rs.tier0_total WHEN 1 THEN _rs.tier1_total
              WHEN 2 THEN _rs.tier2_total ELSE _rs.tier3_total END);$a$);
  _def := replace(_def, '_proc_d := _tot[1] + _tot[2];', '_proc_d := _rs.tier0_total + _rs.tier1_total;');
  _def := replace(_def, '_conc_d := _tot[3] + _tot[4];', '_conc_d := _rs.tier2_total + _rs.tier3_total;');
  _def := replace(_def, E'    tier0_total = _tot[1], tier1_total = _tot[2], tier2_total = _tot[3], tier3_total = _tot[4],\n', '');
  EXECUTE _def;
END
$mig$;
DELETE FROM public.schema_migrations
 WHERE version = '20261054000000_a_question_nobody_could_see_is_not_a_wrong_answer';
