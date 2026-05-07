import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { User, ClipboardCheck, Wallet, BookOpen, Phone, Mail, MapPin, Calendar, GraduationCap } from "lucide-react";
import { toast } from "sonner";

export default function StudentProfilePage() {
  const { user } = useAuth();
  const [student, setStudent] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Stats
  const [attendancePct, setAttendancePct] = useState(0);
  const [totalDays, setTotalDays] = useState(0);
  const [presentDays, setPresentDays] = useState(0);
  const [pendingFees, setPendingFees] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Fetch profile
      const { data: p } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      setProfile(p);
      setEditName(p?.full_name ?? "");

      // Fetch linked student record
      const { data: s } = await supabase
        .from("students")
        .select("*, classes(name,section)")
        .eq("user_id", user.id)
        .maybeSingle();
      setStudent(s);

      if (s) {
        // Attendance stats
        const { data: att } = await supabase
          .from("attendance")
          .select("status")
          .eq("student_id", s.id);
        const total = att?.length ?? 0;
        const present = att?.filter((a) => a.status === "present").length ?? 0;
        setTotalDays(total);
        setPresentDays(present);
        setAttendancePct(total > 0 ? Math.round((present / total) * 100) : 0);

        // Fee stats
        const { data: fees } = await supabase
          .from("fees")
          .select("amount,paid_amount,status")
          .eq("student_id", s.id);
        const owed = (fees ?? [])
          .filter((r) => r.status !== "paid")
          .reduce((sum, r) => sum + (Number(r.amount) - Number(r.paid_amount)), 0);
        setPendingFees(owed);
      }

      setLoading(false);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user || !editName.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: editName.trim() })
      .eq("id", user.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Profile updated");
      setProfile((p: any) => ({ ...p, full_name: editName.trim() }));
    }
    setSaving(false);
  };

  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading profile…</p>;
  }

  return (
    <>
      <PageHeader title="My Profile" subtitle="Your personal information" />

      {/* Avatar & basic info */}
      <Card className="p-5 mb-4">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-full bg-gradient-primary text-primary-foreground flex items-center justify-center text-2xl font-bold shrink-0">
            {(student?.full_name || editName || user?.email || "?")[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">
              {student?.full_name || editName || "Student"}
            </h2>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="outline" className="capitalize">Student</Badge>
              {student?.classes && (
                <Badge className="bg-primary/15 text-primary border-primary/30" variant="outline">
                  Class {student.classes.name}-{student.classes.section}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {!student && (
          <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
            Your account isn't linked to a student record yet. Ask admin to link <strong>{user?.email}</strong> from the Link Users panel.
          </div>
        )}
      </Card>

      {/* Quick stats */}
      {student && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <StatCard
            icon={<ClipboardCheck className="w-5 h-5" />}
            label="Attendance"
            value={`${attendancePct}%`}
            tone={attendancePct >= 75 ? "accent" : "warning"}
          />
          <StatCard
            icon={<Wallet className="w-5 h-5" />}
            label="Pending Fees"
            value={pendingFees > 0 ? `₹${pendingFees}` : "₹0"}
            tone={pendingFees > 0 ? "warning" : "accent"}
          />
        </div>
      )}

      {/* Student details */}
      {student && (
        <Card className="p-5 mb-4">
          <h3 className="font-semibold mb-3">Student Details</h3>
          <div className="space-y-3">
            <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="Admission #" value={student.admission_number} />
            <InfoRow icon={<BookOpen className="w-4 h-4" />} label="Roll Number" value={student.roll_number || "—"} />
            <InfoRow
              icon={<BookOpen className="w-4 h-4" />}
              label="Class"
              value={student.classes ? `${student.classes.name}-${student.classes.section}` : "Unassigned"}
            />
            <InfoRow
              icon={<Calendar className="w-4 h-4" />}
              label="Date of Birth"
              value={student.date_of_birth ? new Date(student.date_of_birth).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—"}
            />
            <InfoRow icon={<MapPin className="w-4 h-4" />} label="Address" value={student.address || "—"} />
            <InfoRow
              icon={<ClipboardCheck className="w-4 h-4" />}
              label="Attendance"
              value={`${presentDays} present out of ${totalDays} days (${attendancePct}%)`}
            />
          </div>
        </Card>
      )}

      {/* Parent info */}
      {student && (student.parent_name || student.parent_mobile) && (
        <Card className="p-5 mb-4">
          <h3 className="font-semibold mb-3">Parent / Guardian</h3>
          <div className="space-y-3">
            <InfoRow icon={<User className="w-4 h-4" />} label="Name" value={student.parent_name || "—"} />
            <InfoRow icon={<Phone className="w-4 h-4" />} label="Mobile" value={student.parent_mobile || "—"} />
          </div>
        </Card>
      )}

      {/* Account & edit */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Account Settings</h3>
        <div className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={profile?.phone ?? user?.phone ?? ""} disabled />
          </div>
          <div>
            <Label>Display Name</Label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || !editName.trim()}
            className="bg-gradient-primary text-primary-foreground"
          >
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </Card>
    </>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}
