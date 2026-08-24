import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { AnalyticsService } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { UserX, ExternalLink } from 'lucide-react'

/**
 * Chronic Absentees Block (§5.F)
 *
 * The only block that looks past today - shows students below
 * threshold across the term (typically < 75% attendance).
 *
 * Shows: Student name, class, attendance percentage
 * Taps through to student profile
 * Sorted by lowest attendance first
 * Limit to top 10 worst cases
 */

interface ChronicAbsentee {
  studentId: string
  studentName: string
  className: string
  section: string
  attendancePct: number
  totalDays: number
  presentDays: number
}

const CHRONIC_THRESHOLD = 75

export function ChronicAbsenteesBlock() {
  const { school } = useAuth()
  const { ctx, settled } = useAcademicContext()
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState<ChronicAbsentee[]>([])

  useEffect(() => {
    if (!school?.id || !settled || !ctx) return

    let cancelled = false

    ;(async () => {
      setLoading(true)

      try {
        // Get all students with their attendance data
        const { data: studentData } = await supabase
          .from('students')
          .select(`
            id,
            full_name,
            class_id,
            classes(class_name, section)
          `)
          .eq('school_id', school.id)
          .eq('status', 'active')

        if (cancelled) return

        const chronicList: ChronicAbsentee[] = []

        // For each student, compute their term attendance
        // TODO: Use actual attendance aggregation from AnalyticsService
        // For now, we'll use a placeholder calculation

        for (const student of studentData || []) {
          // Get student's attendance records
          const { data: attendanceRecords } = await supabase
            .from('attendance')
            .select('status, date')
            .eq('student_id', student.id)
            .order('date', { ascending: false })
            .limit(100) // Look at last 100 days

          if (cancelled) return

          if (attendanceRecords && attendanceRecords.length > 0) {
            const totalDays = attendanceRecords.length
            const presentDays = attendanceRecords.filter(r => r.status === 'present').length
            const attendancePct = (presentDays / totalDays) * 100

            // Only include if below threshold
            if (attendancePct < CHRONIC_THRESHOLD) {
              chronicList.push({
                studentId: student.id,
                studentName: student.full_name,
                className: student.classes?.class_name || 'Unknown',
                section: student.classes?.section || '',
                attendancePct,
                totalDays,
                presentDays,
              })
            }
          }
        }

        // Sort by lowest attendance first and limit to 10
        chronicList.sort((a, b) => a.attendancePct - b.attendancePct)
        setStudents(chronicList.slice(0, 10))

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

  const viewStudentProfile = (studentId: string) => {
    // TODO: Navigate to student profile or open modal
    console.log('View student profile:', studentId)
  }

  if (loading) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937', marginBottom: '16px' }}>
          Chronic Absentees
        </h2>
        <div className="animate-pulse" style={{ color: '#9CA3AF' }}>Loading...</div>
      </div>
    )
  }

  // Empty state - good news
  if (students.length === 0) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        border: '1px solid #d1fae5',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#10b981', textAlign: 'center' }}>
          ✓ No students below {CHRONIC_THRESHOLD}% attendance threshold
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      border: '2px solid #fef2f215',
      borderLeft: '6px solid #dc2626',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937' }}>
            Chronic Absentees
          </h2>
          <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
            Students below {CHRONIC_THRESHOLD}% attendance across the term
          </p>
        </div>
        <div style={{
          background: '#dc2626',
          color: 'white',
          fontSize: '12px',
          fontWeight: 700,
          padding: '4px 10px',
          borderRadius: '12px',
          minWidth: '24px',
          textAlign: 'center',
        }}>
          {students.length}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {students.map((student) => {
          const color = student.attendancePct < 50 ? '#dc2626' : student.attendancePct < 65 ? '#ef4444' : '#f59e0b'

          return (
            <button
              key={student.studentId}
              onClick={() => viewStudentProfile(student.studentId)}
              style={{
                padding: '12px',
                background: '#F9FAFB',
                borderRadius: '8px',
                borderLeft: `3px solid ${color}`,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#F3F4F6'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#F9FAFB'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: `${color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <UserX size={16} color={color} />
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
                    {student.studentName}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>
                    {student.className}{student.section && `-${student.section}`} • {student.presentDays}/{student.totalDays} days
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color,
                    fontFamily: 'monospace',
                  }}>
                    {student.attendancePct.toFixed(1)}%
                  </div>
                  <ExternalLink size={14} color="#9CA3AF" />
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {students.length === 10 && (
        <div style={{
          marginTop: '12px',
          fontSize: '11px',
          color: '#9CA3AF',
          fontStyle: 'italic',
          textAlign: 'center',
        }}>
          Showing top 10 students • More may exist below threshold
        </div>
      )}
    </div>
  )
}
