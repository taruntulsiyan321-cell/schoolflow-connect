import { useState, useEffect } from 'react'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { useAcademicLive, AnalyticsService, AttendanceService } from '@/academic'
import { localDateKey } from '@/lib/localDate'
import { useDashboardDrillDown } from './DashboardDrillDown'
import { PrincipalClassRollups } from './PrincipalLiveAcademic'
import {
  GraduationCap, UserCheck, BookOpen, FileText, ArrowRight, Users, School
} from 'lucide-react'

/**
 * Principal Dashboard - Horizontal Stat Cards with Drill-Down
 *
 * Data from prompt ONLY:
 * - Attendance (marked per class, section, subject, day)
 * - Homework (completion per student, rolls up to class rate)
 * - Tests (marks per student, per subject)
 * - Exams (marks per student, per subject)
 *
 * Drill-down: School → Class → Student (expands in place, no navigation)
 */

interface DashboardStat {
  label: string
  value: string | number
  trend?: string
  color: string
  icon: React.ElementType
  metric?: 'attendance' | 'homework' | 'tests' | 'exams'
}

function StatCard({ stat, onClick }: { stat: DashboardStat; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        padding: '20px',
        background: 'white',
        borderRadius: '12px',
        border: `2px solid ${stat.color}15`,
        borderLeft: `4px solid ${stat.color}`,
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        flex: 1,
        minWidth: '200px',
      }}
      onMouseEnter={onClick ? (e) => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)'
      } : undefined}
      onMouseLeave={onClick ? (e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.04)'
      } : undefined}
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
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(199 30% 30%)' }}>
          {stat.label}
        </div>
        {stat.trend && (
          <div style={{ fontSize: '11px', color: 'hsl(199 20% 45%)', marginTop: '4px' }}>
            {stat.trend}
          </div>
        )}
      </div>
      {onClick && <ArrowRight size={18} color={stat.color} />}
    </button>
  )
}

export default function PrincipalDashboard() {
  const { ctx, settled } = useAcademicContext()
  const liveVersion = useAcademicLive(['profile', 'attendance', 'homework'])
  const { drillState, drillToClass, drillToStudent, BreadcrumbComponent } = useDashboardDrillDown()

  const [stats, setStats] = useState<DashboardStat[]>([
    { label: 'Attendance Today', value: '...', color: '#10b981', icon: UserCheck, metric: 'attendance' },
    { label: 'Homework Rate', value: '...', color: '#f59e0b', icon: BookOpen, metric: 'homework' },
    { label: 'Avg Tests', value: '...', color: '#3b82f6', icon: FileText, metric: 'tests' },
    { label: 'Avg Exams', value: '...', color: '#ef4444', icon: GraduationCap, metric: 'exams' },
  ])

  const [schoolInfo, setSchoolInfo] = useState({ students: 0, teachers: 0, classes: 0 })

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

        setSchoolInfo({
          students: school.studentCount,
          teachers: school.teacherCount,
          classes: school.classCount,
        })

        setStats([
          {
            label: 'Attendance Today',
            value: `${today?.overallDayRatePct ?? 0}%`,
            trend: `${school.studentCount} students`,
            color: '#10b981',
            icon: UserCheck,
            metric: 'attendance',
          },
          {
            label: 'Homework Rate',
            value: `${Math.round(school.avgHomeworkCompletionPct)}%`,
            trend: 'School average',
            color: '#f59e0b',
            icon: BookOpen,
            metric: 'homework',
          },
          {
            label: 'Avg Tests',
            value: `${Math.round(school.avgTestsPct)}%`,
            trend: 'All classes',
            color: '#3b82f6',
            icon: FileText,
            metric: 'tests',
          },
          {
            label: 'Avg Exams',
            value: `${Math.round(school.avgExamsPct)}%`,
            trend: 'All classes',
            color: '#ef4444',
            icon: GraduationCap,
            metric: 'exams',
          },
        ])
      } catch (error) {
        console.error('Failed to load dashboard data:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [settled, ctx, liveVersion])

  return (
    <div style={{ padding: '32px 24px', background: '#F8F9FA', minHeight: '100vh' }}>
      <BreadcrumbComponent />

      {/* School-level view */}
      {drillState.level === 'school' && (
        <>
          {/* School Info Header */}
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'hsl(199 50% 5%)', margin: 0 }}>
              School Overview
            </h1>
            <p style={{ fontSize: '14px', color: 'hsl(199 20% 40%)', marginTop: '6px' }}>
              {schoolInfo.students} students • {schoolInfo.teachers} teachers • {schoolInfo.classes} classes
            </p>
          </div>

          {/* Horizontal Stat Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginBottom: '32px',
          }}>
            {stats.map((stat) => (
              <StatCard
                key={stat.label}
                stat={stat}
                onClick={stat.metric ? () => drillToClass(stat.metric!) : undefined}
              />
            ))}
          </div>

          {/* Class Performance Table */}
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'hsl(199 40% 15%)', marginBottom: '16px' }}>
              Class Performance
            </h2>
            <PrincipalClassRollups onClassClick={drillToStudent} />
          </div>
        </>
      )}

      {/* Class-level drill-down */}
      {drillState.level === 'class' && drillState.metric && (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'hsl(199 40% 15%)', marginBottom: '6px' }}>
            {drillState.metric.charAt(0).toUpperCase()}{drillState.metric.slice(1)} by Class
          </h2>
          <p style={{ fontSize: '14px', color: 'hsl(199 20% 40%)', marginBottom: '24px' }}>
            Click a class to see student-level details
          </p>
          <PrincipalClassRollups
            focusMetric={drillState.metric}
            onClassClick={drillToStudent}
          />
        </div>
      )}

      {/* Student-level drill-down */}
      {drillState.level === 'student' && drillState.classId && (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'hsl(199 40% 15%)', marginBottom: '6px' }}>
            {drillState.className} - {drillState.metric?.charAt(0).toUpperCase()}{drillState.metric?.slice(1)}
          </h2>
          <p style={{ fontSize: '14px', color: 'hsl(199 20% 40%)', marginBottom: '24px' }}>
            Individual student performance
          </p>
          <div style={{ padding: '20px', textAlign: 'center', color: 'hsl(199 20% 50%)' }}>
            Student-level details will load here
            {/* TODO: Add student list component */}
          </div>
        </div>
      )}
    </div>
  )
}
