import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnalyticsService, useAcademicLive } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { tokens, attendanceColor, homeworkColor } from '../design-tokens'
import { Loader2 } from 'lucide-react'
import { ATTENDANCE_LOW, HOMEWORK_LOW } from '@/academic/metrics/thresholds'
import { toClassLabel, toErrorMessage } from '@/lib/presentation';

interface WatchlistItem {
  classId: string
  /**
   * CHUNK 10.7. Was two fields, className and section, both typed string
   * while classes.name and classes.section are nullable — and section was
   * being filled with `cls.section || ""`. One resolved label instead: the
   * render already concatenated the two, so the screen never had a reason
   * to hold the halves.
   */
  classLabel: string
  metric: 'attendance' | 'homework' | 'unmarked'
  value: number | null
}

export function ClassWatchlist() {
  const navigate = useNavigate()
  const { ctx, settled } = useAcademicContext()
  const liveVersion = useAcademicLive(['attendance', 'homework'])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<WatchlistItem[]>([])

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
        const classRollups = await AnalyticsService.classRollups(ctx)
        if (cancelled) return

        const flagged: WatchlistItem[] = []

        classRollups.forEach((cls) => {
          // Chunk 10. Two changes here, and the second is the load-bearing one.
          //
          // The literals are gone: this flagged attendance below 75 while the
          // thresholds module says 80, so a class at 77% was fine on this screen
          // and flagged on every other one.
          //
          // And the null check is now explicit. These fields became
          // `number | null`, null meaning no_data or not_marked — and in
          // JavaScript `null < 75` is TRUE, because null coerces to 0. Without
          // this guard a class nobody had marked would appear in the watchlist
          // as the worst attendance in the school. That is the same defect the
          // school average had, one level down: absence of a record read as a
          // record of absence.
          if (cls.avgAttendancePct !== null && cls.avgAttendancePct < ATTENDANCE_LOW) {
            flagged.push({
              classId: cls.classId,
              classLabel: toClassLabel(cls.className, cls.section),
              metric: 'attendance',
              value: cls.avgAttendancePct,
            })
          }

          if (cls.avgHomeworkCompletionPct !== null && cls.avgHomeworkCompletionPct < HOMEWORK_LOW) {
            flagged.push({
              classId: cls.classId,
              classLabel: toClassLabel(cls.className, cls.section),
              metric: 'homework',
              value: cls.avgHomeworkCompletionPct,
            })
          }
        })

        // Sort by value (lowest first), cap at 5
        flagged.sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
        setItems(flagged.slice(0, 5))
      } catch (err) {
        if (!cancelled) {
          setError(toErrorMessage(err, 'Failed to compute watchlist'))
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
          Class Watchlist
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
          Class Watchlist
        </h2>
        <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.accent }}>{error}</p>
      </div>
    )
  }

  const isEmpty = items.length === 0

  if (isEmpty) {
    return (
      <div style={{
        background: 'white',
        border: `1px solid ${tokens.color.positive}20`,
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
          Class Watchlist
        </h2>
        <p style={{
          fontSize: tokens.fontSize.body,
          fontWeight: tokens.fontWeight.medium,
          color: tokens.color.positive,
          margin: 0,
        }}>
          ✓ All classes performing normally
        </p>
      </div>
    )
  }

  const getColor = (item: WatchlistItem): string => {
    if (item.metric === 'attendance') return attendanceColor(item.value ?? 0)
    if (item.metric === 'homework') return homeworkColor(item.value ?? 0)
    return tokens.color.accent
  }

  const getLabel = (metric: string): string => {
    if (metric === 'attendance') return 'Attendance'
    if (metric === 'homework') return 'Homework'
    return 'Not marked'
  }

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
        Class Watchlist
      </h2>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: `${tokens.space.sm} ${tokens.space.md}`,
        fontSize: tokens.fontSize.body,
      }}>
        {items.map((item) => {
          const color = getColor(item)
          return (
            <button
              key={`${item.classId}-${item.metric}`}
              onClick={() => navigate(`/principal/classes/${item.classId}`)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: tokens.space.sm,
                borderRadius: tokens.radius.sm,
                transition: 'background 0.2s ease',
                display: 'contents',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${color}05`
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none'
              }}
            >
              <span style={{ fontWeight: tokens.fontWeight.medium, color: tokens.color.ink, textAlign: 'left' }}>
                {item.classLabel}
              </span>
              <span style={{ color: tokens.color.inkMuted, fontSize: tokens.fontSize.small }}>
                {getLabel(item.metric)}
              </span>
              <span style={{
                fontFamily: tokens.font.display,
                fontWeight: tokens.fontWeight.bold,
                color,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {item.value !== null ? `${Math.round(item.value)}%` : '—'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
