import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";

const emailSchema = z.string().trim().email({ message: "Invalid email" }).max(255);
const pwSchema = z.string().min(8, { message: "Min 8 chars" }).max(72);
const nameSchema = z.string().trim().min(1).max(100);

export default function Auth() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [tab, setTab] = useState("signin");
  const [busy, setBusy] = useState(false);

  // signin
  const [siEmail, setSiEmail] = useState("");
  const [siPw, setSiPw] = useState("");
  // signup
  const [suName, setSuName] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPw, setSuPw] = useState("");
  const [suRole, setSuRole] = useState<"admin" | "teacher" | "student" | "parent">("student");

  useEffect(() => {
    if (!loading && user) navigate("/");
  }, [user, loading, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const ev = emailSchema.safeParse(siEmail);
    if (!ev.success) return toast.error(ev.error.issues[0].message);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: ev.data, password: siPw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome back!");
    navigate("/");
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const nv = nameSchema.safeParse(suName);
    const ev = emailSchema.safeParse(suEmail);
    const pv = pwSchema.safeParse(suPw);
    if (!nv.success) return toast.error("Enter your full name");
    if (!ev.success) return toast.error(ev.error.issues[0].message);
    if (!pv.success) return toast.error(pv.error.issues[0].message);
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: ev.data,
      password: pv.data,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: nv.data },
      },
    });
    if (error) { setBusy(false); return toast.error(error.message); }
    // Assign role
    if (data.user) {
      await supabase.from("user_roles").insert({ user_id: data.user.id, role: suRole });
    }
    setBusy(false);
    toast.success("Account created!");
    navigate("/");
  };

  const handleReset = async () => {
    const ev = emailSchema.safeParse(siEmail);
    if (!ev.success) return toast.error("Enter your email above first");
    const { error } = await supabase.auth.resetPasswordForEmail(ev.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return toast.error(error.message);
    toast.success("Reset link sent — check your inbox");
  };

  const handleGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      return toast.error(result.error.message ?? "Google sign-in failed");
    }
    if (result.redirected) return; // browser will navigate
    setBusy(false);
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4 shadow-elevated">
            <GraduationCap className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Vidyalaya</h1>
          <p className="text-white/80 mt-1">School Management System</p>
        </div>

        <Card className="p-6 shadow-elevated">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <div className="mt-5">
              <Button
                type="button"
                variant="outline"
                className="w-full h-10 flex items-center justify-center gap-2"
                onClick={handleGoogle}
                disabled={busy}
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z"/>
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
                  <path fill="#4CAF50" d="M24 43.5c5.1 0 9.8-2 13.3-5.2l-6.1-5c-2 1.4-4.5 2.2-7.2 2.2-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39 16.2 43.5 24 43.5z"/>
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.5l6.1 5c-.4.4 6.7-4.9 6.7-14.5 0-1.2-.1-2.3-.4-3.5z"/>
                </svg>
                Continue with Google
              </Button>
              <div className="flex items-center gap-3 my-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or with email</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </div>

            <TabsContent value="signin" className="mt-0">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={siEmail} onChange={e => setSiEmail(e.target.value)} placeholder="you@school.edu" required />
                </div>
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input type="password" value={siPw} onChange={e => setSiPw(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground" disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
                </Button>
                <button type="button" onClick={handleReset} className="text-sm text-primary hover:underline w-full text-center">
                  Forgot password?
                </button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-5">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Full Name</Label>
                  <Input value={suName} onChange={e => setSuName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>I am a</Label>
                  <Select value={suRole} onValueChange={(v: any) => setSuRole(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="student">Student</SelectItem>
                      <SelectItem value="parent">Parent</SelectItem>
                      <SelectItem value="teacher">Teacher</SelectItem>
                      <SelectItem value="admin">Admin / Principal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={suEmail} onChange={e => setSuEmail(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input type="password" value={suPw} onChange={e => setSuPw(e.target.value)} required />
                  <p className="text-xs text-muted-foreground">Min 8 characters</p>
                </div>
                <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground" disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Account"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </Card>

        <p className="text-center text-white/70 text-xs mt-6">
          Phone OTP & native push coming in the next build
        </p>
      </div>
    </div>
  );
}
