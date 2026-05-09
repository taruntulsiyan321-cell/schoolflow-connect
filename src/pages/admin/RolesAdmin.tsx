import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ShieldCheck, Mail, Phone, Link2, UserX, Search, Crown } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

type Student = {
  id: string;
  full_name: string;
  admission_number: string;
  user_id: string | null;
  class_id: string | null;
  parent_mobile: string | null;
  classes?: { name: string; section: string } | null;
};

export default function RolesAdmin() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<Student | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("students")
      .select("id, full_name, admission_number, user_id, class_id, parent_mobile, classes(name, section)")
      .order("full_name");
    if (error) toast.error(error.message);
    setStudents((data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const connect = async () => {
    if (!target || !identifier.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_connect_student_account", {
      _student_id: target.id,
      _identifier: identifier.trim(),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Account connected — student can now sign in");
    setTarget(null); setIdentifier(""); load();
  };

  const revoke = async (s: Student) => {
    if (!confirm(`Revoke portal access for ${s.full_name}?`)) return;
    const { error } = await supabase.rpc("admin_revoke_student_account", { _student_id: s.id });
    if (error) return toast.error(error.message);
    toast.success("Access revoked"); load();
  };

  const filtered = students.filter(s => {
    const q = search.toLowerCase();
    return !q || s.full_name.toLowerCase().includes(q) || s.admission_number?.toLowerCase().includes(q);
  });

  return (
    <>
      <PageHeader
        title="Student Access"
        subtitle="Connect students to their Google account so they can sign in to the student portal"
      />

      {/* Hierarchy info card */}
      <Card className="p-4 mb-5 bg-gradient-soft border-primary/20">
        <div className="flex items-start gap-3">
          <Crown className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold mb-1">Access Hierarchy</div>
            <div className="text-muted-foreground">
              Platform Owner → Principal → Admin → Teacher → Student. As an admin, you can manage <strong>students</strong> here and <strong>teachers</strong> from the Teachers section. Principal &amp; Owner roles are managed by the platform team.
            </div>
          </div>
        </div>
      </Card>

      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or admission number…"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-10 text-sm">No students found.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => (
            <Card key={s.id} className="p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{s.full_name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Adm# {s.admission_number}
                    {s.classes && <> · Class {s.classes.name}-{s.classes.section}</>}
                  </div>
                  <div className="mt-2">
                    {s.user_id ? (
                      <Badge variant="outline" className="bg-accent/15 text-accent border-accent/30 gap-1">
                        <ShieldCheck className="w-3 h-3" /> Active — connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground gap-1">
                        Not connected
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setTarget(s); setIdentifier(""); }}
                  >
                    <Link2 className="w-3.5 h-3.5 mr-1" />
                    {s.user_id ? "Reconnect" : "Connect Account"}
                  </Button>
                  {s.user_id && (
                    <Button size="sm" variant="ghost" onClick={() => revoke(s)}>
                      <UserX className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={v => !v && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Account — {target?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask the student to sign in once with their Google account or phone, then enter that email or mobile here.
            </p>
            <div>
              <Label className="text-xs flex items-center gap-1"><Mail className="w-3 h-3" /> Google email <span className="text-muted-foreground">or</span> <Phone className="w-3 h-3" /> mobile</Label>
              <Input
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="student@gmail.com  or  +919876543210"
                onKeyDown={e => e.key === "Enter" && connect()}
                autoFocus
              />
            </div>
            <Button
              className="w-full bg-gradient-primary text-primary-foreground"
              disabled={busy || !identifier.trim()}
              onClick={connect}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Connect & Activate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
