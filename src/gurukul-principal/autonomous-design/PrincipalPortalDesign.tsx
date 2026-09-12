import React, { useState } from "react"
import {
  appData, fmtRupees, fmtPct, getClassSubjectMarks, getAbsentsForDate, getClassPresentForDate,
  getClassTests, getExamTotals,
  type ClassId, type StudentId, type TeacherId, type ExamId,
  type LeaveRequest, type Announcement,
} from "./data"

// ─── Navigation ──────────────────────────────────────────────────────────────

type Screen =
  | { id: "dashboard" }
  | { id: "fees" }
  | { id: "fees-class"; classId: ClassId }
  | { id: "fees-student"; classId: ClassId; studentId: StudentId }
  | { id: "attendance" }
  | { id: "attendance-class"; classId: ClassId; date?: string }
  | { id: "attendance-student"; classId: ClassId; studentId: StudentId }
  | { id: "leave" }
  | { id: "announcements" }
  | { id: "new-announcement" }
  | { id: "teachers" }
  | { id: "teacher"; teacherId: TeacherId }
  | { id: "students" }
  | { id: "student"; studentId: StudentId }
  | { id: "classes" }
  | { id: "class"; classId: ClassId; tab?: string }
  | { id: "class-homework"; classId: ClassId; homeworkId: string }
  | { id: "class-test"; classId: ClassId; testKey: string }
  | { id: "exam"; classId: ClassId; examId: ExamId }
  | { id: "exam-subject"; classId: ClassId; examId: ExamId; subjectId: string }
  | { id: "settings" }

function screenSection(s: Screen): string {
  if (s.id === "teachers" || s.id === "teacher") return "teachers"
  if (s.id === "students" || s.id === "student") return "students"
  if (s.id === "classes" || s.id === "class" || s.id === "class-homework" || s.id === "class-test" || s.id === "exam" || s.id === "exam-subject") return "classes"
  if (s.id === "settings") return "settings"
  return "dashboard"
}

function screenLabel(s: Screen): string {
  const d = appData
  switch (s.id) {
    case "dashboard": return "Dashboard"
    case "fees": return "Fees"
    case "fees-class": return d.classes[s.classId]?.name ?? s.classId
    case "fees-student": return d.students[s.studentId]?.name ?? s.studentId
    case "attendance": return "Attendance"
    case "attendance-class": return d.classes[s.classId]?.name ?? s.classId
    case "attendance-student": return d.students[s.studentId]?.name ?? s.studentId
    case "leave": return "Leave Requests"
    case "announcements": return "Announcements"
    case "new-announcement": return "New Announcement"
    case "teachers": return "Teachers"
    case "teacher": return d.teachers[s.teacherId]?.name ?? s.teacherId
    case "students": return "Students"
    case "student": return d.students[s.studentId]?.name ?? s.studentId
    case "classes": return "Classes"
    case "class": return d.classes[s.classId]?.name ?? s.classId
    case "class-homework": return "Homework"
    // The breadcrumb names the test itself, the way `exam` names the exam —
    // "Unit Test 2" tells the principal where they are; "Test" would not.
    case "class-test": return getClassTests(s.classId).find(t => t.key === s.testKey)?.title ?? "Test"
    case "exam": return d.classes[s.classId]?.exams.find(e => e.id === s.examId)?.name ?? "Exam"
    case "exam-subject": return d.classes[s.classId]?.exams.find(e => e.id === s.examId)?.subjects.find(sub => sub.id === s.subjectId)?.name ?? "Subject"
    case "settings": return "Settings"
  }
}

function useNav() {
  const [history, setHistory] = useState<Screen[]>([{ id: "dashboard" }])
  const current = history[history.length - 1]
  const navigate = (screen: Screen) => setHistory(prev => [...prev, screen])
  const goBack = () => setHistory(prev => prev.length > 1 ? prev.slice(0, -1) : prev)
  const jumpTo = (idx: number) => setHistory(prev => prev.slice(0, idx + 1))
  const resetTo = (screen: Screen) => setHistory([screen])
  return { current, history, navigate, goBack, jumpTo, resetTo }
}

// ─── Layout primitives ───────────────────────────────────────────────────────

function Sidebar({ section, onNav }: { section: string; onNav: (s: Screen) => void }) {
  const items: { id: string; label: string; screen: Screen }[] = [
    { id: "dashboard", label: "Dashboard", screen: { id: "dashboard" } },
    { id: "teachers",  label: "Teachers",  screen: { id: "teachers" } },
    { id: "students",  label: "Students",  screen: { id: "students" } },
    { id: "classes",   label: "Classes",   screen: { id: "classes" } },
  ]
  return (
    <aside className="w-52 flex-none flex flex-col bg-sidebar text-sidebar-foreground h-full">
      <div className="px-5 pt-6 pb-5 border-b border-white/10">
        <div className="font-display text-lg font-medium text-white tracking-tight leading-none">Gurukul</div>
        <div className="text-xs text-sidebar-foreground/50 mt-1 font-mono">Principal Portal</div>
      </div>
      <nav className="flex-1 py-4 px-3">
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => onNav(item.screen)}
            className={`w-full text-left px-3 py-2.5 rounded-sm text-sm mb-0.5 transition-colors ${
              section === item.id
                ? "bg-sidebar-accent text-white font-medium"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/5"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="px-5 py-4 border-t border-white/10">
        <div className="text-xs text-sidebar-foreground/40 font-mono">Sep 11, 2026</div>
      </div>
    </aside>
  )
}

function Header({
  history, jumpTo, onSettings,
}: {
  history: Screen[]
  jumpTo: (idx: number) => void
  onSettings: () => void
}) {
  const principal = appData.principal
  return (
    <header className="h-12 flex-none flex items-center px-6 border-b border-border bg-background">
      <nav className="flex items-center gap-1 flex-1 min-w-0">
        {history.map((s, i) => {
          const isLast = i === history.length - 1
          const label = screenLabel(s)
          return (
            <span key={i} className="flex items-center gap-1 min-w-0">
              {i > 0 && <span className="text-muted-foreground text-xs">/</span>}
              {isLast ? (
                <span className="text-sm font-medium text-foreground truncate">{label}</span>
              ) : (
                <button
                  onClick={() => jumpTo(i)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors truncate"
                >
                  {label}
                </button>
              )}
            </span>
          )
        })}
      </nav>
      <button
        onClick={onSettings}
        className="w-7 h-7 rounded-full bg-accent text-accent-foreground text-xs font-display font-medium flex items-center justify-center flex-none ml-4 hover:opacity-90 transition-opacity"
        title="Settings"
      >
        {principal.name.charAt(0)}
      </button>
    </header>
  )
}

// ─── Shared UI components ─────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h1 className="font-display text-2xl font-medium text-foreground mb-1">{children}</h1>
}

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`text-[10px] font-medium tracking-widest uppercase text-muted-foreground ${className}`}>
      {children}
    </span>
  )
}

function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-mono ${className}`}>{children}</span>
}

function Pill({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "muted" | "outline" }) {
  const cls = {
    default: "bg-secondary text-secondary-foreground",
    muted: "bg-muted text-muted-foreground",
    outline: "border border-border text-foreground",
  }[variant]
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded-sm ${cls}`}>
      {children}
    </span>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mb-4"
    >
      ← Back
    </button>
  )
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="py-16 text-center">
      <div className="text-sm text-muted-foreground">{title}</div>
      {detail && <div className="text-xs text-muted-foreground mt-1">{detail}</div>}
    </div>
  )
}

function LoadingRow() {
  return (
    <div className="h-10 flex items-center px-4">
      <div className="h-2 w-32 bg-muted rounded-sm animate-pulse" />
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardView({ navigate }: { navigate: (s: Screen) => void }) {
  const d = appData
  const fees = d.schoolFees
  const att = d.schoolAttendance
  const [requests, setRequests] = useState(d.leaveRequests)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const pending = requests.filter(r => r.status === "pending")
  const feesHealth = fees.totalDue > 0 ? fees.totalCollected / fees.totalDue : 1
  const attPct = att.totalCount > 0 ? (att.presentCount / att.totalCount) * 100 : 0
  const attTrend = attPct - att.yesterdayPercent
  const latestAnnouncements = d.announcements.slice(0, 3)

  function approve(id: string) {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "approved" as const, decisionDate: "2026-09-11" } : r))
  }
  function reject(id: string) {
    if (!rejectReason.trim()) return
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "rejected" as const, decisionDate: "2026-09-11", rejectionReason: rejectReason } : r))
    setRejectId(null); setRejectReason("")
  }

  const classRows = d.classOrder.map(cid => {
    const cls = d.classes[cid]
    return { cls, pct: cls.studentIds.length > 0 ? (cls.todayPresent / cls.studentIds.length) * 100 : 0 }
  })

  return (
    <div className="h-full flex flex-col p-5 gap-3">
      {/* Quick access strip */}
      <div className="flex items-center gap-2 flex-none">
        <span className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mr-1">Quick access</span>
        {([
          { label: "Post announcement", screen: { id: "new-announcement" } as Screen },
          { label: "Leave requests", screen: { id: "leave" } as Screen },
          { label: "Attendance", screen: { id: "attendance" } as Screen },
          { label: "Fees", screen: { id: "fees" } as Screen },
        ]).map(a => (
          <button key={a.label} onClick={() => navigate(a.screen)}
            className="px-3 py-1.5 text-xs border border-border bg-card hover:bg-secondary transition-colors">
            {a.label}
          </button>
        ))}
      </div>

      {/* Two panels */}
      <div className="flex-1 grid grid-cols-5 gap-4 min-h-0">

        {/* ── Panel 1: Operational ── */}
        <div className="col-span-3 flex flex-col gap-3 min-h-0">

          {/* Leave requests — inline queue */}
          <div className="bg-card border border-border flex flex-col min-h-0 flex-1">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between flex-none">
              <div className="flex items-baseline gap-3">
                <span className="font-display text-base font-medium">Leave Requests</span>
                <span className="font-mono text-xs text-muted-foreground">{pending.length} pending</span>
              </div>
              <button onClick={() => navigate({ id: "leave" })} className="text-xs text-muted-foreground hover:text-foreground transition-colors">All →</button>
            </div>
            <div className="flex-1 scroll-y">
              {pending.length === 0 ? (
                <div className="px-5 py-8 text-sm text-muted-foreground">No pending leave requests.</div>
              ) : pending.map(req => {
                const days = Math.round((new Date(req.toDate).getTime() - new Date(req.fromDate).getTime()) / 86400000) + 1
                return (
                  <div key={req.id} className="px-5 py-4 border-b border-border last:border-b-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">{req.studentName}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{req.className} · {req.category} · {days} {days === 1 ? "day" : "days"}</div>
                      </div>
                      <div className="font-mono text-xs text-muted-foreground flex-none">
                        {req.fromDate === req.toDate ? req.fromDate : `${req.fromDate} – ${req.toDate}`}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-2">{req.reason}</p>
                    {rejectId === req.id ? (
                      <div className="mt-3 flex gap-2">
                        <input
                          className="flex-1 text-xs border border-border bg-background px-2 py-1.5 focus:outline-none focus:border-foreground/40"
                          placeholder="Reason for turning this down…"
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          autoFocus
                        />
                        <button onClick={() => reject(req.id)} className="px-2.5 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-80">Confirm</button>
                        <button onClick={() => { setRejectId(null); setRejectReason("") }} className="px-2.5 py-1.5 text-xs border border-border hover:bg-secondary">Cancel</button>
                      </div>
                    ) : (
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => approve(req.id)} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-80 transition-opacity">Approve</button>
                        <button onClick={() => setRejectId(req.id)} className="px-3 py-1.5 text-xs border border-border hover:bg-secondary transition-colors">Turn down</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Announcements — compact list */}
          <div className="bg-card border border-border flex-none">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <span className="font-display text-base font-medium">Announcements</span>
              <button onClick={() => navigate({ id: "new-announcement" })} className="text-xs border border-border px-3 py-1.5 hover:bg-secondary transition-colors">Post new</button>
            </div>
            {latestAnnouncements.length === 0 ? (
              <div className="px-5 py-4 text-sm text-muted-foreground">No announcements yet.</div>
            ) : latestAnnouncements.map(a => (
              <button
                key={a.id}
                onClick={() => navigate({ id: "announcements" })}
                className="w-full text-left px-5 py-3 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-medium truncate leading-snug">{a.title}</div>
                  <div className="text-xs text-muted-foreground font-mono flex-none">{a.sentOn}</div>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {a.sentTo.includes("all") ? "All classes" : a.sentTo.map(id => appData.classes[id]?.name ?? id).join(", ")}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Panel 2: School health ── */}
        <div className="col-span-2 flex flex-col gap-3 min-h-0">

          {/* Attendance — summary + per-class */}
          <div className="bg-card border border-border flex flex-col min-h-0 flex-1">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between flex-none">
              <div>
                <span className="font-display text-base font-medium">Attendance</span>
                <div className="text-xs text-muted-foreground mt-0.5">{att.date}</div>
              </div>
              <button onClick={() => navigate({ id: "attendance" })} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Open →</button>
            </div>
            <div className="px-5 py-3 border-b border-border flex-none">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-medium">{attPct.toFixed(1)}%</span>
                <span className="text-xs text-muted-foreground">{att.presentCount} / {att.totalCount} present</span>
              </div>
              <div className="flex gap-3 mt-1">
                <span className="text-xs text-muted-foreground">{attTrend >= 0 ? "+" : ""}{attTrend.toFixed(1)} pp vs yesterday</span>
                <span className="text-xs text-muted-foreground">{att.below75Count} below 75% for year</span>
              </div>
            </div>
            <div className="flex-1 scroll-y">
              {classRows.map(({ cls, pct }) => (
                <button
                  key={cls.id}
                  onClick={() => navigate({ id: "attendance-class", classId: cls.id })}
                  className="w-full flex items-center px-5 py-2.5 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors"
                >
                  <span className="flex-1 text-xs text-left">{cls.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{cls.todayPresent} / {cls.studentIds.length}</span>
                  <span className="font-mono text-xs w-12 text-right">{pct.toFixed(0)}%</span>
                </button>
              ))}
            </div>
          </div>

          {/* Fees — summary */}
          <div className="bg-card border border-border flex-none">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <span className="font-display text-base font-medium">Fees</span>
              <button onClick={() => navigate({ id: "fees" })} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Open →</button>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-medium">{fmtRupees(fees.totalCollected)}</span>
                <span className="text-xs text-muted-foreground">of {fmtRupees(fees.totalDue)} due</span>
              </div>
              <div className="mt-3 h-1 bg-muted overflow-hidden">
                <div className="h-full bg-foreground/50 transition-all" style={{ width: `${Math.min(feesHealth * 100, 100).toFixed(1)}%` }} />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-xs text-muted-foreground">{(feesHealth * 100).toFixed(1)}% collected</span>
                <span className="text-xs text-muted-foreground">{fmtRupees(fees.totalDue - fees.totalCollected)} outstanding</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">As of {fees.asOf}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Fees ─────────────────────────────────────────────────────────────────────

function FeesSchoolView({ navigate, goBack }: { navigate: (s: Screen) => void; goBack: () => void }) {
  const d = appData
  const fees = d.schoolFees
  const [sortBy, setSortBy] = useState<"name" | "outstanding" | "collected">("outstanding")

  const classRows = d.classOrder.map(cid => {
    const cls = d.classes[cid]
    const students = cls.studentIds.map(sid => d.students[sid]).filter(Boolean)
    const collected = students.reduce((sum, s) => sum + s.fees.paid, 0)
    const annual = students.reduce((sum, s) => sum + s.fees.annual, 0)
    const due = students.length * 28000
    const outstanding = due - collected
    return { cls, collected, annual, due, outstanding, count: students.length }
  }).sort((a, b) => {
    if (sortBy === "outstanding") return b.outstanding - a.outstanding
    if (sortBy === "collected") return b.collected - a.collected
    return a.cls.name.localeCompare(b.cls.name)
  })

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Fees</Label>
      <SectionHeading>All classes</SectionHeading>

      <div className="grid grid-cols-3 gap-4 mt-6 mb-8 max-w-2xl">
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Collected</Label>
          <div className="font-mono text-2xl font-medium">{fmtRupees(fees.totalCollected)}</div>
        </div>
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Outstanding</Label>
          <div className="font-mono text-2xl font-medium">{fmtRupees(fees.totalDue - fees.totalCollected)}</div>
        </div>
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Collection rate</Label>
          <div className="font-mono text-2xl font-medium">{fmtPct(fees.totalCollected, fees.totalDue)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">of what is due</div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground mb-4">As of {fees.asOf}</div>

      <div className="border border-border bg-card max-w-2xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1 text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Class</div>
          <div className="w-14 text-right text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Students</div>
          <button onClick={() => setSortBy("collected")} className={`w-28 text-right text-[10px] font-medium tracking-widest uppercase ${sortBy === "collected" ? "text-foreground" : "text-muted-foreground"} hover:text-foreground transition-colors`}>Collected</button>
          <button onClick={() => setSortBy("outstanding")} className={`w-28 text-right text-[10px] font-medium tracking-widest uppercase ${sortBy === "outstanding" ? "text-foreground" : "text-muted-foreground"} hover:text-foreground transition-colors`}>Outstanding</button>
        </div>
        {classRows.map(row => (
          <button
            key={row.cls.id}
            onClick={() => navigate({ id: "fees-class", classId: row.cls.id })}
            className="w-full flex items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors group text-left"
          >
            <div className="flex-1 text-sm font-medium text-foreground">{row.cls.name}</div>
            <div className="w-14 text-right font-mono text-sm text-muted-foreground">{row.count}</div>
            <div className="w-28 text-right font-mono text-sm">{fmtRupees(row.collected)}</div>
            <div className={`w-28 text-right font-mono text-sm ${row.outstanding > 0 ? "text-foreground" : "text-muted-foreground"}`}>
              {row.outstanding > 0 ? fmtRupees(row.outstanding) : "—"}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function FeesClassView({ classId, navigate, goBack }: { classId: ClassId; navigate: (s: Screen) => void; goBack: () => void }) {
  const cls = appData.classes[classId]
  const [sortBy, setSortBy] = useState<"name" | "outstanding" | "paid">("outstanding")
  const [filterYear, setFilterYear] = useState<string>("all")

  if (!cls) return <EmptyState title="Class not found." />

  const students = cls.studentIds.map(sid => appData.students[sid]).filter(Boolean)
  const years = [...new Set(students.map(s => s.classId === classId ? String(cls.yearGroup) : ""))]

  const rows = students.map(s => ({
    s,
    outstanding: Math.max(0, 28000 - s.fees.paid),
    paid: s.fees.paid,
    annual: s.fees.annual,
  })).sort((a, b) => {
    if (sortBy === "outstanding") return b.outstanding - a.outstanding
    if (sortBy === "paid") return b.paid - a.paid
    return a.s.name.localeCompare(b.s.name)
  })

  const totalPaid = rows.reduce((sum, r) => sum + r.paid, 0)
  const totalOutstanding = rows.reduce((sum, r) => sum + r.outstanding, 0)

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Fees</Label>
      <SectionHeading>{cls.name}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">{students.length} students</div>

      <div className="flex gap-4 mb-6 max-w-xl">
        <div className="bg-card border border-border p-3 flex-1">
          <Label className="block mb-1.5">Collected</Label>
          <div className="font-mono text-xl">{fmtRupees(totalPaid)}</div>
        </div>
        <div className="bg-card border border-border p-3 flex-1">
          <Label className="block mb-1.5">Outstanding</Label>
          <div className="font-mono text-xl">{fmtRupees(totalOutstanding)}</div>
        </div>
        <div className="bg-card border border-border p-3 flex-1">
          <Label className="block mb-1.5">Rate</Label>
          <div className="font-mono text-xl">{fmtPct(totalPaid, totalPaid + totalOutstanding)}</div>
        </div>
      </div>

      <div className="border border-border bg-card max-w-xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="w-8 text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Roll</div>
          <button onClick={() => setSortBy("name")} className={`flex-1 text-left text-[10px] font-medium tracking-widest uppercase ${sortBy === "name" ? "text-foreground" : "text-muted-foreground"} hover:text-foreground transition-colors ml-2`}>Name</button>
          <button onClick={() => setSortBy("paid")} className={`w-24 text-right text-[10px] font-medium tracking-widest uppercase ${sortBy === "paid" ? "text-foreground" : "text-muted-foreground"} hover:text-foreground transition-colors`}>Paid</button>
          <button onClick={() => setSortBy("outstanding")} className={`w-24 text-right text-[10px] font-medium tracking-widest uppercase ${sortBy === "outstanding" ? "text-foreground" : "text-muted-foreground"} hover:text-foreground transition-colors`}>Owed</button>
        </div>
        {rows.map(({ s, outstanding, paid }) => (
          <button
            key={s.id}
            onClick={() => navigate({ id: "fees-student", classId, studentId: s.id })}
            className="w-full flex items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
          >
            <div className="w-8 font-mono text-xs text-muted-foreground">{s.rollNo.slice(-3)}</div>
            <div className="flex-1 text-sm ml-2">{s.name}</div>
            <div className="w-24 text-right font-mono text-sm">{fmtRupees(paid)}</div>
            <div className={`w-24 text-right font-mono text-sm ${outstanding === 0 ? "text-muted-foreground" : ""}`}>
              {outstanding === 0 ? "—" : fmtRupees(outstanding)}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function FeesStudentView({ classId, studentId, goBack }: { classId: ClassId; studentId: StudentId; goBack: () => void }) {
  const s = appData.students[studentId]
  const cls = appData.classes[classId]
  if (!s || !cls) return <EmptyState title="Student not found." />

  const outstanding = Math.max(0, 28000 - s.fees.paid)
  const installments = [
    { label: "Installment 1 (June 2026)", amount: 14000, due: "2026-06-15" },
    { label: "Installment 2 (August 2026)", amount: 14000, due: "2026-08-15" },
    { label: "Installment 3 (January 2027)", amount: 14000, due: "2027-01-15" },
  ]

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Fees · {cls.name}</Label>
      <SectionHeading>{s.name}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">Roll {s.rollNo} · {cls.name}</div>

      <div className="grid grid-cols-3 gap-4 max-w-xl mb-8">
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Annual fee</Label>
          <div className="font-mono text-xl">{fmtRupees(s.fees.annual)}</div>
        </div>
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Paid</Label>
          <div className="font-mono text-xl">{fmtRupees(s.fees.paid)}</div>
          {s.fees.lastPaymentDate && (
            <div className="text-xs text-muted-foreground mt-1">Last: {s.fees.lastPaymentDate}</div>
          )}
        </div>
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Outstanding</Label>
          <div className="font-mono text-xl">{outstanding === 0 ? "₹0" : fmtRupees(outstanding)}</div>
          <div className="text-xs text-muted-foreground mt-1">{outstanding === 0 ? "fully paid" : "of ₹28,000 due"}</div>
        </div>
      </div>

      <Label className="block mb-3">Installment schedule</Label>
      <div className="border border-border bg-card max-w-xl">
        {installments.map((inst, i) => {
          const paid = s.fees.payments.find(p => p.installment.startsWith(`Installment ${i + 1}`))
          return (
            <div key={i} className="flex items-center px-4 py-3 border-b border-border last:border-b-0">
              <div className="flex-1">
                <div className="text-sm">{inst.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Due {inst.due}</div>
              </div>
              <div className="font-mono text-sm w-24 text-right">{fmtRupees(inst.amount)}</div>
              <div className="w-20 text-right">
                {paid ? (
                  <span className="text-xs text-muted-foreground font-mono">Paid {paid.date}</span>
                ) : i < 2 ? (
                  <span className="text-xs text-muted-foreground">Unpaid</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Not due</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Attendance ───────────────────────────────────────────────────────────────

function AttendanceSchoolView({ navigate, goBack }: { navigate: (s: Screen) => void; goBack: () => void }) {
  const att = appData.schoolAttendance
  const [date, setDate] = useState("2026-09-11")
  const isToday = date === "2026-09-11"

  const classRows = appData.classOrder.map(cid => {
    const cls = appData.classes[cid]
    const total = cls.studentIds.length
    const present = isToday ? cls.todayPresent : getClassPresentForDate(cid, date)
    return { cls, present, total, pct: total > 0 ? (present / total) * 100 : 0 }
  })

  const totalPresent = classRows.reduce((s, r) => s + r.present, 0)
  const totalStudents = classRows.reduce((s, r) => s + r.total, 0)
  const attPct = totalStudents > 0 ? (totalPresent / totalStudents) * 100 : 0
  const trendPp = isToday ? attPct - att.yesterdayPercent : 0

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Attendance</Label>
      <div className="flex items-end gap-6 mt-1 mb-6">
        <SectionHeading>{isToday ? `Today — ${att.date}` : date}</SectionHeading>
        <div className="flex items-center gap-2 mb-1">
          <Label>Date</Label>
          <input
            type="date"
            value={date}
            min="2026-06-01"
            max="2026-09-11"
            onChange={e => setDate(e.target.value)}
            className="border border-border bg-card px-2 py-1 text-xs font-mono focus:outline-none focus:border-foreground/40 transition-colors"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8 max-w-2xl">
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Present</Label>
          <div className="font-mono text-2xl">{totalPresent} / {totalStudents}</div>
          <div className="font-mono text-lg text-muted-foreground">{attPct.toFixed(1)}%</div>
        </div>
        {isToday ? (
          <div className="bg-card border border-border p-4">
            <Label className="block mb-2">vs yesterday</Label>
            <div className="font-mono text-2xl">{trendPp >= 0 ? "+" : ""}{trendPp.toFixed(1)} pp</div>
            <div className="text-xs text-muted-foreground mt-1">Yesterday: {att.yesterdayPercent}%</div>
          </div>
        ) : (
          <div className="bg-card border border-border p-4">
            <Label className="block mb-2">Absent</Label>
            <div className="font-mono text-2xl">{totalStudents - totalPresent}</div>
            <div className="text-xs text-muted-foreground mt-1">students</div>
          </div>
        )}
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Below 75% for year</Label>
          <div className="font-mono text-2xl">{att.below75Count}</div>
          <div className="text-xs text-muted-foreground mt-1">students</div>
        </div>
      </div>

      <div className="border border-border bg-card max-w-2xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1 text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Class</div>
          <div className="w-28 text-right text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Present</div>
          <div className="w-24 text-right text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Rate</div>
          <div className="w-28 text-right text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Below 75% (year)</div>
        </div>
        {classRows.map(row => (
          <button
            key={row.cls.id}
            onClick={() => navigate({ id: "attendance-class", classId: row.cls.id, date })}
            className="w-full flex items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
          >
            <div className="flex-1 text-sm font-medium">{row.cls.name}</div>
            <div className="w-28 text-right font-mono text-sm">{row.present} / {row.total}</div>
            <div className="w-24 text-right font-mono text-sm">{row.pct.toFixed(1)}%</div>
            <div className="w-28 text-right font-mono text-sm text-muted-foreground">{row.cls.below75Count}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function AttendanceClassView({ classId, date: initDate, navigate, goBack }: { classId: ClassId; date?: string; navigate: (s: Screen) => void; goBack: () => void }) {
  const cls = appData.classes[classId]
  const [date, setDate] = useState(initDate ?? "2026-09-11")
  const isToday = date === "2026-09-11"
  const [view, setView] = useState<"day" | "cumulative">("day")

  if (!cls) return <EmptyState title="Class not found." />

  const students = cls.studentIds.map(sid => appData.students[sid]).filter(Boolean)
  const total = students.length

  const absentIds = new Set(getAbsentsForDate(classId, date))
  const presentCount = total - absentIds.size
  const absentStudents = students.filter(s => absentIds.has(s.id))
  const presentStudents = students.filter(s => !absentIds.has(s.id))

  /**
   * The year-to-date table, ordered as a RANKING.
   *
   * It was sorted worst-first, which reads as a watchlist — a list of who to
   * worry about. Ordered the other way it answers the question the aggregate is
   * actually for: where each student stands on attendance across the year so
   * far. Same rows, same figure, same screen; only the direction changes, plus
   * the position each row has earned.
   *
   * Ties share a rank (1, 2, 2, 4) rather than being numbered off by arrival
   * order — two students on the same percentage are in the same place, and
   * rounding to one decimal makes ties common.
   */
  const cumulativeRows = (() => {
    const rows = students
      .map(s => ({ s, pct: s.totalDays > 0 ? (s.presentDays / s.totalDays) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct || a.s.rollNo.localeCompare(b.s.rollNo))
    let lastPct: number | null = null
    let lastRank = 0
    return rows.map((row, i) => {
      const rank = lastPct !== null && row.pct.toFixed(1) === lastPct.toFixed(1) ? lastRank : i + 1
      lastPct = row.pct
      lastRank = rank
      return { ...row, rank }
    })
  })()

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Attendance · {cls.name}</Label>
      <div className="flex items-end gap-6 mt-1 mb-6">
        <SectionHeading>{isToday ? "Today" : date}</SectionHeading>
        <div className="flex items-center gap-2 mb-1">
          <Label>Date</Label>
          <input
            type="date"
            value={date}
            min="2026-06-01"
            max="2026-09-11"
            onChange={e => setDate(e.target.value)}
            className="border border-border bg-card px-2 py-1 text-xs font-mono focus:outline-none focus:border-foreground/40"
          />
        </div>
      </div>

      <div className="flex gap-3 mb-6 max-w-xl">
        <div className="bg-card border border-border p-3 flex-1">
          <Label className="block mb-1.5">Present</Label>
          <div className="font-mono text-xl">{presentCount} / {total}</div>
          <div className="font-mono text-sm text-muted-foreground">{fmtPct(presentCount, total)}</div>
        </div>
        <div className="bg-card border border-border p-3 flex-1">
          <Label className="block mb-1.5">Absent</Label>
          <div className="font-mono text-xl">{absentIds.size}</div>
          <div className="text-xs text-muted-foreground mt-0.5">students</div>
        </div>
        <div className="bg-card border border-border p-3 flex-1">
          <Label className="block mb-1.5">Below 75% (year)</Label>
          <div className="font-mono text-xl">{cls.below75Count}</div>
          <div className="text-xs text-muted-foreground mt-0.5">students</div>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-0 border border-border w-fit mb-5">
        <button onClick={() => setView("day")} className={`px-4 py-1.5 text-xs ${view === "day" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"} transition-colors`}>
          {isToday ? "Today" : "This date"}
        </button>
        <button onClick={() => setView("cumulative")} className={`px-4 py-1.5 text-xs border-l border-border ${view === "cumulative" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"} transition-colors`}>
          Cumulative (year)
        </button>
      </div>

      {view === "day" && (
        <div className="max-w-xl space-y-4">
          {absentIds.size > 0 && (
            <div>
              <Label className="block mb-2">Absent — {absentIds.size} students</Label>
              <div className="border border-border bg-card">
                {absentStudents.map(s => (
                  <button
                    key={s.id}
                    onClick={() => navigate({ id: "attendance-student", classId, studentId: s.id })}
                    className="w-full flex items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
                  >
                    <div className="w-10 font-mono text-xs text-muted-foreground">{s.rollNo.slice(-3)}</div>
                    <div className="flex-1 text-sm">{s.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {((s.presentDays / s.totalDays) * 100).toFixed(1)}% YTD
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <Label className="block mb-2">Present — {presentCount} students</Label>
            <div className="border border-border bg-card">
              {presentStudents.map(s => (
                <button
                  key={s.id}
                  onClick={() => navigate({ id: "attendance-student", classId, studentId: s.id })}
                  className="w-full flex items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
                >
                  <div className="w-10 font-mono text-xs text-muted-foreground">{s.rollNo.slice(-3)}</div>
                  <div className="flex-1 text-sm">{s.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {((s.presentDays / s.totalDays) * 100).toFixed(1)}% YTD
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === "cumulative" && (
        <div className="border border-border bg-card max-w-xl">
          <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
            <div className="w-8 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">#</div>
            <div className="w-10 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Roll</div>
            <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Name</div>
            <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Days</div>
            <div className="w-20 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Rate</div>
          </div>
          {cumulativeRows.map(({ s, pct, rank }) => (
            <button
              key={s.id}
              onClick={() => navigate({ id: "attendance-student", classId, studentId: s.id })}
              className="w-full flex items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
            >
              <div className="w-8 font-mono text-xs text-muted-foreground">{rank}</div>
              <div className="w-10 font-mono text-xs text-muted-foreground">{s.rollNo.slice(-3)}</div>
              <div className="flex-1 text-sm">{s.name}</div>
              <div className="w-24 text-right font-mono text-sm">{s.presentDays} / {s.totalDays}</div>
              <div className={`w-20 text-right font-mono text-sm ${pct < 75 ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                {pct.toFixed(1)}%
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AttendanceStudentView({ classId, studentId, goBack }: { classId: ClassId; studentId: StudentId; goBack: () => void }) {
  const s = appData.students[studentId]
  const cls = appData.classes[classId]
  if (!s || !cls) return <EmptyState title="Student not found." />
  const pct = s.totalDays > 0 ? (s.presentDays / s.totalDays) * 100 : 0
  const absences = s.totalDays - s.presentDays

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Attendance · {cls.name}</Label>
      <SectionHeading>{s.name}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">Roll {s.rollNo}</div>

      <div className="grid grid-cols-3 gap-4 max-w-xl mb-8">
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Present</Label>
          <div className="font-mono text-2xl">{s.presentDays}</div>
          <div className="text-xs text-muted-foreground">of {s.totalDays} days</div>
        </div>
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Attendance rate</Label>
          <div className="font-mono text-2xl">{pct.toFixed(1)}%</div>
          {pct < 75 && <div className="text-xs text-muted-foreground mt-1">Below 75% threshold</div>}
        </div>
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Absences</Label>
          <div className="font-mono text-2xl">{absences}</div>
          <div className="text-xs text-muted-foreground">days absent</div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground max-w-xl">
        Detailed day-by-day attendance record is maintained in the attendance register.
        Approved leave absences count separately from unexplained absences in the register.
      </div>
    </div>
  )
}

// ─── Leave ────────────────────────────────────────────────────────────────────

function LeaveView({ goBack }: { goBack: () => void }) {
  const [requests, setRequests] = useState(appData.leaveRequests)
  const [tab, setTab] = useState<"pending" | "decided">("pending")
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const pending = requests.filter(r => r.status === "pending")
  const decided = requests.filter(r => r.status !== "pending")

  function approve(id: string) {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "approved" as const, decisionDate: "2026-09-11" } : r))
  }

  function reject(id: string) {
    if (!rejectReason.trim()) return
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "rejected" as const, decisionDate: "2026-09-11", rejectionReason: rejectReason } : r))
    setRejectId(null)
    setRejectReason("")
  }

  function LeaveCard({ req }: { req: LeaveRequest }) {
    const days = Math.round((new Date(req.toDate).getTime() - new Date(req.fromDate).getTime()) / 86400000) + 1
    return (
      <div className="bg-card border border-border p-5 mb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{req.studentName}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{req.className} · Submitted {req.submittedOn}</div>
          </div>
          <div className="text-right flex-none">
            <div className="font-mono text-sm">{req.fromDate === req.toDate ? req.fromDate : `${req.fromDate} – ${req.toDate}`}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{days} {days === 1 ? "day" : "days"} · {req.category}</div>
          </div>
        </div>
        <p className="text-sm mt-3 text-muted-foreground leading-relaxed">{req.reason}</p>
        {req.status === "pending" && (
          <div className="mt-4 flex items-center gap-2">
            {rejectId === req.id ? (
              <div className="flex-1 flex gap-2">
                <input
                  className="flex-1 text-sm border border-border bg-background px-3 py-1.5 focus:outline-none focus:border-foreground/40"
                  placeholder="Reason for turning down this request…"
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  autoFocus
                />
                <button onClick={() => reject(req.id)} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-80 transition-opacity">Confirm</button>
                <button onClick={() => { setRejectId(null); setRejectReason("") }} className="px-3 py-1.5 text-xs border border-border hover:bg-secondary transition-colors">Cancel</button>
              </div>
            ) : (
              <>
                <button onClick={() => approve(req.id)} className="px-3.5 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-80 transition-opacity">Approve</button>
                <button onClick={() => setRejectId(req.id)} className="px-3.5 py-1.5 text-xs border border-border hover:bg-secondary transition-colors">Turn down</button>
              </>
            )}
          </div>
        )}
        {req.status !== "pending" && (
          <div className="mt-3 text-xs text-muted-foreground">
            {req.status === "approved" ? "Approved" : "Turned down"} · {req.decisionDate}
            {req.rejectionReason && <span> · Reason given: {req.rejectionReason}</span>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <SectionHeading>Leave Requests</SectionHeading>

      <div className="flex gap-0 border border-border w-fit mt-6 mb-6">
        <button onClick={() => setTab("pending")} className={`px-5 py-2 text-xs ${tab === "pending" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"} transition-colors`}>
          Pending ({pending.length})
        </button>
        <button onClick={() => setTab("decided")} className={`px-5 py-2 text-xs border-l border-border ${tab === "decided" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"} transition-colors`}>
          Decided ({decided.length})
        </button>
      </div>

      <div className="max-w-xl">
        {tab === "pending" && (
          pending.length === 0
            ? <EmptyState title="No pending requests." detail="Leave requests from students will appear here." />
            : pending.map(r => <LeaveCard key={r.id} req={r} />)
        )}
        {tab === "decided" && (
          decided.length === 0
            ? <EmptyState title="No decided requests yet." />
            : decided.map(r => <LeaveCard key={r.id} req={r} />)
        )}
      </div>
    </div>
  )
}

// ─── Announcements ────────────────────────────────────────────────────────────

function AnnouncementsView({ navigate, goBack }: { navigate: (s: Screen) => void; goBack: () => void }) {
  const ann = appData.announcements
  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <Label>Announcements</Label>
          <SectionHeading>All announcements</SectionHeading>
        </div>
        <button
          onClick={() => navigate({ id: "new-announcement" })}
          className="px-4 py-2 text-xs bg-primary text-primary-foreground hover:opacity-80 transition-opacity"
        >
          Post new
        </button>
      </div>

      <div className="max-w-2xl">
        {ann.length === 0 ? (
          <EmptyState title="No announcements yet." detail="Post an announcement to reach teachers, students, or the whole school." />
        ) : ann.map(a => (
          <div key={a.id} className="bg-card border border-border p-5 mb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-snug">{a.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {a.sentOn} · {a.sentBy} · to{" "}
                  {a.sentTo.includes("all")
                    ? "all classes"
                    : a.sentTo.map(id => appData.classes[id]?.name ?? id).join(", ")}
                </div>
              </div>
            </div>
            <p className="text-sm mt-3 text-muted-foreground leading-relaxed whitespace-pre-line line-clamp-3">{a.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function NewAnnouncementView({ goBack }: { goBack: () => void }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [sentTo, setSentTo] = useState<string[]>(["all"])
  const [sent, setSent] = useState(false)

  const classIds = appData.classOrder
  const isAll = sentTo.includes("all")

  function toggleClass(id: string) {
    if (id === "all") {
      setSentTo(["all"])
    } else {
      const without = sentTo.filter(x => x !== "all")
      setSentTo(without.includes(id) ? without.filter(x => x !== id) : [...without, id])
    }
  }

  const recipientPreview = isAll
    ? `All classes (${appData.classOrder.length} classes, ${appData.schoolAttendance.totalCount} students and all staff)`
    : sentTo.length === 0
    ? "No recipients selected"
    : `${sentTo.map(id => appData.classes[id]?.name ?? id).join(", ")} — ${sentTo.reduce((n, id) => n + (appData.classes[id]?.studentIds.length ?? 0), 0)} students`

  if (sent) {
    return (
      <div className="p-8">
        <div className="max-w-xl">
          <div className="text-sm font-medium mb-2">Announcement posted.</div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-1">Sent to: {recipientPreview}</p>
          <button onClick={goBack} className="mt-6 text-xs text-muted-foreground hover:text-foreground transition-colors">← Back to announcements</button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Announcements</Label>
      <SectionHeading>New announcement</SectionHeading>

      <div className="max-w-xl mt-6 space-y-5">
        <div>
          <Label className="block mb-2">Title</Label>
          <input
            className="w-full border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:border-foreground/40 transition-colors"
            placeholder="Subject line"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        <div>
          <Label className="block mb-2">Message</Label>
          <textarea
            className="w-full border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:border-foreground/40 transition-colors resize-none"
            rows={6}
            placeholder="Write the announcement…"
            value={body}
            onChange={e => setBody(e.target.value)}
          />
        </div>

        <div>
          <Label className="block mb-2">Send to</Label>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => toggleClass("all")}
              className={`px-3 py-1.5 text-xs border transition-colors ${isAll ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary"}`}
            >
              All classes
            </button>
            {classIds.map(id => (
              <button
                key={id}
                onClick={() => toggleClass(id)}
                className={`px-3 py-1.5 text-xs border transition-colors ${!isAll && sentTo.includes(id) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary"}`}
              >
                {appData.classes[id]?.name}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-secondary/60 border border-border px-4 py-3">
          <Label className="block mb-1">Who will receive this</Label>
          <div className="text-sm">{recipientPreview}</div>
        </div>

        <button
          onClick={() => { if (title && body && sentTo.length) setSent(true) }}
          disabled={!title || !body || sentTo.length === 0}
          className="px-5 py-2.5 text-sm bg-primary text-primary-foreground hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Post announcement
        </button>
      </div>
    </div>
  )
}

// ─── Teachers ─────────────────────────────────────────────────────────────────

function TeachersView({ navigate }: { navigate: (s: Screen) => void }) {
  const [search, setSearch] = useState("")
  const all = Object.values(appData.teachers)
  const filtered = search
    ? all.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.subjects.some(s => s.toLowerCase().includes(search.toLowerCase())))
    : all

  return (
    <div className="p-8 scroll-y h-full">
      <Label>Staff</Label>
      <SectionHeading>Teachers</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">{all.length} teachers</div>

      <div className="mb-4 max-w-md">
        <input
          className="w-full border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-foreground/40 transition-colors"
          placeholder="Search by name or subject…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="border border-border bg-card max-w-2xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Name</div>
          <div className="w-48 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Subjects</div>
          <div className="w-48 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Classes</div>
          <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Attendance</div>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">No teachers match that search.</div>
        ) : filtered.map(t => (
          <button
            key={t.id}
            onClick={() => navigate({ id: "teacher", teacherId: t.id })}
            className="w-full flex items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{t.name}</div>
              <div className="text-xs text-muted-foreground">{t.designation}</div>
            </div>
            <div className="w-48 text-xs text-muted-foreground">{t.subjects.join(", ")}</div>
            <div className="w-48 text-xs text-muted-foreground">{t.classIds.map(id => appData.classes[id]?.name ?? id).join(", ")}</div>
            <div className="w-24 text-right font-mono text-sm">{fmtPct(t.presentDays, t.totalDays)}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function TeacherDetailView({ teacherId, goBack }: { teacherId: TeacherId; goBack: () => void }) {
  const t = appData.teachers[teacherId]
  if (!t) return <EmptyState title="Teacher not found." />
  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Teachers</Label>
      <SectionHeading>{t.name}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">{t.designation}</div>

      <div className="grid grid-cols-2 gap-6 max-w-2xl">
        <div className="space-y-4">
          <div>
            <Label className="block mb-2">Contact</Label>
            <div className="text-sm">{t.email}</div>
            <div className="text-sm text-muted-foreground">{t.phone}</div>
          </div>
          <div>
            <Label className="block mb-2">At Gurukul since</Label>
            <div className="text-sm font-mono">{t.joinDate}</div>
          </div>
          <div>
            <Label className="block mb-2">Subjects</Label>
            <div className="flex gap-1.5 flex-wrap">
              {t.subjects.map(s => <Pill key={s}>{s}</Pill>)}
            </div>
          </div>
          <div>
            <Label className="block mb-2">Classes</Label>
            <div className="flex gap-1.5 flex-wrap">
              {t.classIds.map(id => <Pill key={id}>{appData.classes[id]?.name ?? id}</Pill>)}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border p-4">
            <Label className="block mb-2">Attendance this year</Label>
            <div className="font-mono text-2xl">{fmtPct(t.presentDays, t.totalDays)}</div>
            <div className="text-xs text-muted-foreground mt-1">{t.presentDays} / {t.totalDays} days</div>
          </div>
          <div className="bg-card border border-border p-4">
            <Label className="block mb-2">Homework assigned</Label>
            <div className="font-mono text-2xl">{t.homeworkSet}</div>
            <div className="text-xs text-muted-foreground mt-1">assignments this term</div>
          </div>
          <div className="bg-card border border-border p-4">
            <Label className="block mb-2">Tests conducted</Label>
            <div className="font-mono text-2xl">{t.testsRun}</div>
            <div className="text-xs text-muted-foreground mt-1">tests this term</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Students ─────────────────────────────────────────────────────────────────

function StudentsView({ navigate }: { navigate: (s: Screen) => void }) {
  const [search, setSearch] = useState("")
  const [filterClass, setFilterClass] = useState<string>("all")

  const all = Object.values(appData.students)
  const filtered = all
    .filter(s => filterClass === "all" || s.classId === filterClass)
    .filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.rollNo.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-8 h-full flex flex-col">
      <Label>School</Label>
      <SectionHeading>Students</SectionHeading>
      <div className="text-sm text-muted-foreground mb-4">{all.length} students enrolled</div>

      <div className="flex gap-2 mb-4">
        <input
          className="border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-foreground/40 transition-colors w-56"
          placeholder="Search by name or roll number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="border border-border bg-card px-3 py-2 text-sm focus:outline-none"
          value={filterClass}
          onChange={e => setFilterClass(e.target.value)}
        >
          <option value="all">All classes</option>
          {appData.classOrder.map(id => (
            <option key={id} value={id}>{appData.classes[id]?.name}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-hidden border border-border bg-card">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="w-16 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Roll</div>
          <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Name</div>
          <div className="w-32 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Class</div>
          <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Attendance</div>
        </div>
        <div className="scroll-y" style={{ height: "calc(100% - 37px)" }}>
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground">
              {search || filterClass !== "all" ? "No students match." : "No students enrolled yet."}
            </div>
          ) : filtered.map(s => (
            <button
              key={s.id}
              onClick={() => navigate({ id: "student", studentId: s.id })}
              className="w-full flex items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
            >
              <div className="w-16 font-mono text-xs text-muted-foreground">{s.rollNo}</div>
              <div className="flex-1 text-sm">{s.name}</div>
              <div className="w-32 text-xs text-muted-foreground">{appData.classes[s.classId]?.name ?? s.classId}</div>
              <div className="w-24 text-right font-mono text-sm">{fmtPct(s.presentDays, s.totalDays)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function StudentRecordView({ studentId, goBack }: { studentId: StudentId; goBack: () => void }) {
  const s = appData.students[studentId]
  const cls = s ? appData.classes[s.classId] : null
  const [openExamIds, setOpenExamIds] = useState<Set<string>>(() => {
    const first = new Set<string>()
    if (s?.examMarks[0]) first.add(s.examMarks[0].examId)
    return first
  })
  const [showAllRemarks, setShowAllRemarks] = useState(false)
  const [showAllTests, setShowAllTests] = useState(false)

  if (!s || !cls) return <EmptyState title="Student not found." />

  const attPct = s.totalDays > 0 ? (s.presentDays / s.totalDays) * 100 : 0
  const outstanding = Math.max(0, 28000 - s.fees.paid)
  const formTeacher = appData.teachers[cls.formTeacherId]
  const examIds = [...new Set(s.examMarks.map(m => m.examId))]
  const sortedTests = [...s.testMarks].reverse()
  const visibleTests = showAllTests ? sortedTests : sortedTests.slice(0, 10)
  const visibleRemarks = showAllRemarks ? s.remarks : s.remarks.slice(0, 5)

  function toggleExam(eid: string) {
    setOpenExamIds(prev => {
      const next = new Set(prev)
      if (next.has(eid)) next.delete(eid); else next.add(eid)
      return next
    })
  }

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Students</Label>

      {/* Profile header */}
      <SectionHeading>{s.name}</SectionHeading>
      <div className="text-sm text-muted-foreground mt-1 mb-8">
        Roll {s.rollNo} · {cls.name}
        {formTeacher && ` · Form teacher: ${formTeacher.name}`}
      </div>

      <div className="max-w-2xl space-y-10">

        {/* ── Stats strip ── */}
        <section>
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-card border border-border p-3">
              <Label className="block mb-1.5">Attendance</Label>
              <div className="font-mono text-xl">{attPct.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.presentDays} / {s.totalDays} days</div>
              {attPct < 75 && <div className="text-xs text-muted-foreground mt-0.5">Below 75% threshold</div>}
            </div>
            <div className="bg-card border border-border p-3">
              <Label className="block mb-1.5">Absences</Label>
              <div className="font-mono text-xl">{s.totalDays - s.presentDays}</div>
              <div className="text-xs text-muted-foreground mt-0.5">days absent</div>
            </div>
            <div className="bg-card border border-border p-3">
              <Label className="block mb-1.5">Fees paid</Label>
              <div className="font-mono text-xl">{fmtRupees(s.fees.paid)}</div>
              {s.fees.lastPaymentDate
                ? <div className="text-xs text-muted-foreground mt-0.5">Last: {s.fees.lastPaymentDate}</div>
                : <div className="text-xs text-muted-foreground mt-0.5">No payments yet</div>
              }
            </div>
            <div className="bg-card border border-border p-3">
              <Label className="block mb-1.5">Outstanding</Label>
              <div className="font-mono text-xl">{outstanding === 0 ? "₹0" : fmtRupees(outstanding)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{outstanding === 0 ? "fully paid" : "of ₹28k due"}</div>
            </div>
          </div>
        </section>

        {/* ── Homework ── */}
        <section>
          <Label className="block mb-3">Homework</Label>
          <div className="border border-border bg-card">
            <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
              <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Assignment</div>
              <div className="w-28 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Subject</div>
              <div className="w-20 font-mono text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Due</div>
              <div className="w-20 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Status</div>
            </div>
            {s.homework.length === 0
              ? <div className="px-4 py-6 text-sm text-muted-foreground">No homework recorded yet.</div>
              : s.homework.map((hw, i) => (
                <div key={i} className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0">
                  <div className="flex-1 text-sm">{hw.title}</div>
                  <div className="w-28 text-xs text-muted-foreground">{hw.subject}</div>
                  <div className="w-20 font-mono text-xs text-muted-foreground">{hw.dueDate.slice(5)}</div>
                  <div className="w-20 text-right">
                    <span className={`text-xs ${hw.status === "missing" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                      {hw.status}
                    </span>
                  </div>
                </div>
              ))
            }
          </div>
        </section>

        {/* ── Exam results — accordion, most recent open ── */}
        <section>
          <Label className="block mb-3">Exam results</Label>
          {examIds.length === 0 ? (
            <div className="text-sm text-muted-foreground">No exam results recorded yet.</div>
          ) : (
            <div className="space-y-2">
              {examIds.map((eid) => {
                const marks = s.examMarks.filter(m => m.examId === eid)
                const exam = cls.exams.find(e => e.id === eid)
                const isOpen = openExamIds.has(eid)
                return (
                  <div key={eid} className="border border-border bg-card">
                    <button
                      onClick={() => toggleExam(eid)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/40 transition-colors text-left"
                    >
                      <div>
                        <div className="text-sm font-medium">{exam?.name ?? eid}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{exam?.term} · {exam?.date}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">{isOpen ? "▲" : "▼"}</span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-border">
                        {marks.map((m, i) => (
                          <div key={i} className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0">
                            <div className="flex-1 text-sm">{m.subject}</div>
                            <div className="font-mono text-sm">{m.marks} / {m.outOf}</div>
                            <div className="w-14 text-right font-mono text-sm text-muted-foreground">
                              {((m.marks / m.outOf) * 100).toFixed(0)}%
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── Tests — stream, newest first ── */}
        <section>
          <Label className="block mb-3">Tests</Label>
          {sortedTests.length === 0 ? (
            <div className="text-sm text-muted-foreground">No test results recorded.</div>
          ) : (
            <>
              <div className="border border-border bg-card">
                {visibleTests.map((t, i) => (
                  <div key={i} className="flex items-center px-4 py-3 border-b border-border last:border-b-0">
                    <div className="flex-1">
                      <div className="text-sm">{t.title} — {t.subject}</div>
                      <div className="font-mono text-xs text-muted-foreground mt-0.5">{t.date}</div>
                    </div>
                    <div className="font-mono text-sm">{t.marks} / {t.outOf}</div>
                    <div className="w-14 text-right font-mono text-sm text-muted-foreground">
                      {((t.marks / t.outOf) * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
              {sortedTests.length > 10 && (
                <button onClick={() => setShowAllTests(v => !v)} className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {showAllTests ? "Show fewer" : `Show all ${sortedTests.length} tests`}
                </button>
              )}
            </>
          )}
        </section>

        {/* ── Remarks ── */}
        <section>
          <Label className="block mb-3">Remarks</Label>
          {s.remarks.length === 0 ? (
            <div className="text-sm text-muted-foreground">No remarks recorded. Remarks written by any teacher will appear here.</div>
          ) : (
            <>
              <div className="space-y-2">
                {visibleRemarks.map((r, i) => (
                  <div key={i} className="bg-card border border-border px-4 py-3">
                    <div className="flex justify-between items-start mb-2">
                      <div className="text-xs text-muted-foreground">{r.teacher}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.date}</div>
                    </div>
                    <p className="text-sm leading-relaxed">{r.text}</p>
                  </div>
                ))}
              </div>
              {s.remarks.length > 5 && (
                <button onClick={() => setShowAllRemarks(v => !v)} className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {showAllRemarks ? "Show fewer" : `Show all ${s.remarks.length} remarks`}
                </button>
              )}
            </>
          )}
        </section>

      </div>
    </div>
  )
}

// ─── Classes ──────────────────────────────────────────────────────────────────

function ClassesView({ navigate }: { navigate: (s: Screen) => void }) {
  return (
    <div className="p-8 scroll-y h-full">
      <Label>School</Label>
      <SectionHeading>Classes</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">{appData.classOrder.length} classes</div>

      <div className="border border-border bg-card max-w-3xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Class</div>
          <div className="w-20 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Students</div>
          <div className="w-28 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Attendance today</div>
          <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Below 75%</div>
          <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">HW completion</div>
          <div className="w-28 text-[10px] tracking-widest uppercase text-muted-foreground font-medium pl-4">Form teacher</div>
        </div>
        {appData.classOrder.map(cid => {
          const cls = appData.classes[cid]
          const total = cls.studentIds.length
          const ft = appData.teachers[cls.formTeacherId]
          return (
            <button
              key={cid}
              onClick={() => navigate({ id: "class", classId: cid })}
              className="w-full flex items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
            >
              <div className="flex-1 text-sm font-medium">{cls.name}</div>
              <div className="w-20 text-right font-mono text-sm">
                {total === 0 ? <span className="text-muted-foreground">—</span> : total}
              </div>
              <div className="w-28 text-right font-mono text-sm">
                {total === 0 ? <span className="text-muted-foreground">—</span> : `${fmtPct(cls.todayPresent, total)}`}
              </div>
              <div className="w-24 text-right font-mono text-sm text-muted-foreground">{cls.below75Count}</div>
              <div className="w-24 text-right font-mono text-sm text-muted-foreground">
                {(cls.homeworkCompletion * 100).toFixed(0)}%
              </div>
              <div className="w-28 text-xs text-muted-foreground pl-4 truncate">{ft?.name ?? "—"}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ClassDetailView({ classId, tab: initTab = "students", navigate, goBack }: { classId: ClassId; tab?: string; navigate: (s: Screen) => void; goBack: () => void }) {
  const cls = appData.classes[classId]
  const [tab, setTab] = useState(initTab)
  if (!cls) return <EmptyState title="Class not found." />

  const students = cls.studentIds.map(sid => appData.students[sid]).filter(Boolean)
  const ft = appData.teachers[cls.formTeacherId]
  const classTests = getClassTests(classId)

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>Classes</Label>
      <SectionHeading>{cls.name}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-5">
        {students.length} students
        {ft && ` · Form teacher: ${ft.name}`}
      </div>

      {/* Tests sit between homework and exams: more frequent than an exam,
          more formal than homework, which is the order a principal reads them
          in. */}
      <div className="flex gap-0 border border-border w-fit mb-6">
        {["students","homework","tests","exams"].map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 text-xs capitalize ${i > 0 ? "border-l border-border" : ""} ${tab === t ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"} transition-colors`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "students" && (
        <div className="border border-border bg-card max-w-xl">
          <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
            <div className="w-12 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Roll</div>
            <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Name</div>
            <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Attendance</div>
          </div>
          {students.length === 0
            ? <EmptyState title="No students enrolled in this class." detail="Students will appear here once they are assigned to this class." />
            : students.map(s => {
              const pct = s.totalDays > 0 ? (s.presentDays / s.totalDays) * 100 : 0
              return (
                <button
                  key={s.id}
                  onClick={() => navigate({ id: "student", studentId: s.id })}
                  className="w-full flex items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
                >
                  <div className="w-12 font-mono text-xs text-muted-foreground">{s.rollNo.slice(-3)}</div>
                  <div className="flex-1 text-sm">{s.name}</div>
                  <div className={`w-24 text-right font-mono text-sm ${pct < 75 ? "font-medium" : "text-muted-foreground"}`}>
                    {pct.toFixed(1)}%
                  </div>
                </button>
              )
            })
          }
        </div>
      )}

      {tab === "homework" && (
        <div className="border border-border bg-card max-w-2xl">
          <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
            <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Assignment</div>
            <div className="w-24 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Subject</div>
            <div className="w-16 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Due</div>
            <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Submitted</div>
            <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Reviewed</div>
          </div>
          {cls.homework.length === 0
            ? <EmptyState title="No homework assigned yet." />
            : cls.homework.map(hw => (
              <button
                key={hw.id}
                onClick={() => navigate({ id: "class-homework", classId, homeworkId: hw.id })}
                className="w-full flex items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
              >
                <div className="flex-1 text-sm">{hw.title}</div>
                <div className="w-24 text-xs text-muted-foreground">{hw.subject}</div>
                <div className="w-16 text-right font-mono text-xs text-muted-foreground">{hw.dueDate.slice(5)}</div>
                <div className="w-24 text-right font-mono text-sm">{hw.submitted} / {hw.totalStudents}</div>
                <div className="w-24 text-right font-mono text-sm text-muted-foreground">{hw.reviewed} / {hw.submitted}</div>
              </button>
            ))
          }
        </div>
      )}

      {tab === "tests" && (
        <div className="space-y-3 max-w-xl">
          {classTests.length === 0
            ? <EmptyState title="No tests recorded for this class." detail="Tests appear here once a teacher enters marks." />
            : classTests.map(t => {
              const scored = t.marks.length
              const avg = scored > 0 ? t.marks.reduce((n, m) => n + m.marks, 0) / scored : 0
              return (
                <button
                  key={t.key}
                  onClick={() => navigate({ id: "class-test", classId, testKey: t.key })}
                  className="w-full bg-card border border-border p-4 text-left hover:border-foreground/30 transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{t.subject} · {t.date}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm">{avg.toFixed(1)} / {t.outOf}</div>
                      <div className="text-xs text-muted-foreground">class average</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-2 group-hover:text-foreground transition-colors">View marks →</div>
                </button>
              )
            })
          }
        </div>
      )}

      {tab === "exams" && (
        <div className="space-y-3 max-w-xl">
          {cls.exams.length === 0
            ? <EmptyState title="No exams recorded for this class." />
            : cls.exams.map(exam => {
              const withMarks = exam.subjects.filter(s => s.hasMarks).length
              const total = exam.subjects.length
              return (
                <button
                  key={exam.id}
                  onClick={() => navigate({ id: "exam", classId, examId: exam.id })}
                  className="w-full bg-card border border-border p-4 text-left hover:border-foreground/30 transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{exam.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{exam.term} · {exam.date}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm">{withMarks} / {total}</div>
                      <div className="text-xs text-muted-foreground">subjects with marks</div>
                    </div>
                  </div>
                  {withMarks < total && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Marks pending for: {exam.subjects.filter(s => !s.hasMarks).map(s => s.name).join(", ")}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-2 group-hover:text-foreground transition-colors">View results →</div>
                </button>
              )
            })
          }
        </div>
      )}
    </div>
  )
}

/**
 * One test, every student's mark.
 *
 * A test's marks existed only inside a student's own record, so a principal
 * could see one student across many tests and never one test across the class.
 * This is the other axis, and it is built from the same numbers the student
 * record shows, so the two can never disagree.
 *
 * Ordered highest first, matching the per-subject exam table, and ties share a
 * position the way the attendance ranking does.
 */
function ClassTestView({ classId, testKey, goBack }: { classId: ClassId; testKey: string; goBack: () => void }) {
  const cls = appData.classes[classId]
  const test = getClassTests(classId).find(t => t.key === testKey)
  if (!cls || !test) return <EmptyState title="Test not found." />

  const scored = test.marks.length
  const avg = scored > 0 ? test.marks.reduce((n, m) => n + m.marks, 0) / scored : 0
  const highest = scored > 0 ? Math.max(...test.marks.map(m => m.marks)) : 0
  const lowest = scored > 0 ? Math.min(...test.marks.map(m => m.marks)) : 0

  const ranked = (() => {
    const rows = [...test.marks].sort((a, b) => b.marks - a.marks || a.rollNo.localeCompare(b.rollNo))
    let lastMarks: number | null = null
    let lastRank = 0
    return rows.map((m, i) => {
      const rank = lastMarks !== null && m.marks === lastMarks ? lastRank : i + 1
      lastMarks = m.marks
      lastRank = rank
      return { ...m, rank }
    })
  })()

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>{cls.name} · Tests</Label>
      <SectionHeading>{test.title}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">
        {test.subject} · {test.date} · out of {test.outOf}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8 max-w-xl">
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Class average</Label>
          <div className="font-mono text-2xl">{avg.toFixed(1)}</div>
          <div className="text-xs text-muted-foreground mt-1">of {test.outOf}</div>
        </div>
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Highest</Label>
          <div className="font-mono text-2xl">{highest}</div>
          <div className="text-xs text-muted-foreground mt-1">of {test.outOf}</div>
        </div>
        <div className="bg-card border border-border p-4">
          <Label className="block mb-2">Lowest</Label>
          <div className="font-mono text-2xl">{lowest}</div>
          <div className="text-xs text-muted-foreground mt-1">of {test.outOf}</div>
        </div>
      </div>

      <Label className="block mb-3">All students</Label>
      <div className="border border-border bg-card max-w-xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="w-8 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">#</div>
          <div className="w-10 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Roll</div>
          <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Student</div>
          <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Marks</div>
          <div className="w-16 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">%</div>
        </div>
        {ranked.length === 0 ? (
          <EmptyState title="No marks entered for this test yet." />
        ) : ranked.map(m => (
          <div key={m.studentId} className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0">
            <div className="w-8 font-mono text-xs text-muted-foreground">{m.rank}</div>
            <div className="w-10 font-mono text-xs text-muted-foreground">{m.rollNo.slice(-3)}</div>
            <div className="flex-1 text-sm">{m.name}</div>
            <div className="w-24 text-right font-mono text-sm">{m.marks} / {m.outOf}</div>
            <div className="w-16 text-right font-mono text-sm text-muted-foreground">
              {((m.marks / m.outOf) * 100).toFixed(0)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HomeworkDetailView({ classId, homeworkId, goBack }: { classId: ClassId; homeworkId: string; goBack: () => void }) {
  const cls = appData.classes[classId]
  const hw = cls?.homework.find(h => h.id === homeworkId)
  if (!cls || !hw) return <EmptyState title="Homework not found." />

  const students = cls.studentIds.map(sid => appData.students[sid]).filter(Boolean)
  const studentStatuses = students.map(s => {
    const item = s.homework.find(h => h.subject === hw.subject)
    return { s, status: item?.status ?? "missing" }
  })

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>{cls.name} · Homework</Label>
      <SectionHeading>{hw.title}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">{hw.subject} · Due {hw.dueDate}</div>

      <div className="flex gap-3 mb-6">
        {["submitted","accepted","rejected","missing"].map(status => {
          const count = studentStatuses.filter(r => r.status === status).length
          return (
            <div key={status} className="bg-card border border-border px-3 py-2.5">
              <Label className="block mb-1">{status}</Label>
              <div className="font-mono text-xl">{count}</div>
            </div>
          )
        })}
      </div>

      <div className="border border-border bg-card max-w-xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Student</div>
          <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Status</div>
        </div>
        {studentStatuses.map(({ s, status }) => (
          <div key={s.id} className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0">
            <div className="flex-1 text-sm">{s.name}</div>
            <div className={`w-24 text-right text-xs ${status === "missing" ? "font-medium text-foreground" : "text-muted-foreground"}`}>
              {status}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ExamView({ classId, examId, navigate, goBack }: { classId: ClassId; examId: ExamId; navigate: (s: Screen) => void; goBack: () => void }) {
  const cls = appData.classes[classId]
  const exam = cls?.exams.find(e => e.id === examId)
  const examTotals = getExamTotals(classId, examId)
  // Ties share a position, as they do in the attendance ranking and the test
  // table — two students on the same total are in the same place.
  const rankedTotals = (() => {
    let lastTotal: number | null = null
    let lastRank = 0
    return examTotals.rows.map((r, i) => {
      const rank = lastTotal !== null && r.total === lastTotal ? lastRank : i + 1
      lastTotal = r.total
      lastRank = rank
      return { ...r, rank }
    })
  })()
  if (!cls || !exam) return <EmptyState title="Exam not found." />

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>{cls.name}</Label>
      <SectionHeading>{exam.name}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">{exam.term} · {exam.date}</div>

      {exam.subjects.filter(s => !s.hasMarks).length > 0 && (
        <div className="bg-secondary border border-border px-4 py-3 mb-6 max-w-xl text-sm text-muted-foreground">
          Marks not yet entered for: {exam.subjects.filter(s => !s.hasMarks).map(s => s.name).join(", ")}. Results shown below are partial.
        </div>
      )}

      <div className="max-w-xl space-y-2 mb-8">
        {exam.subjects.map(sub => (
          <button
            key={sub.id}
            disabled={!sub.hasMarks}
            onClick={() => navigate({ id: "exam-subject", classId, examId, subjectId: sub.id })}
            className={`w-full bg-card border border-border p-4 text-left transition-colors group ${sub.hasMarks ? "hover:border-foreground/30 cursor-pointer" : "opacity-50 cursor-default"}`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{sub.name}</div>
              <div className="text-xs text-muted-foreground">{sub.hasMarks ? "Marks in · View →" : "Marks pending"}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Leaderboard — ranked on TOTAL marks across the exam.
          Placed under the subject list because it is the whole-exam reading of
          the same numbers: the subjects above answer "how did the class do in
          Physics", this answers "where does each student stand overall".
          The caption states how many subjects the total covers, so a
          part-marked exam produces a real ordering of what HAS been marked
          rather than a final position nobody has earned yet. */}
      {examTotals.rows.length > 0 && (
        <div className="max-w-xl mb-8">
          <Label className="block mb-1">Leaderboard</Label>
          <div className="text-xs text-muted-foreground mb-3">
            Total across {examTotals.subjectsCounted} of {examTotals.subjectsTotal}{" "}
            {examTotals.subjectsTotal === 1 ? "subject" : "subjects"}
            {examTotals.subjectsCounted < examTotals.subjectsTotal ? " marked so far" : ""}
          </div>
          <div className="border border-border bg-card">
            <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
              <div className="w-8 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">#</div>
              <div className="w-10 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Roll</div>
              <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Student</div>
              <div className="w-28 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Total</div>
              <div className="w-16 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">%</div>
            </div>
            {rankedTotals.map(r => (
              <div key={r.studentId} className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0">
                <div className="w-8 font-mono text-xs text-muted-foreground">{r.rank}</div>
                <div className="w-10 font-mono text-xs text-muted-foreground">{r.rollNo.slice(-3)}</div>
                <div className="flex-1 text-sm">{r.name}</div>
                <div className="w-28 text-right font-mono text-sm">{r.total} / {r.outOf}</div>
                <div className="w-16 text-right font-mono text-sm text-muted-foreground">
                  {r.outOf > 0 ? ((r.total / r.outOf) * 100).toFixed(0) : "—"}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {exam.classTeacherComment && (
        <div className="max-w-xl">
          <Label className="block mb-2">Class teacher's note</Label>
          <div className="bg-card border border-border px-4 py-3 text-sm text-muted-foreground leading-relaxed italic">
            "{exam.classTeacherComment}"
          </div>
        </div>
      )}
    </div>
  )
}

function ExamSubjectView({ classId, examId, subjectId, goBack }: { classId: ClassId; examId: ExamId; subjectId: string; goBack: () => void }) {
  const cls = appData.classes[classId]
  const exam = cls?.exams.find(e => e.id === examId)
  const sub = exam?.subjects.find(s => s.id === subjectId)
  if (!cls || !exam || !sub) return <EmptyState title="Subject not found." />

  const marks = getClassSubjectMarks(classId, examId, subjectId)
  const passMark = sub.passMark
  const outOf = sub.outOf

  const ranges = [
    { label: "81–100%",  min: outOf * 0.81, max: outOf },
    { label: "61–80%",   min: outOf * 0.61, max: outOf * 0.80 },
    { label: "41–60%",   min: outOf * 0.41, max: outOf * 0.60 },
    { label: "Passed",   min: passMark,     max: outOf * 0.40 },
    { label: "Failed",   min: 0,            max: passMark - 1 },
  ]

  const bucketed = ranges.map(r => ({
    ...r,
    count: marks.filter(m => m.marks >= r.min && m.marks <= r.max).length,
  }))

  const failCount = marks.filter(m => m.marks < passMark).length
  const maxCount = Math.max(...bucketed.map(b => b.count), 1)

  const sorted = [...marks].sort((a, b) => b.marks - a.marks)

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={goBack} />
      <Label>{cls.name} · {exam.name}</Label>
      <SectionHeading>{sub.name}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-8">
        Out of {outOf} · Pass mark {passMark} · {marks.length} students
      </div>

      {/* Score distribution — the main thing */}
      <Label className="block mb-4">Score distribution</Label>
      <div className="max-w-md mb-2 space-y-2">
        {bucketed.map((b, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-16 text-xs text-muted-foreground font-mono text-right">{b.label}</div>
            <div className="flex-1 h-6 bg-secondary relative overflow-hidden">
              <div
                className={`h-full transition-all ${i === bucketed.length - 1 ? "bg-foreground/30" : "bg-foreground/60"}`}
                style={{ width: `${(b.count / maxCount) * 100}%` }}
              />
            </div>
            <div className="w-6 text-xs font-mono text-muted-foreground">{b.count}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted-foreground mb-8">
        <Mono>{failCount}</Mono> {failCount === 1 ? "student" : "students"} scored below the pass mark of <Mono>{passMark}</Mono>
      </div>

      {/* Per-student scores */}
      <Label className="block mb-3">All students</Label>
      <div className="border border-border bg-card max-w-md">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1 text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Student</div>
          <div className="w-24 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">Marks</div>
          <div className="w-16 text-right text-[10px] tracking-widest uppercase text-muted-foreground font-medium">%</div>
        </div>
        {sorted.map((m, i) => (
          <div key={m.studentId} className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0">
            <div className="flex-1 text-sm">{m.name}</div>
            <div className={`w-24 text-right font-mono text-sm ${m.marks < passMark ? "font-medium" : ""}`}>
              {m.marks} / {m.outOf}
            </div>
            <div className={`w-16 text-right font-mono text-sm text-muted-foreground`}>
              {((m.marks / m.outOf) * 100).toFixed(0)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsView({ goBack }: { goBack: () => void }) {
  const p = appData.principal
  const [hasPassword, setHasPassword] = useState(false)
  const [twoFA, setTwoFA] = useState(false)
  const [twoFAStep, setTwoFAStep] = useState<0|1|2|3>(0)
  const [passwordMode, setPasswordMode] = useState<"none"|"add"|"change">("none")
  const [pw, setPw] = useState("")
  const [pw2, setPw2] = useState("")
  const [pwError, setPwError] = useState("")

  function submitPassword() {
    if (pw.length < 8) { setPwError("Password must be at least 8 characters."); return }
    if (pw !== pw2) { setPwError("Passwords do not match."); return }
    setHasPassword(true)
    setPasswordMode("none")
    setPw(""); setPw2(""); setPwError("")
  }

  function start2FA() {
    setTwoFAStep(1)
  }

  function disable2FA() {
    setTwoFA(false)
    setTwoFAStep(0)
  }

  return (
    <div className="p-8 scroll-y h-full max-w-xl">
      <BackButton onClick={goBack} />
      <SectionHeading>Settings</SectionHeading>

      {/* Account */}
      <section className="mt-8 mb-10">
        <Label className="block mb-4">Account</Label>
        <div className="bg-card border border-border divide-y divide-border">
          {[["Name", p.name], ["School", p.school], ["Email", p.email], ["Role", p.role]].map(([k, v]) => (
            <div key={k} className="flex items-center px-4 py-3">
              <div className="w-24 text-xs text-muted-foreground">{k}</div>
              <div className="text-sm">{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Security */}
      <section>
        <Label className="block mb-4">Security</Label>

        <div className="bg-card border border-border mb-4">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-sm font-medium">Password</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {hasPassword
                ? "A password is set on your account."
                : "You currently sign in with a code sent to your phone. A password is optional."}
            </div>
          </div>
          <div className="px-4 py-3">
            {passwordMode === "none" && (
              <button
                onClick={() => setPasswordMode(hasPassword ? "change" : "add")}
                className="text-xs border border-border px-3 py-1.5 hover:bg-secondary transition-colors"
              >
                {hasPassword ? "Change password" : "Add a password"}
              </button>
            )}
            {(passwordMode === "add" || passwordMode === "change") && (
              <div className="space-y-3 max-w-xs">
                <div>
                  <Label className="block mb-1.5">New password</Label>
                  <input
                    type="password"
                    className="w-full border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground/40"
                    placeholder="At least 8 characters"
                    value={pw}
                    onChange={e => { setPw(e.target.value); setPwError("") }}
                  />
                </div>
                <div>
                  <Label className="block mb-1.5">Confirm password</Label>
                  <input
                    type="password"
                    className="w-full border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground/40"
                    value={pw2}
                    onChange={e => { setPw2(e.target.value); setPwError("") }}
                  />
                </div>
                {pwError && <div className="text-xs text-foreground">{pwError}</div>}
                <div className="flex gap-2">
                  <button onClick={submitPassword} className="px-3.5 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-80 transition-opacity">
                    {passwordMode === "add" ? "Set password" : "Update password"}
                  </button>
                  <button onClick={() => { setPasswordMode("none"); setPw(""); setPw2(""); setPwError("") }} className="px-3.5 py-1.5 text-xs border border-border hover:bg-secondary transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-card border border-border">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-sm font-medium">Two-factor authentication</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {twoFA ? "Two-factor authentication is on." : "Off by default. Adds a second step when signing in."}
            </div>
          </div>
          <div className="px-4 py-4">
            {!twoFA && twoFAStep === 0 && (
              <button onClick={start2FA} className="text-xs border border-border px-3 py-1.5 hover:bg-secondary transition-colors">
                Turn on
              </button>
            )}
            {!twoFA && twoFAStep === 1 && (
              <div className="max-w-xs space-y-3">
                <p className="text-xs text-muted-foreground">When you sign in, a code will be sent to your registered phone number. Enter that code to complete sign-in.</p>
                <p className="text-xs font-mono text-muted-foreground">Phone: +91 ×××× ×× 1234</p>
                <div className="flex gap-2">
                  <button onClick={() => setTwoFAStep(2)} className="px-3.5 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-80 transition-opacity">Continue</button>
                  <button onClick={() => setTwoFAStep(0)} className="px-3.5 py-1.5 text-xs border border-border hover:bg-secondary transition-colors">Cancel</button>
                </div>
              </div>
            )}
            {!twoFA && twoFAStep === 2 && (
              <div className="max-w-xs space-y-3">
                <p className="text-xs text-muted-foreground">Enter the 6-digit code sent to your phone to confirm.</p>
                <input className="border border-border bg-background px-3 py-2 text-sm font-mono w-36 focus:outline-none focus:border-foreground/40 tracking-widest" placeholder="000000" maxLength={6} />
                <div className="flex gap-2">
                  <button onClick={() => { setTwoFA(true); setTwoFAStep(3) }} className="px-3.5 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-80 transition-opacity">Verify and enable</button>
                  <button onClick={() => setTwoFAStep(0)} className="px-3.5 py-1.5 text-xs border border-border hover:bg-secondary transition-colors">Cancel</button>
                </div>
              </div>
            )}
            {twoFA && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">A code is sent to your registered phone each time you sign in.</p>
                <button onClick={disable2FA} className="text-xs border border-border px-3 py-1.5 hover:bg-secondary transition-colors">Turn off</button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const nav = useNav()
  const s = nav.current
  const section = screenSection(s)

  function handleSidebarNav(screen: Screen) {
    nav.resetTo(screen)
  }

  function handleSettings() {
    nav.navigate({ id: "settings" })
  }

  function renderContent() {
    switch (s.id) {
      case "dashboard":
        return <DashboardView navigate={nav.navigate} />
      case "fees":
        return <FeesSchoolView navigate={nav.navigate} goBack={nav.goBack} />
      case "fees-class":
        return <FeesClassView classId={s.classId} navigate={nav.navigate} goBack={nav.goBack} />
      case "fees-student":
        return <FeesStudentView classId={s.classId} studentId={s.studentId} goBack={nav.goBack} />
      case "attendance":
        return <AttendanceSchoolView navigate={nav.navigate} goBack={nav.goBack} />
      case "attendance-class":
        return <AttendanceClassView classId={s.classId} date={s.date} navigate={nav.navigate} goBack={nav.goBack} />
      case "attendance-student":
        return <AttendanceStudentView classId={s.classId} studentId={s.studentId} goBack={nav.goBack} />
      case "leave":
        return <LeaveView goBack={nav.goBack} />
      case "announcements":
        return <AnnouncementsView navigate={nav.navigate} goBack={nav.goBack} />
      case "new-announcement":
        return <NewAnnouncementView goBack={nav.goBack} />
      case "teachers":
        return <TeachersView navigate={nav.navigate} />
      case "teacher":
        return <TeacherDetailView teacherId={s.teacherId} goBack={nav.goBack} />
      case "students":
        return <StudentsView navigate={nav.navigate} />
      case "student":
        return <StudentRecordView studentId={s.studentId} goBack={nav.goBack} />
      case "classes":
        return <ClassesView navigate={nav.navigate} />
      case "class":
        return <ClassDetailView classId={s.classId} tab={s.tab} navigate={nav.navigate} goBack={nav.goBack} />
      case "class-homework":
        return <HomeworkDetailView classId={s.classId} homeworkId={s.homeworkId} goBack={nav.goBack} />
      case "class-test":
        return <ClassTestView classId={s.classId} testKey={s.testKey} goBack={nav.goBack} />
      case "exam":
        return <ExamView classId={s.classId} examId={s.examId} navigate={nav.navigate} goBack={nav.goBack} />
      case "exam-subject":
        return <ExamSubjectView classId={s.classId} examId={s.examId} subjectId={s.subjectId} goBack={nav.goBack} />
      case "settings":
        return <SettingsView goBack={nav.goBack} />
      default:
        return <DashboardView navigate={nav.navigate} />
    }
  }

  // NOT `font-sans`. Tailwind's `font-sans` is its own default stack
  // (ui-sans-serif, system-ui, …) and this project does not remap it, so
  // putting it on the app root cancelled the body typeface the theme sets —
  // every screen rendered in the system sans instead of Work Sans, and because
  // nothing on the page ever asked for Work Sans the webfont was never even
  // fetched (`document.fonts.check('12px "Work Sans"')` returned false while
  // Fraunces and DM Mono both returned true). Inheriting from
  // `.gurukul-principal`, which sets `font-family: var(--font-body)`, is what
  // makes the design render in the face it was drawn in.
  return (
    <div className="flex h-full bg-background">
      <Sidebar section={section} onNav={handleSidebarNav} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header history={nav.history} jumpTo={nav.jumpTo} onSettings={handleSettings} />
        <main className="flex-1 overflow-hidden">
          {renderContent()}
        </main>
      </div>
    </div>
  )
}
