-- Phase 2 (business logic/calculations) audit, 2026-08-22.
--
-- Two compounding defects in the "was this homework late" determination,
-- found by re-verifying the earlier is_late fix against the CURRENT client
-- code (src/academic/repository/homeworkRepository.ts:620-665), not assuming
-- it still holds:
--
-- 1. Timestamp forgery. The earlier fix made `is_late` a server-computed
--    trigger column so a client can't set it directly -- but the trigger
--    computes it FROM `NEW.submitted_at`, and `submitted_at` itself is still
--    client-supplied (`submitted_at: now().toISOString()` using the browser's
--    own clock, homeworkRepository.ts:662) with no DB default or trigger
--    protecting it. A student can submit an arbitrary `submitted_at` (clock
--    skew or a crafted request) and the "server-side" is_late will faithfully
--    -- and wrongly -- compute "on time" from that lie. This defeats the
--    original fix's purpose. `status` ('late'/'submitted') has the identical
--    problem: also client-set from the same forgeable clock, and nothing
--    recomputes it server-side.
--
-- 2. Timezone skew, affecting every submission, not just forged ones. The
--    comparison was `(due_date + due_time) < NEW.submitted_at::timestamp`.
--    due_date/due_time are entered and interpreted everywhere else in the
--    app (confirmed: homeworkRepository.ts:624's `new Date(due_date+"T"+due_time)`,
--    parsed as browser-local time) as IST wall-clock, with no timezone field
--    in the schema at all -- this app has exactly one implicit timezone.
--    submitted_at is timestamptz; casting it to `timestamp` applies the DB
--    SESSION's timezone (confirmed live: UTC), not IST. Comparing an
--    IST-intended due instant against a UTC-read submission clock understates
--    the due instant by IST's fixed +5:30 offset -- every submission got up
--    to 5.5 hours of unearned grace before being marked late.
--
-- Fix: make submitted_at server-authoritative (now(), not client input) and
-- compare it against the due instant using an explicit `AT TIME ZONE
-- 'Asia/Kolkata'` conversion instead of an implicit session-timezone cast --
-- both sides become real timestamptz instants, so no ambiguity is possible.
-- Scoped to TG_OP = 'INSERT' or NEW.status IN ('submitted','late') (the only
-- two values the student submission path ever sends) specifically so this
-- does NOT fire on the teacher grading path's UPDATE (reviewHomeworkRepository's
-- reviewHomeworkSubmission never touches submitted_at/status-as-submitted;
-- it always sets status to graded/reviewed/returned) -- confirmed by reading
-- that function before writing this, so grading timestamps are untouched.
CREATE OR REPLACE FUNCTION public.tg_homework_compute_is_late()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IN ('submitted', 'late') THEN
    NEW.submitted_at := now();

    SELECT (h.due_date + COALESCE(h.due_time, '23:59:59'::time)) AT TIME ZONE 'Asia/Kolkata' < NEW.submitted_at
    INTO NEW.is_late
    FROM public.homework h
    WHERE h.id = NEW.homework_id;

    NEW.status := CASE WHEN NEW.is_late THEN 'late' ELSE 'submitted' END;
  END IF;
  RETURN NEW;
END;
$function$;
