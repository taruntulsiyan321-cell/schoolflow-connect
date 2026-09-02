/**
 * CHUNK 10.6 — ported from ChronicAbsenteesBlock before deleting it.
 *
 * The dashboard spec asks for a chronic-absentee list. The live dashboard had no
 * counterpart: ClassWatchlist flags CLASSES below the threshold, and a principal
 * cannot act on a class. This is the student-level list, which is the one that
 * names who to call.
 *
 * TWO THINGS CHANGED IN THE PORT.
 *
 * The name. §10.8's neighbour ruling: "chronic absentee" is a PRESENTATION of
 * "below the attendance threshold", not a second threshold — the old block
 * declared CHRONIC_THRESHOLD = 75 against a module that says 80, the fourth site
 * to hold its own attendance number. The heading says what the list is.
 *
 * The never-marked. The old block loaded 50 attendance rows per student in a
 * loop and divided; a student with no rows was skipped by a length check, which
 * happened to be right for the wrong reason. belowAttendanceThreshold returns
 * them SEPARATELY, because "nobody has marked this child" is a different message
 * to a principal than "this child is absent", and the second is a thing to say
 * to a parent.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { tokens, attendanceColor } from '../design-tokens'
import { Loader2 } from 'lucide-react'
import { belowAttendanceThreshold } from '@/academic/metrics/attendance'
import { ATTENDANCE_LOW } from '@/academic/metrics/thresholds'
import { isOk } from '@/academic/metrics/types'

interface Row {
  studentId: string
  name: string
  className: string
  pct: number
}

export function BelowAttendanceThreshold() {
  const navigate = useNavigate()
  const { school } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [neverMarked, setNeverMarked] = useState(0)
  const [basis, setBasis] = useState('')

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
        // The profile carries attendance_present / attendance_total already, so
        // this is one query rather than the old block's one-per-student loop.
        const { data, error: err } = await supabase
          .from('student_academic_profiles')
          .select('student_id, attendance_present, attendance_total, students!inner(full_name, class_id, classes(name, section))')
          .eq('school_id', school.id)
          .limit(2000)
        if (err) throw err
        if (cancelled) return

        const list = (data ?? []) as Record<string, unknown>[]
        const metric = belowAttendanceThreshold(
          list.map((r) => ({
            studentId: String(r.student_id),
            present: Number(r.attendance_present ?? 0),
            total: Number(r.attendance_total ?? 0),
          })),
        )
        setBasis(metric.basis)
        if (!isOk(metric)) {
          setRows([])
          setNeverMarked(0)
          return
        }

        const byId = new Map(
          list.map((r) => {
            const s = r.students as
              | { full_name?: string; classes?: { name?: string; section?: string } | null }
              | null
            return [
              String(r.student_id),
              {
                name: s?.full_name ?? 'Unknown',
                className: [s?.classes?.name, s?.classes?.section].filter(Boolean).join('-'),
              },
            ] as const
          }),
        )

        setRows(
          metric.value.below.slice(0, 5).map((b) => ({
            studentId: b.studentId,
            name: byId.get(b.studentId)?.name ?? 'Unknown',
            className: byId.get(b.studentId)?.className ?? '',
            pct: b.pct,
          })),
        )
        setNeverMarked(metric.value.neverMarked.length)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load attendance')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [school?.id])

  const shell = (children: React.ReactNode) => (
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
        Below {ATTENDANCE_LOW}% attendance
      </h2>
      {children}
    </div>
  )

  if (loading) return shell(<Loader2 className="animate-spin" size={20} color={tokens.color.inkMuted} />)
  if (error) {
    return shell(
      <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.accent }}>{error}</p>,
    )
  }

  return shell(
    <>
      {rows.length === 0 ? (
        <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.positive, margin: 0 }}>
          ✓ No student below {ATTENDANCE_LOW}%
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
          {rows.map((r) => (
            <button
              key={r.studentId}
              onClick={() => navigate(`/principal/students/${r.studentId}`)}
              style={{
                background: 'none',
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.sm,
                padding: `${tokens.space.sm} ${tokens.space.md}`,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                justifyContent: 'space-between',
                gap: tokens.space.md,
                fontSize: tokens.fontSize.body,
                color: tokens.color.ink,
              }}
            >
              <span>{r.name}{r.className ? ` · ${r.className}` : ''}</span>
              <span style={{ color: attendanceColor(r.pct), fontVariantNumeric: 'tabular-nums' }}>
                {r.pct}%
              </span>
            </button>
          ))}
        </div>
      )}

      {/*
        Never-marked students are shown SEPARATELY and never inside the list
        above. They are not below the threshold — nobody has said anything about
        them, and putting them under a heading that names a percentage is the
        same lie the school average was telling before Chunk 10.
      */}
      {neverMarked > 0 && (
        <p style={{
          fontSize: tokens.fontSize.small,
          color: tokens.color.inkMuted,
          margin: `${tokens.space.md} 0 0`,
        }}>
          {neverMarked} student{neverMarked === 1 ? ' has' : 's have'} no attendance marked at all —
          not counted above.
        </p>
      )}
      {basis && (
        <p style={{
          fontSize: tokens.fontSize.small,
          color: tokens.color.inkMuted,
          margin: `${tokens.space.xs} 0 0`,
        }}>
          {basis}
        </p>
      )}
    </>,
  )
}
