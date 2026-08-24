import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { useAcademicLive, AnalyticsService, AttendanceService } from '@/academic'
import { localDateKey } from '@/lib/localDate'
import {
  LayoutDashboard, Users, GraduationCap, UserCheck, Calendar,
  TrendingUp, AlertCircle, CheckCircle, Clock, ArrowRight
} from 'lucide-react'

/**
 * Principal Dashboard - REDESIGNED
 *
 * Clean, professional overview without technical service names.
 * Shows today's important information with drill-down capabilities.
 */

interface DashboardStat {
  label: string
  value: string | number
  trend?: string
  color: string
  icon: React.ElementType
  clickable?: boolean
  onClick?: () => void
}

interface ActionItem {
  type: 'attendance' | 'leave' | 'case' | 'announcement'
  title: string
  priority: 'high' | 'medium' | 'low'
  onClick?: () => void
}

function StatCard({ stat }: { stat: DashboardStat }) {
  const Container = stat.clickable ? 'button' : 'div'
  return (
    <Container
      onClick={stat.onClick}
      style={{
        padding: '20px',
        background: 'white',
        borderRadius: '12px',
        border: `2px solid ${stat.color}15`,
        borderLeft: `4px solid ${stat.color}`,
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        cursor: stat.clickable ? 'pointer' : 'default',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        ...(stat.clickable && {
          ':hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
          }
        })
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '10px',
          background: `${stat.color}12`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <stat.icon size={22} color={stat.color} strokeWidth={2.5} />
      </div>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div
          className="font-mono-data"
          style={{
            fontSize: '28px',
            fontWeight: 800,
            color: stat.color,
            lineHeight: 1,
            marginBottom: '4px',
          }}
        >
          {stat.value}
        </div>
        <div style={{ fontSize: '13px', color: 'hsl(199 30% 30%)', fontWeight: 600 }}>
          {stat.label}
        </div>
        {stat.trend && (
          <div style={{ fontSize: '11px', color: 'hsl(199 20% 45%)', marginTop: '4px' }}>
            {stat.trend}
          </div>
        )}
      </div>
      {stat.clickable && <ArrowRight size={18} color={stat.color} />}
    </Container>
  )
}

function ActionItemCard({ item }: { item: ActionItem }) {
  const priorityColors = {
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#3b82f6',
  }
  const color = priorityColors[item.priority]

  return (
    <button
      onClick={item.onClick}
      style={{
        width: '100%',
        padding: '14px 16px',
        background: 'white',
        borderRadius: '8px',
        border: `1px solid ${color}20`,
        borderLeft: `3px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateX(4px)'
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.06)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateX(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: color,
          }}
        />
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'hsl(199 45% 10%)' }}>
          {item.title}
        </span>
      </div>
      <ArrowRight size={16} color={color} />
    </button>
  )
}

export default function PrincipalDashboard() {
  const navigate = useNavigate()
  const { ctx, settled } = useAcademicContext()
  const liveVersion = useAcademicLive(['profile', 'attendance'])

  const [stats, setStats] = useState<DashboardStat[]>([
    { label: 'Total Students', value: '...', color: '#3b82f6', icon: GraduationCap },
    { label: 'Total Teachers', value: '...', color: '#8b5cf6', icon: Users },
    { label: 'Total Classes', value: '...', color: '#06b6d4', icon: LayoutDashboard },
    { label: 'Present Today', value: '...', color: '#10b981', icon: CheckCircle },
  ])

  const [actionItems] = useState<ActionItem[]>([
    { type: 'leave', title: '3 pending leave requests', priority: 'high', onClick: () => navigate('/principal/leaves') },
    { type: 'case', title: '2 new parent inquiries', priority: 'medium', onClick: () => navigate('/principal/communication') },
    { type: 'attendance', title: 'Attendance below 75% in Class 10-A', priority: 'high', onClick: () => navigate('/principal/attendance') },
  ])

  useEffect(() => {
    if (!settled || !ctx) return

    let cancelled = false

    ;(async () => {
      try {
        const [school, today] = await Promise.all([
          AnalyticsService.forSchool(ctx),
          AttendanceService.summarizeSchoolDate(ctx, localDateKey()),
        ])

        if (cancelled) return

        setStats([
          {
            label: 'Total Students',
            value: school.studentCount,
            color: '#3b82f6',
            icon: GraduationCap,
            clickable: true,
            onClick: () => navigate('/principal/students')
          },
          {
            label: 'Total Teachers',
            value: school.teacherCount,
            color: '#8b5cf6',
            icon: Users,
            clickable: true,
            onClick: () => navigate('/principal/teachers')
          },
          {
            label: 'Total Classes',
            value: school.classCount,
            color: '#06b6d4',
            icon: LayoutDashboard,
            clickable: true,
            onClick: () => navigate('/principal/classes')
          },
          {
            label: 'Present Today',
            value: `${today?.overallDayRatePct ?? 0}%`,
            trend: `${Math.round(school.avgAttendancePct)}% avg`,
            color: '#10b981',
            icon: CheckCircle,
            clickable: true,
            onClick: () => navigate('/principal/attendance')
          },
        ])
      } catch (error) {
        console.error('Failed to load dashboard data:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [settled, ctx, liveVersion, navigate])

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Header */}
      <div>
        <h1
          className="font-display"
          style={{
            fontSize: '32px',
            fontWeight: 800,
            color: 'hsl(199 50% 5%)',
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          {greeting()}, Principal
        </h1>
        <p style={{ fontSize: '14px', color: 'hsl(199 20% 40%)', marginTop: '6px' }}>
          {today}
        </p>
      </div>

      {/* Key Stats */}
      <div>
        <h2
          className="font-display"
          style={{
            fontSize: '18px',
            fontWeight: 700,
            color: 'hsl(199 40% 15%)',
            marginBottom: '16px',
          }}
        >
          School Overview
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {stats.map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </div>
      </div>

      {/* Action Items */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2
            className="font-display"
            style={{
              fontSize: '18px',
              fontWeight: 700,
              color: 'hsl(199 40% 15%)',
            }}
          >
            Needs Your Attention
          </h2>
          <button
            onClick={() => navigate('/principal/reports')}
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#3b82f6',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            View all <ArrowRight size={14} />
          </button>
        </div>
        <div
          style={{
            background: 'white',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {actionItems.length > 0 ? (
            actionItems.map((item, i) => <ActionItemCard key={i} item={item} />)
          ) : (
            <div style={{ textAlign: 'center', padding: '20px', color: 'hsl(199 20% 50%)' }}>
              <CheckCircle size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
              <p style={{ fontSize: '14px', fontWeight: 600 }}>All caught up!</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Access */}
      <div>
        <h2
          className="font-display"
          style={{
            fontSize: '18px',
            fontWeight: 700,
            color: 'hsl(199 40% 15%)',
            marginBottom: '16px',
          }}
        >
          Quick Access
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
          {[
            { label: 'Students', icon: GraduationCap, path: '/principal/students', color: '#3b82f6' },
            { label: 'Teachers', icon: Users, path: '/principal/teachers', color: '#8b5cf6' },
            { label: 'Classes', icon: LayoutDashboard, path: '/principal/classes', color: '#06b6d4' },
            { label: 'Attendance', icon: UserCheck, path: '/principal/attendance', color: '#10b981' },
            { label: 'Communication', icon: AlertCircle, path: '/principal/communication', color: '#f59e0b' },
            { label: 'Reports', icon: TrendingUp, path: '/principal/reports', color: '#ef4444' },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              style={{
                padding: '16px',
                background: 'white',
                borderRadius: '10px',
                border: `1px solid ${item.color}15`,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.borderColor = item.color + '40'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.06)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.borderColor = item.color + '15'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: `${item.color}12`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <item.icon size={20} color={item.color} strokeWidth={2.5} />
              </div>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'hsl(199 45% 10%)' }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
