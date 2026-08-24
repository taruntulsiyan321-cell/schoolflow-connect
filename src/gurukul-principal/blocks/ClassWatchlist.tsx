import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnalyticsService, useAcademicLive } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { tokens, attendanceColor, homeworkColor } from '../design-tokens'
import { Loader2 } from 'lucide-react'

interface WatchlistItem {
  classId: string
  className: string
  section: string
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
          // Low attendance (<75%)
          if (cls.avgAttendancePct < 75) {
            flagged.push({
              classId: cls.classId,
              className: cls.className,
              section: cls.section || '',
              metric: 'attendance',
              value: cls.avgAttendancePct,
            })
          }

          // Low homework (<60%)
          if (cls.avgHomeworkCompletionPct < 60) {
            flagged.push({
              classId: cls.classId,
              className: cls.className,
              section: cls.section || '',
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
          setError(err instanceof Error ? err.message : 'Failed to compute watchlist')
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
                {item.className}{item.section && `-${item.section}`}
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
