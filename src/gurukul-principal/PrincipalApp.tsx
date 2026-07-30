import { useMemo, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import {
  type PrincipalPageKey,
  PRINCIPAL_PAGE_PATH,
  PRINCIPAL_NAV_LABEL,
  principalPathToPage,
} from './nav'
import { PrincipalSchoolOverview, PrincipalClassRollups, PrincipalStudentRankings, PrincipalAttendanceLive } from './PrincipalLiveAcademic'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, ComposedChart,
  PieChart, Pie, Legend,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import {
  Search, Bell, TrendingUp, TrendingDown, Users, GraduationCap,
  BookOpen, UserCheck, CalendarDays, ClipboardList, Award, AlertTriangle,
  Activity, Zap, LayoutDashboard, BarChart2, Settings, LogOut,
  CheckCircle, Clock, ArrowRight, Star, Target, Brain, FileText, MessageSquare,
  Megaphone, UserX, Layers, ChevronRight, MoreHorizontal, Sparkles,
  School, FlaskConical, Send, Paperclip, Phone, Video, Search as SearchIcon,
  Plus, Edit3, Trash2, Eye, Download, Filter, Mail, ChevronDown,
  ToggleLeft, ToggleRight, Globe, Lock, Shield, Bell as BellIcon, Palette,
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

function ProgressBar({ value, color = '#3b5bdb' }: { value: number; color?: string }) {
  return (
    <div style={{ height: 5, background: '#f0f1f3', borderRadius: 3, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 3 }} />
    </div>
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

// ── Data ──────────────────────────────────────────────────────────────────────
// Academic mocks (attendance trends, class/subject scores, rankings, exam schedules)
// have been removed — those pages now render live Academic Engine data instead.
// Remaining mocks below are non-academic (teacher directory, announcements, messages).

const teachers = [
  { name: 'Ms. Priya Singh', subject: 'Science', classes: ['8A', '8B', '9A'], avg: 88, attendance: '98%', tests: 12, homework: 34, status: 'active', avatar: 'PS' },
  { name: 'Mr. Ramesh Kumar', subject: 'Mathematics', classes: ['9A', '9B', '10A'], avg: 74, attendance: '95%', tests: 18, homework: 28, status: 'active', avatar: 'RK' },
  { name: 'Ms. Anita Sharma', subject: 'English', classes: ['7A', '7B', '8A'], avg: 85, attendance: '97%', tests: 10, homework: 42, status: 'active', avatar: 'AS' },
  { name: 'Mr. Suresh Nair', subject: 'History', classes: ['11A', '12A'], avg: 82, attendance: '91%', tests: 8, homework: 22, status: 'on-leave', avatar: 'SN' },
  { name: 'Ms. Kavitha Reddy', subject: 'Chemistry', classes: ['10A', '11A', '12A'], avg: 77, attendance: '96%', tests: 14, homework: 38, status: 'active', avatar: 'KR' },
  { name: 'Mr. Arun Pillai', subject: 'Physics', classes: ['10B', '11B'], avg: 69, attendance: '93%', tests: 11, homework: 19, status: 'leave-pending', avatar: 'AP' },
]

const announcements = [
  { title: 'Annual Sports Day — 15 August', audience: 'All', date: '27 Jul', status: 'published', author: 'Principal Office' },
  { title: 'Parent-Teacher Meeting — 5 Aug', audience: 'All Parents', date: '25 Jul', status: 'pending', author: 'Admin Office' },
  { title: 'School Closed — Independence Day', audience: 'All', date: '24 Jul', status: 'scheduled', author: 'Principal Office' },
  { title: 'Fee Payment Reminder — Last Date 31 Jul', audience: 'Parents', date: '22 Jul', status: 'published', author: 'Accounts' },
  { title: 'Science Fair Registration Open', audience: 'Students', date: '20 Jul', status: 'published', author: 'Science Dept' },
  { title: 'Library Timings Updated', audience: 'Students & Staff', date: '18 Jul', status: 'published', author: 'Library' },
]

const messages = [
  { name: 'Ms. Priya Singh', preview: 'The Science lab schedule for next week has been updated. Please review...', time: '9:42 AM', unread: 2, avatar: 'PS', online: true },
  { name: 'Admin Office', preview: 'Fee collection report for July 2025 is ready for your review.', time: '8:15 AM', unread: 1, avatar: 'AO', online: true },
  { name: 'Mr. Ramesh Kumar', preview: "Regarding the Mathematics syllabus coverage — we're slightly behind.", time: 'Yesterday', unread: 0, avatar: 'RK', online: false },
  { name: 'Examination Cell', preview: 'Mid-term schedule has been finalized. Timetable attached.', time: 'Yesterday', unread: 0, avatar: 'EC', online: false },
  { name: 'Ms. Kavitha Reddy', preview: 'Chemistry lab consumables are running low. Approval needed.', time: '25 Jul', unread: 0, avatar: 'KR', online: true },
  { name: 'Transport Committee', preview: 'Bus route 4 will be modified from next month due to road work.', time: '24 Jul', unread: 0, avatar: 'TC', online: false },
]

const convMessages = [
  { from: 'them', text: "The Science lab schedule for next week has been updated. I've shifted the Class 10A practical to Wednesday morning.", time: '9:38 AM' },
  { from: 'me', text: 'Thank you for the update. Does this affect the exam preparation schedule?', time: '9:40 AM' },
  { from: 'them', text: 'No impact on exam prep. We\'ve ensured all revision practicals are completed by Friday. Please review the updated timetable.', time: '9:41 AM' },
  { from: 'them', text: 'Also, the Science Fair registrations are coming in well — 34 teams so far across Classes 9–12.', time: '9:42 AM' },
]

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPICard({ icon: Icon, label, value, delta, deltaDir, color, sub }: {
  icon: React.ElementType; label: string; value: string; delta?: string; deltaDir?: 'up' | 'down'; color: string; sub?: string
}) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '20px 22px',
      boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)', display: 'flex',
      flexDirection: 'column', gap: 12, transition: 'box-shadow 0.2s', cursor: 'default',
    }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={color} />
        </div>
        {delta && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 600,
            color: deltaDir === 'up' ? '#10b981' : '#f43f5e',
            background: deltaDir === 'up' ? '#d1fae5' : '#ffe4e6', borderRadius: 6, padding: '2px 7px',
          }}>
            {deltaDir === 'up' ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {delta}
          </span>
        )}
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const navItems: { icon: React.ElementType; key: PrincipalPageKey }[] = [
  { icon: LayoutDashboard, key: 'dashboard' },
  { icon: BarChart2, key: 'analytics' },
  { icon: Users, key: 'teachers' },
  { icon: GraduationCap, key: 'students' },
  { icon: CalendarDays, key: 'examinations' },
  { icon: UserCheck, key: 'attendance' },
  { icon: Megaphone, key: 'announcements' },
  { icon: MessageSquare, key: 'messages' },
  { icon: Settings, key: 'settings' },
]

// ── PAGE: Dashboard ───────────────────────────────────────────────────────────

function DashboardPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle sub="AnalyticsService · AttendanceService · AiSummaryService">School Overview</SectionTitle>
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
    </div>
  )
}


function TeachersPage() {
  const [search, setSearch] = useState('')
  const filtered = teachers.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.subject.toLowerCase().includes(search.toLowerCase()))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionTitle sub="All teaching staff — academic performance overview">Teachers</SectionTitle>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 14px' }}>
            <Search size={13} color="var(--text-muted)" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search teachers..." style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, width: 160 }} />
          </div>
          <button style={{ fontSize: 12, color: '#fff', background: 'var(--indigo)', border: 'none', borderRadius: 9, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> Add Teacher
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        <KPICard icon={Users} label="Total Teachers" value="98" color="#3b5bdb" />
        <KPICard icon={CheckCircle} label="Active Today" value="93" delta="+0" deltaDir="up" color="#10b981" />
        <KPICard icon={Clock} label="Leave Pending" value="4" color="#f59e0b" />
        <KPICard icon={AlertTriangle} label="Need Support" value="4" color="#f43f5e" />
      </div>

      <Card style={{ padding: 0 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Teacher Directory</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Teacher', 'Subject', 'Classes', 'Avg Student Score', 'Attendance', 'Tests', 'Homework', 'Status'].map(h => (
                <th key={h} style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'left', padding: '10px 20px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const statusColor = t.status === 'active' ? '#10b981' : t.status === 'on-leave' ? '#f43f5e' : '#f59e0b'
                const statusLabel = t.status === 'active' ? 'Active' : t.status === 'on-leave' ? 'On Leave' : 'Leave Pending'
                return (
                  <tr key={t.name} style={{ background: i % 2 === 0 ? 'transparent' : '#fafafa', transition: 'background 0.15s', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#fafafa'}
                  >
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--indigo-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--indigo)', flexShrink: 0 }}>{t.avatar}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</div>
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-secondary)' }}>{t.subject}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {t.classes.map(c => <span key={c} style={{ fontSize: 10, background: 'var(--indigo-light)', color: 'var(--indigo)', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>{c}</span>)}
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px' }} className="font-mono-data">
                      <span style={{ color: t.avg >= 85 ? '#10b981' : t.avg >= 75 ? '#3b5bdb' : '#f43f5e', fontWeight: 700 }}>{t.avg}%</span>
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-secondary)' }} className="font-mono-data">{t.attendance}</td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-secondary)' }} className="font-mono-data">{t.tests}</td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-secondary)' }} className="font-mono-data">{t.homework}</td>
                    <td style={{ padding: '14px 20px' }}><Chip color={statusColor}>{statusLabel}</Chip></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── PAGE: Students ────────────────────────────────────────────────────────────

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
  const [tab, setTab] = useState<'all' | 'published' | 'pending' | 'scheduled'>('all')
  const filtered = announcements.filter(a => tab === 'all' || a.status === tab)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionTitle sub="Manage school announcements and communications">Announcements</SectionTitle>
        <button style={{ fontSize: 12, color: '#fff', background: 'var(--indigo)', border: 'none', borderRadius: 9, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={13} /> New Announcement
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[{ label: 'Total', value: String(announcements.length), color: '#3b5bdb', icon: Megaphone }, { label: 'Published', value: String(announcements.filter(a => a.status === 'published').length), color: '#10b981', icon: CheckCircle }, { label: 'Pending Review', value: String(announcements.filter(a => a.status === 'pending').length), color: '#f59e0b', icon: Clock }, { label: 'Scheduled', value: String(announcements.filter(a => a.status === 'scheduled').length), color: '#6882e8', icon: CalendarDays }].map(m => (
          <StatTile key={m.label} label={m.label} value={m.value} color={m.color} icon={m.icon} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 4, alignSelf: 'flex-start' }}>
        {(['all', 'published', 'pending', 'scheduled'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', textTransform: 'capitalize', background: tab === t ? 'var(--indigo)' : 'transparent', color: tab === t ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s' }}>{t}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map(ann => {
          const statusColor = ann.status === 'published' ? '#10b981' : ann.status === 'pending' ? '#f59e0b' : '#6882e8'
          return (
            <Card key={ann.title} style={{ padding: '18px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: statusColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Megaphone size={18} color={statusColor} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{ann.title}</span>
                    <Chip color={statusColor}>{ann.status}</Chip>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>By {ann.author} &nbsp;·&nbsp; For: {ann.audience} &nbsp;·&nbsp; {ann.date}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ width: 32, height: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Eye size={13} color="var(--text-muted)" /></button>
                  <button style={{ width: 32, height: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Edit3 size={13} color="var(--text-muted)" /></button>
                  {ann.status === 'pending' && (
                    <button style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: 'var(--indigo)', border: 'none', borderRadius: 7, padding: '0 12px', cursor: 'pointer' }}>Publish</button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ── PAGE: Messages ────────────────────────────────────────────────────────────

function MessagesPage() {
  const [selected, setSelected] = useState(messages[0])
  const [input, setInput] = useState('')
  return (
    <div style={{ display: 'flex', gap: 0, background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', height: 'calc(100vh - 180px)', minHeight: 500 }}>

      {/* Conversation list */}
      <div style={{ width: 280, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '18px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Messages</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px' }}>
            <Search size={12} color="var(--text-muted)" />
            <input placeholder="Search..." style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, width: '100%' }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {messages.map(m => (
            <div key={m.name} onClick={() => setSelected(m)} style={{
              padding: '14px 16px', cursor: 'pointer', transition: 'background 0.1s',
              background: selected.name === m.name ? 'var(--indigo-light)' : 'transparent',
              borderLeft: selected.name === m.name ? '3px solid var(--indigo)' : '3px solid transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>{m.avatar}</div>
                  {m.online && <div style={{ position: 'absolute', bottom: 1, right: 1, width: 8, height: 8, borderRadius: '50%', background: '#10b981', border: '1.5px solid var(--surface)' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: m.unread ? 700 : 500, color: 'var(--text-primary)' }}>{m.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.time}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{m.preview}</div>
                </div>
                {m.unread > 0 && <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{m.unread}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff' }}>{selected.avatar}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.name}</div>
            <div style={{ fontSize: 11, color: selected.online ? '#10b981' : 'var(--text-muted)' }}>{selected.online ? 'Online' : 'Offline'}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Phone size={13} color="var(--text-muted)" /></button>
            <button style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Video size={13} color="var(--text-muted)" /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {convMessages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.from === 'me' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '65%', padding: '10px 14px', borderRadius: msg.from === 'me' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                background: msg.from === 'me' ? 'var(--indigo)' : 'var(--bg)',
                color: msg.from === 'me' ? '#fff' : 'var(--text-primary)',
                fontSize: 13, lineHeight: 1.5,
              }}>
                {msg.text}
                <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6, textAlign: 'right' }}>{msg.time}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message..." style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13 }} onKeyDown={e => { if (e.key === 'Enter') setInput('') }} />
            <Paperclip size={15} color="var(--text-muted)" style={{ cursor: 'pointer' }} />
          </div>
          <button onClick={() => setInput('')} style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--indigo)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Send size={16} color="#fff" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PAGE: Settings ────────────────────────────────────────────────────────────

function SettingsPage() {
  const [notifs, setNotifs] = useState(true)
  const [twoFa, setTwoFa] = useState(false)
  const [emailDigest, setEmailDigest] = useState(true)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
      <SectionTitle sub="Principal account and system preferences">Settings</SectionTitle>

      {/* Profile */}
      <Card>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20 }}>Profile Information</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: '#fff' }}>DR</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Dr. Rajesh Sharma</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Principal, Gurukul School</div>
            <button style={{ fontSize: 11, color: 'var(--indigo)', background: 'var(--indigo-light)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600, marginTop: 8 }}>Change Photo</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {[{ label: 'Full Name', value: 'Dr. Rajesh Sharma' }, { label: 'Employee ID', value: 'GRK-PRI-001' }, { label: 'Email', value: 'principal@gurukul.edu.in' }, { label: 'Phone', value: '+91 98765 43210' }, { label: 'Academic Year', value: '2025–26' }, { label: 'Role', value: 'Principal' }].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{f.label}</div>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--text-primary)' }}>{f.value}</div>
            </div>
          ))}
        </div>
        <button style={{ marginTop: 16, fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--indigo)', border: 'none', borderRadius: 9, padding: '10px 20px', cursor: 'pointer' }}>Save Changes</button>
      </Card>

      {/* Notifications */}
      <Card>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20 }}>Notifications</div>
        {[
          { label: 'Push Notifications', sub: 'Receive alerts for leave requests, attendance, and approvals', state: notifs, set: setNotifs },
          { label: 'Daily Email Digest', sub: 'Get a morning summary of school activity via email', state: emailDigest, set: setEmailDigest },
        ].map(n => (
          <div key={n.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{n.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{n.sub}</div>
            </div>
            <button onClick={() => n.set(!n.state)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              {n.state ? <ToggleRight size={28} color="var(--indigo)" /> : <ToggleLeft size={28} color="var(--text-muted)" />}
            </button>
          </div>
        ))}
      </Card>

      {/* Security */}
      <Card>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20 }}>Security</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Two-Factor Authentication</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Add an extra layer of security to your account</div>
          </div>
          <button onClick={() => setTwoFa(!twoFa)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            {twoFa ? <ToggleRight size={28} color="var(--indigo)" /> : <ToggleLeft size={28} color="var(--text-muted)" />}
          </button>
        </div>
        <div style={{ padding: '14px 0' }}>
          <button style={{ fontSize: 13, fontWeight: 600, color: '#f43f5e', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 9, padding: '9px 18px', cursor: 'pointer' }}>
            Change Password
          </button>
        </div>
      </Card>
    </div>
  )
}

// ── ROOT ──────────────────────────────────────────────────────────────────────

export default function PrincipalApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuth()
  const page = useMemo(() => principalPathToPage(location.pathname), [location.pathname])
  const setPage = (p: PrincipalPageKey) => navigate(PRINCIPAL_PAGE_PATH[p])
  const [notifOpen, setNotifOpen] = useState(false)

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth')
  }

  return (
    <div className="gurukul-principal" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Sidebar */}
      <aside style={{ width: 228, flexShrink: 0, background: 'var(--navy)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        <div style={{ padding: '28px 24px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <School size={18} color="#fff" />
            </div>
            <div>
              <div className="font-display" style={{ fontSize: 17, color: '#fff', lineHeight: 1 }}>Gurukul</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 1 }}>Principal Portal</div>
            </div>
          </div>
        </div>

        <nav style={{ padding: '16px 12px', flex: 1 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 12px', marginBottom: 8 }}>Menu</div>
          {navItems.map(({ icon: Icon, key }) => {
            const label = PRINCIPAL_NAV_LABEL[key]
            const active = page === key
            return (
            <button key={key} onClick={() => setPage(key)} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px',
              borderRadius: 8, border: 'none', cursor: 'pointer', marginBottom: 2,
              background: active ? 'rgba(59,91,219,0.25)' : 'transparent',
              color: active ? '#fff' : 'rgba(255,255,255,0.5)',
              fontSize: 13, fontWeight: active ? 600 : 400, textAlign: 'left',
              transition: 'all 0.15s',
              borderLeft: active ? '2px solid var(--indigo)' : '2px solid transparent',
            }}
              onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.75)' } }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.5)' } }}
            >
              <Icon size={15} />
              {label}
            </button>
            )
          })}
        </nav>

        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff' }}>DR</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Dr. Rajesh Sharma</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Principal</div>
            </div>
            <button type="button" onClick={handleSignOut} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}>
              <LogOut size={13} color="rgba(255,255,255,0.3)" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(244,245,247,0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="font-display" style={{ fontSize: 20, fontWeight: 400, color: 'var(--text-primary)', lineHeight: 1 }}>Good morning, Dr. Sharma</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{today} &nbsp;·&nbsp; Academic Year 2025–26</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px', width: 240 }}>
            <Search size={14} color="var(--text-muted)" />
            <input placeholder="Search students, teachers..." style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text-primary)', width: '100%' }} />
          </div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setNotifOpen(o => !o)} style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Bell size={16} color="var(--text-secondary)" />
              <span style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: '50%', background: '#f43f5e', border: '1.5px solid var(--bg)' }} />
            </button>
            {notifOpen && (
              <div style={{ position: 'absolute', right: 0, top: 48, width: 300, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', padding: 16, zIndex: 100 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Notifications</div>
                {[{ text: '4 leave requests pending your approval', time: 'Just now' }, { text: 'Mid-term examination schedule published', time: '1h ago' }, { text: 'Class 10B attendance below threshold', time: '2h ago' }].map((n, i) => (
                  <div key={i} style={{ padding: '8px 0', borderBottom: i < 2 ? '1px solid var(--border-subtle)' : 'none' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.text}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{n.time}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <div style={{ padding: page === 'messages' ? '28px 32px 0' : '28px 32px' }}>
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="teachers" element={<TeachersPage />} />
            <Route path="students" element={<StudentsPage />} />
            <Route path="exams" element={<ExaminationsPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="classes/*" element={<Navigate to="/principal/students" replace />} />
            <Route path="present" element={<Navigate to="/principal/attendance" replace />} />
            <Route path="reports" element={<Navigate to="/principal/analytics" replace />} />
            <Route path="performance" element={<Navigate to="/principal/analytics" replace />} />
            <Route path="engagement" element={<Navigate to="/principal" replace />} />
            <Route path="fees" element={<Navigate to="/principal" replace />} />
            <Route path="timetable" element={<Navigate to="/principal" replace />} />
            <Route path="activity" element={<Navigate to="/principal" replace />} />
            <Route path="profile" element={<Navigate to="/principal/settings" replace />} />
            <Route path="leaves" element={<Navigate to="/principal" replace />} />
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
