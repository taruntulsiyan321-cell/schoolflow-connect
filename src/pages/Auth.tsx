import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
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

            <TabsContent value="signin" className="mt-5">
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
