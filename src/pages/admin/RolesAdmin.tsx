import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShieldCheck, UserPlus, X, Loader2, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

type Role = "admin" | "principal" | "teacher" | "student" | "parent";
type Row = { user_id: string; email: string | null; phone: string | null; created_at: string; roles: Role[] };

const ROLE_COLORS: Record<Role, string> = {
  admin: "bg-primary/15 text-primary border-primary/30",
  principal: "bg-primary/15 text-primary border-primary/30",
  teacher: "bg-secondary/15 text-secondary border-secondary/30",
  student: "bg-accent/15 text-accent border-accent/30",
  parent: "bg-warning/15 text-warning border-warning/30",
};

export default function RolesAdmin() {
  const [users, setUsers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<Role>("teacher");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_users_with_roles");
    if (error) toast.error(error.message);
    setUsers((data as Row[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const assign = async () => {
    if (!identifier.trim()) return toast.error("Enter an email or phone number");
    setBusy(true);
    const { error } = await supabase.rpc("admin_assign_role", { _identifier: identifier.trim(), _role: role });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Role "${role}" assigned to ${identifier}`);
    setIdentifier("");
    load();
  };

  const remove = async (user_id: string, r: Role) => {
    const { error } = await supabase.rpc("admin_remove_role", { _user_id: user_id, _role: r });
    if (error) return toast.error(error.message);
    toast.success(`Removed "${r}" role`);
    load();
  };

  const quickAssign = async (user_id: string, identifier: string, r: Role) => {
    const { error } = await supabase.rpc("admin_assign_role", { _identifier: identifier, _role: r });
    if (error) return toast.error(error.message);
    toast.success(`Assigned "${r}"`);
    load();
  };

  const filtered = users.filter(u => {
    const q = filter.toLowerCase();
    return !q || u.email?.toLowerCase().includes(q) || u.phone?.includes(q);
  });

  return (
    <>
      <PageHeader
        title="Roles & Access"
        subtitle="Assign admin / teacher / student / parent roles to any signed-up user"
      />

      <Card className="p-5 mb-6 bg-gradient-soft border-primary/20">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Assign role by email or phone</h3>
        </div>
        <div className="grid md:grid-cols-[1fr_180px_auto] gap-3">
          <div>
            <Label className="text-xs">Email or phone (E.164: +91…)</Label>
            <Input
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder="user@example.com  or  +919876543210"
              onKeyDown={e => e.key === "Enter" && assign()}
            />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={(v: Role) => setRole(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="principal">Principal</SelectItem>
                <SelectItem value="teacher">Teacher</SelectItem>
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="parent">Parent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full bg-gradient-primary text-primary-foreground"
              disabled={busy}
              onClick={assign}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assign"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          The user must have signed up first (email/password or phone OTP). If not found, ask them to create an account, then assign here.
        </p>
      </Card>

      <Tabs defaultValue="all">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <TabsList>
            <TabsTrigger value="all">All users</TabsTrigger>
            <TabsTrigger value="noroles">No role yet</TabsTrigger>
          </TabsList>
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search email or phone…"
            className="max-w-xs"
          />
        </div>

        <TabsContent value="all">
          <UserList users={filtered} loading={loading} onRemove={remove} onQuickAssign={quickAssign} />
        </TabsContent>
        <TabsContent value="noroles">
          <UserList users={filtered.filter(u => u.roles.length === 0)} loading={loading} onRemove={remove} onQuickAssign={quickAssign} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function UserList({
  users, loading, onRemove, onQuickAssign,
}: {
  users: Row[]; loading: boolean;
  onRemove: (uid: string, r: Role) => void;
  onQuickAssign: (uid: string, ident: string, r: Role) => void;
}) {
  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (users.length === 0) return <p className="text-muted-foreground text-sm text-center py-10">No users.</p>;
  return (
    <div className="space-y-2">
      {users.map(u => {
        const ident = u.email || u.phone || "";
        return (
          <Card key={u.user_id} className="p-4 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {u.email ? <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="truncate">{u.email || u.phone || "—"}</span>
                </div>
                {u.email && u.phone && (
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {u.phone}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {u.roles.length === 0 && (
                    <Badge variant="outline" className="text-muted-foreground">No role</Badge>
                  )}
                  {u.roles.map(r => (
                    <Badge key={r} className={`border ${ROLE_COLORS[r]} gap-1 pl-2 pr-1 py-0.5`} variant="outline">
                      <ShieldCheck className="w-3 h-3" />
                      {r}
                      <button
                        onClick={() => onRemove(u.user_id, r)}
                        className="ml-0.5 hover:bg-background/60 rounded-full p-0.5"
                        aria-label={`remove ${r}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 shrink-0">
                {(["admin", "principal", "teacher", "student", "parent"] as Role[]).map(r => (
                  <Button
                    key={r}
                    size="sm"
                    variant="outline"
                    disabled={u.roles.includes(r)}
                    onClick={() => onQuickAssign(u.user_id, ident, r)}
                    className="text-xs h-7"
                  >
                    + {r}
                  </Button>
                ))}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
