-- ---------------------------------------------------------------------
-- rpc_start_session must be idempotent under concurrency.
--
-- Found by the G8 live-smoke gate, not by this chunk's work: admin, principal
-- and student all logged
--
--   HTTP 409 rpc_start_session -> 23505
--   duplicate key value violates unique constraint "sessions_auth_session_id_key"
--
-- Cause: AuthProvider resolves the context twice on boot — once from
-- onAuthStateChange's INITIAL_SESSION and once from getSession().then() — so
-- two rpc_start_session calls run concurrently. Each SELECTs for an existing
-- sessions row, neither sees the other's uncommitted INSERT, both insert, and
-- the loser gets a 409. The contextRequestId guard in AuthProvider stops a
-- stale result from overwriting newer state; it is not a mutex and does not
-- stop the second call being made.
--
-- Fixed here rather than in the client because the guarantee belongs to the
-- function: this is the session bootstrap every role passes through, and any
-- caller may legitimately call it twice — two tabs, a retry, a remount. A
-- client-side latch would make the symptom rare on one path and leave the
-- function fragile on all the others.
--
-- Only the INSERT changes. Every branch above it, including the unbound-row
-- reuse that keeps public.sessions from growing without bound when the JWT
-- carries no session_id claim, is preserved exactly.
-- ---------------------------------------------------------------------

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

  IF _cnt = 1 THEN
    SELECT m.id INTO _mid
      FROM public.memberships m
     WHERE m.account_id = _uid AND m.status = 'active';
  END IF;

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
    -- When _asid IS NULL nothing can conflict (NULLs are distinct in the
    -- unique index) and this behaves as a plain INSERT — which is correct,
    -- because that case was already resolved by the unbound-row reuse above.
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

COMMENT ON FUNCTION public.rpc_start_session() IS
  'Binds this GoTrue session to a public.sessions row and, when the account holds exactly one active membership, activates it. Idempotent: safe to call concurrently from more than one place on boot, which AuthProvider does. Never creates more than one row per auth session, nor more than one unbound row per account.';


-- Assert the guarantee, not the text: two calls for the SAME auth session
-- must leave exactly one row. Runs as a real authenticated caller so the
-- function is exercised the way the app exercises it.
DO $probe$
DECLARE
  _uid  uuid;
  _asid uuid := gen_random_uuid();
  _n    bigint;
BEGIN
  SELECT m.account_id INTO _uid
    FROM public.memberships m
   WHERE m.status = 'active'
   GROUP BY m.account_id
  HAVING count(*) = 1
   LIMIT 1;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'rpc_start_session probe: no account with exactly one active membership to test with.';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated', 'session_id', _asid)::text, true);

  PERFORM public.rpc_start_session();
  PERFORM public.rpc_start_session();

  SELECT count(*) INTO _n FROM public.sessions s WHERE s.auth_session_id = _asid;

  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _n <> 1 THEN
    RAISE EXCEPTION 'rpc_start_session is not idempotent: two calls for one auth session left % row(s).', _n;
  END IF;

  DELETE FROM public.sessions WHERE auth_session_id = _asid;
END
$probe$;
