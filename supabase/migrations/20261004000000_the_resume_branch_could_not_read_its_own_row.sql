-- ═══════════════════════════════════════════════════════════════════════════
-- The resume branch could not read its own row
--
-- 20261003000000 gave rpc_start_recovery_session a resume path so a second tap
-- hands back the session already open instead of burning another §4.6 round.
-- That path read the row with
--
--     SELECT rs.round, rs.tier0_total, ... INTO _round, _tot[1], _tot[2], ...
--
-- and plpgsql's INTO does not accept array subscripts as targets. It bound the
-- whole `_tot` array to the first column instead, so the statement raised
--
--     22P02 malformed array literal: "2"
--
-- for any student who had an unfinished recovery session — which, after
-- 20261003000000, is the exact case the branch exists to serve. Recovery could
-- not be started at all for them.
--
-- Caught immediately by re-running the attack suite that motivated the change:
-- both files failed on the same line before any assertion was reached. It is
-- the same mistake made once already in 20261001000000 and fixed there before
-- applying; here it reached production for the minutes between the two
-- migrations.
--
-- The fix is scalar temporaries, which is what INTO can actually bind, and the
-- proof drives the resume path rather than reading it.
--
-- Reverse: none. 20261003000000's rollback restores the pre-resume body; this
-- migration only repairs that migration's own statement, so reverting it alone
-- would restore a function that raises.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $fix$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.proname='rpc_start_recovery_session';
  IF md5(_def) <> '3b4b62b9c4ee7158fff5d2777ceebf3a' THEN
    RAISE EXCEPTION 'rpc_start_recovery_session is not the body 20261003000000 left (live md5 %)', md5(_def);
  END IF;
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
$old$    SELECT rs.round, rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total, rs.plan
      INTO _round, _tot[1], _tot[2], _tot[3], _tot[4], _plan
      FROM public.recovery_sessions rs WHERE rs.id = _rid;$old$,
$new$    -- Scalars, not array subscripts: plpgsql's INTO cannot bind _tot[1].
    SELECT rs.round, rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total, rs.plan
      INTO _round, _r0, _r1, _r2, _r3, _plan
      FROM public.recovery_sessions rs WHERE rs.id = _rid;
    _tot[1] := _r0; _tot[2] := _r1; _tot[3] := _r2; _tot[4] := _r3;$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the resume SELECT'; END IF;
  _def := _new;

  _new := replace(_def, '  _ok     boolean;', '  _ok     boolean;' || E'\n' ||
                        '  _r0 int; _r1 int; _r2 int; _r3 int;');
  IF _new = _def THEN RAISE EXCEPTION 'could not find the declarations'; END IF;

  EXECUTE _new;
  RAISE NOTICE 'the resume branch reads its own row again';
END
$fix$;

-- ── Prove the resume path, by taking it ─────────────────────────────────────
-- G11: this fails against the body 20261003000000 left. It deliberately leaves
-- a session open and then starts again, which is the exact case that raised.
DO $prove$
DECLARE
  _uid uuid; _chap uuid; _a jsonb; _b jsonb; _open int;
BEGIN
  BEGIN
    SELECT sm.user_id, sm.chapter_id INTO _uid, _chap
      FROM public.student_mistakes sm
     WHERE sm.status='open' AND sm.chapter_id IS NOT NULL AND sm.question_id IS NOT NULL
     GROUP BY 1,2 HAVING count(*) >= public._recovery_const('RECOVERY_TRIGGER_COUNT')::int
     ORDER BY count(*) DESC LIMIT 1;
    IF _uid IS NULL THEN RAISE EXCEPTION 'nobody is at the trigger'; END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

    _a := public.rpc_start_recovery_session(_chap);
    IF NOT (_a->>'started')::boolean THEN
      RAISE EXCEPTION 'the first start refused: %', _a->>'reason';
    END IF;

    -- The second tap. Before the fix this raised; before 20261003000000 it
    -- opened another session and took another round.
    _b := public.rpc_start_recovery_session(_chap);

    SELECT count(*) INTO _open FROM public.recovery_sessions
     WHERE user_id=_uid AND chapter_id=_chap AND completed_at IS NULL;

    IF (_b->>'session_id') IS DISTINCT FROM (_a->>'session_id') THEN
      RAISE EXCEPTION 'the second start opened a different session (% vs %)',
        _b->>'session_id', _a->>'session_id';
    END IF;
    IF (_b->>'round')::int IS DISTINCT FROM (_a->>'round')::int THEN
      RAISE EXCEPTION 'the second start took another round (% vs %)', _b->>'round', _a->>'round';
    END IF;
    IF NOT COALESCE((_b->>'resumed')::boolean, false) THEN
      RAISE EXCEPTION 'the second start did not report itself as a resume: %', _b;
    END IF;
    IF (_b->>'session_size')::int IS DISTINCT FROM (_a->>'session_size')::int THEN
      RAISE EXCEPTION 'the resumed session reports a different size (% vs %)',
        _b->>'session_size', _a->>'session_size';
    END IF;
    IF _open <> 1 THEN
      RAISE EXCEPTION 'expected exactly one open session for this chapter, found %', _open;
    END IF;

    RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
      RAISE NOTICE 'a second start resumes the same session, same round, same size, one open row';
    ELSE
      RAISE;
    END IF;
  END;
END
$prove$;

COMMIT;
