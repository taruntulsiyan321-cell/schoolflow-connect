import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnalyticsService, useAcademicLive } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { tokens, homeworkColor } from '../design-tokens'
import { toPercentLabel } from '@/lib/presentation'
import { Loader2 } from 'lucide-react'

export function HomeworkBlock() {
  const navigate = useNavigate()
  const { ctx, settled } = useAcademicContext()
  const liveVersion = useAcademicLive(['homework'])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // CHUNK 10.7. Was useState(0): "not loaded yet" and "the school is at 0%"
  // were the same value, and homeworkColor(0) is the alert colour — so the block
  // rendered a confident red 0% before any data arrived.
  const [schoolAvg, setSchoolAvg] = useState<number | null>(null)
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

        // CHUNK 10.7. Unmeasured classes are EXCLUDED before sorting, not
        // sorted as zero. `null - null` is 0 and `null - 5` is -5, so a class
        // nobody had marked sorted to the front and was shown to the principal
        // as the school’s worst for homework — a named class ranked last on
        // the strength of never having been measured.
        //
        // The guard is on `measured`, not on `classRollups`: a school where no
        // class has been marked has no range to show, and showing one class as
        // both the best and the worst would be the same lie in another shape.
        const measured = classRollups.filter(
          (c): c is typeof c & { avgHomeworkCompletionPct: number } =>
            c.avgHomeworkCompletionPct !== null,
        )

        if (measured.length > 0) {
          const sorted = [...measured].sort((a, b) => a.avgHomeworkCompletionPct - b.avgHomeworkCompletionPct)
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
          {toPercentLabel(schoolAvg)}
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
              {toPercentLabel(lowest.pct)} ({lowest.className})
            </span> to <span style={{ fontWeight: tokens.fontWeight.semibold, color: tokens.color.positive }}>
              {toPercentLabel(highest.pct)} ({highest.className})
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
