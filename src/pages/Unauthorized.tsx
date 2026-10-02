import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ArrowLeft, LogOut } from "lucide-react";

type Reason = "forbidden" | "disabled" | "missing_role" | "missing_profile" | "organisation" | string;

const MESSAGES: Record<string, { title: string; body: string }> = {
  forbidden: {
    title: "Unauthorized",
    body: "You do not have permission to open that page.",
  },
  // Every non-student role, and a student of a school: the live app is the
  // individual student panel only (2026-10-01).
  organisation: {
    title: "School accounts aren't available yet",
    body: "Gurukul is open to individual students preparing for an exam. School accounts — admin, principal, teacher, parent and school students — will come back in a later release. Sign out, then sign in with your mobile number as an individual student.",
  },
  disabled: {
    title: "Account disabled",
    body: "This account has been deactivated. Contact Gurukul support for help.",
  },
  missing_role: {
    title: "Account not set up",
    body: "Your account is signed in but isn't set up as a student yet. Sign out, then sign in again with your mobile number and pick your exam.",
  },
  missing_profile: {
    title: "Profile unavailable",
    body: "We could not load your user profile. Try signing in again. If this continues, contact support.",
  },
};

export default function Unauthorized() {
  const { role, homePath, signOut, profile, school } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as { reason?: Reason; from?: string; home?: string } | null) ?? {};
  const reason = state.reason ?? (role && role !== "student" ? "organisation" : "forbidden");
  const copy = MESSAGES[reason] ?? MESSAGES.forbidden;
  const dest = state.home || homePath || "/";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-soft p-6">
      <div className="w-full max-w-md text-center space-y-5 animate-fade-in">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="w-7 h-7 text-destructive" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{copy.body}</p>
        </div>

        {(profile || role || school) && (
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-left text-xs text-muted-foreground space-y-1">
            {profile?.fullName && (
              <div>
                <span className="font-medium text-foreground">User:</span> {profile.fullName}
              </div>
            )}
            {role && (
              <div>
                <span className="font-medium text-foreground">Role:</span> {role}
              </div>
            )}
            {school?.name && (
              <div>
                <span className="font-medium text-foreground">School:</span> {school.name}
              </div>
            )}
            {state.from && (
              <div>
                <span className="font-medium text-foreground">Tried:</span> {state.from}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          {role === "student" && reason !== "organisation" && (
            <Button onClick={() => navigate(dest, { replace: true })} className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Go to my dashboard
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={async () => {
              await signOut();
              navigate("/auth", { replace: true });
            }}
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          <Link to="/auth" className="text-primary hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
