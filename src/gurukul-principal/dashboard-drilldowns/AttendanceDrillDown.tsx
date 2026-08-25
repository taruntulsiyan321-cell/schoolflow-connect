import { useState, useEffect } from 'react'
import { AttendanceService } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { localDateKey } from '@/lib/localDate'
import { supabase } from '@/integrations/supabase/client'
import { UserX, Users, CheckCircle } from 'lucide-react'

/**
 * Attendance Drill-Down (Fix 4)
 *
 * School → Class table (%, present/total, marked/unmarked, teacher)
 *        → Student list (NAMED absent students for selected class)
 */

interface ClassAttendance {
  classId: string
  className: string
  section: string
  teacherName: string
  presentCount: number
  totalCount: number
  percentage: number
  marked: boolean
}

interface AbsentStudent {
  id: string
  name: string
  rollNumber: string | null
}

interface AttendanceDrillDownProps {
  selectedClassId?: string
  selectedClassName?: string
  onClassClick: (classId: string, className: string) => void
}

export function AttendanceDrillDown({ selectedClassId, selectedClassName, onClassClick }: AttendanceDrillDownProps) {
  const { ctx, settled } = useAcademicContext()
  const [loading, setLoading] = useState(true)
  const [classes, setClasses] = useState<ClassAttendance[]>([])
  const [absentStudents, setAbsentStudents] = useState<AbsentStudent[]>([])

  useEffect(() => {
    if (!settled || !ctx) return

    let cancelled = false

    ;(async () => {
      setLoading(true)
      try {
        const today = localDateKey()

        // Load all classes with their teachers
        const { data: classesData } = await supabase
          .from('classes')
          .select('id, class_name, section, class_teacher_id, users!classes_class_teacher_id_fkey(full_name)')
          .eq('school_id', ctx.schoolId)
          .order('class_name')

        if (cancelled) return

        // Load today's attendance for all classes
        const summary = await AttendanceService.summarizeSchoolDate(ctx, today)

        if (cancelled) return

        const classAttendance: ClassAttendance[] = (classesData || []).map((cls: any) => {
          // Find attendance data for this class from summary
          const classData = summary?.byClass?.find((c: any) => c.classId === cls.id)

          return {
            classId: cls.id,
            className: cls.class_name,
            section: cls.section || '',
            teacherName: cls.users?.full_name || 'No teacher assigned',
            presentCount: classData?.presentCount || 0,
            totalCount: classData?.totalCount || 0,
            percentage: classData?.totalCount > 0 ? Math.round((classData.presentCount / classData.totalCount) * 100) : 0,
            marked: !!classData,
          }
        })

        setClasses(classAttendance)

      } catch (error) {
        console.error('Failed to load attendance:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [settled, ctx])

  // Load absent students for selected class
  useEffect(() => {
    if (!selectedClassId || !ctx || !settled) {
      setAbsentStudents([])
      return
    }

    let cancelled = false

    ;(async () => {
      try {
        const today = localDateKey()
        const records = await AttendanceService.listForClassDate(ctx, selectedClassId, today)

        if (cancelled) return

        // Get student details for absent students
        const absentIds = records.filter(r => r.status === 'absent').map(r => r.studentId)

        if (absentIds.length > 0) {
          const { data: students } = await supabase
            .from('students')
            .select('id, full_name, roll_number')
            .in('id', absentIds)
            .order('roll_number', { nullsFirst: false })

          if (!cancelled) {
            setAbsentStudents((students || []).map((s: any) => ({
              id: s.id,
              name: s.full_name,
              rollNumber: s.roll_number,
            })))
          }
        } else {
          setAbsentStudents([])
        }

      } catch (error) {
        console.error('Failed to load absent students:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedClassId, ctx, settled])

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>
        Loading attendance data...
      </div>
    )
  }

  // Student-level view
  if (selectedClassId && selectedClassName) {
    return (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937', marginBottom: '16px' }}>
          {selectedClassName} · Absent Today
        </h3>

        {absentStudents.length === 0 ? (
          <div style={{
            padding: '40px',
            textAlign: 'center',
            background: '#f0fdf4',
            borderRadius: '8px',
            border: '1px solid #bbf7d0',
          }}>
            <CheckCircle size={32} color="#10b981" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#10b981', marginBottom: '4px' }}>
              Perfect Attendance!
            </div>
            <div style={{ fontSize: '13px', color: '#6B7280' }}>
              All students present today
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {absentStudents.map((student) => (
              <div
                key={student.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  background: '#fef2f2',
                  borderRadius: '8px',
                  border: '1px solid #fecaca',
                }}
              >
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: '#fee2e2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <UserX size={20} color="#ef4444" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
                    {student.name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>
                    Roll #{student.rollNumber || 'N/A'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Class-level view
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
              Class
            </th>
            <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
              Teacher
            </th>
            <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
              Present/Total
            </th>
            <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
              %
            </th>
            <th style={{ textAlign: 'center', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {classes.map((cls, i) => {
            const className = `${cls.className}${cls.section ? `-${cls.section}` : ''}`
            const color = !cls.marked ? '#9CA3AF' : (cls.percentage >= 90 ? '#10b981' : cls.percentage >= 75 ? '#f59e0b' : '#ef4444')

            return (
              <tr
                key={cls.classId}
                onClick={() => cls.marked && onClassClick(cls.classId, className)}
                style={{
                  background: i % 2 === 0 ? 'transparent' : '#F9FAFB',
                  cursor: cls.marked ? 'pointer' : 'default',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (cls.marked) e.currentTarget.style.background = '#F3F4F6'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#F9FAFB'
                }}
              >
                <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
                  {className}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', color: '#6B7280' }}>
                  {cls.teacherName}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', textAlign: 'right' }} className="font-mono-data">
                  {cls.marked ? `${cls.presentCount}/${cls.totalCount}` : '—'}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: 700, textAlign: 'right', color }} className="font-mono-data">
                  {cls.marked ? `${cls.percentage}%` : '—'}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                  {cls.marked ? (
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#10b981',
                      background: '#f0fdf4',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #bbf7d0',
                    }}>
                      MARKED
                    </span>
                  ) : (
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#f59e0b',
                      background: '#fef3c7',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #fde68a',
                    }}>
                      PENDING
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
