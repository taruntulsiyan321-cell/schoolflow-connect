import { useState, useEffect, useId } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, dashboardForRole, canAccessPath } from "@/auth";
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
import { normalizePhone } from "@/lib/phone";

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

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, loading, status, signIn, requestPasswordReset, homePath, refreshAuth } = useAuth();
  const [busy, setBusy] = useState(false);

  /** Top-level account type — Organization is the only live path today;
   *  Individual is a disabled placeholder per the current design brief. */
  const [accountType, setAccountType] = useState<"individual" | "organization">("organization");
  /** Password vs one-time code, under Organization → Sign in. */
  const [signInMode, setSignInMode] = useState<"password" | "otp">("password");

  const identifierId = useId();
  const otpIdentifierId = useId();
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

  // Mobile OTP (MSG91 widget) — the widget itself collects the phone number
  // and OTP code inside its own UI; there's no local phone/code field to hold.
  const [mobileBusy, setMobileBusy] = useState(false);
  const [mobileCancelling, setMobileCancelling] = useState(false);

  // OTP sign-in — one identifier field routes to whichever channel it
  // resolves to: a mobile number hands off to the MSG91 widget above
  // (which still collects/verifies the number itself, unchanged); an email
  // address uses Supabase Auth's own native email OTP (a sign-in link,
  // since this project has no custom email template exposing a typed code).
  const [otpIdentifier, setOtpIdentifier] = useState("");
  const [emailOtpBusy, setEmailOtpBusy] = useState(false);
  const [emailOtpSent, setEmailOtpSent] = useState(false);

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

  /** Sends a Supabase-native sign-in link to an email address — the same
   *  supabase.auth client used everywhere else in this file, just its
   *  built-in passwordless method. Not a new provider or backend: it is
   *  the email OTP/passwordless mechanism Supabase Auth already ships
   *  with, resolving through the same onAuthStateChange listener in
   *  AuthProvider that every other sign-in path already relies on. */
  const handleEmailOtp = async (email: string) => {
    if (emailOtpBusy) return;
    setEmailOtpBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth`,
      },
    });
    setEmailOtpBusy(false);
    if (error) {
      toast.error(error.message || "Could not send the sign-in email. Please try again.");
      return;
    }
    setEmailOtpSent(true);
    toast.success(`Sign-in link sent to ${email} — check your inbox.`);
  };

  /** Unified OTP entry point: the identifier field alone decides the
   *  channel, reusing the same validators as password-mode sign-in
   *  (email-first, then phone) so both modes classify input identically. */
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobileBusy || emailOtpBusy) return;
    const ev = validateEmail(otpIdentifier);
    if (ev.ok) {
      await handleEmailOtp(ev.email);
      return;
    }
    if (normalizePhone(otpIdentifier)) {
      await handleMobileOtp();
      return;
    }
    toast.error("Enter a valid email or mobile number");
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
        if (profileErr) {
          console.warn("[auth] profile name update:", profileErr.message);
          toast.error("Your account is set up, but we couldn't save your name — you can update it later from your profile.");
        }
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
              {profileStep === "complete_profile" ? "Almost there" : "Welcome Back"}
            </h2>
            <p className="text-base text-muted-foreground mt-1.5">
              {profileStep === "complete_profile"
                ? "You're verified — just a couple more details."
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
                disabled={busy || mobileBusy || emailOtpBusy}
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
                ) : (
                  <>
                    {/* Sign in with — Password / OTP */}
                    <p className="text-sm font-medium text-foreground mb-2">Sign in with</p>
                    <SegmentedControl
                      ariaLabel="Sign in with"
                      value={signInMode}
                      onChange={setSignInMode}
                      disabled={busy || mobileBusy || emailOtpBusy}
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
                        </form>
                      ) : (
                        <form onSubmit={handleSendOtp} className="space-y-4" noValidate>
                          <div className="space-y-1.5">
                            <Label htmlFor={otpIdentifierId}>Email or Mobile</Label>
                            <div className="relative group">
                              <Mail className={FIELD_ICON_CLASS} />
                              <Input
                                id={otpIdentifierId}
                                value={otpIdentifier}
                                onChange={(e) => {
                                  setOtpIdentifier(e.target.value);
                                  setEmailOtpSent(false);
                                }}
                                placeholder="you@school.edu or +91 98765 43210"
                                autoComplete="username"
                                required
                                disabled={mobileBusy || emailOtpBusy}
                                className={FIELD_CLASS}
                              />
                            </div>
                          </div>

                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {mobileBusy
                              ? "A secure verification window is open — finish it there, or cancel below."
                              : emailOtpSent
                                ? "Sign-in link sent — check your inbox, or resend below."
                                : "Mobile numbers open a secure verification window; email addresses get a sign-in link. New here? This creates your account too."}
                          </p>

                          <Button
                            type="submit"
                            className={PRIMARY_BUTTON_CLASS}
                            disabled={mobileBusy || emailOtpBusy}
                          >
                            {mobileBusy ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                Verifying…
                              </>
                            ) : emailOtpBusy ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                Sending…
                              </>
                            ) : (
                              <>
                                <Phone className="w-4 h-4 mr-2" />
                                {emailOtpSent ? "Resend link" : "Send OTP"}
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
                        </form>
                      )}
                    </div>
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
