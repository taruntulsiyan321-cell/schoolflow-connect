import { useState, useEffect } from 'react'
import { AnalyticsService, useAcademicLive } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface ClassHomework {
  classId: string
  className: string
  section: string
  rate: number
}

interface HomeworkBlockProps {
  onDrillToClasses: () => void
}

export function HomeworkCompletionBlock({ onDrillToClasses }: HomeworkBlockProps) {
  const { ctx, settled } = useAcademicContext()
  const liveVersion = useAcademicLive(['homework'])

  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [schoolRate, setSchoolRate] = useState(0)
  const [lowestClass, setLowestClass] = useState<ClassHomework | null>(null)
  const [highestClass, setHighestClass] = useState<ClassHomework | null>(null)

  useEffect(() => {
    if (!settled || !ctx) return

    let cancelled = false

    ;(async () => {
      setLoading(true)

      try {
        const [school, classRollups] = await Promise.all([
          AnalyticsService.forSchool(ctx),
          AnalyticsService.classRollups(ctx),
        ])

        if (cancelled) return

        setSchoolRate(school.avgHomeworkCompletionPct)

        if (classRollups.length > 0) {
          const sorted = [...classRollups].sort((a, b) => a.avgHomeworkCompletionPct - b.avgHomeworkCompletionPct)

          setLowestClass({
            classId: sorted[0].classId,
            className: sorted[0].className,
            section: sorted[0].section || '',
            rate: sorted[0].avgHomeworkCompletionPct,
          })

          setHighestClass({
            classId: sorted[sorted.length - 1].classId,
            className: sorted[sorted.length - 1].className,
            section: sorted[sorted.length - 1].section || '',
            rate: sorted[sorted.length - 1].avgHomeworkCompletionPct,
          })
        }

      } catch (error) {
        console.error('Failed to load homework data:', error)
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
        borderRadius: '8px',
        padding: '16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          HOMEWORK COMPLETION
        </div>
        {/* Skeleton */}
        <div className="animate-pulse" style={{ height: '60px', background: '#F3F4F6', borderRadius: '6px' }} />
      </div>
    )
  }

  // Fix 2: Only red for real problems, neutral when below threshold but not critical
  const color = schoolRate >= 75 ? '#10b981' : schoolRate >= 60 ? '#1F2937' : '#ef4444'

  // Compact collapsed state
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '16px 20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
          border: `2px solid ${color}15`,
          borderLeft: `4px solid ${color}`,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = `0 4px 12px ${color}30`
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              HOMEWORK COMPLETION
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <div className="font-mono-data" style={{ fontSize: '36px', fontWeight: 700, color, lineHeight: 1 }}>
                {Math.round(schoolRate)}%
              </div>
              <div style={{ fontSize: '13px', color: '#6B7280', fontWeight: 500 }}>7-day average</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <ChevronDown size={20} color="#9CA3AF" />
            <div style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 500 }}>Click to expand</div>
          </div>
        </div>
      </button>
    )
  }

  // Expanded state
  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      border: `2px solid ${color}15`,
      borderLeft: `4px solid ${color}`,
    }}>
      <button
        onClick={() => setExpanded(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          marginBottom: '12px',
          padding: 0,
        }}
      >
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', marginBottom: '4px' }}>
            HOMEWORK COMPLETION (7-DAY)
          </div>
          <div className="font-mono-data" style={{ fontSize: '28px', fontWeight: 700, color }}>
            {Math.round(schoolRate)}%
          </div>
        </div>
        <ChevronUp size={18} color="#9CA3AF" />
      </button>

      {/* Spread */}
      {lowestClass && highestClass && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={onDrillToClasses}
            style={{
              padding: '8px',
              background: '#fef2f2',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1F2937' }}>
                {lowestClass.className}{lowestClass.section && `-${lowestClass.section}`}
              </div>
              <div className="font-mono-data" style={{ fontSize: '16px', fontWeight: 700, color: '#ef4444' }}>
                {Math.round(lowestClass.rate)}%
              </div>
            </div>
            <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>Lowest</div>
          </button>

          <button
            onClick={onDrillToClasses}
            style={{
              padding: '8px',
              background: '#f0fdf4',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1F2937' }}>
                {highestClass.className}{highestClass.section && `-${highestClass.section}`}
              </div>
              <div className="font-mono-data" style={{ fontSize: '16px', fontWeight: 700, color: '#10b981' }}>
                {Math.round(highestClass.rate)}%
              </div>
            </div>
            <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>Highest</div>
          </button>
        </div>
      )}
    </div>
  )
}
