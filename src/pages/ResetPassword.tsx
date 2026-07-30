import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Lock, GraduationCap } from "lucide-react";

/**
 * Password reset page — opened from Supabase recovery email link.
 * Requires a recovery (or authenticated) session before updating.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const { updatePassword, user, loading } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      // Hash fragments from recovery links are processed by Supabase client
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setReady(!!data.session);
        setChecking(false);
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(!!session);
        setChecking(false);
      }
    });

    void check();
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== pw2) return toast.error("Passwords do not match");
    setBusy(true);
    const { error } = await updatePassword(pw);
    if (error) {
      setBusy(false);
      return toast.error(error);
    }
    toast.success("Password updated. Please sign in with your new password.");
    await supabase.auth.signOut();
    setBusy(false);
    navigate("/auth", { replace: true });
  };

  if (loading || checking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-soft gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verifying reset link…</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
        <Card className="w-full max-w-md p-6 shadow-elevated space-y-4 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-primary flex items-center justify-center">
            <GraduationCap className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold">Reset link expired</h1>
          <p className="text-sm text-muted-foreground">
            This password reset link is invalid or has expired. Request a new one from the login page.
          </p>
          <Button asChild className="w-full">
            <Link to="/auth">Back to login</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md p-6 shadow-elevated">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center">
            <Lock className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Set new password</h1>
            <p className="text-xs text-muted-foreground">Choose a strong password for your Gurukul account</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New password</Label>
            <Input
              id="new-pw"
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
              minLength={8}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw">Confirm password</Label>
            <Input
              id="confirm-pw"
              type="password"
              autoComplete="new-password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              required
              minLength={8}
              disabled={busy}
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-gradient-primary text-primary-foreground"
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Updating…
              </>
            ) : (
              "Update password"
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
}
