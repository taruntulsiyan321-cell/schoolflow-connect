-- ROLLBACK 20261051000000 — keys a mistake on the attempted question again
-- instead of on the question a variant was generated from.
--
-- THIS RESTORES BOTH DEFECTS: a wrong answer to a variant in recovery will
-- once more record nothing at all (the guard looks for a mistake keyed on
-- the variant, finds none, and skips), and ordinary practice will once more
-- mint mistake rows keyed on variants.
--
-- Reverses exactly the three edits the forward migration made.
DO $rollback$
DECLARE
  _src text := pg_get_functiondef(
    'public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)'::regprocedure);
  _old text;
BEGIN
  _old := replace(_src, '_session_id, _mistake_qid,', '_session_id, _bank_id,');
  _old := replace(_old, 'sm.question_id IS NOT DISTINCT FROM _mistake_qid', 'sm.question_id IS NOT DISTINCT FROM _bank_id');
  _old := replace(_old, 'AND _mistake_qid IS NOT NULL', 'AND _bank_id IS NOT NULL');
  IF _old = _src THEN
    RAISE EXCEPTION 'nothing to reverse — is the forward migration applied?';
  END IF;
  EXECUTE _old;
END
$rollback$;

DELETE FROM public.schema_migrations
 WHERE version = '20261051000000_a_variant_is_not_its_own_mistake';
