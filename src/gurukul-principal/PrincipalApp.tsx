import { useMemo, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import {
  type PrincipalPageKey,
  PRINCIPAL_PAGE_PATH,
  PRINCIPAL_NAV_LABEL,
  principalPathToPage,
} from './nav'
import {
  AreaChart, Area, BarChart, Bar,
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

const attendanceTrend = [
  { day: 'Mon', students: 94, teachers: 96 },
  { day: 'Tue', students: 91, teachers: 98 },
  { day: 'Wed', students: 96, teachers: 95 },
  { day: 'Thu', students: 88, teachers: 97 },
  { day: 'Fri', students: 92, teachers: 94 },
  { day: 'Sat', students: 85, teachers: 92 },
]

const classPerformance = [
  { class: '6A', score: 82 }, { class: '7B', score: 76 }, { class: '8A', score: 91 },
  { class: '9A', score: 88 }, { class: '10B', score: 71 }, { class: '11A', score: 85 }, { class: '12A', score: 79 },
]

const subjectData = [
  { subject: 'Mathematics', score: 68, fill: '#f43f5e' },
  { subject: 'Science', score: 79, fill: '#0ea5a0' },
  { subject: 'English', score: 85, fill: '#3b5bdb' },
  { subject: 'History', score: 82, fill: '#f59e0b' },
  { subject: 'Commerce', score: 74, fill: '#6882e8' },
]

const completionData = [
  { name: 'Homework', value: 78, fill: '#3b5bdb' },
  { name: 'Assignments', value: 65, fill: '#0ea5a0' },
  { name: 'Practice', value: 54, fill: '#f59e0b' },
]

const recentActivities = [
  { id: 1, actor: 'Mr. Ramesh Kumar', action: 'published a Mathematics test for Class 9A', time: '8 min ago', icon: ClipboardList, color: '#3b5bdb' },
  { id: 2, actor: 'Ms. Priya Singh', action: 'uploaded exam marks for Class 8B Science', time: '23 min ago', icon: FileText, color: '#10b981' },
  { id: 3, actor: 'Ms. Anita Sharma', action: 'submitted attendance for Class 7A', time: '41 min ago', icon: UserCheck, color: '#0ea5a0' },
  { id: 4, actor: 'Admin Office', action: 'published Annual Sports Day announcement', time: '1 hr ago', icon: Megaphone, color: '#f59e0b' },
  { id: 5, actor: 'Examination Cell', action: 'created Mid-Term Examination schedule', time: '2 hr ago', icon: CalendarDays, color: '#6882e8' },
  { id: 6, actor: 'Mr. Suresh Nair', action: 'leave request approved for 2 days', time: '3 hr ago', icon: CheckCircle, color: '#10b981' },
  { id: 7, actor: 'Ms. Kavitha Reddy', action: 'assigned homework for Class 10A Chemistry', time: '4 hr ago', icon: BookOpen, color: '#f43f5e' },
]

const pendingApprovals = [
  { id: 1, type: 'Leave', name: 'Mr. Vikram Mehta', detail: 'Sick Leave · 3 days · From 28 Jul', urgency: 'today', avatar: 'VM' },
  { id: 2, type: 'Leave', name: 'Ms. Deepika Joshi', detail: 'Personal Leave · 1 day · From 29 Jul', urgency: 'tomorrow', avatar: 'DJ' },
  { id: 3, type: 'Announcement', name: 'Parent-Teacher Meet Notice', detail: 'Scheduled · 5 Aug · For all classes', urgency: 'review', avatar: 'PT' },
  { id: 4, type: 'Leave', name: 'Mr. Arun Pillai', detail: 'Medical Leave · 5 days · From 30 Jul', urgency: 'urgent', avatar: 'AP' },
]

const insights = [
  { text: 'Overall school performance has improved by 4.2% compared to last month across all classes.', type: 'positive', icon: TrendingUp },
  { text: 'Mathematics requires immediate attention — average score dropped to 68% across 7 classes.', type: 'negative', icon: AlertTriangle },
  { text: 'Class 8A is performing 13 points above the school average, driven by Science and English.', type: 'positive', icon: Star },
  { text: 'Homework completion rate at 78% is strong, but practice activity remains low at 54%.', type: 'neutral', icon: BookOpen },
  { text: 'Science assignment submission is 22% below target — curriculum review recommended.', type: 'negative', icon: FlaskConical },
  { text: 'Low attendance in Classes 10B and 7C is correlated with declining test scores this week.', type: 'negative', icon: UserX },
]

const studentInsights = [
  { label: 'Requiring Academic Attention', count: 34, color: '#f43f5e', icon: AlertTriangle },
  { label: 'High Performing Students', count: 127, color: '#10b981', icon: Star },
  { label: 'Low Attendance (< 75%)', count: 18, color: '#f59e0b', icon: UserX },
  { label: 'Pending Homework', count: 203, color: '#6882e8', icon: BookOpen },
  { label: 'Low Practice Activity', count: 89, color: '#0ea5a0', icon: Activity },
]

const classInsights = [
  { class: '8A', type: 'Best', avg: 91, attendance: 96, homework: 88 },
  { class: '9A', type: 'Best', avg: 88, attendance: 94, homework: 85 },
  { class: '10B', type: 'Attention', avg: 71, attendance: 79, homework: 62 },
  { class: '7C', type: 'Attention', avg: 74, attendance: 77, homework: 68 },
]

const teachers = [
  { name: 'Ms. Priya Singh', subject: 'Science', classes: ['8A', '8B', '9A'], avg: 88, attendance: '98%', tests: 12, homework: 34, status: 'active', avatar: 'PS' },
  { name: 'Mr. Ramesh Kumar', subject: 'Mathematics', classes: ['9A', '9B', '10A'], avg: 74, attendance: '95%', tests: 18, homework: 28, status: 'active', avatar: 'RK' },
  { name: 'Ms. Anita Sharma', subject: 'English', classes: ['7A', '7B', '8A'], avg: 85, attendance: '97%', tests: 10, homework: 42, status: 'active', avatar: 'AS' },
  { name: 'Mr. Suresh Nair', subject: 'History', classes: ['11A', '12A'], avg: 82, attendance: '91%', tests: 8, homework: 22, status: 'on-leave', avatar: 'SN' },
  { name: 'Ms. Kavitha Reddy', subject: 'Chemistry', classes: ['10A', '11A', '12A'], avg: 77, attendance: '96%', tests: 14, homework: 38, status: 'active', avatar: 'KR' },
  { name: 'Mr. Arun Pillai', subject: 'Physics', classes: ['10B', '11B'], avg: 69, attendance: '93%', tests: 11, homework: 19, status: 'leave-pending', avatar: 'AP' },
]

const students = [
  { name: 'Arjun Mehta', class: '9A', roll: '9A-01', attendance: 96, avg: 92, status: 'excellent', avatar: 'AM' },
  { name: 'Sneha Kapoor', class: '8A', roll: '8A-05', attendance: 94, avg: 88, status: 'good', avatar: 'SK' },
  { name: 'Rohan Gupta', class: '10B', roll: '10B-12', attendance: 72, avg: 64, status: 'attention', avatar: 'RG' },
  { name: 'Priya Nair', class: '7C', roll: '7C-08', attendance: 68, avg: 71, status: 'attention', avatar: 'PN' },
  { name: 'Karthik Reddy', class: '11A', roll: '11A-03', attendance: 98, avg: 90, status: 'excellent', avatar: 'KR' },
  { name: 'Anjali Singh', class: '6A', roll: '6A-15', attendance: 88, avg: 79, status: 'good', avatar: 'AS' },
  { name: 'Dev Sharma', class: '12A', roll: '12A-07', attendance: 74, avg: 68, status: 'attention', avatar: 'DS' },
  { name: 'Meera Pillai', class: '8A', roll: '8A-11', attendance: 99, avg: 95, status: 'excellent', avatar: 'MP' },
]

const exams = [
  { name: 'Mid-Term Examination', classes: 'All Classes', date: '5 Aug 2025', status: 'upcoming', subjects: 6, duration: '2h 30m' },
  { name: 'Unit Test — Mathematics', classes: 'Class 9A, 9B', date: '28 Jul 2025', status: 'ongoing', subjects: 1, duration: '1h' },
  { name: 'Science Practical', classes: 'Class 11A, 12A', date: '30 Jul 2025', status: 'upcoming', subjects: 1, duration: '3h' },
  { name: 'First Term Examination', classes: 'All Classes', date: '15 Jun 2025', status: 'completed', subjects: 6, duration: '2h 30m' },
  { name: 'Unit Test — English', classes: 'Class 7A, 7B, 7C', date: '10 Jul 2025', status: 'completed', subjects: 1, duration: '1h' },
  { name: 'Pre-Board Examination', classes: 'Class 12', date: '20 Aug 2025', status: 'upcoming', subjects: 5, duration: '3h' },
]

const attendanceClasses = [
  { class: '6A', teacher: 'Ms. Anjali Roy', students: 42, present: 40, status: 'approved' },
  { class: '7B', teacher: 'Mr. Sanjay Verma', students: 38, present: 34, status: 'approved' },
  { class: '7C', teacher: 'Ms. Rekha Iyer', students: 40, present: 28, status: 'pending' },
  { class: '8A', teacher: 'Ms. Priya Singh', students: 44, present: 43, status: 'approved' },
  { class: '9A', teacher: 'Mr. Ramesh Kumar', students: 41, present: 39, status: 'approved' },
  { class: '10B', teacher: 'Mr. Arun Pillai', students: 39, present: 30, status: 'pending' },
  { class: '11A', teacher: 'Ms. Kavitha Reddy', students: 35, present: 34, status: 'approved' },
  { class: '12A', teacher: 'Mr. Suresh Nair', students: 32, present: 28, status: 'pending' },
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>

      {/* AI Summary */}
      <div style={{
        background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-mid) 100%)',
        borderRadius: 'var(--radius-lg)', padding: '28px 32px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 240, height: 240, borderRadius: '50%', background: 'rgba(59,91,219,0.15)' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(59,91,219,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={22} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="font-display" style={{ fontSize: 16, color: '#fff', fontWeight: 400 }}>AI Executive Summary</span>
              <span style={{ fontSize: 10, background: 'rgba(59,91,219,0.5)', color: '#a5b4fc', borderRadius: 5, padding: '2px 8px', fontWeight: 600, letterSpacing: '0.05em' }}>LIVE</span>
            </div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.82)', lineHeight: 1.7, margin: '0 0 14px' }}>
              The school is in <strong style={{ color: '#86efac' }}>stable academic health</strong> this week with an average performance of <strong style={{ color: '#86efac' }}>79.4%</strong>, up 4.2% from last month. Attendance stands at <strong style={{ color: '#fde68a' }}>92.3%</strong> for students and <strong style={{ color: '#86efac' }}>95.8%</strong> for teachers.
              Class 8A and 9A are performing exceptionally well. <strong style={{ color: '#fca5a5' }}>Mathematics requires urgent attention</strong> — average scores fell to 68% across seven classes.
              Science assignment submission is 22% below target. <strong style={{ color: '#fca5a5' }}> 34 students</strong> require academic support. Four teacher leave requests are pending your approval.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['Prioritize Math intervention', 'Review 10B attendance', 'Approve pending leaves', 'Monitor Science assignments'].map(a => (
                <span key={a} style={{ fontSize: 11, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)', borderRadius: 6, padding: '5px 11px', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <Zap size={10} /> {a}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <section>
        <SectionTitle sub="Live operational snapshot">School Overview</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
          <KPICard icon={GraduationCap} label="Total Students" value="1,842" delta="+12" deltaDir="up" color="#3b5bdb" />
          <KPICard icon={Users} label="Total Teachers" value="98" delta="+2" deltaDir="up" color="#0ea5a0" />
          <KPICard icon={Layers} label="Total Classes" value="36" color="#6882e8" />
          <KPICard icon={Users} label="Total Parents" value="3,614" color="#f59e0b" />
          <KPICard icon={UserCheck} label="Attendance Today" value="92.3%" delta="-1.4%" deltaDir="down" color="#10b981" sub="1,699 / 1,842 present" />
          <KPICard icon={ClipboardList} label="Active Tests" value="7" color="#f43f5e" sub="Across 5 classes" />
          <KPICard icon={CalendarDays} label="Scheduled Exams" value="3" color="#6882e8" sub="Next: 5 Aug" />
          <KPICard icon={Clock} label="Teacher Leave Pending" value="4" delta="Urgent" deltaDir="down" color="#f59e0b" sub="Awaiting approval" />
        </div>
      </section>

      {/* Academic Health + Attendance */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card>
          <SectionTitle sub="School-wide academic performance">Academic Health</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Overall Performance', value: '79.4%', color: '#3b5bdb' },
              { label: 'School Average', value: '79.4%', color: '#10b981' },
              { label: 'Best Class', value: 'Class 8A', color: '#10b981' },
              { label: 'Needs Attention', value: 'Class 10B', color: '#f43f5e' },
              { label: 'Best Subject', value: 'English', color: '#10b981' },
              { label: 'Weakest Subject', value: 'Mathematics', color: '#f43f5e' },
            ].map(m => (
              <div key={m.label} style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: m.color, marginTop: 4 }}>{m.value}</div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>Completion Rates</div>
            {completionData.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                <div style={{ width: 72, fontSize: 11, color: 'var(--text-secondary)' }}>{d.name}</div>
                <ProgressBar value={d.value} color={d.fill} />
                <div className="font-mono-data" style={{ width: 36, fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right' }}>{d.value}%</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle sub="This week's attendance trend">Attendance Overview</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            {[{ label: 'Students Today', value: '92.3%', color: '#3b5bdb' }, { label: 'Teachers Today', value: '95.8%', color: '#10b981' }, { label: 'Overall %', value: '91.6%', color: '#f59e0b' }].map(s => (
              <div key={s.label} style={{ textAlign: 'center', padding: '12px 8px', background: s.color + '0e', borderRadius: 10 }}>
                <div className="font-mono-data" style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={attendanceTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b5bdb" stopOpacity={0.15} /><stop offset="95%" stopColor="#3b5bdb" stopOpacity={0} /></linearGradient>
                <linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.15} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="#f0f1f3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis domain={[80, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8 }} />
              <Area type="monotone" dataKey="students" stroke="#3b5bdb" strokeWidth={2} fill="url(#gs)" name="Students" dot={false} />
              <Area type="monotone" dataKey="teachers" stroke="#10b981" strokeWidth={2} fill="url(#gt)" name="Teachers" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Chip color="#f43f5e">Pending: 3 classes</Chip>
            <Chip color="#f59e0b">Low: 7C, 10B</Chip>
          </div>
        </Card>
      </div>

      {/* Class + Subject charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20 }}>
        <Card>
          <SectionTitle sub="Average performance score by class">Class Performance</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={classPerformance} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#f0f1f3" vertical={false} />
              <XAxis dataKey="class" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis domain={[60, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8 }} cursor={{ fill: '#f4f5f7' }} />
              <Bar dataKey="score" radius={[5, 5, 0, 0]} name="Avg Score">
                {classPerformance.map((entry, i) => (
                  <Cell key={i} fill={entry.score >= 85 ? '#10b981' : entry.score >= 75 ? '#3b5bdb' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle sub="School-wide subject averages">Subject Insights</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {subjectData.map(s => (
              <div key={s.subject} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.fill, flexShrink: 0 }} />
                <div style={{ width: 90, fontSize: 12, color: 'var(--text-secondary)' }}>{s.subject}</div>
                <ProgressBar value={s.score} color={s.fill} />
                <div className="font-mono-data" style={{ width: 38, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{s.score}%</div>
                {s.score < 72 && <AlertTriangle size={12} color="#f59e0b" />}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, padding: '10px 14px', background: '#fff7ed', borderRadius: 10, border: '1px solid #fed7aa' }}>
            <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600, marginBottom: 2 }}>Intervention Needed</div>
            <div style={{ fontSize: 12, color: '#b45309' }}>Mathematics avg 68% — curriculum review recommended</div>
          </div>
        </Card>
      </div>

      {/* AI Insights */}
      <section>
        <SectionTitle sub="AI-generated observations from school data">School Performance Insights</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {insights.map((ins, i) => {
            const Icon = ins.icon
            const colors = { positive: { bg: '#f0fdf4', border: '#bbf7d0', icon: '#22c55e', text: '#166534' }, negative: { bg: '#fff1f2', border: '#fecdd3', icon: '#f43f5e', text: '#9f1239' }, neutral: { bg: '#eff6ff', border: '#bfdbfe', icon: '#3b82f6', text: '#1e40af' } } as const
            const c = colors[ins.type as keyof typeof colors]
            return (
              <div key={i} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, padding: '16px', display: 'flex', gap: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: c.icon + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={14} color={c.icon} />
                </div>
                <p style={{ fontSize: 13, color: c.text, lineHeight: 1.55, margin: 0 }}>{ins.text}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Teacher + Student Insights */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card>
          <SectionTitle sub="Institutional overview">Teacher Performance</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[{ label: 'Active Teachers', value: '98', color: '#3b5bdb' }, { label: 'Attendance Pending', value: '5', color: '#f59e0b' }, { label: 'Homework Today', value: '23', color: '#0ea5a0' }, { label: 'Tests Conducted', value: '7', color: '#10b981' }].map(m => (
              <div key={m.label} style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 9, border: '1px solid var(--border-subtle)' }}>
                <div className="font-mono-data" style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{m.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{m.label}</div>
              </div>
            ))}
          </div>
          {[{ label: 'Classes consistently above average', count: 12, color: '#10b981' }, { label: 'Teachers needing academic support', count: 4, color: '#f43f5e' }, { label: 'Pending academic tasks', count: 8, color: '#f59e0b' }].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: item.color }} className="font-mono-data">{item.count}</span>
            </div>
          ))}
        </Card>

        <Card>
          <SectionTitle sub="Institution-wide student indicators">Student Insights</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {studentInsights.map(ins => {
              const Icon = ins.icon
              return (
                <div key={ins.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = ins.color + '0a'; e.currentTarget.style.borderColor = ins.color + '30' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: ins.color + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={15} color={ins.color} />
                  </div>
                  <div style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>{ins.label}</div>
                  <div className="font-mono-data" style={{ fontSize: 18, fontWeight: 700, color: ins.color }}>{ins.count}</div>
                  <ChevronRight size={13} color="var(--text-muted)" />
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Class table */}
      <Card>
        <SectionTitle sub="Class-level intervention signals">Class Insights</SectionTitle>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Class', 'Status', 'Avg Score', 'Attendance', 'Homework %', 'Action'].map(h => (
                <th key={h} style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'left', padding: '6px 14px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {classInsights.map((c, i) => (
                <tr key={c.class} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 700, fontSize: 14 }}>{c.class}</td>
                  <td style={{ padding: '12px 14px' }}><Chip color={c.type === 'Best' ? '#10b981' : '#f43f5e'}>{c.type === 'Best' ? 'Excelling' : 'Attention'}</Chip></td>
                  <td style={{ padding: '12px 14px' }} className="font-mono-data"><span style={{ color: c.avg >= 85 ? '#10b981' : c.avg >= 75 ? '#3b5bdb' : '#f43f5e', fontWeight: 700 }}>{c.avg}%</span></td>
                  <td style={{ padding: '12px 14px' }} className="font-mono-data"><span style={{ color: c.attendance >= 90 ? '#10b981' : '#f59e0b', fontWeight: 600 }}>{c.attendance}%</span></td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ProgressBar value={c.homework} color={c.homework >= 80 ? '#10b981' : '#f59e0b'} />
                      <span className="font-mono-data" style={{ fontSize: 11, color: 'var(--text-secondary)', width: 30 }}>{c.homework}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <button style={{ fontSize: 11, color: 'var(--indigo)', background: 'var(--indigo-light)', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Activity + Pending */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20 }}>
        <Card>
          <SectionTitle sub="Live institutional activity feed">Recent Activities</SectionTitle>
          {recentActivities.map((act, i) => {
            const Icon = act.icon
            return (
              <div key={act.id} style={{ display: 'flex', gap: 14, padding: '12px 0', borderBottom: i < recentActivities.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: act.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                  <Icon size={14} color={act.color} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    <strong style={{ color: 'var(--navy)' }}>{act.actor}</strong>{' '}
                    <span style={{ color: 'var(--text-secondary)' }}>{act.action}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{act.time}</div>
                </div>
              </div>
            )
          })}
        </Card>

        <Card>
          <SectionTitle sub="Items requiring your decision">Pending Approvals</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingApprovals.map(p => {
              const urgencyColor = p.urgency === 'urgent' ? '#f43f5e' : p.urgency === 'today' ? '#f59e0b' : '#3b5bdb'
              return (
                <div key={p.id} style={{ padding: '14px', background: 'var(--bg)', borderRadius: 10, border: `1px solid ${urgencyColor}25` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 8, background: urgencyColor + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: urgencyColor, flexShrink: 0 }}>{p.avatar}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                        <Chip color={urgencyColor}>{p.urgency}</Chip>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.detail}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button style={{ flex: 1, fontSize: 11, fontWeight: 600, padding: '6px', borderRadius: 7, border: 'none', background: '#dcfce7', color: '#15803d', cursor: 'pointer' }}>Approve</button>
                    <button style={{ flex: 1, fontSize: 11, fontWeight: 600, padding: '6px', borderRadius: 7, border: 'none', background: '#ffe4e6', color: '#be123c', cursor: 'pointer' }}>Decline</button>
                    <button style={{ width: 28, fontSize: 11, padding: '6px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><MoreHorizontal size={12} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Announcements + Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card>
          <SectionTitle sub="School-wide communications" action={<button style={{ fontSize: 12, color: 'var(--indigo)', background: 'var(--indigo-light)', border: 'none', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 }}>+ New</button>}>Announcements</SectionTitle>
          {[
            { title: 'Annual Sports Day — 15 August', status: 'Published', date: 'Today', color: '#10b981' },
            { title: 'Parent-Teacher Meeting — 5 Aug', status: 'Pending Review', date: '25 Jul', color: '#f59e0b' },
            { title: 'School Closed — Independence Day', status: 'Scheduled', date: '24 Jul', color: '#3b5bdb' },
            { title: 'Fee Payment Reminder — Last Date 31 Jul', status: 'Published', date: '22 Jul', color: '#10b981' },
          ].map(a => (
            <div key={a.title} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{a.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{a.date}</div>
              </div>
              <Chip color={a.color}>{a.status}</Chip>
            </div>
          ))}
        </Card>
        <Card>
          <SectionTitle sub="Commonly used administrative shortcuts">Quick Actions</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'School Reports', icon: FileText, color: '#3b5bdb' },
              { label: 'Academic Analytics', icon: BarChart2, color: '#0ea5a0' },
              { label: 'Teacher Performance', icon: Users, color: '#f59e0b' },
              { label: 'Attendance Overview', icon: UserCheck, color: '#10b981' },
              { label: 'Create Announcement', icon: Megaphone, color: '#6882e8' },
              { label: 'Open Messages', icon: MessageSquare, color: '#f43f5e' },
            ].map(({ label, icon: Icon, color }) => (
              <button key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border-subtle)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = color + '0a'; e.currentTarget.style.borderColor = color + '30' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
              >
                <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={15} color={color} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ height: 20 }} />
    </div>
  )
}

// ── PAGE: Analytics ───────────────────────────────────────────────────────────

function AnalyticsPage() {
  const monthlyPerf = [
    { month: 'Feb', avg: 73 }, { month: 'Mar', avg: 75 }, { month: 'Apr', avg: 72 },
    { month: 'May', avg: 78 }, { month: 'Jun', avg: 76 }, { month: 'Jul', avg: 80 },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <SectionTitle sub="School-wide performance trends and academic analytics">Academic Analytics</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        <KPICard icon={TrendingUp} label="School Avg This Month" value="79.4%" delta="+4.2%" deltaDir="up" color="#10b981" />
        <KPICard icon={Award} label="Top Class Avg" value="91%" color="#3b5bdb" sub="Class 8A" />
        <KPICard icon={AlertTriangle} label="Lowest Class Avg" value="71%" color="#f43f5e" sub="Class 10B" />
        <KPICard icon={BookOpen} label="Homework Completion" value="78%" delta="+3%" deltaDir="up" color="#6882e8" />
        <KPICard icon={ClipboardList} label="Assignment Completion" value="65%" delta="-2%" deltaDir="down" color="#f59e0b" />
        <KPICard icon={Activity} label="Practice Activity" value="54%" delta="-5%" deltaDir="down" color="#f43f5e" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <Card>
          <SectionTitle sub="6-month school performance trend">Monthly Performance</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={monthlyPerf} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b5bdb" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b5bdb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#f0f1f3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis domain={[65, 90]} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8 }} />
              <Area type="monotone" dataKey="avg" stroke="#3b5bdb" strokeWidth={2.5} fill="url(#gm)" name="School Avg %" dot={{ fill: '#3b5bdb', r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle sub="Subject performance breakdown">By Subject</SectionTitle>
          {subjectData.map(s => (
            <div key={s.subject} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.fill, flexShrink: 0 }} />
              <div style={{ width: 90, fontSize: 12, color: 'var(--text-secondary)' }}>{s.subject}</div>
              <ProgressBar value={s.score} color={s.fill} />
              <div className="font-mono-data" style={{ width: 36, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{s.score}%</div>
            </div>
          ))}
        </Card>
      </div>

      <Card>
        <SectionTitle sub="Class-wise performance comparison">Class-wise Analysis</SectionTitle>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={classPerformance} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#f0f1f3" vertical={false} />
            <XAxis dataKey="class" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis domain={[60, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8 }} cursor={{ fill: '#f4f5f7' }} />
            <Bar dataKey="score" radius={[5, 5, 0, 0]} name="Avg Score">
              {classPerformance.map((entry, i) => (
                <Cell key={i} fill={entry.score >= 85 ? '#10b981' : entry.score >= 75 ? '#3b5bdb' : '#f43f5e'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  )
}

// ── PAGE: Teachers ────────────────────────────────────────────────────────────

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
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const filtered = students.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.class.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || s.status === filter
    return matchSearch && matchFilter
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionTitle sub="Institution-wide student performance and attendance">Students</SectionTitle>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 14px' }}>
            <Search size={13} color="var(--text-muted)" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students..." style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, width: 160 }} />
          </div>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', fontSize: 12, background: 'var(--surface)', color: 'var(--text-secondary)', cursor: 'pointer', outline: 'none' }}>
            <option value="all">All Students</option>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="attention">Needs Attention</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        {studentInsights.map(ins => {
          const Icon = ins.icon
          return (
            <div key={ins.label} onClick={() => setFilter(ins.label.includes('High Perf') ? 'excellent' : ins.label.includes('Attention') ? 'attention' : 'all')}
              style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '18px 20px', border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = ins.color + '40'; e.currentTarget.style.background = ins.color + '06' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.background = 'var(--surface)' }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: ins.color + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                <Icon size={15} color={ins.color} />
              </div>
              <div className="font-mono-data" style={{ fontSize: 24, fontWeight: 700, color: ins.color }}>{ins.count}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{ins.label}</div>
            </div>
          )
        })}
      </div>

      <Card style={{ padding: 0 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Student Directory</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>{filtered.length} students</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Student', 'Class', 'Roll No.', 'Attendance', 'Avg Score', 'Status', 'Action'].map(h => (
                <th key={h} style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'left', padding: '10px 20px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const statusColor = s.status === 'excellent' ? '#10b981' : s.status === 'good' ? '#3b5bdb' : '#f43f5e'
                return (
                  <tr key={s.name} style={{ background: i % 2 === 0 ? 'transparent' : '#fafafa', cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#fafafa'}
                  >
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: statusColor + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: statusColor, flexShrink: 0 }}>{s.avatar}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</div>
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-secondary)' }}>{s.class}</td>
                    <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--text-muted)' }} className="font-mono-data">{s.roll}</td>
                    <td style={{ padding: '14px 20px' }} className="font-mono-data">
                      <span style={{ color: s.attendance >= 90 ? '#10b981' : s.attendance >= 75 ? '#f59e0b' : '#f43f5e', fontWeight: 700 }}>{s.attendance}%</span>
                    </td>
                    <td style={{ padding: '14px 20px' }} className="font-mono-data">
                      <span style={{ color: s.avg >= 85 ? '#10b981' : s.avg >= 70 ? '#3b5bdb' : '#f43f5e', fontWeight: 700 }}>{s.avg}%</span>
                    </td>
                    <td style={{ padding: '14px 20px' }}><Chip color={statusColor}>{s.status}</Chip></td>
                    <td style={{ padding: '14px 20px' }}>
                      <button style={{ fontSize: 11, color: 'var(--indigo)', background: 'var(--indigo-light)', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }}>View</button>
                    </td>
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

// ── PAGE: Examinations ────────────────────────────────────────────────────────

function ExaminationsPage() {
  const [tab, setTab] = useState<'all' | 'upcoming' | 'ongoing' | 'completed'>('all')
  const filtered = exams.filter(e => tab === 'all' || e.status === tab)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionTitle sub="Tests, examinations, and results overview">Examinations & Tests</SectionTitle>
        <button style={{ fontSize: 12, color: '#fff', background: 'var(--indigo)', border: 'none', borderRadius: 9, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={13} /> Create Examination
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        <StatTile label="Ongoing Tests" value="7" color="#f43f5e" icon={Activity} />
        <StatTile label="Upcoming Tests" value="12" color="#f59e0b" icon={Clock} />
        <StatTile label="Upcoming Exams" value="3" color="#6882e8" icon={CalendarDays} />
        <StatTile label="Avg Test Score" value="74.2%" color="#3b5bdb" icon={BarChart2} />
        <StatTile label="Avg Exam Score" value="77.8%" color="#10b981" icon={Award} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 4, alignSelf: 'flex-start' }}>
        {(['all', 'upcoming', 'ongoing', 'completed'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', textTransform: 'capitalize',
            background: tab === t ? 'var(--indigo)' : 'transparent',
            color: tab === t ? '#fff' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map(exam => {
          const statusColor = exam.status === 'ongoing' ? '#f43f5e' : exam.status === 'upcoming' ? '#f59e0b' : '#10b981'
          return (
            <Card key={exam.name} style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: statusColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <CalendarDays size={20} color={statusColor} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{exam.name}</span>
                    <Chip color={statusColor}>{exam.status}</Chip>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{exam.classes} &nbsp;·&nbsp; {exam.subjects} subject{exam.subjects > 1 ? 's' : ''} &nbsp;·&nbsp; {exam.duration}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="font-mono-data" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{exam.date}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                    <button style={{ fontSize: 11, color: 'var(--indigo)', background: 'var(--indigo-light)', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }}>View</button>
                    {exam.status !== 'completed' && <button style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }}>Edit</button>}
                  </div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ── PAGE: Attendance ──────────────────────────────────────────────────────────

function AttendancePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionTitle sub="School-wide attendance monitoring and approvals">Attendance</SectionTitle>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        <KPICard icon={GraduationCap} label="Student Attendance" value="92.3%" delta="-1.4%" deltaDir="down" color="#3b5bdb" sub="1,699 / 1,842" />
        <KPICard icon={Users} label="Teacher Attendance" value="95.8%" delta="+0.5%" deltaDir="up" color="#10b981" sub="94 / 98 present" />
        <KPICard icon={Clock} label="Pending Approval" value="3" color="#f59e0b" sub="Classes awaiting" />
        <KPICard icon={AlertTriangle} label="Low Attendance Classes" value="2" color="#f43f5e" sub="7C, 10B" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20 }}>
        <Card>
          <SectionTitle sub="This week's student and teacher attendance">Weekly Trend</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={attendanceTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="as" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b5bdb" stopOpacity={0.15} /><stop offset="95%" stopColor="#3b5bdb" stopOpacity={0} /></linearGradient>
                <linearGradient id="at" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.15} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="#f0f1f3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis domain={[80, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8 }} />
              <Area type="monotone" dataKey="students" stroke="#3b5bdb" strokeWidth={2} fill="url(#as)" name="Students" dot={false} />
              <Area type="monotone" dataKey="teachers" stroke="#10b981" strokeWidth={2} fill="url(#at)" name="Teachers" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle sub="Action required">Low Attendance</SectionTitle>
          {attendanceClasses.filter(c => c.present / c.students < 0.85).map(c => (
            <div key={c.class} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: '#ffe4e6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertTriangle size={16} color="#f43f5e" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Class {c.class}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.teacher} &nbsp;·&nbsp; {c.present}/{c.students} present</div>
              </div>
              <div className="font-mono-data" style={{ fontSize: 14, fontWeight: 700, color: '#f43f5e' }}>{Math.round(c.present / c.students * 100)}%</div>
            </div>
          ))}
        </Card>
      </div>

      <Card style={{ padding: 0 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Class Attendance — Today</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>27 Jul 2025</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Class', 'Class Teacher', 'Total Students', 'Present', 'Absent', 'Attendance %', 'Status', 'Action'].map(h => (
                <th key={h} style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'left', padding: '10px 20px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {attendanceClasses.map((c, i) => {
                const pct = Math.round(c.present / c.students * 100)
                const statusColor = c.status === 'approved' ? '#10b981' : '#f59e0b'
                return (
                  <tr key={c.class} style={{ background: i % 2 === 0 ? 'transparent' : '#fafafa' }}>
                    <td style={{ padding: '12px 20px', fontWeight: 700, fontSize: 14 }}>{c.class}</td>
                    <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-secondary)' }}>{c.teacher}</td>
                    <td style={{ padding: '12px 20px', fontSize: 13 }} className="font-mono-data">{c.students}</td>
                    <td style={{ padding: '12px 20px', fontSize: 13, color: '#10b981', fontWeight: 700 }} className="font-mono-data">{c.present}</td>
                    <td style={{ padding: '12px 20px', fontSize: 13, color: '#f43f5e', fontWeight: 700 }} className="font-mono-data">{c.students - c.present}</td>
                    <td style={{ padding: '12px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ProgressBar value={pct} color={pct >= 90 ? '#10b981' : pct >= 75 ? '#f59e0b' : '#f43f5e'} />
                        <span className="font-mono-data" style={{ fontSize: 12, fontWeight: 600, color: pct >= 90 ? '#10b981' : '#f43f5e', width: 36 }}>{pct}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 20px' }}><Chip color={statusColor}>{c.status}</Chip></td>
                    <td style={{ padding: '12px 20px' }}>
                      {c.status === 'pending' && (
                        <button style={{ fontSize: 11, color: '#fff', background: 'var(--indigo)', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 }}>Approve</button>
                      )}
                    </td>
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

// ── PAGE: Announcements ───────────────────────────────────────────────────────

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
