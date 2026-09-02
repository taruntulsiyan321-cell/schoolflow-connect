import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { tokens } from '../design-tokens'
import { Loader2 } from 'lucide-react'
import { marksOverdue } from '@/academic/metrics/marks'
import { valueOr } from '@/academic/metrics/types'

interface AcademicEvent {
  id: string
  title: string
  event_date: string
  event_type: string
  class_id?: string | null
  class_name?: string
  section?: string
  subject?: string
}

export function AcademicsAhead() {
  const navigate = useNavigate()
  const { school } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<AcademicEvent[]>([])
  const [upcomingExams, setUpcomingExams] = useState<
    { id: string; date: string; label: string; className: string }[]
  >([])
  const [overdue, setOverdue] = useState<
    { id: string; label: string; missing: number; daysOverdue: number }[]
  >([])
  const [overdueBasis, setOverdueBasis] = useState<string>('')

  useEffect(() => {
    if (!school?.id) {
      setLoading(false)
      return
    }

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)

      try {
        const today = new Date().toISOString().split('T')[0]

        // Real table is `school_calendar_events`; there is no `school_events`.
        // Its date column is `starts_at` (timestamptz), not `event_date`.
        const { data, error: eventsErr } = await supabase
          .from('school_calendar_events')
          .select('id, title, starts_at, event_type, class_id')
          .eq('school_id', school.id)
          .gte('starts_at', today)
          .order('starts_at', { ascending: true })
          .limit(5)

        if (eventsErr) throw eventsErr
        if (cancelled) return

        setEvents(
          (data ?? []).map((e) => ({
            id: e.id,
            title: e.title,
            event_date: e.starts_at,
            event_type: String(e.event_type),
            class_id: e.class_id,
          })),
        )

        // ── CHUNK 10.6: ported from UpcomingBlock before deleting it ────────
        //
        // The dashboard spec asks this block for "upcoming exams and overdue
        // marks". It was showing calendar events only. UpcomingBlock, on the
        // superseded dashboard, had both — and could not have shown either:
        //
        //   exam_results          no such table
        //   exams.exam_name       no such column (it is `name`)
        //   classes.class_name    no such column (it is `name`)
        //   subjects.subject_name no such column
        //
        // Four identifiers, four wrong. Dark since 9980c05, so it has never run
        // against this schema and would throw on every load. The INTENT ports;
        // the code could not.
        const todayKey = new Date().toISOString().slice(0, 10);
        const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
        const back60 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

        const [soon, past] = await Promise.all([
          supabase
            .from('exams')
            .select('id, name, exam_date, subject, class_id, classes(name, section)')
            .eq('school_id', school.id)
            .gte('exam_date', todayKey)
            .lte('exam_date', in30)
            .order('exam_date', { ascending: true })
            .limit(3),
          supabase
            .from('exams')
            .select('id, name, exam_date, class_id, classes(name, section)')
            .eq('school_id', school.id)
            .lt('exam_date', todayKey)
            .gte('exam_date', back60)
            .order('exam_date', { ascending: false })
            .limit(10),
        ])
        if (cancelled) return

        setUpcomingExams(
          (soon.data ?? []).map((e) => ({
            id: e.id,
            date: e.exam_date ?? '',
            label: [e.subject, e.name].filter(Boolean).join(' — ') || 'Exam',
            className: [(e.classes as { name?: string } | null)?.name,
                        (e.classes as { section?: string } | null)?.section]
                        .filter(Boolean).join('-'),
          })),
        )

        // Overdue = a past exam whose marks are not fully entered. `expected` is
        // the roll of the exam's class; `entered` is the marks actually there.
        // marksOverdue() decides what counts as overdue, so this screen cannot
        // disagree with any other about MARKS_OVERDUE.
        const pastIds = (past.data ?? []).map((e) => e.id)
        const classIds = [...new Set((past.data ?? []).map((e) => e.class_id).filter(Boolean))]
        const [markRows, rollRows] = await Promise.all([
          pastIds.length
            ? supabase.from('marks').select('exam_id').in('exam_id', pastIds)
            : Promise.resolve({ data: [] as { exam_id: string }[] }),
          classIds.length
            ? supabase.from('students').select('id, class_id')
                .eq('school_id', school.id).in('class_id', classIds as string[])
            : Promise.resolve({ data: [] as { id: string; class_id: string }[] }),
        ])
        if (cancelled) return

        const enteredByExam = new Map<string, number>()
        for (const m of markRows.data ?? []) {
          enteredByExam.set(m.exam_id, (enteredByExam.get(m.exam_id) ?? 0) + 1)
        }
        const rollByClass = new Map<string, number>()
        for (const s of rollRows.data ?? []) {
          // A student with no class_id cannot be counted toward any class roll.
          // Without this the map gains a null key, and the expected count for
          // every exam is measured against a roll that includes students who
          // belong to no class — inflating "marks missing" for all of them.
          if (!s.class_id) continue
          rollByClass.set(s.class_id, (rollByClass.get(s.class_id) ?? 0) + 1)
        }

        const overdueMetric = marksOverdue(
          (past.data ?? []).map((e) => ({
            examId: e.id,
            examDate: e.exam_date ?? null,
            expected: rollByClass.get(e.class_id ?? '') ?? 0,
            entered: enteredByExam.get(e.id) ?? 0,
          })),
          todayKey,
        )
        const nameByExam = new Map(
          (past.data ?? []).map((e) => [
            e.id,
            [e.name, [(e.classes as { name?: string } | null)?.name,
                      (e.classes as { section?: string } | null)?.section]
                      .filter(Boolean).join('-')].filter(Boolean).join(' · '),
          ]),
        )
        setOverdue(
          valueOr(overdueMetric, []).slice(0, 3).map((o) => ({
            id: o.examId,
            label: nameByExam.get(o.examId) ?? 'Exam',
            missing: o.missing,
            daysOverdue: o.daysSince,
          })),
        )
        setOverdueBasis(overdueMetric.basis)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load calendar')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [school?.id])

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
          Academics Ahead
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
          Academics Ahead
        </h2>
        <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.accent }}>{error}</p>
      </div>
    )
  }

  // All three groups, not just events. The block now carries overdue marks and
  // upcoming exams too, and an empty-state that only counted calendar events
  // would hide an overdue-marks list behind "nothing scheduled".
  const isEmpty = events.length === 0 && upcomingExams.length === 0 && overdue.length === 0

  if (isEmpty) {
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
          margin: `0 0 ${tokens.space.md}`,
        }}>
          Academics Ahead
        </h2>
        <p style={{
          fontSize: tokens.fontSize.body,
          color: tokens.color.inkMuted,
          margin: 0,
        }}>
          No upcoming exams or events
        </p>
      </div>
    )
  }

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
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
        Academics Ahead
      </h2>

      {/* Ported from UpcomingBlock: the spec asks this block for upcoming exams
          and overdue marks, and it was showing calendar events alone. */}
      {overdue.length > 0 && (
        <div style={{ marginBottom: tokens.space.lg }}>
          <p style={{
            fontSize: tokens.fontSize.label,
            fontWeight: tokens.fontWeight.semibold,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: tokens.color.accent,
            margin: `0 0 ${tokens.space.sm}`,
          }}>
            Marks overdue
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
            {overdue.map((o) => (
              <button
                key={o.id}
                onClick={() => navigate('/principal/exams')}
                style={{
                  background: 'none',
                  border: `1px solid ${tokens.color.accent}30`,
                  borderRadius: tokens.radius.sm,
                  padding: `${tokens.space.sm} ${tokens.space.md}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: tokens.fontSize.body,
                  color: tokens.color.ink,
                }}
              >
                {o.label} — {o.missing} mark{o.missing === 1 ? '' : 's'} missing,{' '}
                {o.daysOverdue} day{o.daysOverdue === 1 ? '' : 's'} on
              </button>
            ))}
          </div>
          {/* The basis says which exams could not be aged for want of a date. */}
          {overdueBasis.includes('no exam_date') && (
            <p style={{
              fontSize: tokens.fontSize.small,
              color: tokens.color.inkMuted,
              margin: `${tokens.space.xs} 0 0`,
            }}>
              {overdueBasis}
            </p>
          )}
        </div>
      )}

      {upcomingExams.length > 0 && (
        <div style={{ marginBottom: tokens.space.lg }}>
          <p style={{
            fontSize: tokens.fontSize.label,
            fontWeight: tokens.fontWeight.semibold,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: tokens.color.inkMuted,
            margin: `0 0 ${tokens.space.sm}`,
          }}>
            Exams ahead
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
            {upcomingExams.map((x) => (
              <button
                key={x.id}
                onClick={() => navigate('/principal/exams')}
                style={{
                  background: 'none',
                  border: `1px solid ${tokens.color.border}`,
                  borderRadius: tokens.radius.sm,
                  padding: `${tokens.space.sm} ${tokens.space.md}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: tokens.fontSize.body,
                  color: tokens.color.ink,
                }}
              >
                {formatDate(x.date)} · {x.label}
                {x.className ? ` · ${x.className}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.md }}>
        {events.map((event) => (
          <button
            key={event.id}
            onClick={() => navigate('/principal/exams')}
            style={{
              background: 'none',
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.sm,
              padding: `${tokens.space.sm} ${tokens.space.md}`,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = tokens.color.borderSubtle
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.md }}>
              <div style={{
                fontSize: tokens.fontSize.label,
                fontWeight: tokens.fontWeight.bold,
                color: tokens.color.ink,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatDate(event.event_date)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: tokens.fontSize.body,
                  fontWeight: tokens.fontWeight.medium,
                  color: tokens.color.ink,
                }}>
                  {event.title}
                </div>
                {event.class_name && (
                  <div style={{
                    fontSize: tokens.fontSize.small,
                    color: tokens.color.inkMuted,
                    marginTop: tokens.space.xs,
                  }}>
                    {event.class_name}{event.section && `-${event.section}`}
                    {event.subject && ` • ${event.subject}`}
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
