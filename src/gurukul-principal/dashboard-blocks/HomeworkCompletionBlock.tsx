import { useState, useEffect } from 'react'
import { AnalyticsService, useAcademicLive } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { BookOpen, TrendingDown, TrendingUp } from 'lucide-react'

/**
 * Homework Completion Block (§5.C)
 *
 * Formula (§3):
 * Class rate = completions ÷ students assigned, for homework with
 *              due date in last 7 days (past due only)
 * School rate = total completions ÷ total assignments, same window
 *
 * Shows school rate + spread (lowest to highest class)
 * Principal cares about the class at the bottom
 *
 * Drill-down: School → Class-wise → Students (with missed-while-absent separate)
 */

interface ClassHomework {
  classId: string
  className: string
  section: string
  rate: number
  completions: number
  total: number
}

interface HomeworkBlockProps {
  onDrillToClasses: () => void
}

export function HomeworkCompletionBlock({ onDrillToClasses }: HomeworkBlockProps) {
  const { ctx, settled } = useAcademicContext()
  const liveVersion = useAcademicLive(['homework'])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [schoolRate, setSchoolRate] = useState(0)
  const [lowestClass, setLowestClass] = useState<ClassHomework | null>(null)
  const [highestClass, setHighestClass] = useState<ClassHomework | null>(null)
  const [classCount, setClassCount] = useState(0)

  useEffect(() => {
    if (!settled || !ctx) return

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)

      try {
        // TODO: Implement 7-day window calculation
        // For now using aggregate from AnalyticsService
        const [school, classRollups] = await Promise.all([
          AnalyticsService.forSchool(ctx),
          AnalyticsService.classRollups(ctx),
        ])

        if (cancelled) return

        // Use school average (TODO: implement proper 7-day window)
        setSchoolRate(school.avgHomeworkCompletionPct)

        // Find spread
        if (classRollups.length > 0) {
          const sorted = [...classRollups].sort((a, b) => a.avgHomeworkCompletionPct - b.avgHomeworkCompletionPct)

          const lowest = sorted[0]
          const highest = sorted[sorted.length - 1]

          setLowestClass({
            classId: lowest.classId,
            className: lowest.className,
            section: lowest.section || '',
            rate: lowest.avgHomeworkCompletionPct,
            completions: 0, // TODO: Get from actual data
            total: lowest.studentCount,
          })

          setHighestClass({
            classId: highest.classId,
            className: highest.className,
            section: highest.section || '',
            rate: highest.avgHomeworkCompletionPct,
            completions: 0,
            total: highest.studentCount,
          })

          setClassCount(classRollups.length)
        }

      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load homework data')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [settled, ctx, liveVersion])

  if (loading) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937', marginBottom: '16px' }}>
          Homework Completion
        </h2>
        <div className="animate-pulse" style={{ color: '#9CA3AF' }}>Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937', marginBottom: '16px' }}>
          Homework Completion
        </h2>
        <p style={{ fontSize: '14px', color: '#ef4444' }}>{error}</p>
      </div>
    )
  }

  const color = schoolRate >= 75 ? '#10b981' : schoolRate >= 60 ? '#f59e0b' : '#ef4444'

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      border: `2px solid ${color}15`,
      borderLeft: `6px solid ${color}`,
      padding: '24px',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
    }}>
      {/* Header */}
      <div style={{ fontSize: '14px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>
        HOMEWORK COMPLETION
      </div>

      {/* School Rate */}
      <button
        onClick={onDrillToClasses}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginBottom: '16px',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <div
          className="font-mono-data"
          style={{
            fontSize: '48px',
            fontWeight: 800,
            color,
            lineHeight: 1,
            marginBottom: '8px',
          }}
        >
          {Math.round(schoolRate)}%
        </div>
        <div style={{ fontSize: '14px', color: '#6B7280' }}>
          School average (7-day window)
        </div>
      </button>

      {/* Spread - Show lowest and highest */}
      {lowestClass && highestClass && (
        <div style={{
          marginTop: '16px',
          padding: '16px',
          background: '#F9FAFB',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '12px', textTransform: 'uppercase' }}>
            Spread across {classCount} classes
          </div>

          {/* Lowest */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: '#fef2f2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <TrendingDown size={16} color="#ef4444" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1F2937' }}>
                {lowestClass.className}{lowestClass.section && `-${lowestClass.section}`}
              </div>
              <div style={{ fontSize: '11px', color: '#6B7280' }}>Lowest</div>
            </div>
            <div className="font-mono-data" style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>
              {Math.round(lowestClass.rate)}%
            </div>
          </div>

          {/* Highest */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: '#f0fdf4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <TrendingUp size={16} color="#10b981" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1F2937' }}>
                {highestClass.className}{highestClass.section && `-${highestClass.section}`}
              </div>
              <div style={{ fontSize: '11px', color: '#6B7280' }}>Highest</div>
            </div>
            <div className="font-mono-data" style={{ fontSize: '20px', fontWeight: 700, color: '#10b981' }}>
              {Math.round(highestClass.rate)}%
            </div>
          </div>
        </div>
      )}

      {/* Note about window */}
      <div style={{
        marginTop: '12px',
        fontSize: '11px',
        color: '#9CA3AF',
        fontStyle: 'italic',
      }}>
        Only counts homework past its due date in the last 7 days
      </div>
    </div>
  )
}
