-- ═══════════════════════════════════════════════════════════════════════════
-- TOPIC WEAKNESS IS IN THE PLAN WHEREVER IT IS READ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 86, closed.
--
-- 20261112000000 put topic-level analysis in the plan by fencing the two RPCs
-- the Analysis panel reads — `rpc_student_academic_snapshot` and
-- `rpc_student_practice_analytics` — which return `by_topic` / `weak_topics` as
-- empty lists with `topic_analysis_locked: true` for a plan that does not carry
-- `analysis.topic`.
--
-- `rpc_weak_areas_v2` returns the same KIND of thing and was not fenced: the
-- weakest concepts of one student, straight out of `concept_mastery`, ranked.
-- Measured 2026-09-29: it answers 47 rows for one live CUET account and 13 for
-- another. Its only reader is `decisionEngineService`, behind
-- `VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2`, which `productFeatureFlags.ts`
-- defaults to false — so nothing reads it today, and the day that flag is
-- turned on a free account would read paid analysis through it while the Plans
-- screen says topic-wise analysis is paid for.
--
-- Fenced now, while it is latent, because the cost of fixing it later is that
-- somebody turns the flag on and does not think about plans at all.
--
-- WHY NO ROWS RATHER THAN A LOCK FLAG. This one returns a TABLE, not jsonb, so
-- there is nowhere in its result to put `topic_analysis_locked`. It returns no
-- rows, which is what the other two produce (an empty list) minus the flag. A
-- screen that picks this up must ask `rpc_my_premium` for the lock and say so,
-- the way every other paid surface does — `PlanLimitNotice` is that component.
-- Left as a comment on the function so the next reader is told.
--
-- ROLLBACK: rollback/20261122000000_topic_weakness_is_in_the_plan_wherever_it_is_read.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.routines_pre_20261122000000 (
  object text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20261122000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261122000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261122000000 IS
  'Rollback source for 20261122000000: rpc_weak_areas_v2 as it was. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261122000000 (object, definition)
SELECT o, pg_get_functiondef(o::regprocedure)
  FROM unnest(ARRAY['public.rpc_weak_areas_v2()']) AS o;

-- What it answers now, per account, so the proof can show what moved.
CREATE TEMP TABLE _weak_before ON COMMIT DROP AS
SELECT ea.account_id AS uid,
       (SELECT count(*) FROM public.concept_mastery cm
         WHERE cm.user_id = ea.account_id AND cm.total_attempts > 0) AS candidates
  FROM public.exam_accounts ea;

DO $edit$
DECLARE
  _def text;
  _n   int;
  _old constant text := E'  IF _uid IS NULL THEN\n    RETURN;\n  END IF;\n';
  _new constant text := E'  IF _uid IS NULL THEN\n    RETURN;\n  END IF;\n' ||
    E'\n' ||
    E'  -- Topic-level analysis is in the plan (20261112000000). The two RPCs the\n' ||
    E'  -- Analysis panel reads answer empty + topic_analysis_locked without it;\n' ||
    E'  -- this returns the same kind of thing and answers nothing. A screen that\n' ||
    E'  -- reads this must take the lock from rpc_my_premium: a TABLE has nowhere\n' ||
    E'  -- to carry the flag. KNOWN_ISSUES 86.\n' ||
    E'  IF NOT (public._premium_decide(_uid, ''analysis.topic'', 1, false)->>''ok'')::boolean THEN\n' ||
    E'    RETURN;\n' ||
    E'  END IF;\n';
BEGIN
  _def := replace(pg_get_functiondef('public.rpc_weak_areas_v2()'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _old, ''))) / length(_old);
  IF _n <> 1 THEN
    RAISE EXCEPTION 'weak areas: expected the null-identity guard once, found %', _n;
  END IF;
  EXECUTE replace(_def, _old, _new);
END
$edit$;

COMMENT ON FUNCTION public.rpc_weak_areas_v2() IS
  'The caller''s own weakest concepts from concept_mastery, ranked. Topic-level analysis is a paid feature: without analysis.topic in the plan this answers NO ROWS (20261122000000, KNOWN_ISSUES 86). A TABLE cannot carry topic_analysis_locked, so a screen reading this takes the lock from rpc_my_premium and renders PlanLimitNotice.';

-- ── THE PROOF ─────────────────────────────────────────────────────────────
--
--   1. The guard is in the body, once, and reads analysis.topic.
--   2. Enforcement is OFF today, so every account still gets what it got —
--      the fence is not a blanket off-switch. (Positive control: an account
--      with candidates must still answer rows.)
--   3. Enforced for ONE account, whose free plan does not carry analysis.topic,
--      it answers ZERO rows — and the same account answered rows a moment
--      earlier, so the zero is the fence and not an empty table.
--   4. The enforcement row is removed again before this commits.
DO $proof$
DECLARE
  _uid uuid; _before int; _after int; _enforced int; _decide jsonb;
BEGIN
  IF pg_get_functiondef('public.rpc_weak_areas_v2()'::regprocedure)
       NOT LIKE '%_premium_decide(_uid, ''analysis.topic'', 1, false)%' THEN
    RAISE EXCEPTION 'the fence is not in the body';
  END IF;

  -- The account with the most to lose.
  SELECT w.uid INTO _uid FROM _weak_before w ORDER BY w.candidates DESC LIMIT 1;
  SELECT w.candidates INTO _before FROM _weak_before w WHERE w.uid = _uid;
  IF COALESCE(_before, 0) = 0 THEN
    RAISE EXCEPTION 'no account has a concept_mastery row, so nothing here can be proved';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  SELECT count(*) INTO _after FROM public.rpc_weak_areas_v2();
  IF _after = 0 THEN
    RAISE EXCEPTION
      'CONTROL FAILED: % has % candidate concept(s) but the RPC answers nothing with enforcement off', _uid, _before;
  END IF;

  _decide := public._premium_decide(_uid, 'analysis.topic', 1, false);
  IF (_decide->>'would_deny') IS DISTINCT FROM 'not_in_plan' THEN
    RAISE EXCEPTION 'this account''s plan already carries analysis.topic (%), so the next step proves nothing', _decide;
  END IF;

  INSERT INTO public.premium_enforced_accounts (account_id, note)
  VALUES (_uid, '20261122000000 proof — removed in the same transaction')
  ON CONFLICT (account_id) DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  SELECT count(*) INTO _enforced FROM public.rpc_weak_areas_v2();

  DELETE FROM public.premium_enforced_accounts
   WHERE account_id = _uid
     AND note = '20261122000000 proof — removed in the same transaction';

  IF _enforced <> 0 THEN
    RAISE EXCEPTION
      'enforced, and with analysis.topic outside the plan, the RPC still answered % row(s)', _enforced;
  END IF;

  IF EXISTS (SELECT 1 FROM public.premium_enforced_accounts WHERE account_id = _uid
               AND note = '20261122000000 proof — removed in the same transaction') THEN
    RAISE EXCEPTION 'the proof left its enforcement row behind';
  END IF;

  RAISE NOTICE 'weak areas v2: % rows unenforced, 0 enforced, for %', _after, _uid;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261122000000_topic_weakness_is_in_the_plan_wherever_it_is_read')
ON CONFLICT (version) DO NOTHING;

COMMIT;
