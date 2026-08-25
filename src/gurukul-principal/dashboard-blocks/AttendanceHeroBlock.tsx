import { useState, useEffect } from 'react'
import { AttendanceService, MessageService, useAcademicLive } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { localDateKey } from '@/lib/localDate'
import { UserCheck, MessageSquare, AlertCircle, TrendingUp } from 'lucide-react'

/**
 * Attendance Hero Block
 *
 * Formula (§3):
 * School = total present ÷ total students in MARKED classes × 100
 * Excludes unmarked classes from denominator (not treated as absent)
 *
 * Always shows coverage line: "across X of Y classes marked"
 * Shows: %, coverage, raw absent count, 7-day trend, provisional marker
 * Unmarked classes list INSIDE hero with class teacher names
 */

interface UnmarkedClass {
  classId: string
  className: string
  section: string
  teacherId: string
  teacherName: string
}

interface AttendanceTrend {
  date: string
  percentage: number
  isFinal: boolean
}

interface AttendanceHeroProps {
  onDrillToClasses: () => void
}

export function AttendanceHeroBlock({ onDrillToClasses }: AttendanceHeroProps) {
  const { ctx, settled } = useAcademicContext()
  const liveVersion = useAcademicLive(['attendance'])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Computed data
  const [percentage, setPercentage] = useState(0)
  const [presentCount, setPresentCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [absentCount, setAbsentCount] = useState(0)
  const [markedClasses, setMarkedClasses] = useState(0)
  const [totalClasses, setTotalClasses] = useState(0)
  const [unmarked, setUnmarked] = useState<UnmarkedClass[]>([])
  const [trend, setTrend] = useState<AttendanceTrend[]>([])
  const [isProvisional, setIsProvisional] = useState(true)

  useEffect(() => {
    if (!settled || !ctx) return

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)

      try {
        const today = localDateKey()
        const summary = await AttendanceService.summarizeSchoolDate(ctx, today)

        if (cancelled) return

        // Compute using student-weighted formula
        // School % = sum(present in each marked class) / sum(total in each marked class) × 100
        let totalPresent = 0
        let totalInMarked = 0
        let classesMarked = 0
        const unmarkedList: UnmarkedClass[] = []

        // TODO: Parse summary.byClass to compute these
        // For now, using the aggregate provided
        const pct = summary?.overallDayRatePct ?? 0

        setPercentage(pct)
        setPresentCount(Math.round(totalPresent)) // Will compute from byClass
        setTotalCount(Math.round(totalInMarked))
        setAbsentCount(totalInMarked - totalPresent)
        setMarkedClasses(classesMarked)
        setTotalClasses(22) // TODO: Get from school data
        setUnmarked(unmarkedList)

        // Check if edit window has closed (24h)
        const now = new Date()
        const todayDate = new Date(today)
        const hoursSince = (now.getTime() - todayDate.getTime()) / (1000 * 60 * 60)
        setIsProvisional(hoursSince < 24)

        // TODO: Load 7-day trend of FINAL days only
        setTrend([])

      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load attendance')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [settled, ctx, liveVersion])

  const messageTeacher = async (teacherId: string, className: string) => {
    if (!ctx) return

    const prefilled = `Hi, attendance for ${className} hasn't been marked yet today. Please submit when you can.`

    // TODO: Open message compose with prefilled text to this teacher
    console.log('Message teacher:', teacherId, prefilled)
  }

  if (loading) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '8px',
        border: '2px solid #10b98115',
        borderLeft: '4px solid #10b981',
        padding: '16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          TODAY'S ATTENDANCE
        </div>
        {/* Skeleton matching real content shape */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="animate-pulse" style={{ height: '60px', background: '#F3F4F6', borderRadius: '8px' }} />
          <div className="animate-pulse" style={{ height: '80px', background: '#F9FAFB', borderRadius: '6px' }} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '12px',
        border: '2px solid #ef444415',
        borderLeft: '6px solid #ef4444',
        padding: '32px 24px',
      }}>
        <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '16px' }}>
          TODAY'S ATTENDANCE
        </div>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <AlertCircle size={32} color="#ef4444" style={{ margin: '0 auto 12px' }} />
          <p style={{ fontSize: '14px', color: '#ef4444', marginBottom: '12px' }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Three states: not-yet-marked, no-data, and genuine-zero
  const hasData = markedClasses > 0 && totalCount > 0
  const color = !hasData ? '#6B7280' : (percentage >= 90 ? '#10b981' : percentage >= 75 ? '#f59e0b' : '#ef4444')

  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      border: `2px solid ${!hasData ? '#E5E7EB' : color + '15'}`,
      borderLeft: `4px solid ${!hasData ? '#9CA3AF' : color}`,
      padding: '16px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          TODAY'S ATTENDANCE
        </div>
        {isProvisional && hasData && (
          <div style={{
            fontSize: '9px',
            fontWeight: 600,
            color: '#f59e0b',
            background: '#fef3c7',
            padding: '2px 6px',
            borderRadius: '3px',
          }}>
            PROVISIONAL
          </div>
        )}
      </div>

      {/* Not yet marked state */}
      {!hasData && (
        <div style={{
          padding: '12px',
          background: '#F9FAFB',
          borderRadius: '8px',
          marginBottom: '12px',
        }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
            Attendance not yet marked
          </div>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>
            {unmarked.length} {unmarked.length === 1 ? 'class' : 'classes'} pending
          </div>
        </div>
      )}

      {/* Hero Percentage - Only when we have data */}
      {hasData && (
        <button
          onClick={onDrillToClasses}
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 100%)',
            border: 'none',
            cursor: 'pointer',
            padding: '12px',
            marginBottom: '0',
            width: '100%',
            textAlign: 'left',
            borderRadius: '8px',
            transition: 'all 0.2s ease',
            position: 'relative',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `linear-gradient(135deg, ${color}08 0%, ${color}15 100%)`
            e.currentTarget.style.transform = 'scale(1.02)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 100%)'
            e.currentTarget.style.transform = 'scale(1)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <div
              className="font-mono-data"
              style={{
                fontSize: '48px',
                fontWeight: 800,
                color,
                lineHeight: 1,
              }}
            >
              {percentage.toFixed(1)}%
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
              {presentCount} present • {absentCount} absent
            </div>
            <div style={{
              fontSize: '10px',
              color: '#9CA3AF',
              fontWeight: 500,
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              Click to drill down →
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>
            across {markedClasses} of {totalClasses} classes marked
          </div>
        </button>
      )}

      {/* 7-day Trend */}
      {trend.length > 0 && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: '#F9FAFB',
          borderRadius: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <TrendingUp size={14} color="#6B7280" />
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280' }}>7-DAY TREND (FINAL)</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {trend.map((day) => (
              <div key={day.date} style={{ flex: 1, textAlign: 'center' }}>
                <div className="font-mono-data" style={{ fontSize: '14px', fontWeight: 700, color }}>
                  {day.percentage.toFixed(0)}%
                </div>
                <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px' }}>
                  {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unmarked Classes - INSIDE THE HERO (Fix 6: specific action labels) */}
      {unmarked.length > 0 && (
        <div style={{
          marginTop: '12px',
          padding: '10px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#1F2937', marginBottom: '8px' }}>
            {unmarked.length} class{unmarked.length !== 1 ? 'es' : ''} not yet marked
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {unmarked.map((cls) => (
              <div
                key={cls.classId}
                style={{
                  background: 'white',
                  padding: '8px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#1F2937' }}>
                    {cls.className}{cls.section && `-${cls.section}`}
                  </div>
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '1px' }}>
                    {cls.teacherName}
                  </div>
                </div>
                <button
                  onClick={() => messageTeacher(cls.teacherId, `${cls.className}${cls.section ? `-${cls.section}` : ''}`)}
                  style={{
                    padding: '4px 8px',
                    background: '#1F2937',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                  }}
                >
                  <MessageSquare size={12} />
                  Message teacher
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All marked - good news (Fix 9: empty states as good news) */}
      {unmarked.length === 0 && markedClasses === totalClasses && hasData && (
        <div style={{
          marginTop: '12px',
          padding: '8px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '6px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#10b981' }}>
            ✓ All {totalClasses} classes marked attendance
          </div>
        </div>
      )}
    </div>
  )
}
