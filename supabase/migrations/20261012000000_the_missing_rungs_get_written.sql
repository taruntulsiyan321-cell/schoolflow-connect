-- ════════════════════════════════════════════════════════════════════════════
-- THE MISSING RUNGS GET WRITTEN
-- ════════════════════════════════════════════════════════════════════════════
--
-- Measured on production 2026-09-15:
--
--     question_bank rows with source_question_id (variants):  0 of 21,681
--     rows with variant_tier set:                             0
--
-- Not one variant has ever existed. Tiers 1 and 2 of the transfer ladder are
-- AI-written variants of the student's own wrong questions (§4.2a), so every
-- recovery session ever planned has come up short at exactly those two rungs —
-- the two §4.2 calls "the widest, because the 1-pass/2-fail split is the single
-- most useful thing this feature detects".
--
-- The generator itself was written months ago and is a good piece of work. It
-- was simply never connected to anything: not deployed, and called only by
-- scripts/run-variant-generation.mjs, which a human has to run by hand and
-- which nobody ever had. This migration is the wiring.
--
-- THE SHAPE, AND WHY THIS ONE
--
--   1. A recovery session is built when practice ENDS (20261009000000). That
--      is the moment we know, per question and per tier, exactly what is
--      missing — and the student has the rest of their sitting, then the walk
--      to the Recovery tab, before they need it. §4.1a's "never in front of a
--      waiting student" and "within the least time possible" stop being in
--      tension: the waiting time IS the generation time.
--
--   2. The queue is keyed on (source question, tier), NOT on the student.
--      §4.2a: "A variant generated because Ravi failed a question is there,
--      free and instant, for the next student who fails the same one." Forty
--      students failing the same question enqueue one job, not forty.
--
--   3. The BANK is the truth, the queue is advisory. A row is resolved by
--      looking for the variant, never by trusting a reply — pg_net is
--      fire-and-forget and a queue that believed its own sends would mark
--      work done that never happened.
--
--   4. The cron presents a vault secret, not the service-role key. The service
--      key inside a function body is a master credential sitting in pg_proc.
--      Same shape dispatch_notification_push already uses in production.
--
-- WHAT THIS DOES NOT DO
--
-- It does not review what the AI writes. Generated variants are saved
-- is_approved (they are invisible to students otherwise, and §4.2a's whole
-- economics depend on the next student finding them), which means unreviewed
-- AI content becomes servable in ordinary practice to every student in the
-- school. That is the spec's explicit decision — "Variants are ordinary bank
-- questions… which is fine and desirable" — and scripts/dump-variants.mjs
-- exists so a person can read what landed. It is worth being clear-eyed that
-- scoring is now evidence-based, so a bad answer key does not merely teach the
-- wrong thing: it marks a correct student wrong and pushes them toward a
-- recovery session they did not earn. Flagged, not solved, here.
--
-- ROLLBACK: supabase/migrations/rollback/20261012000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The batch size ──────────────────────────────────────────────────────

INSERT INTO public.recovery_constants (key, value, spec_ref, rationale) VALUES
  ('GENERATION_BATCH_SIZE', 3, '§4.1a',
   'Generation jobs dispatched per cron tick (the tick is every minute). Three rather than a larger number because each is a paid AI call and the realistic backlog is small: 42 students produce a handful of new wrong questions a day, and a variant is generated once per QUESTION, not once per student. A backlog drains at 180/hour, which clears any plausible spike within the interval a student waits; a bigger batch would only make a runaway cost more before anyone noticed.')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, spec_ref = EXCLUDED.spec_ref,
      rationale = EXCLUDED.rationale, updated_at = now();


-- ── 2. The queue ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.variant_generation_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_question_id uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  tier               smallint NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  attempts           int  NOT NULL DEFAULT 0,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  dispatched_at      timestamptz,
  resolved_at        timestamptz,
  CONSTRAINT variant_generation_queue_tier_check   CHECK (tier IN (1, 2)),
  CONSTRAINT variant_generation_queue_status_check CHECK (status IN ('pending', 'done', 'failed')),
  CONSTRAINT variant_generation_queue_attempts_check CHECK (attempts >= 0)
);

-- ONE PENDING JOB PER (QUESTION, TIER), across every student. This index is
-- what makes §4.2a's economics true rather than aspirational: forty students
-- failing the same question produce one job.
CREATE UNIQUE INDEX IF NOT EXISTS variant_generation_queue_pending_uniq
  ON public.variant_generation_queue (source_question_id, tier)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS variant_generation_queue_drain_idx
  ON public.variant_generation_queue (status, created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.variant_generation_queue IS
  'Work list for AI variant generation, keyed on (source question, tier) and NOT on the student — a variant is generated once and serves everyone who fails that question (§4.2a). Advisory only: question_bank is the truth, and a row is resolved by finding the variant, never by trusting a dispatch.';

-- No school_id, deliberately, and no RLS policy granting anyone access.
-- question_bank is a G2 GLOBAL table with no school_id at all (7A: "Shared
-- across every school. No institution_id"), so a variant belongs to no school
-- and neither does the job that produces it. RLS is enabled with zero policies
-- so that a direct read or write by any client role is refused outright; the
-- two SECURITY DEFINER functions below are the only way in.
ALTER TABLE public.variant_generation_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.variant_generation_queue FROM anon, authenticated;


-- ── 3. Enqueue what a plan came up short of ────────────────────────────────

CREATE OR REPLACE FUNCTION public._enqueue_variant_generation(_plan jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _src   record;
  _tier  smallint;
  _added int := 0;
  _qid   uuid;
BEGIN
  IF _plan IS NULL OR _plan->>'mode' NOT IN ('deep', 'wide') THEN
    RETURN 0;
  END IF;

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    -- Nothing short at this rung means nothing to write. A plan that filled
    -- from the bank is the cache working, and enqueuing anyway would pay for
    -- questions that already exist.
    CONTINUE WHEN COALESCE((_plan->'tiers'->(_tier::text)->>'shortfall')::int, 0) = 0;

    FOR _src IN SELECT value AS v FROM jsonb_array_elements(_plan->'sources') LOOP
      _qid := (_src.v->>'question_id')::uuid;
      CONTINUE WHEN _qid IS NULL;

      -- Already have one for this question at this tier? Then this plan's
      -- shortfall is at a DIFFERENT source, and paying again would buy a
      -- duplicate. Checked against the bank rather than the queue because the
      -- bank is the truth.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.question_bank qb
         WHERE qb.source_question_id = _qid
           AND qb.variant_tier = _tier
           AND qb.is_active
           AND qb.replaced_by_question_id IS NULL);

      -- ON CONFLICT DO NOTHING against the partial unique index: two students
      -- finishing sessions in the same second, having failed the same
      -- question, must produce one job.
      INSERT INTO public.variant_generation_queue (source_question_id, tier)
      VALUES (_qid, _tier)
      ON CONFLICT DO NOTHING;

      IF FOUND THEN _added := _added + 1; END IF;
    END LOOP;
  END LOOP;

  RETURN _added;
END;
$fn$;

COMMENT ON FUNCTION public._enqueue_variant_generation(jsonb) IS
  'Queue AI generation for the rungs a recovery plan could not fill from the bank. Bank-first (§4.2a): a question that already has a variant at that tier is skipped, so generation is the fallback and never the default.';


-- ── 4. Hook it to the moment a session is prepared ─────────────────────────

CREATE OR REPLACE FUNCTION public._ensure_recovery_session(
  _uid uuid, _student_id uuid, _school_id uuid, _chapter_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _plan  jsonb;
  _round int;
  _rid   uuid;
  _tot   int[] := ARRAY[0,0,0,0];
  _i     int;
BEGIN
  SELECT rs.id INTO _rid
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id
     AND rs.completed_at IS NULL AND rs.plan IS NOT NULL
   LIMIT 1;
  IF _rid IS NOT NULL THEN RETURN _rid; END IF;

  _plan := public._recovery_session_plan_for(_uid, _chapter_id);

  IF _plan->>'mode' IN ('relearn', 'none') THEN RETURN NULL; END IF;

  -- QUEUE THE MISSING RUNGS BEFORE DECIDING WHETHER TO OFFER THE SESSION.
  --
  -- Order matters and this is the whole point of the change. A plan too thin
  -- to diagnose is precisely the plan whose missing questions most need
  -- writing: refusing to offer it AND refusing to queue anything is how a
  -- chapter stays unofferable for ever. §4.1a says an incomplete session is
  -- not offered and that generation RETRIES IN THE BACKGROUND — the retry has
  -- to be queued from somewhere, and this is it.
  PERFORM public._enqueue_variant_generation(_plan);

  IF NOT (COALESCE((_plan->>'complete')::boolean, false)
          OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false)) THEN
    RETURN NULL;
  END IF;

  FOR _i IN 0..3 LOOP
    _tot[_i + 1] := COALESCE((_plan->'tiers'->(_i::text)->>'filled')::int, 0);
  END LOOP;

  SELECT COALESCE(max(rs.round), 0) + 1 INTO _round
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id;

  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total, plan)
  VALUES (_uid, _student_id, _school_id, _chapter_id, _round,
          _tot[1], _tot[2], _tot[3], _tot[4], _plan)
  RETURNING id INTO _rid;

  RETURN _rid;
END;
$fn$;


-- ── 5. The drain ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dispatch_variant_generation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _drain    text;
  _batch    int;
  _max_try  int;
  _sent     int := 0;
  _resolved int;
  _r        record;
BEGIN
  -- RESOLVE FIRST, from the bank. pg_net is fire-and-forget, so a job is done
  -- when the variant EXISTS, never because a request was sent. This also
  -- retires jobs whose variant arrived by any other route.
  WITH done AS (
    UPDATE public.variant_generation_queue q
       SET status = 'done', resolved_at = now()
     WHERE q.status = 'pending'
       AND EXISTS (
         SELECT 1 FROM public.question_bank qb
          WHERE qb.source_question_id = q.source_question_id
            AND qb.variant_tier = q.tier
            AND qb.is_active
            AND qb.replaced_by_question_id IS NULL)
    RETURNING 1)
  SELECT count(*)::int INTO _resolved FROM done;

  _batch   := public._recovery_const('GENERATION_BATCH_SIZE')::int;
  _max_try := public._recovery_const('GENERATION_MAX_RETRIES')::int;

  -- Jobs that have exhausted their retries stop costing money. §4.1a wants
  -- failures invisible and retried; it does not want them retried for ever.
  UPDATE public.variant_generation_queue
     SET status = 'failed', resolved_at = now(),
         last_error = COALESCE(last_error, 'exhausted retries with no variant in the bank')
   WHERE status = 'pending' AND attempts >= _max_try;

  SELECT decrypted_secret INTO _drain
    FROM vault.decrypted_secrets WHERE name = 'variant_generation_drain';

  IF _drain IS NULL THEN
    -- A missing secret is reported and nothing is sent. Silently doing nothing
    -- is how this feature spent months looking healthy while generating zero.
    RAISE WARNING 'dispatch_variant_generation: vault secret variant_generation_drain is missing; % job(s) wait',
      (SELECT count(*) FROM public.variant_generation_queue WHERE status = 'pending');
    RETURN 0;
  END IF;

  FOR _r IN
    SELECT q.id, q.source_question_id, q.tier
      FROM public.variant_generation_queue q
     WHERE q.status = 'pending'
       AND q.attempts < _max_try
     ORDER BY q.created_at
     LIMIT _batch
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM net.http_post(
      url := 'https://psqxykzqfvxgsvkmgurn.supabase.co/functions/v1/ai-recovery-variants',
      body := jsonb_build_object(
        'source_question_id', _r.source_question_id,
        'tier', _r.tier,
        'count', 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-variant-drain', _drain),
      timeout_milliseconds := 60000
    );

    UPDATE public.variant_generation_queue
       SET attempts = attempts + 1, dispatched_at = now()
     WHERE id = _r.id;

    _sent := _sent + 1;
  END LOOP;

  RETURN _sent;
END;
$fn$;

COMMENT ON FUNCTION public.dispatch_variant_generation() IS
  'Cron drain for variant generation. Resolves finished jobs from the BANK (pg_net is fire-and-forget, so a send proves nothing), retires jobs past GENERATION_MAX_RETRIES, then dispatches up to GENERATION_BATCH_SIZE. Presents the vault secret variant_generation_drain, never the service-role key.';

REVOKE ALL ON FUNCTION public.dispatch_variant_generation()          FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._enqueue_variant_generation(jsonb)     FROM anon, authenticated;


-- ── 6. Run it ──────────────────────────────────────────────────────────────

SELECT cron.schedule(
  'drain-variant-generation',
  '* * * * *',
  'SELECT public.dispatch_variant_generation()');

DO $check$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM cron.job WHERE jobname = 'drain-variant-generation';
  IF _n <> 1 THEN
    RAISE EXCEPTION 'the cron job was not scheduled (% rows)', _n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'variant_generation_drain') THEN
    RAISE EXCEPTION 'the vault secret variant_generation_drain is missing — the cron would tick for ever sending nothing';
  END IF;
END $check$;

COMMIT;
