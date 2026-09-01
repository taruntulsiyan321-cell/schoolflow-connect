import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { UserX, ChevronDown, ChevronUp } from 'lucide-react'
import { ATTENDANCE_LOW } from '@/academic/metrics/thresholds'
import { studentAttendance } from '@/academic/metrics/attendance'
import { valueOr } from '@/academic/metrics/types'

interface ChronicAbsentee {
  studentId: string
  studentName: string
  className: string
  section: string
  attendancePct: number
}

/**
 * CHUNK 10. This was `const CHRONIC_THRESHOLD = 75` — the FOURTH site declaring
 * an attendance threshold, at a fourth number, after NeedsAttentionBlock (75),
 * ClassWatchlist (75) and design-tokens (75), against a module that says 80.
 *
 * And "chronic" is not a second threshold. It was 80 over the year while
 * ATTENDANCE_LOW is 80 over the reporting window — which, since terms were
 * dropped, IS the year. One number, one period. "Chronic absentee" is a
 * PRESENTATION of "below the attendance threshold", so it presents that.
 */
const CHRONIC_THRESHOLD = ATTENDANCE_LOW

export function ChronicAbsenteesBlock() {
  const { school } = useAuth()
  const { ctx, settled } = useAcademicContext()
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [students, setStudents] = useState<ChronicAbsentee[]>([])

  useEffect(() => {
    if (!school?.id || !settled || !ctx) return

    let cancelled = false

    ;(async () => {
      setLoading(true)

      try {
        const { data: studentData } = await supabase
          .from('students')
          .select(`
            id,
            full_name,
            class_id,
            classes(name, section)
          `)
          .eq('school_id', school.id)
          .eq('status', 'active')
          .limit(50)

        if (cancelled) return

        const chronicList: ChronicAbsentee[] = []

        for (const student of studentData || []) {
          const { data: attendanceRecords } = await supabase
            .from('attendance')
            .select('status')
            .eq('student_id', student.id)
            .limit(50)

          if (cancelled) return

          if (attendanceRecords && attendanceRecords.length > 0) {
            const presentDays = attendanceRecords.filter(r => r.status === 'present').length
            // studentAttendance, not a local division: one definition of
            // "present ÷ marked", and it returns not_marked rather than 0% when
            // the register is empty. The length > 0 guard above stops the NaN;
            // the STATE is what keeps an unmarked student off a list headed
            // "chronic absentee".
            const attendancePct = valueOr(
              studentAttendance({
                studentId: student.id,
                present: presentDays,
                total: attendanceRecords.length,
              }),
              null,
            )

            if (attendancePct !== null && attendancePct < CHRONIC_THRESHOLD) {
              chronicList.push({
                studentId: student.id,
                studentName: student.full_name,
                // Column is `name`, not `class_name`; `section` is real.
                className: student.classes?.name || 'Unknown',
                section: student.classes?.section || '',
                attendancePct,
              })
            }
          }
        }

        chronicList.sort((a, b) => a.attendancePct - b.attendancePct)
        setStudents(chronicList.slice(0, 5))

      } catch (error) {
        console.error('Failed to load chronic absentees:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [school?.id, settled, ctx])

  if (loading) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}>
        <div className="animate-pulse" style={{ fontSize: '13px', color: '#9CA3AF' }}>Loading...</div>
      </div>
    )
  }

  if (students.length === 0) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        border: '1px solid #d1fae5',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#10b981' }}>
          ✓ No chronic absentees
        </div>
      </div>
    )
  }

  // Compact
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '16px 20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
          border: '2px solid #fef2f2',
          borderLeft: '4px solid #dc2626',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(220,38,38,0.15)'
          e.currentTarget.style.borderColor = '#fee2e2'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)'
          e.currentTarget.style.borderColor = '#fef2f2'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
            <div style={{
              background: '#dc2626',
              color: 'white',
              fontSize: '12px',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '12px',
              minWidth: '28px',
              textAlign: 'center',
              boxShadow: '0 2px 4px rgba(220,38,38,0.3)',
            }}>
              {students.length}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
                Chronic Absentees
              </div>
              <div style={{ fontSize: '12px', color: '#6B7280' }}>
                Below {CHRONIC_THRESHOLD}% attendance
              </div>
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

  // Expanded
  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      border: '2px solid #fef2f2',
      borderLeft: '4px solid #dc2626',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: '#dc2626',
            color: 'white',
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: '10px',
          }}>
            {students.length}
          </div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', margin: 0 }}>
            Chronic Absentees
          </h3>
        </div>
        <ChevronUp size={18} color="#9CA3AF" />
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {students.map((student) => {
          // Severity shades WITHIN the threshold, not thresholds: every student
          // in this list is already below ATTENDANCE_LOW, and these only decide
          // how red the row is. Named so they are not read as a second rule.
          const SEVERE = 50
          const VERY_LOW = 65
          const color = student.attendancePct < SEVERE ? '#dc2626' : student.attendancePct < VERY_LOW ? '#ef4444' : '#f59e0b'

          return (
            <button
              key={student.studentId}
              onClick={() => console.log('View student:', student.studentId)}
              style={{
                padding: '12px',
                background: '#F9FAFB',
                borderRadius: '8px',
                borderLeft: `4px solid ${color}`,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${color}10`
                e.currentTarget.style.transform = 'translateX(4px)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#F9FAFB'
                e.currentTarget.style.transform = 'translateX(0)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: `${color}20`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <UserX size={18} color={color} />
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
                    {student.studentName}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    {student.className}{student.section && `-${student.section}`}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <div className="font-mono-data" style={{ fontSize: '18px', fontWeight: 700, color }}>
                    {student.attendancePct.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 500 }}>
                    View profile →
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
