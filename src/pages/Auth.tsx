import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, dashboardForRole, canAccessPath } from "@/auth";
import { cn } from "@/lib/utils";
import {
  classifyMsg91Failure,
  isMsg91WidgetConfigured,
  resendMsg91Otp,
  sendMsg91Otp,
  startMsg91,
  verifyMsg91Otp,
  type Msg91WidgetSettings,
} from "@/lib/msg91Widget";
import { completeMsg91SignIn } from "@/lib/msg91Auth";
import { displayIndianMobile, parseIndianMobile } from "@/lib/indianMobile";
import { toErrorMessage } from "@/lib/presentation";

/**
 * Sign in and register — individual students, by mobile number and OTP.
 *
 * Redesigned 2026-10-02 to the owner's mockup: one centred column, logo,
 * "Welcome Back", two fields and one button. The fields are ours; MSG91 only
 * sends and verifies the code (msg91Widget.ts, headless). Every student
 * prepares for CUET, the one exam open, so the page no longer asks: the exam is
 * part of WHICH account a number signs into (one account per number per exam),
 * and verify-msg91-widget refuses an exam that is not open.
 *
 * Both doors reach the same account: a number that is new is given an account
 * by the verified sign-in whichever view it came through. Register asks for the
 * name up front; a new number that came through Log In is asked for it after.
 */
const LAUNCH_EXAM = "cuet";

const nameSchema = z.string().trim().min(1).max(100);

type View = "login" | "register";
type WidgetState =
  | { status: "loading" }
  | { status: "ready"; settings: Msg91WidgetSettings }
  | { status: "unconfigured" }
  | { status: "failed" };
type FieldError = { field: "name" | "mobile" | "code" | "form"; message: string } | null;

const COPY: Record<View, { title: string; subtitle: string; submit: string; switchPrompt: string; switchTo: string }> = {
  login: {
    title: "Welcome Back",
    subtitle: "Enter your mobile number to access your account.",
    submit: "Log In",
    switchPrompt: "Don't Have An Account?",
    switchTo: "Register Now.",
  },
  register: {
    title: "Create Your Account",
    subtitle: "Register with your mobile number to start preparing for CUET.",
    submit: "Register",
    switchPrompt: "Already Have An Account?",
    switchTo: "Log In.",
  },
};

const FIELD =
  "h-12 w-full rounded-xl border border-border bg-background px-4 text-[15px] text-foreground placeholder:text-muted-foreground/70 transition-colors focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-[invalid=true]:border-destructive";
const PRIMARY =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60";
const LINK = "font-medium text-primary hover:underline underline-offset-4 disabled:opacity-60 disabled:no-underline";

function viewFrom(search: string): View {
  return new URLSearchParams(search).get("mode") === "register" ? "register" : "login";
}

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, loading, status, homePath, refreshAuth } = useAuth();

  // Keep Google from ranking the login screen as the homepage.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Sign in — Gurukul";
    let robots = document.querySelector('meta[name="robots"]');
    const created = !robots;
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    const prevRobots = robots.getAttribute("content");
    robots.setAttribute("content", "noindex, nofollow");
    return () => {
      document.title = prevTitle;
      if (created) robots?.remove();
      else if (prevRobots != null) robots?.setAttribute("content", prevRobots);
      else robots?.removeAttribute("content");
    };
  }, []);

  const from = (location.state as { from?: string } | null)?.from ?? null;
  /** `?next=` is used by the OAuth consent flow to return the user after sign-in. */
  const nextParam = (() => {
    const raw = new URLSearchParams(location.search).get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
  })();

  const ids = { name: useId(), mobile: useId(), code: useId(), error: useId() };
  const codeRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<View>(() => viewFrom(location.search));
  const [widget, setWidget] = useState<WidgetState>(() =>
    isMsg91WidgetConfigured() ? { status: "loading" } : { status: "unconfigured" },
  );
  const [startAttempt, setStartAttempt] = useState(0);

  const [name, setName] = useState("");
  const [mobileInput, setMobileInput] = useState("");
  /** The number a code was sent to; null until one is. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"idle" | "sending" | "resending" | "verifying" | "saving">("idle");
  const [error, setError] = useState<FieldError>(null);
  const [resendAt, setResendAt] = useState(0);
  const [resendsUsed, setResendsUsed] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  /** "signing_in" holds the redirect while a verified sign-in is finished here;
   *  "complete_profile" is a new number that came through Log In. */
  const [phase, setPhase] = useState<"form" | "signing_in" | "complete_profile">("form");

  useEffect(() => {
    if (!isMsg91WidgetConfigured()) return;
    let alive = true;
    setWidget({ status: "loading" });
    startMsg91().then(
      (settings) => alive && setWidget({ status: "ready", settings }),
      () => alive && setWidget({ status: "failed" }),
    );
    return () => {
      alive = false;
    };
  }, [startAttempt]);

  // The resend countdown.
  useEffect(() => {
    if (!sentTo || resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [sentTo, resendAt]);

  useEffect(() => {
    if (loading || status === "loading") return;
    if (phase !== "form") return;
    if (user && (status === "disabled" || status === "missing_profile" || status === "missing_role")) {
      navigate("/unauthorized", { replace: true, state: { reason: status } });
      return;
    }
    if (user && role && status === "authenticated") {
      if (nextParam && canAccessPath(role, nextParam)) {
        navigate(nextParam, { replace: true });
        return;
      }
      const dest =
        from && from !== "/auth" && canAccessPath(role, from) ? from : homePath || dashboardForRole(role);
      navigate(dest, { replace: true });
    }
  }, [user, role, loading, status, navigate, from, homePath, nextParam, phase]);

  const settings = widget.status === "ready" ? widget.settings : null;
  const secondsToResend = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const canResend =
    !!settings && settings.resendChannel !== null && resendsUsed < settings.resendsAllowed && secondsToResend === 0;

  const switchView = (next: View) => {
    if (busy !== "idle") return;
    setView(next);
    setError(null);
    navigate({ search: next === "register" ? "?mode=register" : "" }, { replace: true, state: location.state });
  };

  const changeNumber = () => {
    setSentTo(null);
    setCode("");
    setError(null);
  };

  const sendCode = async () => {
    if (!settings || busy !== "idle") return;
    if (view === "register" && !nameSchema.safeParse(name).success) {
      setError({ field: "name", message: "Enter your full name." });
      return;
    }
    const mobile = parseIndianMobile(mobileInput);
    if (!mobile) {
      setError({ field: "mobile", message: "Enter a valid 10-digit mobile number." });
      return;
    }
    setError(null);
    setBusy("sending");
    try {
      await sendMsg91Otp(mobile);
      setSentTo(mobile);
      setCode("");
      setResendsUsed(0);
      setResendAt(Date.now() + settings.resendAfterSec * 1000);
      setNow(Date.now());
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (e) {
      setError({ field: "mobile", message: classifyMsg91Failure(e).message });
    } finally {
      setBusy("idle");
    }
  };

  const resendCode = async () => {
    if (!settings || !canResend || busy !== "idle") return;
    setError(null);
    setBusy("resending");
    try {
      await resendMsg91Otp(settings.resendChannel);
      setResendsUsed((n) => n + 1);
      setResendAt(Date.now() + settings.resendAfterSec * 1000);
      setNow(Date.now());
      toast.success("We sent you a new code.");
    } catch (e) {
      setError({ field: "code", message: classifyMsg91Failure(e).message });
    } finally {
      setBusy("idle");
    }
  };

  const verifyCode = async () => {
    if (!settings || !sentTo || busy !== "idle") return;
    if (code.length !== settings.otpLength) {
      setError({ field: "code", message: `Enter the ${settings.otpLength}-digit code we sent you.` });
      return;
    }
    setError(null);
    setBusy("verifying");
    let token;
    try {
      token = await verifyMsg91Otp(code);
    } catch (e) {
      setBusy("idle");
      setError({ field: "code", message: classifyMsg91Failure(e).message });
      return;
    }
    // Verified with MSG91: hold the redirect until this page has finished.
    setPhase("signing_in");
    const result = await completeMsg91SignIn(token.token, LAUNCH_EXAM, {
      keys: token.keys,
      jwt_shaped: token.jwt_shaped,
      length: token.length,
    });
    if (result.ok !== true) {
      // The code is spent once MSG91 has accepted it: start again from the number.
      setPhase("form");
      setBusy("idle");
      changeNumber();
      setError({ field: "form", message: toErrorMessage(result.error, "We couldn't sign you in. Please try again.") });
      return;
    }
    if (!result.is_new_user) {
      toast.success(view === "register" ? "You already have an account — signed you in." : "Welcome back!");
      setBusy("idle");
      setPhase("form");
      return;
    }
    if (view === "login") {
      setBusy("idle");
      setPhase("complete_profile");
      return;
    }
    await saveName();
  };

  /** A new account's one remaining step: its name, on the profile and the student row. */
  const saveName = async () => {
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setBusy("idle");
      setError({ field: "name", message: "Enter your full name." });
      return;
    }
    setBusy("saving");
    const { error: nameErr } = await supabase.rpc("rpc_set_my_display_name", { _full_name: parsed.data });
    if (nameErr) {
      setBusy("idle");
      setPhase("complete_profile");
      setError({ field: "name", message: toErrorMessage(nameErr, "We couldn't save your name. Please try again.") });
      return;
    }
    await refreshAuth();
    toast.success("Welcome to Gurukul!");
    setBusy("idle");
    setPhase("form");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (phase === "complete_profile") void saveName();
    else if (sentTo) void verifyCode();
    else void sendCode();
  };

  if (phase !== "complete_profile" && (loading || phase === "signing_in" || (user && role && status === "authenticated"))) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <img src="/gurukul-logo.svg" alt="" className="h-12 w-12" />
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground" role="status">Signing you in…</p>
      </div>
    );
  }

  const copy = COPY[view];
  const errorFor = (field: NonNullable<FieldError>["field"]) => (error?.field === field ? error.message : null);
  const describedBy = (field: NonNullable<FieldError>["field"]) => (error?.field === field ? ids.error : undefined);
  const working = busy !== "idle";

  return (
    <div className="min-h-screen bg-background px-4 py-12 sm:py-16">
      <main className="mx-auto flex w-full max-w-[448px] flex-col">
        <div className="flex flex-col items-center">
          <img src="/gurukul-logo.svg" alt="" className="h-12 w-12" />
          <p className="mt-3 text-lg font-bold tracking-tight text-foreground">Gurukul</p>
        </div>

        <h1 className="mt-10 text-center text-[32px] font-normal leading-tight tracking-tight text-foreground sm:text-[34px]">
          {phase === "complete_profile" ? "Almost There" : copy.title}
        </h1>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-muted-foreground">
          {phase === "complete_profile"
            ? "Your number is verified. What should we call you?"
            : copy.subtitle}
        </p>

        <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
          {(view === "register" || phase === "complete_profile") && (
            <div className="space-y-2">
              <label htmlFor={ids.name} className="text-sm font-medium text-foreground">Full Name</label>
              <input
                id={ids.name}
                className={FIELD}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                autoComplete="name"
                maxLength={100}
                disabled={working}
                aria-invalid={error?.field === "name"}
                aria-describedby={describedBy("name")}
              />
              {errorFor("name") && <FieldMessage id={ids.error}>{errorFor("name")}</FieldMessage>}
            </div>
          )}

          {phase !== "complete_profile" && (
            <>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <label htmlFor={ids.mobile} className="text-sm font-medium text-foreground">Mobile Number</label>
                  {sentTo && (
                    <button type="button" className={cn(LINK, "text-sm")} onClick={changeNumber} disabled={working}>
                      Change
                    </button>
                  )}
                </div>
                <div
                  className={cn(
                    "flex h-12 items-center rounded-xl border border-border bg-background transition-colors focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15",
                    sentTo && "bg-muted",
                    error?.field === "mobile" && "border-destructive",
                  )}
                >
                  <span className="pl-4 pr-3 text-[15px] text-muted-foreground border-r border-border">+91</span>
                  <input
                    id={ids.mobile}
                    className="h-full min-w-0 flex-1 rounded-r-xl bg-transparent px-3 text-[15px] text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground"
                    value={mobileInput}
                    onChange={(e) => setMobileInput(e.target.value)}
                    placeholder="98765 43210"
                    inputMode="tel"
                    autoComplete="tel-national"
                    maxLength={16}
                    disabled={working || !!sentTo}
                    aria-invalid={error?.field === "mobile"}
                    aria-describedby={describedBy("mobile")}
                  />
                </div>
                {errorFor("mobile") && <FieldMessage id={ids.error}>{errorFor("mobile")}</FieldMessage>}
              </div>

              <div className="space-y-2">
                <label htmlFor={ids.code} className="text-sm font-medium text-foreground">OTP</label>
                <div className="relative">
                  <input
                    id={ids.code}
                    ref={codeRef}
                    className={cn(FIELD, "pr-32 tracking-[0.3em] placeholder:tracking-normal")}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, settings?.otpLength ?? 9))}
                    placeholder={sentTo ? `Enter ${settings?.otpLength ?? ""}-digit code` : "Send a code first"}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    disabled={!sentTo || working}
                    aria-invalid={error?.field === "code"}
                    aria-describedby={describedBy("code")}
                  />
                  {sentTo && settings?.resendChannel !== null && (
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm">
                      {busy === "resending" ? (
                        <span className="text-muted-foreground">Sending…</span>
                      ) : resendsUsed >= (settings?.resendsAllowed ?? 0) ? (
                        <span className="text-muted-foreground">No resends left</span>
                      ) : secondsToResend > 0 ? (
                        <span className="tabular-nums text-muted-foreground">Resend in {secondsToResend}s</span>
                      ) : (
                        <button type="button" className={LINK} onClick={() => void resendCode()} disabled={working}>
                          Resend OTP
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {errorFor("code") ? (
                  <FieldMessage id={ids.error}>{errorFor("code")}</FieldMessage>
                ) : sentTo ? (
                  <p className="text-sm text-muted-foreground">We sent a code to {displayIndianMobile(sentTo)}.</p>
                ) : null}
              </div>
            </>
          )}

          {errorFor("form") && <FieldMessage id={ids.error}>{errorFor("form")}</FieldMessage>}

          {widget.status === "loading" && phase !== "complete_profile" ? (
            <p className="text-center text-sm text-muted-foreground" role="status">Getting mobile sign-in ready…</p>
          ) : widget.status === "unconfigured" ? (
            <FieldMessage>Mobile sign-in isn't set up yet. Please try again later.</FieldMessage>
          ) : widget.status === "failed" ? (
            <div className="space-y-2 text-center">
              <FieldMessage>Mobile sign-in couldn't start. Check your connection and try again.</FieldMessage>
              <button type="button" className={cn(LINK, "text-sm")} onClick={() => setStartAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : null}

          <button
            type="submit"
            className={PRIMARY}
            disabled={working || (phase !== "complete_profile" && widget.status !== "ready")}
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {phase === "complete_profile"
              ? busy === "saving" ? "Saving…" : "Continue"
              : busy === "sending"
                ? "Sending code…"
                : busy === "verifying"
                  ? "Verifying…"
                  : sentTo
                    ? copy.submit
                    : "Send OTP"}
          </button>
        </form>

        {phase !== "complete_profile" && (
          <p className="mt-8 text-center text-[15px] text-muted-foreground">
            {copy.switchPrompt}{" "}
            <button
              type="button"
              className={LINK}
              onClick={() => switchView(view === "login" ? "register" : "login")}
              disabled={working}
            >
              {copy.switchTo}
            </button>
          </p>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          By continuing, you agree to Gurukul&apos;s{" "}
          <a href="/terms" className="underline underline-offset-2 hover:text-foreground">terms</a> and{" "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">privacy policy</a>.
        </p>
      </main>
    </div>
  );
}

function FieldMessage({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
