import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { toEnumLabel, toErrorMessage } from "@/lib/presentation";
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/hooks/useNotifications'
import {
  type PrincipalPageKey,
  PRINCIPAL_PAGE_PATH,
  PRINCIPAL_NAV_LABEL,
  principalPathToPage,
} from './nav'
import {
  PrincipalSchoolOverview,
  PrincipalClassRollups,
  PrincipalStudentRankings,
  PrincipalAttendanceLive,
  PrincipalTeachersLive,
  PrincipalHomeworkLive,
} from './PrincipalLiveAcademic'
import PrincipalMessages from './Messages'
import LeaveRequests from '../gurukul-admin/LeaveRequests'
import { InquiriesReport, ComplaintsReport } from '@/pages/shared/OperationalCases'
import {
  AnnouncementService,
  MessageService,
  useAcademicLive,
  type TeacherAnnouncementRow,
  type AnnouncementStatus,
} from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import PrincipalClasses from '@/pages/principal/PrincipalClasses'
import PrincipalClassDetail from '@/pages/principal/PrincipalClassDetail'
import {
  Search, Bell, Users, GraduationCap, UserCheck, CalendarDays,
  LayoutDashboard, BarChart2, Settings, LogOut, CheckCircle, Clock,
  MessageSquare, Megaphone, School, Layers, Lock, Loader2, AlertCircle,
} from 'lucide-react'

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
      background: color + '18', color, borderRadius: 5, padding: '2px 7px',
    }}>{children}</span>
  )
}

function SectionTitle({ children, sub, action }: { children: React.ReactNode; sub?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
      <div>
        <h2 className="font-display" style={{ fontSize: 20, fontWeight: 400, color: 'var(--text-primary)', margin: 0 }}>{children}</h2>
        {sub && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>{sub}</p>}
      </div>
      {action}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: '24px',
      boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)', ...style,
    }}>{children}</div>
  )
}

function StatTile({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon: React.ElementType }) {
  return (
    <div style={{ padding: '16px', background: color + '09', borderRadius: 10, border: `1px solid ${color}20`, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: color + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} color={color} />
      </div>
      <div>
        <div className="font-mono-data" style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  )
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

function greetingForNow(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const navItems: { icon: React.ElementType; key: PrincipalPageKey }[] = [
  { icon: LayoutDashboard, key: 'dashboard' },
  { icon: BarChart2, key: 'analytics' },
  { icon: Users, key: 'teachers' },
  { icon: GraduationCap, key: 'students' },
  { icon: Layers, key: 'classes' },
  { icon: CalendarDays, key: 'examinations' },
  { icon: UserCheck, key: 'attendance' },
  { icon: Clock, key: 'leaves' },
  { icon: AlertCircle, key: 'cases' },
  { icon: Megaphone, key: 'announcements' },
  { icon: MessageSquare, key: 'messages' },
  { icon: Settings, key: 'settings' },
]

// ── PAGE: Dashboard ───────────────────────────────────────────────────────────

function DashboardPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle sub="AnalyticsService · AttendanceService · EIE health brief">School Overview</SectionTitle>
      <Card><PrincipalSchoolOverview /></Card>
      <SectionTitle sub="Per-class averages from AnalyticsService.classRollups">Class Performance</SectionTitle>
      <Card><PrincipalClassRollups /></Card>
    </div>
  )
}

function AnalyticsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle sub="Academic Engine analytics — no mock charts">Academic Analytics</SectionTitle>
      <Card><PrincipalSchoolOverview /></Card>
      <SectionTitle>Class Rollups</SectionTitle>
      <Card><PrincipalClassRollups /></Card>
      <SectionTitle>Student Rankings</SectionTitle>
      <Card><PrincipalStudentRankings /></Card>
      <SectionTitle sub="AnalyticsService.homeworkSchool">Homework</SectionTitle>
      <Card><PrincipalHomeworkLive /></Card>
    </div>
  )
}

function TeachersPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle sub="AnalyticsService.forTeacher · live directory — empty when no assignments">Teachers</SectionTitle>
      <Card><PrincipalTeachersLive /></Card>
    </div>
  )
}

function StudentsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle sub="Rankings from AcademicProfileService.listForSchool">Students</SectionTitle>
      <Card><PrincipalStudentRankings /></Card>
    </div>
  )
}

function ExaminationsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle sub="Exam / test averages from AnalyticsService (no mock exam schedule stats)">Examinations & Tests</SectionTitle>
      <Card><PrincipalSchoolOverview /></Card>
      <SectionTitle>Class exam & test rollups</SectionTitle>
      <Card><PrincipalClassRollups /></Card>
    </div>
  )
}

function AttendancePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle sub="AttendanceService.summarizeSchoolDate">Attendance</SectionTitle>
      <Card><PrincipalAttendanceLive /></Card>
    </div>
  )
}

function AnnouncementsPage() {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(['profile'])
  const [rows, setRows] = useState<TeacherAnnouncementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | AnnouncementStatus>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = async () => {
    if (!settled) return
    if (!ctx) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const list = await AnnouncementService.listForSchool(ctx)
      setRows(list)
      setError(null)
    } catch (e) {
      setRows([])
      setError(toErrorMessage(e, 'Failed to load announcements'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, ready, ctx, liveVersion])

  const filtered = rows.filter((a) => tab === 'all' || a.status === tab)

  async function publish(row: TeacherAnnouncementRow) {
    if (!ctx) return
    setBusyId(row.id)
    try {
      await AnnouncementService.update(ctx, row.id, {
        title: row.title,
        body: row.body,
        classId: row.classId,
        priority: row.priority,
        status: 'published',
      })
      await reload()
    } catch (e) {
      setError(toErrorMessage(e, 'Publish failed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle sub="AnnouncementService.listForSchool — live notices only">Announcements</SectionTitle>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { label: 'Total', value: String(rows.length), color: '#3b5bdb', icon: Megaphone },
          { label: 'Published', value: String(rows.filter((a) => a.status === 'published').length), color: '#10b981', icon: CheckCircle },
          { label: 'Draft', value: String(rows.filter((a) => a.status === 'draft').length), color: '#f59e0b', icon: Clock },
          { label: 'Scheduled', value: String(rows.filter((a) => a.status === 'scheduled').length), color: '#6882e8', icon: CalendarDays },
        ].map((m) => (
          <StatTile key={m.label} label={m.label} value={m.value} color={m.color} icon={m.icon} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 4, alignSelf: 'flex-start' }}>
        {(['all', 'published', 'draft', 'scheduled'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
              textTransform: 'capitalize',
              background: tab === t ? 'var(--indigo)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--text-muted)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>
          <Loader2 className="animate-spin" size={16} /> Loading announcements…
        </div>
      )}
      {error && <div style={{ textAlign: 'center', color: 'var(--rose)', fontSize: 12, padding: 16 }}>{error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <Card>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>
            No announcements yet. Teachers and admins publish class notices via AnnouncementService.
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map((ann) => {
          const statusColor = ann.status === 'published' ? '#10b981' : ann.status === 'draft' ? '#f59e0b' : '#6882e8'
          const classLabel = [ann.targetClass, ann.targetSection].filter(Boolean).join(' ') || '—'
          return (
            <Card key={ann.id} style={{ padding: '18px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: statusColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Megaphone size={18} color={statusColor} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{ann.title}</span>
                    <Chip color={statusColor}>{toEnumLabel(ann.status, "announcement_status")}</Chip>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Class: {classLabel} &nbsp;·&nbsp; {ann.publishedAt ?? ann.scheduledFor ?? '—'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.45 }}>{ann.body}</div>
                </div>
                {ann.status !== 'published' && (
                  <button
                    type="button"
                    disabled={busyId === ann.id}
                    onClick={() => void publish(ann)}
                    style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: 'var(--indigo)', border: 'none', borderRadius: 7, padding: '8px 12px', cursor: 'pointer', opacity: busyId === ann.id ? 0.5 : 1 }}
                  >
                    Publish
                  </button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function MessagesPage() {
  return <PrincipalMessages />
}

function LeavesPage() {
  return <LeaveRequests />
}

function CasesPage() {
  const [tab, setTab] = useState<'inquiries' | 'complaints'>('inquiries')
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['inquiries', 'complaints'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '7px 16px', borderRadius: 999, border: '1px solid var(--border)',
              background: tab === t ? 'rgba(59,91,219,0.15)' : 'transparent',
              color: tab === t ? 'var(--indigo)' : 'var(--text-muted)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'inquiries' ? <InquiriesReport /> : <ComplaintsReport />}
    </div>
  )
}

function SettingsPage() {
  const { profile, school, user, updatePassword } = useAuth()
  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwd, setPwd] = useState({ next: '', confirm: '' })
  const [pwdBusy, setPwdBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const name = profile?.fullName?.trim() || 'Principal'
  const email = profile?.email || user?.email || '—'
  const schoolName = school?.name || '—'
  const initials = initialsFromName(name)

  async function savePassword() {
    if (!pwd.next || pwd.next !== pwd.confirm) return
    setPwdBusy(true)
    const { error } = await updatePassword(pwd.next)
    setPwdBusy(false)
    if (error) {
      setErr(error)
      setMsg(null)
      return
    }
    setPwdOpen(false)
    setPwd({ next: '', confirm: '' })
    setErr(null)
    setMsg('Password updated')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
      <SectionTitle sub="Signed-in principal account">Settings</SectionTitle>
      {msg && <div style={{ fontSize: 12, color: '#10b981' }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: '#f43f5e' }}>{err}</div>}

      <Card>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20 }}>Profile Information</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: '#fff' }}>{initials}</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Principal · {schoolName}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {[
            { label: 'Full Name', value: name },
            { label: 'Email', value: email },
            { label: 'School', value: schoolName },
            { label: 'Role', value: 'Principal' },
          ].map((f) => (
            <div key={f.label}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{f.label}</div>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--text-primary)' }}>{f.value}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20 }}>Security</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Two-Factor Authentication</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Not connected — MFA is not wired yet</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px' }}>
            Not connected
          </span>
        </div>
        <div style={{ padding: '14px 0' }}>
          {!pwdOpen ? (
            <button
              type="button"
              onClick={() => setPwdOpen(true)}
              style={{ fontSize: 13, fontWeight: 600, color: '#f43f5e', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 9, padding: '9px 18px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Lock size={14} /> Change Password
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
              <input type="password" placeholder="New password" value={pwd.next} onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13 }} />
              <input type="password" placeholder="Confirm password" value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setPwdOpen(false)} style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Cancel</button>
                <button type="button" disabled={pwdBusy || !pwd.next || pwd.next !== pwd.confirm} onClick={() => void savePassword()} style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: 'none', background: 'var(--indigo)', color: '#fff', cursor: 'pointer', opacity: pwdBusy || !pwd.next || pwd.next !== pwd.confirm ? 0.5 : 1 }}>
                  {pwdBusy ? 'Saving…' : 'Update password'}
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

// ── ROOT ──────────────────────────────────────────────────────────────────────

export default function PrincipalApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut, profile, school } = useAuth()
  const { items: notifItems, unread: unreadNotif, loading: notifLoading, markRead, markAllRead } = useNotifications()
  const { ctx, ready, settled } = useAcademicContext();
  const messageLive = useAcademicLive('message')
  const page = useMemo(() => principalPathToPage(location.pathname), [location.pathname])
  const setPage = (p: PrincipalPageKey) => navigate(PRINCIPAL_PAGE_PATH[p])
  const [notifOpen, setNotifOpen] = useState(false)
  const [unreadMsg, setUnreadMsg] = useState(0)
  const [headerSearch, setHeaderSearch] = useState('')
  const [searchHint, setSearchHint] = useState<string | null>(null)

  useEffect(() => {
    if (!notifOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest('#principal-notif-trigger') || t.closest('#principal-notif-panel')) return
      setNotifOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNotifOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [notifOpen])

  useEffect(() => {
    if (!ready || !ctx) {
      setUnreadMsg(0)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const n = await MessageService.countUnread(ctx)
        if (!cancelled) setUnreadMsg(n)
      } catch {
        if (!cancelled) setUnreadMsg(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, ctx, messageLive, page])

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const displayName = profile?.fullName?.trim() || 'Principal'
  const firstName = displayName.split(/\s+/)[0] || 'Principal'
  const initials = initialsFromName(displayName)
  const schoolName = school?.name?.trim() || ''

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth')
  }

  return (
    <div className="gurukul-principal" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <style>{`
        .gurukul-principal aside.principal-sidebar {
          background: #10242c !important;
          color: rgba(255,255,255,0.5) !important;
          border-color: rgba(255,255,255,0.06) !important;
        }
        .gurukul-principal aside.principal-sidebar *:not(svg):not(path) {
          color: inherit !important;
        }
        .gurukul-principal aside.principal-sidebar button {
          color: rgba(255,255,255,0.5) !important;
          font-weight: 400 !important;
          background: transparent !important;
          box-shadow: none !important;
        }
        .gurukul-principal aside.principal-sidebar button:hover {
          transform: none !important;
          box-shadow: none !important;
        }
        .gurukul-principal aside.principal-sidebar button[data-active="true"] {
          color: #fff !important;
          font-weight: 600 !important;
          background: rgba(59,91,219,0.25) !important;
        }
        .gurukul-principal aside.principal-sidebar [data-sidebar-title] {
          color: #fff !important;
        }
        .gurukul-principal aside.principal-sidebar [data-sidebar-subtitle] {
          color: rgba(255,255,255,0.4) !important;
        }
        .gurukul-principal aside.principal-sidebar [data-sidebar-section-label] {
          color: rgba(255,255,255,0.3) !important;
        }
        .gurukul-principal aside.principal-sidebar [data-sidebar-user-name] {
          color: #fff !important;
          font-weight: 600 !important;
        }
        .gurukul-principal aside.principal-sidebar [data-sidebar-user-role] {
          color: rgba(255,255,255,0.4) !important;
        }
      `}</style>
      <aside className="principal-sidebar" style={{ width: 228, flexShrink: 0, background: '#10242c', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        <div style={{ padding: '28px 24px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <School size={18} color="#fff" />
            </div>
            <div>
              <div data-sidebar-title className="font-display" style={{ fontSize: 17, lineHeight: 1 }}>Gurukul</div>
              <div data-sidebar-subtitle style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 1 }}>Principal Portal</div>
            </div>
          </div>
        </div>

        <nav style={{ padding: '16px 12px', flex: 1 }}>
          <div data-sidebar-section-label style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 12px', marginBottom: 8 }}>Menu</div>
          {navItems.map(({ icon: Icon, key }) => {
            const label = PRINCIPAL_NAV_LABEL[key]
            const active = page === key
            return (
              <button
                key={key}
                type="button"
                data-active={active ? "true" : "false"}
                onClick={() => setPage(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px',
                  borderRadius: 8, border: 'none', cursor: 'pointer', marginBottom: 2,
                  background: active ? 'rgba(59,91,219,0.25)' : 'transparent',
                  fontSize: 13, textAlign: 'left',
                  transition: 'all 0.15s',
                  borderLeft: active ? '2px solid var(--indigo)' : '2px solid transparent',
                }}
              >
                <Icon size={15} />
                <span style={{ flex: 1 }}>{label}</span>
                {key === 'messages' && unreadMsg > 0 && (
                  <span style={{ minWidth: 16, height: 16, borderRadius: 999, background: '#f43f5e', color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                    {unreadMsg > 9 ? '9+' : unreadMsg}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff' }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div data-sidebar-user-name style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
              <div data-sidebar-user-role style={{ fontSize: 10 }}>Principal</div>
            </div>
            <button type="button" onClick={handleSignOut} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}>
              <LogOut size={13} color="rgba(255,255,255,0.3)" />
            </button>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(244,245,247,0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="font-display" style={{ fontSize: 20, fontWeight: 400, color: 'var(--text-primary)', lineHeight: 1 }}>
              {greetingForNow()}, {firstName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {today}{schoolName ? ` · ${schoolName}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px', width: 280, position: 'relative' }}>
            <Search size={14} color="var(--text-muted)" />
            <input
              value={headerSearch}
              onChange={(e) => {
                setHeaderSearch(e.target.value)
                setSearchHint(null)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                setSearchHint('Not connected — global student/teacher search is not wired yet')
              }}
              placeholder="Search students, teachers..."
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text-primary)', width: '100%' }}
              aria-label="School search (not connected)"
            />
            {searchHint && (
              <div className="z-overlay" style={{ position: 'absolute', left: 0, right: 0, top: 44, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)', boxShadow: 'var(--shadow-sm)' }}>
                {searchHint}
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              id="principal-notif-trigger"
              onClick={() => {
                setNotifOpen((o) => {
                  const next = !o
                  if (next && unreadNotif > 0) void markAllRead()
                  return next
                })
              }}
              style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}
            >
              <Bell size={16} color="var(--text-secondary)" />
              {unreadNotif > 0 && (
                <span style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: '50%', background: '#f43f5e', border: '1.5px solid var(--bg)' }} />
              )}
            </button>
            {notifOpen && typeof document !== 'undefined' && createPortal(
              <div
                id="principal-notif-panel"
                className="z-overlay"
                style={{ position: 'fixed', right: 32, top: 62, width: 300, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', padding: 16 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Notifications</span>
                  {unreadNotif > 0 && (
                    <button type="button" onClick={() => void markAllRead()} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--indigo)', fontWeight: 600 }}>
                      Mark all read
                    </button>
                  )}
                </div>
                {notifLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
                {!notifLoading && notifItems.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No notifications</div>
                )}
                {notifItems.slice(0, 8).map((n, i, arr) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      if (!n.read) void markRead(n.id)
                      if (n.link) {
                        setNotifOpen(false)
                        navigate(n.link)
                      }
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                      padding: '8px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      opacity: n.read ? 0.75 : 1,
                    }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: n.read ? 400 : 600 }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {new Date(n.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </button>
                ))}
              </div>,
              document.body,
            )}
          </div>
        </header>

        <div style={{ padding: page === 'messages' ? '28px 32px 0' : '28px 32px' }}>
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="teachers" element={<TeachersPage />} />
            <Route path="students" element={<StudentsPage />} />
            <Route path="classes" element={<PrincipalClasses />} />
            <Route path="classes/:classId" element={<PrincipalClassDetail />} />
            <Route path="exams" element={<ExaminationsPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="leaves" element={<LeavesPage />} />
            <Route path="cases" element={<CasesPage />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="present" element={<Navigate to="/principal/attendance" replace />} />
            <Route path="reports" element={<Navigate to="/principal/analytics" replace />} />
            <Route path="performance" element={<Navigate to="/principal/analytics" replace />} />
            <Route path="engagement" element={<Navigate to="/principal" replace />} />
            <Route path="fees" element={<Navigate to="/principal" replace />} />
            <Route path="timetable" element={<Navigate to="/principal" replace />} />
            <Route path="activity" element={<Navigate to="/principal" replace />} />
            <Route path="profile" element={<Navigate to="/principal/settings" replace />} />
            <Route path="notices" element={<Navigate to="/principal/announcements" replace />} />
            <Route path="leaderboard" element={<Navigate to="/principal/analytics" replace />} />
            <Route path="*" element={<Navigate to="/principal" replace />} />
          </Routes>
        </div>

        {page !== 'messages' && <div style={{ height: 32 }} />}
      </main>
    </div>
  )
}
