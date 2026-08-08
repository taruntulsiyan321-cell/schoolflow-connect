import { useState, useEffect, useId } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, dashboardForRole, canAccessPath, mapAuthError } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  GraduationCap,
  Loader2,
  BookOpen,
  Users,
  Eye,
  EyeOff,
  ArrowLeft,
  CheckCircle2,
  Sparkles,
  Lock,
  Mail,
  User,
  Phone,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { validateEmail } from "@/lib/emailValidation";
import { cn } from "@/lib/utils";
import { openMsg91Widget, classifyMsg91Failure, isMsg91WidgetConfigured } from "@/lib/msg91Widget";
import { completeMsg91SignIn, phoneToSyntheticEmail } from "@/lib/msg91Auth";

const pwSchema = z.string().min(8, { message: "Min 8 chars" }).max(72);
const nameSchema = z.string().trim().min(1).max(100);

/** Public self-signup is limited — school staff are provisioned by admins */
type SignUpRole = "student" | "parent";

const ROLE_OPTIONS: {
  value: SignUpRole;
  label: string;
  desc: string;
  icon: typeof GraduationCap;
}[] = [
  { value: "student", label: "Student", desc: "Attendance, exams & notices", icon: BookOpen },
  { value: "parent", label: "Parent", desc: "Track your child's progress", icon: Users },
];

const TRUST_POINTS = [
  "Secure cloud authentication",
  "Role-based portal access",
  "Multi-school ready",
];

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          disabled={disabled}
          className="pr-10"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md"
          disabled={disabled}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, loading, status, signIn, requestPasswordReset, homePath, refreshAuth } = useAuth();
  const [tab, setTab] = useState<"signin" | "signup" | "mobile">("signin");
  const [busy, setBusy] = useState(false);

  const signinEmailId = useId();
  const signupNameId = useId();
  const signupEmailId = useId();
  const mobilePhoneId = useId();
  const mobilePwId = useId();
  const profileNameId = useId();

  const from = (location.state as { from?: string } | null)?.from ?? null;
  /** `?next=` is used by the OAuth consent flow to return the user after sign-in. */
  const nextParam = (() => {
    const raw = new URLSearchParams(location.search).get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
  })();

  const [siEmail, setSiEmail] = useState("");
  const [siPw, setSiPw] = useState("");
  const [suName, setSuName] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPw, setSuPw] = useState("");
  const [suRole, setSuRole] = useState<SignUpRole>("student");

  // Mobile tab — OTP (MSG91 widget) or Password, plus new-user profile completion.
  const [mobileMode, setMobileMode] = useState<"otp" | "password">("otp");
  const [mobileBusy, setMobileBusy] = useState(false);
  const [mobilePhone, setMobilePhone] = useState("");
  const [mobilePw, setMobilePw] = useState("");
  const [mobileStep, setMobileStep] = useState<"idle" | "complete_profile">("idle");
  const [mobileName, setMobileName] = useState("");
  const [mobileRole, setMobileRole] = useState<SignUpRole>("student");

  useEffect(() => {
    if (loading || status === "loading") return;
    if (user && (status === "disabled" || status === "missing_role" || status === "missing_profile")) {
      navigate("/unauthorized", {
        replace: true,
        state: { reason: status === "disabled" ? "disabled" : status },
      });
      return;
    }
    if (user && role && status === "authenticated") {
      if (nextParam && canAccessPath(role, nextParam)) {
        navigate(nextParam, { replace: true });
        return;
      }
      const dest =
        from && from !== "/auth" && canAccessPath(role, from)
          ? from
          : homePath || dashboardForRole(role);
      navigate(dest, { replace: true });
    }
  }, [user, role, loading, status, navigate, from, homePath, nextParam]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ev = validateEmail(siEmail);
    if (!ev.ok) {
      toast.error(ev.message);
      return;
    }
    if (!siPw.trim()) {
      toast.error("Enter your password");
      return;
    }
    setBusy(true);
    const { error } = await signIn({ email: ev.email, password: siPw });
    setBusy(false);
    if (error) return toast.error(error);
    toast.success("Welcome back!");
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const nv = nameSchema.safeParse(suName);
    const ev = validateEmail(suEmail);
    const pv = pwSchema.safeParse(suPw);
    if (!nv.success) return toast.error("Enter your full name");
    if (!ev.ok) {
      toast.error(ev.message);
      return;
    }
    if (!pv.success) return toast.error(pv.error.issues[0].message);
    setBusy(true);
    // Staff roles are admin-provisioned. Student/parent may self-claim via intended_role + RPC.
    const { data, error } = await supabase.auth.signUp({
      email: ev.email,
      password: pv.data,
      options: {
        emailRedirectTo: `${window.location.origin}/auth${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ""}`,
        data: { full_name: nv.data, intended_role: suRole },
      },
    });
    if (error) {
      setBusy(false);
      return toast.error(mapAuthError(error));
    }
    // Prefer SECURITY DEFINER RPC (bypasses RLS) over direct user_roles insert
    if (data.session && data.user && (suRole === "student" || suRole === "parent")) {
      const { error: roleErr } = await (supabase.rpc as any)("claim_signup_role", { _role: suRole });
      if (roleErr) {
        console.warn("[auth] claim_signup_role:", roleErr.message);
      }
    }
    setBusy(false);
    toast.success(
      data.session
        ? "Account created! Taking you to your dashboard…"
        : "Account created — check your email to confirm, then sign in.",
    );
    if (!data.session) setTab("signin");
  };

  const handleReset = async () => {
    if (busy) return;
    const ev = validateEmail(siEmail);
    if (!ev.ok) {
      toast.error("Enter your email above, then tap Forgot password");
      return;
    }
    setBusy(true);
    const { error } = await requestPasswordReset(ev.email);
    setBusy(false);
    if (error) return toast.error(error);
    toast.success("Reset link sent — check your inbox");
  };

  const handleGoogle = async () => {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setBusy(false);
      toast.error(error.message || "Google sign-in failed");
      return;
    }
    // Success navigates the browser away to Google's consent screen.
  };

  /** Opens the MSG91 widget; the client never asserts a phone number — only
   *  the access-token it returns is ever sent anywhere. */
  const handleMobileOtp = async () => {
    if (mobileBusy) return;
    if (!isMsg91WidgetConfigured()) {
      toast.error("Mobile sign-in isn't configured yet.");
      return;
    }
    setMobileBusy(true);
    await openMsg91Widget({
      onSuccess: async (accessToken) => {
        const result = await completeMsg91SignIn(accessToken);
        setMobileBusy(false);
        if (result.ok !== true) {
          toast.error(result.error);
          return;
        }
        if (result.is_new_user) {
          setMobileStep("complete_profile");
          toast.success(`Mobile verified (${result.verified_phone_masked}) — finish setting up your account.`);
        } else {
          toast.success(`Welcome back! Signed in as ${result.verified_phone_masked}.`);
        }
        // AuthProvider's onAuthStateChange listener already picked up the
        // new session; the top-level effect navigates away as soon as role
        // resolves (existing users: immediately; new users: once
        // handleCompleteMobileProfile below claims a role).
      },
      onFailure: (error) => {
        setMobileBusy(false);
        const { message } = classifyMsg91Failure(error);
        toast.error(message);
      },
    });
  };

  const handleMobilePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const digits = mobilePhone.replace(/[^0-9]/g, "");
    if (digits.length < 8) {
      toast.error("Enter a valid mobile number");
      return;
    }
    if (!mobilePw.trim()) {
      toast.error("Enter your password");
      return;
    }
    setBusy(true);
    const { error } = await signIn({ email: phoneToSyntheticEmail(mobilePhone), password: mobilePw });
    setBusy(false);
    if (error) return toast.error(error);
    toast.success("Welcome back!");
  };

  /** New phone-verified account: claim a role via the same self-signup RPC
   *  the email flow already uses, then save the display name. */
  const handleCompleteMobileProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobileBusy) return;
    const nv = nameSchema.safeParse(mobileName);
    if (!nv.success) return toast.error("Enter your full name");
    setMobileBusy(true);
    try {
      const { error: roleErr } = await (supabase.rpc as any)("claim_signup_role", { _role: mobileRole });
      if (roleErr) throw roleErr;
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user?.id) {
        const { error: profileErr } = await supabase
          .from("profiles")
          .update({ full_name: nv.data })
          .eq("id", authData.user.id);
        if (profileErr) console.warn("[auth] profile name update:", profileErr.message);
      }
      await refreshAuth();
      toast.success("You're all set!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not finish setting up your account");
    } finally {
      setMobileBusy(false);
    }
  };

  if (loading || (user && role && status === "authenticated")) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-soft gap-3 animate-fade-in">
        <div className="w-12 h-12 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-elevated">
          <GraduationCap className="w-6 h-6 text-primary-foreground" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Brand panel */}
      <aside className="relative lg:w-[44%] xl:w-[42%] bg-gradient-hero text-white overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(0 0% 100% / 0.12) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.12) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
          aria-hidden
        />
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/10 blur-3xl animate-float" aria-hidden />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full bg-white/5 blur-2xl" aria-hidden />

        <div className="relative z-10 flex flex-col min-h-[220px] lg:min-h-screen p-6 sm:p-10 lg:p-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-white/75 hover:text-white transition-colors w-fit group"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Back to home
          </Link>

          <div className="flex-1 flex flex-col justify-center py-8 lg:py-0 max-w-md">
            <div className="animate-rise">
              <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-3 py-1 text-xs mb-6 backdrop-blur">
                <Sparkles className="w-3.5 h-3.5" />
                Wisdom Campus · School portal
              </div>

              <div className="flex items-center gap-3 mb-6">
                <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shadow-elevated ring-1 ring-white/20">
                  <GraduationCap className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Vidyalaya</h1>
                  <p className="text-white/75 text-sm mt-0.5">School Management System</p>
                </div>
              </div>

              <p className="text-lg text-white/85 text-balance leading-relaxed">
                One secure sign-in for admins, teachers, students, and parents — attendance, exams, fees, and more.
              </p>

              <ul className="mt-8 space-y-3 stagger hidden sm:block">
                {TRUST_POINTS.map((point) => (
                  <li key={point} className="flex items-center gap-2.5 text-sm text-white/80">
                    <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="text-xs text-white/50 hidden lg:block animate-fade-in">
            Native push notifications coming soon.
          </p>
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex-1 flex items-center justify-center bg-gradient-soft p-4 sm:p-8 lg:p-12">
        <div className="w-full max-w-[420px] animate-rise">
          <div className="mb-8 lg:hidden text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-primary shadow-card mb-3">
              <GraduationCap className="w-6 h-6 text-primary-foreground" />
            </div>
            <h2 className="text-xl font-bold">Welcome to Vidyalaya</h2>
            <p className="text-sm text-muted-foreground mt-1">Sign in to your school portal</p>
          </div>

          <div className="surface-elevated p-6 sm:p-8 rounded-2xl">
            <div className="hidden lg:block mb-6">
              <h2 className="text-2xl font-bold tracking-tight">
                {tab === "signin" ? "Welcome back" : tab === "mobile" ? "Sign in with mobile" : "Create your account"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {tab === "signin"
                  ? "Enter your credentials to access your dashboard."
                  : tab === "mobile"
                    ? "New or returning — your mobile number takes you straight in."
                    : "Join your school's digital campus in minutes."}
              </p>
            </div>

            {/* Tab switcher */}
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-muted/80 mb-6"
            >
              {(["signin", "mobile", "signup"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={tab === mode}
                  onClick={() => setTab(mode)}
                  disabled={busy || mobileBusy}
                  className={cn(
                    "relative py-2.5 px-3 text-sm font-medium rounded-lg transition-all duration-200 press",
                    tab === mode
                      ? "bg-background text-foreground shadow-card"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode === "signin" ? "Email" : mode === "mobile" ? "Mobile" : "Sign up"}
                </button>
              ))}
            </div>

            {/* Google OAuth */}
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 flex items-center justify-center gap-2.5 font-medium hover-lift"
              onClick={handleGoogle}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#FFC107"
                    d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z"
                  />
                  <path
                    fill="#FF3D00"
                    d="M6.3 14.7l6.6 4.8C14.7 16 19 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"
                  />
                  <path
                    fill="#4CAF50"
                    d="M24 43.5c5.1 0 9.8-2 13.3-5.2l-6.1-5c-2 1.4-4.5 2.2-7.2 2.2-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39 16.2 43.5 24 43.5z"
                  />
                  <path
                    fill="#1976D2"
                    d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.5l6.1 5c-.4.4 6.7-4.9 6.7-14.5 0-1.2-.1-2.3-.4-3.5z"
                  />
                </svg>
              )}
              Continue with Google
            </Button>

            <div className="flex items-center gap-3 my-5">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground font-medium">
                {tab === "mobile" ? "or with mobile" : "or with email"}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Sign in form */}
            {tab === "signin" && (
              <form key="signin" onSubmit={handleSignIn} className="space-y-4 animate-fade-in" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor={signinEmailId}>Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id={signinEmailId}
                      type="email"
                      value={siEmail}
                      onChange={(e) => setSiEmail(e.target.value)}
                      placeholder="you@school.edu"
                      autoComplete="email"
                      required
                      disabled={busy}
                      className="pl-9"
                    />
                  </div>
                </div>

                <PasswordField
                  id="signin-password"
                  label="Password"
                  value={siPw}
                  onChange={setSiPw}
                  autoComplete="current-password"
                  disabled={busy}
                />

                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={busy}
                    className="text-sm text-primary hover:underline underline-offset-4 transition-colors disabled:opacity-50"
                  >
                    Forgot password?
                  </button>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated transition-shadow"
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 mr-2" />
                      Sign in
                    </>
                  )}
                </Button>
              </form>
            )}

            {/* Mobile tab — OTP via MSG91 widget, or Mobile + Password */}
            {tab === "mobile" && (
              <div key="mobile" className="space-y-4 animate-fade-in">
                {mobileStep === "complete_profile" ? (
                  <form onSubmit={handleCompleteMobileProfile} className="space-y-4" noValidate>
                    <p className="text-sm text-muted-foreground">
                      Your mobile number is verified. Just a couple more details.
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor={profileNameId}>Full name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id={profileNameId}
                          value={mobileName}
                          onChange={(e) => setMobileName(e.target.value)}
                          placeholder="Your full name"
                          autoComplete="name"
                          required
                          disabled={mobileBusy}
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>I am a</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {ROLE_OPTIONS.map(({ value, label, desc, icon: Icon }) => (
                          <button
                            key={value}
                            type="button"
                            disabled={mobileBusy}
                            onClick={() => setMobileRole(value)}
                            className={cn(
                              "flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all duration-200 press",
                              mobileRole === value
                                ? "border-primary bg-primary/5 shadow-glow ring-1 ring-primary/20"
                                : "border-border/70 bg-background hover:border-primary/30 hover:bg-muted/40",
                            )}
                          >
                            <Icon className={cn("w-4 h-4", mobileRole === value ? "text-primary" : "text-muted-foreground")} />
                            <span className="text-sm font-medium leading-none">{label}</span>
                            <span className="text-[11px] text-muted-foreground leading-tight">{desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-11 bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated transition-shadow"
                      disabled={mobileBusy}
                    >
                      {mobileBusy ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Finishing up…
                        </>
                      ) : (
                        "Finish setting up"
                      )}
                    </Button>
                  </form>
                ) : (
                  <>
                    <div
                      role="tablist"
                      aria-label="Mobile sign-in method"
                      className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/60 mb-1"
                    >
                      {(["otp", "password"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="tab"
                          aria-selected={mobileMode === m}
                          onClick={() => setMobileMode(m)}
                          disabled={busy || mobileBusy}
                          className={cn(
                            "py-2 px-3 text-xs font-medium rounded-md transition-all duration-200",
                            mobileMode === m
                              ? "bg-background text-foreground shadow-card"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {m === "otp" ? "OTP" : "Password"}
                        </button>
                      ))}
                    </div>

                    {mobileMode === "otp" ? (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Verify your mobile number with a one-time code. New here? This creates your account too.
                        </p>
                        <Button
                          type="button"
                          onClick={handleMobileOtp}
                          className="w-full h-11 bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated transition-shadow"
                          disabled={mobileBusy}
                        >
                          {mobileBusy ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              Verifying…
                            </>
                          ) : (
                            <>
                              <Phone className="w-4 h-4 mr-2" />
                              Continue with mobile OTP
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={handleMobilePasswordSignIn} className="space-y-4" noValidate>
                        <div className="space-y-1.5">
                          <Label htmlFor={mobilePhoneId}>Mobile number</Label>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                            <Input
                              id={mobilePhoneId}
                              type="tel"
                              value={mobilePhone}
                              onChange={(e) => setMobilePhone(e.target.value)}
                              placeholder="+91 98765 43210"
                              autoComplete="tel"
                              required
                              disabled={busy}
                              className="pl-9"
                            />
                          </div>
                        </div>
                        <PasswordField
                          id={mobilePwId}
                          label="Password"
                          value={mobilePw}
                          onChange={setMobilePw}
                          autoComplete="current-password"
                          disabled={busy}
                        />
                        <Button
                          type="submit"
                          className="w-full h-11 bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated transition-shadow"
                          disabled={busy}
                        >
                          {busy ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              Signing in…
                            </>
                          ) : (
                            <>
                              <KeyRound className="w-4 h-4 mr-2" />
                              Sign in
                            </>
                          )}
                        </Button>
                        <p className="text-[11px] text-muted-foreground">
                          Password sign-in only works after you've verified this number with OTP at least once and set a password (where your portal offers that setting).
                        </p>
                      </form>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Sign up form */}
            {tab === "signup" && (
              <form key="signup" onSubmit={handleSignUp} className="space-y-4 animate-fade-in" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor={signupNameId}>Full name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id={signupNameId}
                      value={suName}
                      onChange={(e) => setSuName(e.target.value)}
                      placeholder="Your full name"
                      autoComplete="name"
                      required
                      disabled={busy}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>I am a</Label>
                  <p className="text-[11px] text-muted-foreground -mt-1">
                    Teachers, principals, and school admins are invited by your school — they cannot self-register here.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {ROLE_OPTIONS.map(({ value, label, desc, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        disabled={busy}
                        onClick={() => setSuRole(value)}
                        className={cn(
                          "flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all duration-200 press",
                          suRole === value
                            ? "border-primary bg-primary/5 shadow-glow ring-1 ring-primary/20"
                            : "border-border/70 bg-background hover:border-primary/30 hover:bg-muted/40",
                        )}
                      >
                        <Icon
                          className={cn(
                            "w-4 h-4",
                            suRole === value ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="text-sm font-medium leading-none">{label}</span>
                        <span className="text-[11px] text-muted-foreground leading-tight">{desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={signupEmailId}>Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id={signupEmailId}
                      type="email"
                      value={suEmail}
                      onChange={(e) => setSuEmail(e.target.value)}
                      placeholder="you@school.edu"
                      autoComplete="email"
                      required
                      disabled={busy}
                      className="pl-9"
                    />
                  </div>
                </div>

                <PasswordField
                  id="signup-password"
                  label="Password"
                  value={suPw}
                  onChange={setSuPw}
                  autoComplete="new-password"
                  hint="Minimum 8 characters"
                  disabled={busy}
                />

                <Button
                  type="submit"
                  className="w-full h-11 bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated transition-shadow"
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Creating account…
                    </>
                  ) : (
                    "Create account"
                  )}
                </Button>
              </form>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6 leading-relaxed">
            By continuing, you agree to your school's portal policies.
            <br className="hidden sm:inline" />
            <span className="sm:ml-1">
              Need help? Contact your school administrator.
            </span>
          </p>

          <div className="flex justify-center mt-4 lg:hidden">
            <Badge variant="secondary" className="text-[10px] font-normal">
              Wisdom Campus · Secure portal
            </Badge>
          </div>
        </div>
      </main>
    </div>
  );
}
