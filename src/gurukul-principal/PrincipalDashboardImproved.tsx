/**
 * Principal Dashboard - Visually Rich Version
 *
 * Features:
 * - Large hero metrics with trends
 * - Visual progress bars and charts
 * - Color-coded status indicators
 * - Quick action cards
 * - Rich data presentation
 */

import { PALETTE } from './shared/palette'
import { TrendingUp, TrendingDown, Users, BookOpen, ClipboardCheck, AlertCircle, CheckCircle, Clock } from 'lucide-react'

export default function PrincipalDashboardImproved() {
  // Mock data - in production, load from API
  const metrics = {
    totalStudents: 847,
    presentToday: 792,
    attendanceRate: 93.5,
    attendanceTrend: 2.3,
    pendingLeaves: 12,
    flaggedStudents: 8,
    homeworkCompletion: 78,
    upcomingExams: 3,
  }

  const recentActivity = [
    { time: '10 mins ago', action: 'Mrs. Sharma marked attendance for Class 10-A', type: 'attendance' },
    { time: '25 mins ago', action: '3 new leave requests pending approval', type: 'leave' },
    { time: '1 hour ago', action: 'Math test results uploaded for Class 9-B', type: 'marks' },
    { time: '2 hours ago', action: '5 students marked absent consecutively', type: 'alert' },
  ]

  const classSummary = [
    { class: 'Class 10', sections: 4, students: 142, attendance: 95, homework: 82, flagged: 3 },
    { class: 'Class 9', sections: 4, students: 156, attendance: 92, homework: 79, flagged: 2 },
    { class: 'Class 8', sections: 3, students: 118, attendance: 91, homework: 75, flagged: 1 },
    { class: 'Class 7', sections: 3, students: 124, attendance: 94, homework: 81, flagged: 2 },
  ]

  const topPerformers = [
    { name: 'Aarav Kumar', class: '10-A', score: 96 },
    { name: 'Priya Sharma', class: '9-B', score: 94 },
    { name: 'Rohan Singh', class: '10-C', score: 93 },
  ]

  const needsAttention = [
    { name: 'Rahul Verma', class: '8-A', issue: 'Attendance: 65%', severity: 'high' },
    { name: 'Sneha Patel', class: '9-C', issue: 'Homework: 42%', severity: 'high' },
    { name: 'Amit Gupta', class: '7-B', issue: '3 consecutive absences', severity: 'medium' },
  ]

  return (
    <div style={{ background: PALETTE.ground, minHeight: '100vh', padding: '24px' }}>
      {/* Hero Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        {/* Attendance Hero */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '12px',
          padding: '28px',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(102, 126, 234, 0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.9 }}>
              Today's Attendance
            </div>
            <Users size={24} style={{ opacity: 0.9 }} />
          </div>
          <div style={{ fontSize: '48px', fontWeight: 700, lineHeight: 1, marginBottom: '8px' }}>
            {metrics.attendanceRate}%
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', opacity: 0.95 }}>
            <TrendingUp size={16} />
            <span>+{metrics.attendanceTrend}% from yesterday</span>
          </div>
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.2)', fontSize: '14px' }}>
            <strong>{metrics.presentToday}</strong> of <strong>{metrics.totalStudents}</strong> students present
          </div>
        </div>

        {/* Homework Completion */}
        <div style={{
          background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
          borderRadius: '12px',
          padding: '28px',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(245, 87, 108, 0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.9 }}>
              Homework Completion
            </div>
            <BookOpen size={24} style={{ opacity: 0.9 }} />
          </div>
          <div style={{ fontSize: '48px', fontWeight: 700, lineHeight: 1, marginBottom: '8px' }}>
            {metrics.homeworkCompletion}%
          </div>
          <div style={{ marginTop: '16px' }}>
            <div style={{ background: 'rgba(255,255,255,0.2)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ background: '#fff', height: '100%', width: `${metrics.homeworkCompletion}%`, borderRadius: '4px' }} />
            </div>
          </div>
          <div style={{ marginTop: '12px', fontSize: '13px', opacity: 0.95 }}>
            Last 7 days average
          </div>
        </div>

        {/* Pending Actions */}
        <div style={{
          background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
          borderRadius: '12px',
          padding: '28px',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(79, 172, 254, 0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.9 }}>
              Pending Actions
            </div>
            <ClipboardCheck size={24} style={{ opacity: 0.9 }} />
          </div>
          <div style={{ fontSize: '48px', fontWeight: 700, lineHeight: 1, marginBottom: '8px' }}>
            {metrics.pendingLeaves}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.95, marginTop: '8px' }}>
            Leave requests awaiting approval
          </div>
          <button style={{
            marginTop: '16px',
            background: 'rgba(255,255,255,0.2)',
            border: '1px solid rgba(255,255,255,0.3)',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            width: '100%'
          }}>
            Review Now
          </button>
        </div>

        {/* Alerts */}
        <div style={{
          background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
          borderRadius: '12px',
          padding: '28px',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(250, 112, 154, 0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.9 }}>
              Needs Attention
            </div>
            <AlertCircle size={24} style={{ opacity: 0.9 }} />
          </div>
          <div style={{ fontSize: '48px', fontWeight: 700, lineHeight: 1, marginBottom: '8px' }}>
            {metrics.flaggedStudents}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.95, marginTop: '8px' }}>
            Students flagged for intervention
          </div>
          <div style={{ marginTop: '16px', fontSize: '13px', opacity: 0.95 }}>
            Low attendance, homework, or marks
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginBottom: '24px' }}>
        {/* Class Overview */}
        <div style={{
          background: PALETTE.surface,
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: PALETTE.ink, margin: '0 0 20px 0' }}>
            Class Overview
          </h2>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${PALETTE.border}` }}>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: PALETTE.inkMuted, textTransform: 'uppercase' }}>Class</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: PALETTE.inkMuted, textTransform: 'uppercase' }}>Students</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: PALETTE.inkMuted, textTransform: 'uppercase' }}>Attendance</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: PALETTE.inkMuted, textTransform: 'uppercase' }}>Homework</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: PALETTE.inkMuted, textTransform: 'uppercase' }}>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {classSummary.map((cls, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${PALETTE.border}`, cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = PALETTE.ground}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '16px 8px', fontWeight: 600, color: PALETTE.ink }}>{cls.class}</td>
                    <td style={{ padding: '16px 8px', color: PALETTE.ink }}>{cls.students}</td>
                    <td style={{ padding: '16px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, background: PALETTE.ground, height: '6px', borderRadius: '3px', overflow: 'hidden', maxWidth: '80px' }}>
                          <div style={{ background: cls.attendance >= 90 ? '#10b981' : '#f59e0b', height: '100%', width: `${cls.attendance}%` }} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: PALETTE.ink }}>{cls.attendance}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, background: PALETTE.ground, height: '6px', borderRadius: '3px', overflow: 'hidden', maxWidth: '80px' }}>
                          <div style={{ background: cls.homework >= 80 ? '#10b981' : '#f59e0b', height: '100%', width: `${cls.homework}%` }} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: PALETTE.ink }}>{cls.homework}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 8px' }}>
                      {cls.flagged > 0 ? (
                        <span style={{
                          background: PALETTE.alertBg,
                          color: PALETTE.alert,
                          padding: '4px 10px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 600
                        }}>
                          {cls.flagged}
                        </span>
                      ) : (
                        <span style={{ color: PALETTE.inkMuted, fontSize: '13px' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Activity */}
        <div style={{
          background: PALETTE.surface,
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: PALETTE.ink, margin: '0 0 20px 0' }}>
            Recent Activity
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {recentActivity.map((activity, i) => (
              <div key={i} style={{ display: 'flex', gap: '12px', paddingBottom: '16px', borderBottom: i < recentActivity.length - 1 ? `1px solid ${PALETTE.border}` : 'none' }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: activity.type === 'alert' ? PALETTE.alert : activity.type === 'attendance' ? '#10b981' : PALETTE.inkMuted,
                  marginTop: '6px',
                  flexShrink: 0
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: PALETTE.ink, marginBottom: '4px', lineHeight: 1.4 }}>
                    {activity.action}
                  </div>
                  <div style={{ fontSize: '11px', color: PALETTE.inkMuted }}>
                    {activity.time}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
        {/* Top Performers */}
        <div style={{
          background: PALETTE.surface,
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
            <TrendingUp size={20} color="#10b981" />
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: PALETTE.ink, margin: 0 }}>
              Top Performers
            </h2>
          </div>
          {topPerformers.map((student, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px',
              background: i === 0 ? 'linear-gradient(135deg, #ffeaa7 0%, #fdcb6e 100%)' : PALETTE.ground,
              borderRadius: '8px',
              marginBottom: '8px'
            }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: i === 0 ? '#fff' : '#10b981',
                color: i === 0 ? '#fdcb6e' : '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 700
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: PALETTE.ink }}>{student.name}</div>
                <div style={{ fontSize: '12px', color: PALETTE.inkMuted }}>{student.class}</div>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: i === 0 ? '#d63031' : '#10b981' }}>
                {student.score}%
              </div>
            </div>
          ))}
        </div>

        {/* Needs Attention */}
        <div style={{
          background: PALETTE.surface,
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
            <AlertCircle size={20} color={PALETTE.alert} />
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: PALETTE.ink, margin: 0 }}>
              Needs Attention
            </h2>
          </div>
          {needsAttention.map((student, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px',
              background: PALETTE.ground,
              borderLeft: `3px solid ${student.severity === 'high' ? PALETTE.alert : '#f59e0b'}`,
              borderRadius: '8px',
              marginBottom: '8px'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: PALETTE.ink }}>{student.name}</div>
                <div style={{ fontSize: '12px', color: PALETTE.inkMuted, marginTop: '2px' }}>{student.class}</div>
              </div>
              <div style={{ fontSize: '12px', color: student.severity === 'high' ? PALETTE.alert : '#f59e0b', fontWeight: 600 }}>
                {student.issue}
              </div>
            </div>
          ))}
          <button style={{
            width: '100%',
            marginTop: '12px',
            background: PALETTE.alert,
            color: '#fff',
            border: 'none',
            padding: '12px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer'
          }}>
            View All Flagged Students
          </button>
        </div>

        {/* Quick Stats */}
        <div style={{
          background: PALETTE.surface,
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: PALETTE.ink, margin: '0 0 20px 0' }}>
            Quick Stats
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', color: PALETTE.inkMuted }}>Total Classes</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: PALETTE.ink }}>14</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', color: PALETTE.inkMuted }}>Total Teachers</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: PALETTE.ink }}>42</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', color: PALETTE.inkMuted }}>Upcoming Exams</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#f59e0b' }}>{metrics.upcomingExams}</div>
            </div>
            <div style={{ height: '1px', background: PALETTE.border }} />
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px', background: '#ecfdf5', borderRadius: '8px' }}>
              <CheckCircle size={20} color="#10b981" />
              <div style={{ fontSize: '13px', color: '#047857', fontWeight: 600 }}>
                All systems operational
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
