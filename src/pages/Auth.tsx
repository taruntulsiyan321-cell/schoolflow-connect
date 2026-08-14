import { useState, useEffect, useId } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, dashboardForRole, canAccessPath, mapAuthError } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  GraduationCap,
  Loader2,
  BookOpen,
  Users,
  Eye,
  EyeOff,
  ChevronLeft,
  Check,
  Lock,
  Mail,
  User,
  Phone,
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

const FEATURE_HIGHLIGHTS = ["Smart Learning", "School ERP", "AI Teachers"];

const FIELD_CLASS =
  "h-14 pl-11 rounded-[14px] border border-border bg-muted text-[15px] shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-200 focus-visible:bg-background focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0 focus-visible:shadow-none";
const FIELD_ICON_CLASS =
  "absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground/55 pointer-events-none transition-colors duration-200 group-focus-within:text-primary";
const PRIMARY_BUTTON_CLASS =
  "w-full h-14 rounded-[14px] bg-primary text-primary-foreground text-base font-semibold press shadow-card hover:bg-primary/90 transition-all duration-200";
const OUTLINE_BUTTON_CLASS = "w-full h-14 rounded-[14px] border-border text-base font-semibold";

/** Equal-width segmented control, 48px tall, 14px radius — used for both
 *  Individual/Organization and Password/OTP switches. */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="relative grid h-12 p-1 rounded-[14px] bg-muted"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <div
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-[10px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_1px_6px_rgba(15,23,42,0.05)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
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
            "relative z-10 flex items-center justify-center rounded-[10px] text-sm font-semibold transition-colors duration-200",
            value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            disabled && "opacity-50 cursor-not-allowed",
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
        <Lock className={FIELD_ICON_CLASS} />
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          disabled={disabled}
          className={cn(FIELD_CLASS, "pr-11")}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md"
          disabled={disabled}
        >
          {visible ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
        </button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: SignUpRole;
  onChange: (v: SignUpRole) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="I am a">
      {ROLE_OPTIONS.map(({ value: v, label, desc, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cn(
            "flex flex-col items-start gap-1.5 p-4 rounded-[14px] border text-left transition-all duration-200 press",
            value === v
              ? "border-primary bg-primary/[0.06] shadow-glow ring-1 ring-primary/20"
              : "border-border bg-background hover:border-primary/30 hover:bg-muted/40",
          )}
        >
          <Icon className={cn("w-5 h-5 mb-0.5", value === v ? "text-primary" : "text-muted-foreground")} />
          <span className="text-sm font-semibold leading-none">{label}</span>
          <span className="text-[12px] text-muted-foreground leading-snug">{desc}</span>
        </button>
      ))}
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
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
  );
}

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, loading, status, signIn, requestPasswordReset, homePath, refreshAuth } = useAuth();
  const [busy, setBusy] = useState(false);

  /** Top-level account type — Organization is the only live path today;
   *  Individual is a disabled placeholder per the current design brief. */
  const [accountType, setAccountType] = useState<"individual" | "organization">("organization");
  /** Sign in vs the existing two-step signup flow, entered via a link
   *  rather than a top-level tab now that the channel switch lives above it. */
  const [authView, setAuthView] = useState<"signin" | "signup">("signin");
  /** Password vs one-time code, under Organization → Sign in. */
  const [signInMode, setSignInMode] = useState<"password" | "otp">("password");

  const identifierId = useId();
  const signupNameId = useId();
  const signupEmailId = useId();
  const profileNameId = useId();

  const from = (location.state as { from?: string } | null)?.from ?? null;
  /** `?next=` is used by the OAuth consent flow to return the user after sign-in. */
  const nextParam = (() => {
    const raw = new URLSearchParams(location.search).get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
  })();

  // Sign in — Password mode accepts either an email or a mobile number in
  // one field, resolving to the same signIn({email,password}) call either
  // way (validateEmail / phoneToSyntheticEmail already existed; this just
  // tries both instead of assuming the channel from a separate tab).
  const [siIdentifier, setSiIdentifier] = useState("");
  const [siPw, setSiPw] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  const [suName, setSuName] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPw, setSuPw] = useState("");
  const [suRole, setSuRole] = useState<SignUpRole>("student");
  const [signupStep, setSignupStep] = useState<"role" | "details">("role");

  // Mobile OTP (MSG91 widget) — the widget itself collects the phone number
  // and OTP code inside its own UI; there's no local phone/code field to hold.
  const [mobileBusy, setMobileBusy] = useState(false);
  const [mobileCancelling, setMobileCancelling] = useState(false);

  // New-user profile completion — shared by every OTP-style path (mobile
  // widget today) since it doesn't collect a name/role up front the way
  // Email+Password sign-up does. status === "missing_role" is the single
  // source of truth for "show this"; see the redirect effect below.
  const [profileStep, setProfileStep] = useState<"idle" | "complete_profile">("idle");
  const [profileBusy, setProfileBusy] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountRole, setNewAccountRole] = useState<SignUpRole>("student");

  useEffect(() => {
    if (loading || status === "loading") return;
    // missing_role is the expected, self-serviceable state for any brand-new
    // OTP-verified account -- show the completion form instead of sending
    // them to the dead-end "ask your admin" page. This also fixes a real
    // race that predates this change: applyContext's role resolution
    // resolves asynchronously after the session is created, so without this
    // branch this effect could fire mid-signup and yank a brand-new user
    // away before they ever saw the completion form.
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

  /** Accepts either an email or a mobile number in one field — tries email
   *  validation first, then falls back to phone, both already-existing
   *  validators. Same signIn() call as before either way. */
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ev = validateEmail(siIdentifier);
    const resolvedEmail = ev.ok ? ev.email : phoneToSyntheticEmail(siIdentifier);
    if (!resolvedEmail) {
      toast.error("Enter a valid email or mobile number");
      return;
    }
    if (!siPw.trim()) {
      toast.error("Enter your password");
      return;
    }
    setBusy(true);
    const { error } = await signIn({ email: resolvedEmail, password: siPw });
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
    if (!data.session) setAuthView("signin");
  };

  const handleReset = async () => {
    if (busy) return;
    const ev = validateEmail(siIdentifier);
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
   *  to the sign-in screen — see closeMsg91Widget() for why this is async
   *  and not instantaneous (MSG91's own overlay needs a moment to release).
   *  `mobileCancelling` covers that gap so the Cancel button itself never
   *  appears to do nothing. */
  const handleCancelMobileOtp = async () => {
    if (mobileCancelling) return;
    setMobileCancelling(true);
    await closeMsg91Widget();
    setMobileBusy(false);
    setMobileCancelling(false);
  };

  /** New OTP-verified account (mobile widget): claim a role via the same
   *  self-signup RPC Email+Password uses, then save the display name.
   *  Reached whenever status === "missing_role" — see the redirect effect
   *  above. */
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

  if (loading || (user && role && status === "authenticated")) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] gap-3 animate-fade-in">
        <div className="w-11 h-11 rounded-2xl bg-primary flex items-center justify-center shadow-elevated">
          <GraduationCap className="w-5 h-5 text-primary-foreground" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4 py-14">
      <div className="w-full max-w-[480px] flex flex-col items-center">
        {/* Page brand block */}
        <div className="text-center mb-10 animate-rise">
          <div className="text-sm font-extrabold tracking-[0.14em] uppercase text-primary mb-4">Gurukul</div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground leading-[1.15] text-balance">
            The Future of Learning Starts Here
          </h1>
          <p className="text-base text-muted-foreground mt-3">AI-powered education platform for schools.</p>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {FEATURE_HIGHLIGHTS.map((f) => (
              <li key={f} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Check className="w-4 h-4 text-primary" strokeWidth={2.5} />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Authentication card */}
        <div className="w-full bg-white rounded-3xl shadow-[0_30px_80px_-24px_rgba(15,23,42,0.18),0_8px_24px_-8px_rgba(15,23,42,0.08)] p-8 animate-rise">
          <div className="text-center mb-6">
            <div className="text-xs font-extrabold tracking-[0.14em] uppercase text-primary mb-3">Gurukul</div>
            <h2 className="text-[32px] font-semibold tracking-tight">
              {profileStep === "complete_profile"
                ? "Almost there"
                : accountType === "organization" && authView === "signup"
                  ? signupStep === "role"
                    ? "Create your account"
                    : "Just a few details"
                  : "Welcome Back"}
            </h2>
            <p className="text-base text-muted-foreground mt-1.5">
              {profileStep === "complete_profile"
                ? "You're verified — just a couple more details."
                : accountType === "organization" && authView === "signup"
                  ? signupStep === "role"
                    ? "Tell us who you are — it takes two steps."
                    : `Setting up your ${suRole} account.`
                  : "Choose how you want to access Gurukul."}
            </p>
          </div>

          {profileStep === "complete_profile" ? (
            <form onSubmit={handleCompleteProfile} className="space-y-4 animate-fade-in" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor={profileNameId}>Full name</Label>
                <div className="relative group">
                  <User className={FIELD_ICON_CLASS} />
                  <Input
                    id={profileNameId}
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    placeholder="Your full name"
                    autoComplete="name"
                    required
                    disabled={profileBusy}
                    className={FIELD_CLASS}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>I am a</Label>
                <RolePicker value={newAccountRole} onChange={setNewAccountRole} disabled={profileBusy} />
              </div>
              <Button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={profileBusy}>
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
              {/* Individual / Organization */}
              <SegmentedControl
                ariaLabel="Account type"
                value={accountType}
                onChange={setAccountType}
                disabled={busy || mobileBusy}
                options={[
                  { value: "individual", label: "Individual" },
                  { value: "organization", label: "Organization" },
                ]}
              />

              <div key={accountType} className="animate-fade-in-300 mt-6">
                {accountType === "individual" ? (
                  <div className="py-10 text-center">
                    <p className="text-sm font-semibold text-muted-foreground/70">Coming Soon</p>
                    <p className="text-xs text-muted-foreground/50 mt-1.5 max-w-[280px] mx-auto leading-relaxed">
                      Individual accounts aren't available yet — sign in through your school's Organization account.
                    </p>
                  </div>
                ) : authView === "signup" ? (
                  <>
                    <div className="flex items-center gap-1.5 mb-6" aria-hidden>
                      <div
                        className={cn(
                          "h-1 flex-1 rounded-full transition-colors duration-300",
                          signupStep === "role" || signupStep === "details" ? "bg-primary" : "bg-border",
                        )}
                      />
                      <div
                        className={cn(
                          "h-1 flex-1 rounded-full transition-colors duration-300",
                          signupStep === "details" ? "bg-primary" : "bg-border",
                        )}
                      />
                    </div>

                    {signupStep === "role" ? (
                      <div className="space-y-6 animate-fade-in">
                        <RolePicker value={suRole} onChange={setSuRole} disabled={busy} />
                        <p className="text-[12px] text-muted-foreground leading-relaxed">
                          Teachers, principals, and school admins are invited by your school — they cannot
                          self-register here.
                        </p>
                        <Button
                          type="button"
                          onClick={() => setSignupStep("details")}
                          className={PRIMARY_BUTTON_CLASS}
                        >
                          Continue
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={handleSignUp} className="space-y-4 animate-fade-in" noValidate>
                        <button
                          type="button"
                          onClick={() => setSignupStep("role")}
                          disabled={busy}
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors -mt-1 mb-1"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Back
                        </button>

                        <div className="space-y-1.5">
                          <Label htmlFor={signupNameId}>Full name</Label>
                          <div className="relative group">
                            <User className={FIELD_ICON_CLASS} />
                            <Input
                              id={signupNameId}
                              value={suName}
                              onChange={(e) => setSuName(e.target.value)}
                              placeholder="Your full name"
                              autoComplete="name"
                              required
                              disabled={busy}
                              className={FIELD_CLASS}
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={signupEmailId}>Email address</Label>
                          <div className="relative group">
                            <Mail className={FIELD_ICON_CLASS} />
                            <Input
                              id={signupEmailId}
                              type="email"
                              value={suEmail}
                              onChange={(e) => setSuEmail(e.target.value)}
                              placeholder="you@school.edu"
                              autoComplete="email"
                              required
                              disabled={busy}
                              className={FIELD_CLASS}
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

                        <Button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={busy}>
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

                    <p className="text-center text-sm mt-6">
                      <span className="text-muted-foreground">Already have an account? </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthView("signin");
                          setSignupStep("role");
                        }}
                        className="text-primary font-medium hover:underline underline-offset-4"
                      >
                        Sign in
                      </button>
                    </p>
                  </>
                ) : (
                  <>
                    {/* Sign in with — Password / OTP */}
                    <p className="text-sm font-medium text-foreground mb-2">Sign in with</p>
                    <SegmentedControl
                      ariaLabel="Sign in with"
                      value={signInMode}
                      onChange={setSignInMode}
                      disabled={busy || mobileBusy}
                      options={[
                        { value: "password", label: "Password" },
                        { value: "otp", label: "OTP" },
                      ]}
                    />

                    <div key={signInMode} className="animate-slide-in-x mt-6">
                      {signInMode === "password" ? (
                        <form onSubmit={handleSignIn} className="space-y-4" noValidate>
                          <div className="space-y-1.5">
                            <Label htmlFor={identifierId}>Email or Mobile</Label>
                            <div className="relative group">
                              <Mail className={FIELD_ICON_CLASS} />
                              <Input
                                id={identifierId}
                                value={siIdentifier}
                                onChange={(e) => setSiIdentifier(e.target.value)}
                                placeholder="you@school.edu or +91 98765 43210"
                                autoComplete="username"
                                required
                                disabled={busy}
                                className={FIELD_CLASS}
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

                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                              <Checkbox
                                checked={rememberMe}
                                onCheckedChange={(v) => setRememberMe(v === true)}
                                disabled={busy}
                              />
                              Remember me
                            </label>
                            <button
                              type="button"
                              onClick={handleReset}
                              disabled={busy}
                              className="text-sm text-primary hover:underline underline-offset-4 transition-colors disabled:opacity-50"
                            >
                              Forgot password?
                            </button>
                          </div>

                          <Button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={busy}>
                            {busy ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                Signing in…
                              </>
                            ) : (
                              "Sign In"
                            )}
                          </Button>

                          <div className="flex items-center gap-3 py-1">
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-xs text-muted-foreground font-medium">or</span>
                            <div className="h-px flex-1 bg-border" />
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            className={cn(OUTLINE_BUTTON_CLASS, "flex items-center justify-center gap-2.5")}
                            onClick={handleGoogle}
                            disabled={busy}
                          >
                            {busy ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <GoogleGlyph className="w-[18px] h-[18px]" />
                            )}
                            Continue with Google
                          </Button>
                        </form>
                      ) : (
                        <div className="space-y-4">
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {mobileBusy
                              ? "A secure verification window is open — finish it there, or cancel below."
                              : "We'll open a secure window to verify your mobile number with a one-time password. New here? This creates your account too."}
                          </p>
                          <Button
                            type="button"
                            onClick={handleMobileOtp}
                            className={PRIMARY_BUTTON_CLASS}
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
                                Send OTP
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
                      )}
                    </div>

                    <p className={cn("text-center text-sm mt-6 transition-opacity", mobileBusy && "opacity-50 pointer-events-none")}>
                      <span className="text-muted-foreground">New to Gurukul? </span>
                      <button
                        type="button"
                        onClick={() => setAuthView("signup")}
                        disabled={mobileBusy}
                        className="text-primary font-medium hover:underline underline-offset-4"
                      >
                        Create an account
                      </button>
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 leading-relaxed">
          By continuing, you agree to your school's portal policies.
          <br className="hidden sm:inline" />
          <span className="sm:ml-1">Need help? Contact your school administrator.</span>
        </p>
      </div>
    </div>
  );
}
