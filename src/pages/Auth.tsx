import { useState, useEffect, useId } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, dashboardForRole, canAccessPath, mapAuthError } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  X,
} from "lucide-react";
import { toast } from "sonner";
import { validateEmail } from "@/lib/emailValidation";
import { cn } from "@/lib/utils";
import { openMsg91Widget, closeMsg91Widget, classifyMsg91Failure, isMsg91WidgetConfigured } from "@/lib/msg91Widget";
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

/** What the portal actually does, standing in for the old generic
 *  "Secure cloud authentication" checklist — concrete beats vague. */
const CAMPUS_PILLARS: { label: string; icon: typeof GraduationCap }[] = [
  { label: "Attendance", icon: CheckCircle2 },
  { label: "Exams", icon: BookOpen },
  { label: "Fees", icon: KeyRound },
  { label: "Notices", icon: Sparkles },
];

/** Sliding-indicator tab control — replaces the three near-identical
 *  grey-pill segmented switchers that used to be hand-rolled per tab. */
function TabSwitch<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
  size = "md",
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  size?: "md" | "sm";
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "relative grid p-0.5 rounded-full bg-muted/70",
        size === "md" ? "h-11" : "h-9",
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <div
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-full bg-card shadow-card transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          width: `calc(${100 / options.length}% - 4px)`,
          transform: `translateX(calc(${idx * 100}% + ${idx * 4}px))`,
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 flex items-center justify-center rounded-full font-medium transition-colors duration-200",
            size === "md" ? "text-sm" : "text-xs",
            value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
      <div className="relative group">
        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none transition-colors duration-200 group-focus-within:text-primary" />
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          disabled={disabled}
          className="h-12 pl-10 pr-10 rounded-xl border-border/50 bg-muted/40 text-[15px] shadow-none transition-all duration-200 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
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

  // Email tab — Password (existing) or OTP-via-link (new).
  const [emailMode, setEmailMode] = useState<"password" | "otp">("password");
  const [emailOtpEmail, setEmailOtpEmail] = useState("");
  const [emailOtpBusy, setEmailOtpBusy] = useState(false);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpCooldown, setEmailOtpCooldown] = useState(0);

  // Mobile tab — OTP (MSG91 widget) or Password.
  const [mobileMode, setMobileMode] = useState<"otp" | "password">("otp");
  const [mobileBusy, setMobileBusy] = useState(false);
  const [mobileCancelling, setMobileCancelling] = useState(false);
  const [mobilePhone, setMobilePhone] = useState("");
  const [mobilePw, setMobilePw] = useState("");

  // New-user profile completion — shared by every OTP-style path (mobile widget,
  // email link) since neither collects a name/role up front the way
  // Email+Password sign-up does. status === "missing_role" is the single
  // source of truth for "show this"; see the redirect effect below.
  const [profileStep, setProfileStep] = useState<"idle" | "complete_profile">("idle");
  const [profileBusy, setProfileBusy] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountRole, setNewAccountRole] = useState<SignUpRole>("student");

  useEffect(() => {
    if (loading || status === "loading") return;
    // missing_role is the expected, self-serviceable state for any brand-new
    // OTP-style account (mobile widget or email link both land here, since
    // neither collects a name/role up front) -- show the completion form
    // instead of sending them to the dead-end "ask your admin" page. This
    // also fixes a real race that predates this change: applyContext's role
    // resolution resolves asynchronously after the session is created, so
    // without this branch this effect could fire mid-signup and yank a
    // brand-new user away before they ever saw the completion form.
    if (user && status === "missing_role") {
      setProfileStep("complete_profile");
      return;
    }
    if (user && (status === "disabled" || status === "missing_profile")) {
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

  useEffect(() => {
    if (emailOtpCooldown <= 0) return;
    const t = setTimeout(() => setEmailOtpCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [emailOtpCooldown]);

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
          setProfileStep("complete_profile");
          toast.success(`Mobile verified (${result.verified_phone_masked}) — finish setting up your account.`);
        } else {
          toast.success(`Welcome back! Signed in as ${result.verified_phone_masked}.`);
        }
        // AuthProvider's onAuthStateChange listener already picked up the
        // new session; the top-level effect navigates away as soon as role
        // resolves (existing users: immediately; new users: once
        // handleCompleteProfile below claims a role).
      },
      onFailure: (error) => {
        setMobileBusy(false);
        const { message } = classifyMsg91Failure(error);
        toast.error(message);
      },
    });
  };

  /** Cancels an in-progress MSG91 widget verification and returns the user
   *  to the mobile sign-in screen — see closeMsg91Widget() for why this is
   *  async and not instantaneous (MSG91's own overlay needs a moment to
   *  release). `mobileCancelling` covers that gap so the Cancel button
   *  itself never appears to do nothing. */
  const handleCancelMobileOtp = async () => {
    if (mobileCancelling) return;
    setMobileCancelling(true);
    await closeMsg91Widget();
    setMobileBusy(false);
    setMobileCancelling(false);
  };

  const handleMobilePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const email = phoneToSyntheticEmail(mobilePhone);
    if (!email) {
      toast.error("Enter a valid mobile number");
      return;
    }
    if (!mobilePw.trim()) {
      toast.error("Enter your password");
      return;
    }
    setBusy(true);
    const { error } = await signIn({ email, password: mobilePw });
    setBusy(false);
    if (error) return toast.error(error);
    toast.success("Welcome back!");
  };

  /** New OTP-verified account (mobile widget or email link): claim a role
   *  via the same self-signup RPC Email+Password uses, then save the
   *  display name. Shared by every path that lands on status ===
   *  "missing_role" — see the redirect effect above. */
  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profileBusy) return;
    const nv = nameSchema.safeParse(newAccountName);
    if (!nv.success) return toast.error("Enter your full name");
    setProfileBusy(true);
    try {
      const { error: roleErr } = await (supabase.rpc as any)("claim_signup_role", { _role: newAccountRole });
      if (roleErr) throw roleErr;
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user?.id) {
        const { error: profileErr } = await supabase
          .from("profiles")
          .update({ full_name: nv.data })
          .eq("id", authData.user.id);
        if (profileErr) console.warn("[auth] profile name update:", profileErr.message);
      }
      setProfileStep("idle");
      await refreshAuth();
      toast.success("You're all set!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not finish setting up your account");
    } finally {
      setProfileBusy(false);
    }
  };

  /** Sends a sign-in link to the given email via Supabase's own OTP
   *  mechanism (supabase.auth.signInWithOtp) -- no third-party provider or
   *  edge function needed, unlike phone. Creates the account automatically
   *  if the email is new; the existing top-level redirect effect picks up
   *  the resulting session via onAuthStateChange exactly like every other
   *  sign-in method once the user clicks the link and lands back on /auth. */
  const handleEmailOtpSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailOtpBusy || emailOtpCooldown > 0) return;
    const ev = validateEmail(emailOtpEmail);
    if (!ev.ok) {
      toast.error(ev.message);
      return;
    }
    setEmailOtpBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: ev.email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ""}`,
      },
    });
    setEmailOtpBusy(false);
    if (error) return toast.error(mapAuthError(error));
    setEmailOtpSent(true);
    setEmailOtpCooldown(30);
    toast.success(`Sign-in link sent to ${ev.email}.`);
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
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(0 0% 100% / 0.14) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.14) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
          aria-hidden
        />
        <div
          className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-[480px] h-[480px] rounded-full opacity-60"
          style={{ background: "radial-gradient(circle, rgba(202,164,106,0.16) 0%, rgba(202,164,106,0) 70%)" }}
          aria-hidden
        />

        <div className="relative z-10 flex flex-col min-h-[240px] lg:min-h-screen p-6 sm:p-10 lg:p-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors w-fit group"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Back to home
          </Link>

          <div className="flex-1 flex flex-col justify-center py-8 lg:py-0 max-w-md">
            <div className="animate-rise">
              {/* Seal — a circle reads as "the mark," distinct from the small
                  rounded-square icon tiles used for utility actions elsewhere
                  in the app. */}
              <div className="relative w-16 h-16 mb-7">
                <div className="absolute inset-0 rounded-full border border-[#caa46a]/50" aria-hidden />
                <div className="absolute inset-[3px] rounded-full bg-white/[0.07] backdrop-blur flex items-center justify-center ring-1 ring-white/15 shadow-elevated">
                  <GraduationCap className="w-7 h-7 text-[#e3c793]" strokeWidth={1.75} />
                </div>
              </div>

              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#caa46a]" aria-hidden />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/55">
                  Wisdom Campus · School Portal
                </span>
              </div>

              <h1 className="text-4xl sm:text-[2.75rem] font-bold tracking-tight leading-[1.05] text-balance">
                Vidyalaya
              </h1>
              <p className="text-white/60 text-sm mt-1.5 mb-6">School Management System</p>

              <p className="text-lg text-white/85 text-balance leading-relaxed">
                One secure sign-in for admins, teachers, students, and parents.
              </p>

              <div className="mt-9 hidden sm:flex items-stretch stagger">
                {CAMPUS_PILLARS.map(({ label, icon: Icon }, i) => (
                  <div
                    key={label}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-2 py-1 text-center",
                      i > 0 && "border-l border-white/10",
                    )}
                  >
                    <Icon className="w-4 h-4 text-[#e3c793]" strokeWidth={1.75} />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-white/55">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="font-mono text-[11px] uppercase tracking-wide text-white/35 hidden lg:block animate-fade-in">
            Native push notifications — coming soon
          </p>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex-1 flex items-center justify-center bg-gradient-soft p-4 sm:p-8 lg:p-12 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, hsl(var(--foreground) / 0.06) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
          aria-hidden
        />
        <div className="relative w-full max-w-[420px] animate-rise">
          <div className="relative surface-elevated rounded-2xl overflow-hidden">
            <div
              className="h-[3px] w-full"
              style={{ background: "linear-gradient(90deg, #caa46a 0%, #3b5bdb 55%, #caa46a 100%)" }}
              aria-hidden
            />
            <div className="p-6 sm:p-8">
            <div className="mb-6">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                {profileStep === "complete_profile"
                  ? "Almost there"
                  : tab === "signin"
                    ? "Welcome back"
                    : tab === "mobile"
                      ? "Sign in with mobile"
                      : "Create your account"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {profileStep === "complete_profile"
                  ? "You're verified — just a couple more details."
                  : tab === "signin"
                    ? "Enter your credentials to access your dashboard."
                    : tab === "mobile"
                      ? "New or returning — your mobile number takes you straight in."
                      : "Join your school's digital campus in minutes."}
              </p>
            </div>

            {profileStep === "complete_profile" ? (
              <form onSubmit={handleCompleteProfile} className="space-y-4 animate-fade-in" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor={profileNameId}>Full name</Label>
                  <div className="relative group">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none transition-colors duration-200 group-focus-within:text-primary" />
                    <Input
                      id={profileNameId}
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      placeholder="Your full name"
                      autoComplete="name"
                      required
                      disabled={profileBusy}
                      className="h-12 pl-10 rounded-xl border-border/50 bg-muted/40 text-[15px] shadow-none transition-all duration-200 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
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
                        disabled={profileBusy}
                        onClick={() => setNewAccountRole(value)}
                        className={cn(
                          "flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all duration-200 press",
                          newAccountRole === value
                            ? "border-primary bg-primary/5 shadow-glow ring-1 ring-primary/20"
                            : "border-border/70 bg-background hover:border-primary/30 hover:bg-muted/40",
                        )}
                      >
                        <Icon className={cn("w-4 h-4", newAccountRole === value ? "text-primary" : "text-muted-foreground")} />
                        <span className="text-sm font-medium leading-none">{label}</span>
                        <span className="text-[11px] text-muted-foreground leading-tight">{desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 rounded-xl bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated hover:brightness-[1.06] active:brightness-95 transition-all duration-300"
                  disabled={profileBusy}
                >
                  {profileBusy ? (
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
            {/* Tab switcher */}
            <div className="mb-6">
              <TabSwitch
                ariaLabel="Authentication mode"
                value={tab}
                onChange={setTab}
                disabled={busy || mobileBusy}
                options={[
                  { value: "signin", label: "Email" },
                  { value: "mobile", label: "Mobile" },
                  { value: "signup", label: "Sign up" },
                ]}
              />
            </div>

            {/* Google OAuth */}
            <Button
              type="button"
              variant="outline"
              className="w-full h-12 rounded-xl border-border/60 flex items-center justify-center gap-2.5 font-medium hover-lift"
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

            {/* Sign in form — Password (existing) or OTP-via-link (new) */}
            {tab === "signin" && (
              <div key="signin" className="space-y-4 animate-fade-in">
                <TabSwitch
                  size="sm"
                  ariaLabel="Email sign-in method"
                  value={emailMode}
                  onChange={setEmailMode}
                  disabled={busy || emailOtpBusy}
                  options={[
                    { value: "password", label: "Password" },
                    { value: "otp", label: "OTP" },
                  ]}
                />

                {emailMode === "password" ? (
                  <form onSubmit={handleSignIn} className="space-y-4" noValidate>
                    <div className="space-y-1.5">
                      <Label htmlFor={signinEmailId}>Email address</Label>
                      <div className="relative group">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none transition-colors duration-200 group-focus-within:text-primary" />
                        <Input
                          id={signinEmailId}
                          type="email"
                          value={siEmail}
                          onChange={(e) => setSiEmail(e.target.value)}
                          placeholder="you@school.edu"
                          autoComplete="email"
                          required
                          disabled={busy}
                          className="h-12 pl-10 rounded-xl border-border/50 bg-muted/40 text-[15px] shadow-none transition-all duration-200 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
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
                      className="w-full h-12 rounded-xl bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated hover:brightness-[1.06] active:brightness-95 transition-all duration-300"
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
                ) : emailOtpSent ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      We sent a sign-in link to <span className="font-medium text-foreground">{emailOtpEmail}</span>.
                      Open it on this device to continue — new here? The same link creates your account too.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-10"
                      disabled={emailOtpBusy || emailOtpCooldown > 0}
                      onClick={handleEmailOtpSend}
                    >
                      {emailOtpBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Mail className="w-4 h-4 mr-2" />
                      )}
                      {emailOtpCooldown > 0 ? `Resend in ${emailOtpCooldown}s` : "Resend link"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setEmailOtpSent(false);
                        setEmailOtpCooldown(0);
                      }}
                      className="text-sm text-primary hover:underline underline-offset-4 transition-colors block mx-auto"
                    >
                      Use a different email
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleEmailOtpSend} className="space-y-4" noValidate>
                    <div className="space-y-1.5">
                      <Label htmlFor="email-otp-address">Email address</Label>
                      <div className="relative group">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none transition-colors duration-200 group-focus-within:text-primary" />
                        <Input
                          id="email-otp-address"
                          type="email"
                          value={emailOtpEmail}
                          onChange={(e) => setEmailOtpEmail(e.target.value)}
                          placeholder="you@school.edu"
                          autoComplete="email"
                          required
                          disabled={emailOtpBusy}
                          className="h-12 pl-10 rounded-xl border-border/50 bg-muted/40 text-[15px] shadow-none transition-all duration-200 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      We'll email you a sign-in link — no password needed. New here? This creates your account too.
                    </p>
                    <Button
                      type="submit"
                      className="w-full h-12 rounded-xl bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated hover:brightness-[1.06] active:brightness-95 transition-all duration-300"
                      disabled={emailOtpBusy}
                    >
                      {emailOtpBusy ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Sending…
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4 mr-2" />
                          Send sign-in link
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </div>
            )}

            {/* Mobile tab — OTP via MSG91 widget, or Mobile + Password */}
            {tab === "mobile" && (
              <div key="mobile" className="space-y-4 animate-fade-in">
                    <TabSwitch
                      size="sm"
                      ariaLabel="Mobile sign-in method"
                      value={mobileMode}
                      onChange={setMobileMode}
                      disabled={busy || mobileBusy}
                      options={[
                        { value: "otp", label: "OTP" },
                        { value: "password", label: "Password" },
                      ]}
                    />

                    {mobileMode === "otp" ? (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Verify your mobile number with a one-time code. New here? This creates your account too.
                        </p>
                        <Button
                          type="button"
                          onClick={handleMobileOtp}
                          className="w-full h-12 rounded-xl bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated hover:brightness-[1.06] active:brightness-95 transition-all duration-300"
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
                        {mobileBusy && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={handleCancelMobileOtp}
                            disabled={mobileCancelling}
                            className="w-full h-9 text-sm text-muted-foreground hover:text-foreground"
                          >
                            {mobileCancelling ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                                Closing…
                              </>
                            ) : (
                              <>
                                <X className="w-3.5 h-3.5 mr-1.5" />
                                Cancel
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <form onSubmit={handleMobilePasswordSignIn} className="space-y-4" noValidate>
                        <div className="space-y-1.5">
                          <Label htmlFor={mobilePhoneId}>Mobile number</Label>
                          <div className="relative group">
                            <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none transition-colors duration-200 group-focus-within:text-primary" />
                            <Input
                              id={mobilePhoneId}
                              type="tel"
                              value={mobilePhone}
                              onChange={(e) => setMobilePhone(e.target.value)}
                              placeholder="+91 98765 43210"
                              autoComplete="tel"
                              required
                              disabled={busy}
                              className="h-12 pl-10 rounded-xl border-border/50 bg-muted/40 text-[15px] shadow-none transition-all duration-200 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
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
                          className="w-full h-12 rounded-xl bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated hover:brightness-[1.06] active:brightness-95 transition-all duration-300"
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
              </div>
            )}

            {/* Sign up form */}
            {tab === "signup" && (
              <form key="signup" onSubmit={handleSignUp} className="space-y-4 animate-fade-in" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor={signupNameId}>Full name</Label>
                  <div className="relative group">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none transition-colors duration-200 group-focus-within:text-primary" />
                    <Input
                      id={signupNameId}
                      value={suName}
                      onChange={(e) => setSuName(e.target.value)}
                      placeholder="Your full name"
                      autoComplete="name"
                      required
                      disabled={busy}
                      className="h-12 pl-10 rounded-xl border-border/50 bg-muted/40 text-[15px] shadow-none transition-all duration-200 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
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
                  <div className="relative group">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none transition-colors duration-200 group-focus-within:text-primary" />
                    <Input
                      id={signupEmailId}
                      type="email"
                      value={suEmail}
                      onChange={(e) => setSuEmail(e.target.value)}
                      placeholder="you@school.edu"
                      autoComplete="email"
                      required
                      disabled={busy}
                      className="h-12 pl-10 rounded-xl border-border/50 bg-muted/40 text-[15px] shadow-none transition-all duration-200 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
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
                  className="w-full h-12 rounded-xl bg-gradient-primary text-primary-foreground font-semibold press shadow-card hover:shadow-elevated hover:brightness-[1.06] active:brightness-95 transition-all duration-300"
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
              </>
            )}
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6 leading-relaxed">
            By continuing, you agree to your school's portal policies.
            <br className="hidden sm:inline" />
            <span className="sm:ml-1">
              Need help? Contact your school administrator.
            </span>
          </p>

        </div>
      </main>
    </div>
  );
}
