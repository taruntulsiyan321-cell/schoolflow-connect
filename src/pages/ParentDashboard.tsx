import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, ClipboardCheck, Bell, Wallet, FileText, MessageSquare, User, NotebookPen, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import NoticesPage from "./shared/NoticesPage";
import MyFeesPage from "./shared/MyFeesPage";
import MyMarksPage from "./shared/MyMarksPage";
import ChatPage from "./shared/ChatPage";
import { ProfilePage } from "./shared/SchoolFeatures";

const nav = [
  { to: "/parent", label: "Home", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/parent/attendance", label: "Attendance", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/parent/homework", label: "Homework", icon: <NotebookPen className="w-4 h-4" /> },
  { to: "/parent/marks", label: "Marks", icon: <Trophy className="w-4 h-4" /> },
  { to: "/parent/fees", label: "Fees", icon: <Wallet className="w-4 h-4" /> },
  { to: "/parent/notices", label: "Notices", icon: <Bell className="w-4 h-4" /> },
  { to: "/parent/chat", label: "Chat", icon: <MessageSquare className="w-4 h-4" /> },
  { to: "/parent/profile", label: "Profile", icon: <User className="w-4 h-4" /> },
];

const Home = () => {
  const { user } = useAuth();
  const [children, setChildren] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, { attPct: number; pendingFees: number }>>({});

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data } = await supabase.from("students").select("*, classes(name,section)").eq("parent_user_id", user.id);
      const kids = data ?? [];
      setChildren(kids);

      // Compute stats per child
      const s: Record<string, { attPct: number; pendingFees: number }> = {};
      for (const kid of kids) {
        // Attendance
        const { data: att } = await supabase.from("attendance").select("status").eq("student_id", kid.id);
        const total = att?.length ?? 0;
        const present = att?.filter((a) => a.status === "present").length ?? 0;
        const attPct = total > 0 ? Math.round((present / total) * 100) : 0;

        // Fees
        const { data: fees } = await supabase.from("fees").select("amount,paid_amount,status").eq("student_id", kid.id);
        const pendingFees = (fees ?? [])
          .filter((f) => f.status !== "paid")
          .reduce((sum, f) => sum + (Number(f.amount) - Number(f.paid_amount)), 0);

        s[kid.id] = { attPct, pendingFees };
      }
      setStats(s);
    })();
  }, [user]);

  return (
    <>
      <PageHeader title="Parent Dashboard" subtitle="Track your child's progress" />
      {children.length === 0 ? (
        <Card className="p-5 border-warning/30 bg-warning/5">
          <p className="text-sm">
            No children linked. Ask admin to link your account (<strong>{user?.email}</strong>) from the Link Users panel.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {children.map((c) => {
            const st = stats[c.id];
            return (
              <Card key={c.id} className="p-5 shadow-card">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-primary text-primary-foreground flex items-center justify-center text-lg font-bold shrink-0">
                    {c.full_name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div>
                    <div className="font-bold text-lg">{c.full_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {c.classes ? `Class ${c.classes.name}-${c.classes.section}` : "Unassigned"} · Roll {c.roll_number || "—"}
                    </div>
                  </div>
                </div>
                {st && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-xs text-muted-foreground">Attendance</div>
                      <div className={`text-xl font-bold ${st.attPct >= 75 ? "text-accent" : "text-warning"}`}>
                        {st.attPct}%
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-xs text-muted-foreground">Pending Fees</div>
                      <div className={`text-xl font-bold ${st.pendingFees > 0 ? "text-destructive" : "text-accent"}`}>
                        ₹{st.pendingFees}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
};

const ChildAttendance = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({ present: 0, absent: 0, leave: 0, total: 0 });

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: ss } = await supabase.from("students").select("id").eq("parent_user_id", user.id);
      const ids = ss?.map((s) => s.id) ?? [];
      if (!ids.length) return;
      const { data } = await supabase
        .from("attendance")
        .select("*, students(full_name)")
        .in("student_id", ids)
        .order("date", { ascending: false })
        .limit(60);
      const allRows = data ?? [];
      setRows(allRows);
      setSummary({
        present: allRows.filter((r) => r.status === "present").length,
        absent: allRows.filter((r) => r.status === "absent").length,
        leave: allRows.filter((r) => r.status === "leave").length,
        total: allRows.length,
      });
    })();
  }, [user]);

  const colors: Record<string, string> = {
    present: "bg-accent/10 text-accent",
    absent: "bg-destructive/10 text-destructive",
    leave: "bg-warning/10 text-warning",
  };

  return (
    <>
      <PageHeader title="Child Attendance" subtitle="Attendance records of your children" />
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Present" value={summary.present} tone="accent" />
        <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Absent" value={summary.absent} tone="warning" />
        <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Leave" value={summary.leave} />
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.id} className="p-3 flex items-center justify-between shadow-card">
            <div>
              <div className="font-medium">{r.students?.full_name}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(r.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full capitalize font-medium ${colors[r.status]}`}>
              {r.status}
            </span>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8">No records yet.</p>}
      </div>
    </>
  );
};

const ChildHomework = () => {
  const { user } = useAuth();
  const [homework, setHomework] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user) return;
      // Get children
      const { data: kids } = await supabase.from("students").select("id, full_name, class_id").eq("parent_user_id", user.id);
      if (!kids?.length) { setLoading(false); return; }

      const classIds = [...new Set(kids.map((k) => k.class_id).filter(Boolean))];
      if (!classIds.length) { setLoading(false); return; }

      // Get homework for children's classes
      const { data: hw } = await supabase
        .from("homework")
        .select("*")
        .in("class_id", classIds)
        .order("created_at", { ascending: false })
        .limit(30);

      // Get submissions for children
      const kidIds = kids.map((k) => k.id);
      const hwIds = (hw ?? []).map((h) => h.id);
      const { data: subs } = hwIds.length > 0
        ? await supabase.from("homework_submissions").select("*").in("student_id", kidIds).in("homework_id", hwIds)
        : { data: [] };

      const result = (hw ?? []).map((h) => {
        const sub = subs?.find((s) => s.homework_id === h.id);
        const kid = kids.find((k) => k.class_id === h.class_id);
        return { ...h, childName: kid?.full_name, submission: sub };
      });

      setHomework(result);
      setLoading(false);
    })();
  }, [user]);

  if (loading) return <p className="text-muted-foreground text-center py-8">Loading…</p>;

  const today = new Date().toISOString().split("T")[0];
  const pending = homework.filter((h) => !h.submission && (!h.due_date || h.due_date >= today));
  const done = homework.filter((h) => h.submission);

  return (
    <>
      <PageHeader title="Child Homework" subtitle="Track homework assignments and submissions" />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard icon={<NotebookPen className="w-5 h-5" />} label="Pending" value={pending.length} tone="warning" />
        <StatCard icon={<NotebookPen className="w-5 h-5" />} label="Submitted" value={done.length} tone="accent" />
      </div>

      {pending.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">⏳ Pending</h3>
          <div className="space-y-2 mb-4">
            {pending.map((h) => (
              <Card key={h.id} className="p-4 shadow-card border-l-4 border-l-warning">
                <div className="font-semibold text-sm">{h.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {h.subject} · {h.childName}
                  {h.due_date && ` · Due: ${new Date(h.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                </div>
                {h.description && <p className="text-xs text-muted-foreground mt-1">{h.description}</p>}
              </Card>
            ))}
          </div>
        </>
      )}

      {done.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">✅ Submitted</h3>
          <div className="space-y-2">
            {done.map((h) => (
              <Card key={h.id} className="p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-sm">{h.title}</div>
                    <div className="text-xs text-muted-foreground">{h.subject} · {h.childName}</div>
                  </div>
                  <Badge
                    variant="outline"
                    className={h.submission?.status === "graded"
                      ? "bg-accent/10 text-accent border-accent/30"
                      : "bg-warning/10 text-warning border-warning/30"}
                  >
                    {h.submission?.status === "graded" ? h.submission.grade || "Graded" : "Submitted"}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {homework.length === 0 && (
        <Card className="p-8 text-center">
          <NotebookPen className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No homework assigned yet.</p>
        </Card>
      )}
    </>
  );
};

export default function ParentDashboard() {
  return (
    <AppLayout nav={nav} title="Parent">
      <Routes>
        <Route index element={<Home />} />
        <Route path="attendance" element={<ChildAttendance />} />
        <Route path="homework" element={<ChildHomework />} />
        <Route path="marks" element={<MyMarksPage asParent />} />
        <Route path="fees" element={<MyFeesPage asParent />} />
        <Route path="notices" element={<NoticesPage viewerRole="parent" />} />
        <Route path="chat" element={<ChatPage userRole="parent" />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/parent" replace />} />
      </Routes>
    </AppLayout>
  );
}
