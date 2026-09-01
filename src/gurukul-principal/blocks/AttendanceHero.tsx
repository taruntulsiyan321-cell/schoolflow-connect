import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AttendanceService, useAcademicLive } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { localDateKey } from '@/lib/localDate'
import { tokens, attendanceColor } from '../design-tokens'
import { Loader2 } from 'lucide-react'
import { schoolAttendanceToday } from '@/academic/metrics/attendance'
import { valueOr } from '@/academic/metrics/types'

interface UnmarkedClass {
  classId: string
  className: string
  section: string
  subject: string
  period: number
  teacherName?: string
}

export function AttendanceHero() {
  const navigate = useNavigate()
  const { ctx, settled } = useAcademicContext()
  const liveVersion = useAcademicLive(['attendance'])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // null = not_marked / no_data. NOT 0: a register nobody filled in is not a
  // school where nobody attended, and this is the headline figure on the
  // principal's landing page.
  const [presentPct, setPresentPct] = useState<number | null>(null)
  const [basis, setBasis] = useState<string>('')
  const [presentCount, setPresentCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [unmarked, setUnmarked] = useState<UnmarkedClass[]>([])

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
        // AnalyticsService.forSchool was fetched only for studentCount, which
        // was the WRONG denominator — the roster rather than the sections that
        // submitted. The round trip goes with it.
        const today = await AttendanceService.summarizeSchoolDate(ctx, localDateKey())

        if (cancelled) return

        // CHUNK 10. Two defects lived in these ten lines, and on screen they
        // contradicted each other while nothing noticed.
        //
        // 1. `today?.overallDayRatePct ?? 0` rendered 0% on a day nobody had
        //    marked. And overallDayRatePct itself divides present by the WHOLE
        //    ROSTER rather than by the sections that submitted, so a day where
        //    one of three sections had marked read as a third of the truth.
        //    §10: "present ÷ students in sections that submitted".
        //
        // 2. setUnmarked([]) sat behind a TODO, so `allMarked` was ALWAYS true
        //    and the block always printed "✓ All classes marked attendance
        //    today" — a reassurance that could not fail, sitting directly under
        //    a 0%. G14: a control that cannot fail is not a control.
        const byClass = today?.classes ?? []
        const m = schoolAttendanceToday(
          byClass.map((c) => ({
            sectionId: c.classId,
            submitted: c.marked > 0,
            present: c.present,
            enrolled: c.totalStudents,
          })),
        )

        const submitted = byClass.filter((c) => c.marked > 0)
        setPresentPct(valueOr(m, null))
        setBasis(m.basis)
        setPresentCount(submitted.reduce((a, c) => a + c.present, 0))
        setTotalCount(submitted.reduce((a, c) => a + c.totalStudents, 0))

        // The real unmarked list, from the same rows the figure came from.
        setUnmarked(
          byClass
            .filter((c) => c.marked === 0)
            .map((c) => ({
              classId: c.classId,
              className: c.className,
              section: c.section ?? '',
              subject: '',
              period: 0,
            })),
        )
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

  if (loading) {
    return (
      <div style={{
        background: tokens.color.ground,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.xxl,
        textAlign: 'center',
      }}>
        <Loader2 className="animate-spin" size={32} color={tokens.color.inkMuted} style={{ margin: '0 auto' }} />
        <p style={{ marginTop: tokens.space.md, fontSize: tokens.fontSize.small, color: tokens.color.inkMuted }}>
          Loading attendance...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        background: tokens.color.ground,
        border: `2px solid ${tokens.color.accent}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.xxl,
        textAlign: 'center',
      }}>
        <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.accent, fontWeight: tokens.fontWeight.medium }}>
          {error}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: tokens.space.lg,
            padding: `${tokens.space.sm} ${tokens.space.lg}`,
            background: tokens.color.accent,
            color: 'white',
            border: 'none',
            borderRadius: tokens.radius.sm,
            fontSize: tokens.fontSize.label,
            fontWeight: tokens.fontWeight.semibold,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  const color = attendanceColor(presentPct)
  const allMarked = unmarked.length === 0

  return (
    <div style={{
      background: 'white',
      border: `2px solid ${color}20`,
      borderLeft: `6px solid ${color}`,
      borderRadius: tokens.radius.lg,
      padding: tokens.space.xxl,
    }}>
      {/* Title */}
      <h2 style={{
        fontSize: tokens.fontSize.blockTitle,
        fontWeight: tokens.fontWeight.semibold,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: tokens.color.inkMuted,
        margin: 0,
        marginBottom: tokens.space.lg,
      }}>
        Today's Attendance
      </h2>

      {/* Hero Percentage */}
      <button
        onClick={() => navigate('/principal/attendance')}
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
          fontSize: tokens.fontSize.hero,
          fontWeight: tokens.fontWeight.bold,
          color,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {presentPct === null ? '—' : `${presentPct}%`}
        </div>
        <p style={{
          fontSize: tokens.fontSize.metric,
          fontWeight: tokens.fontWeight.medium,
          color: tokens.color.ink,
          margin: `${tokens.space.sm} 0 0`,
        }}>
          PRESENT
        </p>
        <p style={{
          fontSize: tokens.fontSize.body,
          color: tokens.color.inkMuted,
          margin: `${tokens.space.xs} 0 0`,
        }}>
          {presentPct === null ? basis : `${presentCount} of ${totalCount} students in sections that submitted`}
        </p>
      </button>

      {/* Unmarked Classes */}
      {!allMarked && (
        <div style={{
          marginTop: tokens.space.xl,
          padding: tokens.space.lg,
          background: `${tokens.color.accent}05`,
          border: `1px solid ${tokens.color.accent}20`,
          borderRadius: tokens.radius.md,
        }}>
          <p style={{
            fontSize: tokens.fontSize.label,
            fontWeight: tokens.fontWeight.semibold,
            color: tokens.color.accent,
            margin: `0 0 ${tokens.space.md}`,
          }}>
            {unmarked.length} class{unmarked.length !== 1 ? 'es' : ''} not yet marked:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
            {unmarked.map((u, i) => (
              <button
                key={i}
                onClick={() => navigate(`/principal/classes/${u.classId}`)}
                style={{
                  background: 'white',
                  border: `1px solid ${tokens.color.border}`,
                  borderRadius: tokens.radius.sm,
                  padding: `${tokens.space.sm} ${tokens.space.md}`,
                  fontSize: tokens.fontSize.body,
                  color: tokens.color.ink,
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.space.xs,
                }}
              >
                {/*
                  Subject and period are not known at this level — the summary is
                  per SECTION per day, not per period. They used to be rendered
                  unconditionally and printed "• • Period 0" beside every class.
                  A separator with nothing on either side of it is a field the
                  screen is claiming to have and does not.
                */}
                <span style={{ fontWeight: tokens.fontWeight.medium }}>
                  {u.className}{u.section ? `-${u.section}` : ''}
                </span>
                {u.subject ? (
                  <>
                    <span style={{ color: tokens.color.inkMuted }}>•</span>
                    <span>{u.subject}</span>
                  </>
                ) : null}
                <span style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted }}>
                  {u.period > 0 ? `Period ${u.period}` : ''}
                </span>
                {u.teacherName && (
                  <>
                    <span style={{ color: tokens.color.inkMuted }}>•</span>
                    <span style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted }}>
                      {u.teacherName}
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {allMarked && (
        <div style={{
          marginTop: tokens.space.xl,
          padding: tokens.space.lg,
          background: `${tokens.color.positive}05`,
          border: `1px solid ${tokens.color.positive}20`,
          borderRadius: tokens.radius.md,
          textAlign: 'center',
        }}>
          <p style={{
            fontSize: tokens.fontSize.body,
            fontWeight: tokens.fontWeight.medium,
            color: tokens.color.positive,
            margin: 0,
          }}>
            ✓ All classes marked attendance today
          </p>
        </div>
      )}
    </div>
  )
}
