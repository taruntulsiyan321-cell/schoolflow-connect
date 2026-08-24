import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnalyticsService, useAcademicLive } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { tokens, homeworkColor } from '../design-tokens'
import { Loader2 } from 'lucide-react'

export function HomeworkBlock() {
  const navigate = useNavigate()
  const { ctx, settled } = useAcademicContext()
  const liveVersion = useAcademicLive(['homework'])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [schoolAvg, setSchoolAvg] = useState(0)
  const [lowest, setLowest] = useState<{ pct: number; className: string } | null>(null)
  const [highest, setHighest] = useState<{ pct: number; className: string } | null>(null)

  useEffect(() => {
    if (!settled || !ctx) {
      setLoading(false)
      return
    }

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)

      try {
        const [school, classRollups] = await Promise.all([
          AnalyticsService.forSchool(ctx),
          AnalyticsService.classRollups(ctx),
        ])

        if (cancelled) return

        setSchoolAvg(school.avgHomeworkCompletionPct)

        if (classRollups.length > 0) {
          const sorted = [...classRollups].sort((a, b) => a.avgHomeworkCompletionPct - b.avgHomeworkCompletionPct)
          setLowest({
            pct: sorted[0].avgHomeworkCompletionPct,
            className: `${sorted[0].className}${sorted[0].section ? `-${sorted[0].section}` : ''}`,
          })
          setHighest({
            pct: sorted[sorted.length - 1].avgHomeworkCompletionPct,
            className: `${sorted[sorted.length - 1].className}${sorted[sorted.length - 1].section ? `-${sorted[sorted.length - 1].section}` : ''}`,
          })
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
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.xl,
      }}>
        <h2 style={{
          fontSize: tokens.fontSize.blockTitle,
          fontWeight: tokens.fontWeight.semibold,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: tokens.color.inkMuted,
          margin: `0 0 ${tokens.space.lg}`,
        }}>
          Homework Completion
        </h2>
        <Loader2 className="animate-spin" size={20} color={tokens.color.inkMuted} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        background: 'white',
        border: `1px solid ${tokens.color.accent}20`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.xl,
      }}>
        <h2 style={{
          fontSize: tokens.fontSize.blockTitle,
          fontWeight: tokens.fontWeight.semibold,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: tokens.color.inkMuted,
          margin: `0 0 ${tokens.space.md}`,
        }}>
          Homework Completion
        </h2>
        <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.accent }}>{error}</p>
      </div>
    )
  }

  const color = homeworkColor(schoolAvg)

  return (
    <div style={{
      background: 'white',
      border: `1px solid ${tokens.color.border}`,
      borderRadius: tokens.radius.lg,
      padding: tokens.space.xl,
    }}>
      <h2 style={{
        fontSize: tokens.fontSize.blockTitle,
        fontWeight: tokens.fontWeight.semibold,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: tokens.color.inkMuted,
        margin: `0 0 ${tokens.space.lg}`,
      }}>
        Homework Completion
      </h2>

      <button
        onClick={() => navigate('/principal/analytics')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          display: 'block',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <div style={{
          fontFamily: tokens.font.display,
          fontSize: tokens.fontSize.metric,
          fontWeight: tokens.fontWeight.bold,
          color,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {Math.round(schoolAvg)}%
        </div>
        <p style={{
          fontSize: tokens.fontSize.body,
          color: tokens.color.inkMuted,
          margin: `${tokens.space.xs} 0 0`,
        }}>
          School average
        </p>
      </button>

      {lowest && highest && (
        <div style={{
          marginTop: tokens.space.lg,
          padding: tokens.space.md,
          background: tokens.color.borderSubtle,
          borderRadius: tokens.radius.sm,
        }}>
          <p style={{
            fontSize: tokens.fontSize.small,
            color: tokens.color.inkMuted,
            margin: 0,
          }}>
            Range: <span style={{ fontWeight: tokens.fontWeight.semibold, color: tokens.color.accent }}>
              {Math.round(lowest.pct)}% ({lowest.className})
            </span> to <span style={{ fontWeight: tokens.fontWeight.semibold, color: tokens.color.positive }}>
              {Math.round(highest.pct)}% ({highest.className})
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
