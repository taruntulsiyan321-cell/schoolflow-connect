import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadAuthContext, clearClientAuthCaches } from "./session";
import { mapAuthError } from "./rbac";
import { dashboardForRole } from "./rbac";
import type {
  AppRole,
  AuthContextData,
  AuthProfile,
  AuthSchool,
  AuthStatus,
  SignInCredentials,
} from "./types";

/** A hung identity-load request must not leave every dashboard behind an
 *  infinite spinner — bound it and let applyContext's existing catch/finally
 *  turn a hang into a real (recoverable) error state instead. */
const AUTH_CONTEXT_TIMEOUT_MS = 15_000;

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  profile: AuthProfile | null;
  school: AuthSchool | null;
  schoolId: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  status: AuthStatus;
  /** Sign in with email + password (Supabase Auth) */
  signIn: (credentials: SignInCredentials) => Promise<{ error: string | null }>;
  /** Request password recovery email */
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  /** Update password (recovery or signed-in session) */
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Force re-fetch of profile / role / school */
  refreshAuth: () => Promise<void>;
  /** Home path for the current role */
  homePath: string;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ctx, setCtx] = useState<AuthContextData | null>(null);
  const [loading, setLoading] = useState(true);
  const bootstrapped = useRef<string | null>(null);
  /** Monotonic id so a slower loadAuthContext cannot overwrite a newer session. */
  const contextRequestId = useRef(0);

  const applyContext = useCallback(async (uid: string | undefined | null, requestId?: number) => {
    const id = requestId ?? ++contextRequestId.current;
    // If this call's id is already stale (e.g. a deferred call whose id was
    // captured before scheduling, and a sign-out advanced the counter while
    // it waited), bail before touching any state.
    if (id !== contextRequestId.current) return;
    if (!uid) {
      setCtx(null);
      bootstrapped.current = null;
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await Promise.race([
        loadAuthContext(uid),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Timed out loading auth context")),
            AUTH_CONTEXT_TIMEOUT_MS,
          ),
        ),
      ]);
      if (id !== contextRequestId.current) return;
      setCtx(data);
      bootstrapped.current = uid;
    } catch (err) {
      if (id !== contextRequestId.current) return;
      console.error("[auth] failed to load context", err);
      setCtx(null);
    } finally {
      if (id === contextRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);

      // Recovery sessions land on /reset-password — still restore user
      if (event === "SIGNED_OUT") {
        contextRequestId.current += 1;
        setCtx(null);
        bootstrapped.current = null;
        // Also fires on token expiry, another tab signing out, and server-side
        // revocation — not just the signOut() button — so the caches have to be
        // dropped here too or the next user on this device reads them.
        clearClientAuthCaches();
        queryClient.clear();
        setLoading(false);
        return;
      }

      if (sess?.user) {
        // Keep loading=true until role/profile resolve — same as pre-refactor.
        // Without this, Auth/Index briefly see user+!role and send users to
        // /unauthorized ("No portal role") before loadAuthContext finishes.
        setLoading(true);
        // Defer DB work to avoid auth deadlock. Capture the request id
        // synchronously (before scheduling) rather than inside the timeout
        // callback -- otherwise a sign-out landing first advances
        // contextRequestId, and the still-pending callback would then bump
        // it again for itself and wrongly treat itself as the newest
        // request, resurrecting stale profile/role state right after logout.
        const requestId = ++contextRequestId.current;
        setTimeout(() => {
          void applyContext(sess.user.id, requestId);
        }, 0);
      } else {
        contextRequestId.current += 1;
        setCtx(null);
        bootstrapped.current = null;
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        void applyContext(s.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [applyContext, queryClient]);

  const signIn = useCallback(async ({ email, password }: SignInCredentials) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) return { error: mapAuthError(error) };
    return { error: null };
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { error: mapAuthError(error) };
    return { error: null };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: mapAuthError(error) };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      contextRequestId.current += 1;
      await supabase.auth.signOut();
      setCtx(null);
      setSession(null);
      setUser(null);
      bootstrapped.current = null;
      clearClientAuthCaches();
      queryClient.clear();
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  const refreshAuth = useCallback(async () => {
    if (user?.id) await applyContext(user.id);
  }, [user?.id, applyContext]);

  const role = ctx?.role ?? null;
  const profile = ctx?.profile ?? null;
  const school = ctx?.school ?? null;
  const schoolId = school?.id ?? null;

  const status: AuthStatus = useMemo(() => {
    if (loading) return "loading";
    if (!user) return "unauthenticated";
    if (!ctx) return "missing_profile";
    if (profile && !profile.isActive) return "disabled";
    if (!role) return "missing_role";
    return "authenticated";
  }, [loading, user, ctx, profile, role]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      session,
      role,
      profile,
      school,
      schoolId,
      loading,
      isAuthenticated: status === "authenticated",
      status,
      signIn,
      requestPasswordReset,
      updatePassword,
      signOut,
      refreshAuth,
      homePath: dashboardForRole(role),
    }),
    [
      user,
      session,
      role,
      profile,
      school,
      schoolId,
      loading,
      status,
      signIn,
      requestPasswordReset,
      updatePassword,
      signOut,
      refreshAuth,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
