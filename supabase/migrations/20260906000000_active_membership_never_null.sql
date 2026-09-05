-- ═══════════════════════════════════════════════════════════════════════════
-- A second membership must not lock the account out of everything
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────
--
-- `active_membership_id()` ends in a last-resort branch that returns a
-- membership only when the account holds EXACTLY ONE:
--
--     (SELECT t.id FROM (
--        SELECT m.id, count(*) OVER () AS n
--          FROM public.memberships m
--         WHERE m.account_id = auth.uid() AND m.status = 'active'
--      ) t WHERE t.n = 1)
--
-- 111 policies across 68 tables call `has_role(auth.uid(), ...)`, whose self
-- branch is keyed on that function. So the moment an account holds a SECOND
-- active membership, `active_membership_id()` returns NULL and `has_role/2`
-- answers false for BOTH roles — every one of those 111 policies refuses that
-- person, everywhere.
--
-- A teacher whose child attends the same school is not an edge case in an
-- Indian school. It is most of the staff.
--
-- ── WHY THE SESSION BRANCHES DO NOT SAVE IT ──────────────────────────────
--
-- The first two branches read `sessions.active_membership_id` and would handle
-- several memberships correctly. They never fire, because nothing populates
-- that column for a multi-membership account:
--
--   · `rpc_start_session()` — called at sign-in from `src/auth/session.ts:76` —
--     sets it only `IF _cnt = 1`. With two it inserts the session row with
--     `active_membership_id` NULL, and both branches INNER JOIN on that column,
--     so both yield nothing.
--   · `rpc_switch_membership()` would set it, and has ZERO callers in `src/`.
--     `session.ts:73` says "the picker must choose". There is no picker.
--
-- ── WHAT THIS PRESENTS AS, WHICH IS WHY IT IS URGENT ─────────────────────
--
-- Not "you have no role". `src/auth/session.ts:87` resolves the client-side
-- role by reading `memberships` directly — a read allowed by
-- `memberships_select_own` (`account_id = auth.uid()`) regardless of any active
-- membership — and picks with its own ROLE_PRIORITY. So the client routes the
-- dual-role teacher into the teacher app, renders it, and every query inside it
-- returns nothing. A fully-drawn application in which nothing works.
--
-- ── THE FIX, AND THE PART OF IT THAT IS A PRODUCT DECISION ───────────────
--
-- Two separate claims, kept separate deliberately:
--
--   CORRECTNESS — `active_membership_id()` must never be NULL for an account
--   that holds at least one active membership. 111 policies depend on it. This
--   is not arguable and is what this migration fixes.
--
--   PREFERENCE — WHICH membership is chosen by default is a product question.
--   This migration does not invent an answer. `src/auth/session.ts:18-25`
--   already ships a ROLE_PRIORITY that decides which app the user is shown:
--
--       super_admin, admin, principal, teacher, student, parent
--
--   The database now uses that same order. The alternative — a different order
--   here — is strictly worse than either: the client would render the teacher
--   app while the database activated the parent membership, which is the same
--   bug wearing a subtler costume (G9, two homes for one decision). Aligning
--   them is not a new product rule; it is making the two existing homes agree.
--
--   Changing the ORDER is a ruling. Changing it here alone is a defect.
--
-- The default applies only where nothing has been chosen. An explicit
-- `rpc_switch_membership` writes `sessions.active_membership_id`, branch 1 or 2
-- then answers, and this branch is never consulted — so switching still wins.
--
-- The `app_role` ENUM ORDER IS NOT A PRIVILEGE ORDER and must not be used:
-- it is (admin, teacher, student, parent, principal, super_admin) — `principal`
-- sorts after `parent`. Hence the explicit mapping below.
--
-- ── WHAT THIS DOES NOT FIX ───────────────────────────────────────────────
--
-- The membership picker still does not exist. A dual-role account now lands in
-- its highest-precedence role and CANNOT LEAVE IT from the UI, because nothing
-- calls `rpc_switch_membership`. That is a degradation; before this migration
-- it was a total lockout. The picker is a separate, client-side change and is
-- written up as a ruling request rather than guessed at here.
--
-- §10.18 (docs/locked-decisions.md:564) — admin creates principals, teachers,
-- students and parents, and multiple admins per school. The schema's UNIQUE
-- (account_id, school_id, role) exists precisely so one account can hold
-- several roles at one institution; this restores the ability to.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── The precedence, in one place ─────────────────────────────────────────
-- IMMUTABLE and internal. Deliberately NOT granted to anon/authenticated: it is
-- only ever called from inside SECURITY DEFINER functions, which run as the
-- owner. Mirrors src/auth/session.ts:18-25 exactly; if that array changes, this
-- must change with it.
CREATE OR REPLACE FUNCTION public._role_precedence(_role app_role)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN 1
    WHEN 'admin'       THEN 2
    WHEN 'principal'   THEN 3
    WHEN 'teacher'     THEN 4
    WHEN 'student'     THEN 5
    WHEN 'parent'      THEN 6
    ELSE 99
  END
$function$;

REVOKE ALL ON FUNCTION public._role_precedence(app_role) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._role_precedence(app_role) IS
  'Role precedence for choosing a DEFAULT active membership when an account '
  'holds several and has chosen none. Mirrors ROLE_PRIORITY in '
  'src/auth/session.ts:18-25 so the database and the client agree on which app '
  'the user is in. NOT a privilege ordering and not an authorization check.';

-- ── The fix ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.active_membership_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- 1. The membership chosen for THIS GoTrue session.
    (SELECT s.active_membership_id
       FROM public.sessions s
       JOIN public.memberships m ON m.id = s.active_membership_id
      WHERE s.account_id = auth.uid()
        AND s.auth_session_id = public.current_auth_session_id()
        AND (s.expires_at IS NULL OR s.expires_at > now())
        AND m.status = 'active'
      LIMIT 1),
    -- 2. The most recent live session for this account that has a choice.
    (SELECT s.active_membership_id
       FROM public.sessions s
       JOIN public.memberships m ON m.id = s.active_membership_id
      WHERE s.account_id = auth.uid()
        AND (s.expires_at IS NULL OR s.expires_at > now())
        AND m.status = 'active'
      ORDER BY s.last_seen_at DESC
      LIMIT 1),
    -- 3. Nothing has been chosen. Fall back to the account's highest-precedence
    --    active membership rather than to NULL. This branch previously required
    --    `count(*) OVER () = 1`, which returned NULL for every account holding a
    --    second membership and refused it through all 111 policies keyed on
    --    has_role. created_at then id break ties so the answer is stable across
    --    calls within a transaction and across sessions.
    (SELECT m.id
       FROM public.memberships m
      WHERE m.account_id = auth.uid()
        AND m.status = 'active'
      ORDER BY public._role_precedence(m.role), m.created_at, m.id
      LIMIT 1)
  )
$function$;

COMMENT ON FUNCTION public.active_membership_id() IS
  'The membership the caller is ACTING IN. Prefers an explicit choice recorded '
  'on the session by rpc_switch_membership; otherwise defaults to the '
  'highest-precedence active membership. Never NULL for an account holding at '
  'least one active membership -- 111 policies depend on that.';

-- ── Materialise the same default at sign-in ──────────────────────────────
-- Body is unchanged except for the `IF _cnt = 1` guard, which becomes an
-- unconditional pick by the same precedence. Everything else -- the unbound-row
-- reuse, the ON CONFLICT race close, the COALESCE that preserves an existing
-- choice -- is carried over verbatim.
CREATE OR REPLACE FUNCTION public.rpc_start_session()
RETURNS TABLE(session_id uuid, active_membership_id uuid, school_id uuid, role app_role, membership_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- The directive above must be the first line of the body. It is here because
-- this function's OUT parameters share names with columns of public.sessions
-- and public.memberships; every reference below is table-qualified anyway, but
-- this removes the ambiguity class instead of relying on that.
DECLARE
  _uid  uuid := auth.uid();
  _asid uuid := public.current_auth_session_id();
  _sid  uuid;
  _mid  uuid;
  _cnt  int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.accounts (id) VALUES (_uid) ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO _cnt
    FROM public.memberships m
   WHERE m.account_id = _uid AND m.status = 'active';

  -- Previously guarded by `IF _cnt = 1`. With two or more this left _mid NULL,
  -- the session row was written pointing at nothing, and the account was
  -- refused by every policy keyed on has_role. membership_count is still
  -- returned so a picker can offer the choice; until one exists the account at
  -- least lands somewhere it can work.
  SELECT m.id INTO _mid
    FROM public.memberships m
   WHERE m.account_id = _uid AND m.status = 'active'
   ORDER BY public._role_precedence(m.role), m.created_at, m.id
   LIMIT 1;

  IF _asid IS NOT NULL THEN
    SELECT s.id INTO _sid FROM public.sessions s WHERE s.auth_session_id = _asid;
  ELSE
    -- No session_id claim in the JWT. Without this branch every call would
    -- insert another row (auth_session_id IS NULL never collides with the
    -- UNIQUE index), growing public.sessions without bound. Reuse the
    -- account's own unbound row instead: at most one per account.
    SELECT s.id INTO _sid
      FROM public.sessions s
     WHERE s.account_id = _uid
       AND s.auth_session_id IS NULL
     ORDER BY s.last_seen_at DESC
     LIMIT 1;
  END IF;

  IF _sid IS NULL THEN
    -- ON CONFLICT closes the race: a concurrent call that committed its row
    -- between the SELECT above and this INSERT is adopted instead of
    -- colliding. The DO UPDATE mirrors the ELSE branch below, so a caller
    -- that loses the race gets exactly what the winner would have produced.
    INSERT INTO public.sessions (account_id, auth_session_id, active_membership_id)
    VALUES (_uid, _asid, _mid)
    ON CONFLICT (auth_session_id) DO UPDATE
       SET last_seen_at = now(),
           active_membership_id =
             COALESCE(public.sessions.active_membership_id, EXCLUDED.active_membership_id)
    RETURNING id, public.sessions.active_membership_id INTO _sid, _mid;
  ELSE
    UPDATE public.sessions s
       SET last_seen_at = now(),
           active_membership_id = COALESCE(s.active_membership_id, _mid)
     WHERE s.id = _sid
     RETURNING s.active_membership_id INTO _mid;
  END IF;

  RETURN QUERY
  SELECT _sid,
         m.id,
         m.school_id,
         m.role,
         _cnt
    FROM public.sessions s
    LEFT JOIN public.memberships m ON m.id = s.active_membership_id
   WHERE s.id = _sid;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- This runs as `postgres` and therefore proves NOTHING about who is refused
-- (rule 6). It checks the shape of what was installed. The behavioural claims
-- — that a dual-role account reaches BOTH surfaces, that it still cannot reach
-- a role it does not hold, and that the fence to another school survives — are
-- asserted as the caller in probe13.sql (rule 7).
--
-- EVERY MATCH BELOW STRIPS COMMENTS FIRST. A guard that matches a function body
-- must, in BOTH directions:
--   · asserting ABSENCE  — a comment naming the forbidden identifier fails a
--     correct change. This is what bit `examAvg` twice, in f6e2f51 and 1ec1628.
--   · asserting PRESENCE — worse. A comment containing the required string lets
--     a genuinely unguarded function pass as safe.
-- This block explains its own change at length and would trip both without it.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _ami  text;
  _rss  text;
  -- POSIX ARE: without the 'n' flag `.` matches newline, so the block-comment
  -- alternative spans lines. Adding 'n' would silently stop it doing so.
  _strip constant text := '--[^\n]*|/\*.*?\*/';
BEGIN
  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g')
    INTO _ami
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'active_membership_id';

  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g')
    INTO _rss
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_start_session';

  IF _ami IS NULL OR _rss IS NULL THEN
    RAISE EXCEPTION 'ABORT: a function this migration replaces is missing';
  END IF;

  -- The exactly-one restriction is the defect. It must be gone from both.
  IF _ami ~ 'n\s*=\s*1' THEN
    RAISE EXCEPTION 'ABORT: active_membership_id still requires exactly one membership';
  END IF;
  IF _rss ~ '_cnt\s*=\s*1' THEN
    RAISE EXCEPTION 'ABORT: rpc_start_session still activates only a single membership';
  END IF;

  -- ...and the default must actually be ordered, not merely unrestricted.
  IF _ami !~ '_role_precedence' OR _rss !~ '_role_precedence' THEN
    RAISE EXCEPTION 'ABORT: the default membership is not chosen by a stated precedence';
  END IF;

  -- An explicit choice must still win, or switching becomes decorative.
  IF _ami !~ 'current_auth_session_id' THEN
    RAISE EXCEPTION 'ABORT: the session-bound branch was lost; switching would no longer take effect';
  END IF;

  -- Status must still gate. Without it a revoked membership could be activated.
  IF _ami !~ 'status' OR _rss !~ 'status' THEN
    RAISE EXCEPTION 'ABORT: the active-status filter was lost';
  END IF;

  -- The precedence must not leak to callers: it is a defaulting rule, not an
  -- authorization primitive, and nothing outside a definer body may call it.
  IF has_function_privilege('anon', 'public._role_precedence(public.app_role)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._role_precedence(public.app_role)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: _role_precedence is executable by a client role';
  END IF;

  -- Positive control on the guard itself: prove the comment stripper ran. The
  -- literal below appears ONLY inside a comment in active_membership_id, so if
  -- stripping silently failed this fires and the whole block is untrustworthy.
  IF _ami ~ 'refused it through all 111 policies' THEN
    RAISE EXCEPTION 'ABORT: comment stripping did not run; every match above is unreliable';
  END IF;
END $verify$;

COMMIT;
