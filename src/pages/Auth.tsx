import { useState, useEffect, useId } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, dashboardForRole, canAccessPath } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GraduationCap, Loader2, Check, User, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  openMsg91Widget,
  closeMsg91Widget,
  classifyMsg91Failure,
  isMsg91WidgetConfigured,
} from "@/lib/msg91Widget";
import { completeMsg91SignIn } from "@/lib/msg91Auth";
import { toErrorMessage } from "@/lib/presentation";
import { LOADING_LIST, listItems, type ListState } from "@/lib/listState";

const nameSchema = z.string().trim().min(1).max(100);

/** One row of public.competitive_exams — the login page reads it before
 *  anyone is signed in, so anon holds SELECT on the active ones. */
type ExamOption = { code: string; name: string };

const FEATURE_HIGHLIGHTS_INDIVIDUAL = ["Smart Learning", "Exam prep", "AI Coach"] as const;

const FIELD_CLASS =
  "h-14 pl-11 rounded-[14px] border border-border bg-muted text-[15px] shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-200 focus-visible:bg-background focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0 focus-visible:shadow-none";
const FIELD_ICON_CLASS =
  "absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground/55 pointer-events-none transition-colors duration-200 group-focus-within:text-primary";
const PRIMARY_BUTTON_CLASS =
  "w-full h-14 rounded-[14px] bg-primary text-primary-foreground text-base font-semibold press shadow-card hover:bg-primary/90 transition-all duration-200";

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

  // Individual students only (2026-10-01). The school sign-in tab — password,
  // email or OTP sign-in, forgot password and the student/parent role picker —
  // is kept on the `organisation` branch with the rest of the school side.
  const profileNameId = useId();

  const from = (location.state as { from?: string } | null)?.from ?? null;
  /** `?next=` is used by the OAuth consent flow to return the user after sign-in. */
  const nextParam = (() => {
    const raw = new URLSearchParams(location.search).get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
  })();

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

  // The individual student's exam. It is picked BEFORE the phone is verified
  // because it is part of which account that phone signs into: the same number
  // holds one account per exam, and an account's exam never changes (ruling
  // 2026-09-23).
  const [exams, setExams] = useState<ListState<ExamOption>>(LOADING_LIST);
  const [examCode, setExamCode] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase
        .from("competitive_exams")
        .select("code, name")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (!alive) return;
      if (error) {
        setExams({ status: "failed", message: toErrorMessage(error, "Could not load exams") });
        return;
      }
      const items = (data ?? []) as ExamOption[];
      setExams({ status: "ready", items });
      // One exam open → select it. Leaving Continue disabled until a click
      // when CUET is the only tile reads as "OTP is broken".
      if (items.length === 1) setExamCode(items[0].code);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (loading || status === "loading") return;
    // missing_role is the expected, self-serviceable state for any brand-new
    // OTP-verified account -- show the completion form instead of sending
    // them to the dead-end "ask your admin" page. This also fixes a real
    // race that predates this change: applyContext's role resolution
    // resolves asynchronously after the session is created, so without this
    // branch this effect could fire mid-signup and yank a brand-new user
    // away before they ever saw the completion form.
    // missing_role: an account with no student membership. Every account the
    // individual flow creates has one (rpc_create_exam_account), so this is an
    // older account, and there is no role to pick here any more.
    if (profileStep === "complete_profile") return;
    if (user && (status === "disabled" || status === "missing_profile" || status === "missing_role")) {
      navigate("/unauthorized", {
        replace: true,
        state: { reason: status },
      });
      return;
    }
    // (Above: an exam account is authenticated the moment it signs in -- its
    // space, its student row and its membership were all created by the
    // verified sign-in -- so the name form must not be navigated away from the
    // instant it appears, or the student lands on a dashboard called "Student".)
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
  }, [user, role, loading, status, navigate, from, homePath, nextParam, profileStep]);

  /** Opens the MSG91 widget; the client never asserts a phone number — only
   *  the access-token it returns is ever sent anywhere. */
  const handleMobileOtp = async (forExam: string) => {
    if (mobileBusy) return;
    if (!isMsg91WidgetConfigured()) {
      toast.error("Mobile sign-in isn't configured yet.");
      return;
    }
    setMobileBusy(true);
    await openMsg91Widget({
      onSuccess: async (accessToken, tokenMeta) => {
        const result = await completeMsg91SignIn(accessToken, forExam, tokenMeta);
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

  /** A new exam account's one remaining step: its name. */
  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profileBusy) return;
    const nv = nameSchema.safeParse(newAccountName);
    if (!nv.success) return toast.error("Enter your full name");
    setProfileBusy(true);
    try {
      // An exam account already has its role: rpc_create_exam_account gave it
      // an active student membership in its own space before this page ever
      // saw a session. Its name goes to the profile AND the student row,
      // which is what the panel reads.
      const { error: nameErr } = await supabase.rpc("rpc_set_my_display_name", {
        _full_name: nv.data,
      });
      if (nameErr) throw nameErr;
      setProfileStep("idle");
      await refreshAuth();
      toast.success("You're all set!");
    } catch (err) {
      toast.error(toErrorMessage(err, "Could not finish setting up your account"));
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
          <p className="text-base text-muted-foreground mt-3">AI-powered exam prep for competitive exams.</p>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {FEATURE_HIGHLIGHTS_INDIVIDUAL.map((f) => (
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
                : "Pick your exam and continue with your mobile number."}
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
            <div className="animate-fade-in-300">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">
                        Which exam are you preparing for?
                      </p>
                      {exams.status === "loading" ? (
                        <p role="status" className="text-sm text-muted-foreground py-6 text-center">
                          Loading exams…
                        </p>
                      ) : exams.status === "failed" ? (
                        <div className="py-6 text-center space-y-2">
                          <p className="text-sm text-destructive">We couldn't load the exam list.</p>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => window.location.reload()}
                            className="h-9 text-sm"
                          >
                            Try again
                          </Button>
                        </div>
                      ) : listItems(exams).length === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                          No exams are open for sign-up right now.
                        </p>
                      ) : (
                        <div className="grid gap-2" role="radiogroup" aria-label="Exam">
                          {listItems(exams).map((ex) => (
                            <button
                              key={ex.code}
                              type="button"
                              role="radio"
                              aria-checked={examCode === ex.code}
                              onClick={() => setExamCode(ex.code)}
                              disabled={mobileBusy}
                              className={cn(
                                "w-full h-14 rounded-[14px] border px-4 text-left text-[15px] font-semibold transition-all duration-200 press disabled:opacity-50",
                                examCode === ex.code
                                  ? "border-primary bg-primary/5 text-primary ring-4 ring-primary/15"
                                  : "border-border bg-muted text-foreground hover:border-primary/40",
                              )}
                            >
                              {ex.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {mobileBusy
                        ? "A secure verification window is open — finish it there, or cancel below."
                        : "Your account is tied to the exam you pick, and can't be switched later. Preparing for another exam? Sign up again with the same number and pick that one."}
                    </p>

                    <Button
                      type="button"
                      onClick={() => void handleMobileOtp(examCode)}
                      className={PRIMARY_BUTTON_CLASS}
                      disabled={!examCode || mobileBusy}
                    >
                      {mobileBusy ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Verifying…
                        </>
                      ) : (
                        <>
                          <Phone className="w-4 h-4 mr-2" />
                          Continue with mobile
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
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 leading-relaxed">
          By continuing, you agree to Gurukul&apos;s terms of use.
          <br className="hidden sm:inline" />
          <span className="sm:ml-1">Need help? Reach us from your profile after you sign in.</span>
        </p>
      </div>
    </div>
  );
}
