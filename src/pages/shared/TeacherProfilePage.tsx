import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { User, BookOpen, GraduationCap, Phone, Mail, Users } from "lucide-react";
import { toast } from "sonner";

export default function TeacherProfilePage() {
  const { user } = useAuth();
  const [teacher, setTeacher] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [classTeacherOf, setClassTeacherOf] = useState<any>(null);
  const [subjectClasses, setSubjectClasses] = useState<any[]>([]);

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

      // Fetch teacher record
      const { data: t } = await supabase
        .from("teachers")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      setTeacher(t);

      if (t) {
        // Fetch class teacher assignment
        if (t.class_teacher_of) {
          const { data: c } = await supabase
            .from("classes")
            .select("name,section")
            .eq("id", t.class_teacher_of)
            .maybeSingle();
          setClassTeacherOf(c);
        }

        // Fetch subject class assignments
        const { data: tc } = await supabase
          .from("teacher_classes")
          .select("subject, classes(name,section)")
          .eq("teacher_id", t.id);
        setSubjectClasses(
          (tc ?? []).map((r: any) => ({
            subject: r.subject,
            className: r.classes ? `${r.classes.name}-${r.classes.section}` : "—",
          }))
        );
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
            {(teacher?.full_name || editName || user?.email || "?")[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">
              {teacher?.full_name || editName || "Teacher"}
            </h2>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="outline" className="capitalize">Teacher</Badge>
              {teacher?.is_class_teacher && classTeacherOf && (
                <Badge className="bg-primary/15 text-primary border-primary/30" variant="outline">
                  Class Teacher · {classTeacherOf.name}-{classTeacherOf.section}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {!teacher && (
          <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
            Your account isn't linked to a teacher record yet. Ask admin to link{" "}
            <strong>{user?.email}</strong> from the Link Users panel.
          </div>
        )}
      </Card>

      {/* Stats */}
      {teacher && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <StatCard
            icon={<BookOpen className="w-5 h-5" />}
            label="Subject Classes"
            value={subjectClasses.length}
            tone="accent"
          />
          <StatCard
            icon={<Users className="w-5 h-5" />}
            label="Class Teacher"
            value={classTeacherOf ? `${classTeacherOf.name}-${classTeacherOf.section}` : "—"}
          />
        </div>
      )}

      {/* Teacher details */}
      {teacher && (
        <Card className="p-5 mb-4">
          <h3 className="font-semibold mb-3">Teacher Details</h3>
          <div className="space-y-3">
            <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="Primary Subject" value={teacher.subject || "—"} />
            <InfoRow icon={<Phone className="w-4 h-4" />} label="Mobile" value={teacher.mobile || "—"} />
            <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={teacher.email || user?.email || "—"} />
          </div>
        </Card>
      )}

      {/* Subject assignments */}
      {subjectClasses.length > 0 && (
        <Card className="p-5 mb-4">
          <h3 className="font-semibold mb-3">Class Assignments</h3>
          <div className="space-y-2">
            {subjectClasses.map((sc, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div className="font-medium text-sm">{sc.subject || "Subject"}</div>
                <Badge variant="outline">Class {sc.className}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Account settings */}
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
