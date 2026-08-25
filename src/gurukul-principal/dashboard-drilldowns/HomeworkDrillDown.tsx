import { useState, useEffect } from 'react'
import { AcademicProfileService } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { supabase } from '@/integrations/supabase/client'
import { CheckCircle, AlertCircle } from 'lucide-react'

/**
 * Homework Drill-Down (Fix 4)
 *
 * School → Class table (completion % over 7-day window)
 *        → Student list (EVERY student with completion %, missed-while-absent separate)
 */

interface ClassHomework {
  classId: string
  className: string
  section: string
  completion: number
  studentCount: number
}

interface StudentHomework {
  id: string
  name: string
  rollNumber: string | null
  completion: number
  missedWhileAbsent: number
}

interface HomeworkDrillDownProps {
  selectedClassId?: string
  selectedClassName?: string
  onClassClick: (classId: string, className: string) => void
}

const HOMEWORK_THRESHOLD = 60

export function HomeworkDrillDown({ selectedClassId, selectedClassName, onClassClick }: HomeworkDrillDownProps) {
  const { ctx, settled } = useAcademicContext()
  const [loading, setLoading] = useState(true)
  const [classes, setClasses] = useState<ClassHomework[]>([])
  const [students, setStudents] = useState<StudentHomework[]>([])

  useEffect(() => {
    if (!settled || !ctx) return

    let cancelled = false

    ;(async () => {
      setLoading(true)
      try {
        // Load all classes
        // `classes` exposes `name`; it has no class_name/section columns.
        const { data: classesData } = await supabase
          .from('classes')
          .select('id, name')
          .eq('school_id', ctx.schoolId)
          .order('name')

        if (cancelled) return

        // StudentAcademicProfile carries studentId but no classId, so the
        // student -> class mapping has to come from `students` itself.
        const { data: studentRows } = await supabase
          .from('students')
          .select('id, class_id')
          .eq('school_id', ctx.schoolId)

        if (cancelled) return

        const classOfStudent = new Map<string, string>()
        for (const s of studentRows ?? []) {
          if (s.class_id) classOfStudent.set(s.id, s.class_id)
        }

        // Load profiles for all students to get homework completion
        const profiles = await AcademicProfileService.listForSchool(ctx, { limit: 1000 })

        if (cancelled) return

        // Aggregate by class
        const classMap = new Map<string, { total: number; sum: number; count: number }>()

        profiles.forEach(profile => {
          const classId = classOfStudent.get(profile.studentId)
          // A student with no class yet contributes to no class average, rather
          // than being bucketed under a fabricated key.
          if (!classId) return
          if (!classMap.has(classId)) {
            classMap.set(classId, { total: 0, sum: 0, count: 0 })
          }
          const data = classMap.get(classId)!
          data.count++
          data.sum += profile.homeworkCompletionPct
        })

        const classHomework: ClassHomework[] = (classesData || []).map((cls: any) => {
          const data = classMap.get(cls.id)
          const completion = data ? Math.round(data.sum / data.count) : 0

          return {
            classId: cls.id,
            className: cls.name ?? 'Unknown',
            section: '',
            completion,
            studentCount: data?.count || 0,
          }
        })

        setClasses(classHomework)

      } catch (error) {
        console.error('Failed to load homework data:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [settled, ctx])

  // Load students for selected class
  useEffect(() => {
    if (!selectedClassId || !ctx || !settled) {
      setStudents([])
      return
    }

    let cancelled = false

    ;(async () => {
      try {
        // Load students
        const { data: studentsData } = await supabase
          .from('students')
          .select('id, full_name, roll_number')
          .eq('class_id', selectedClassId)
          .eq('status', 'active')
          .order('roll_number', { nullsFirst: false })

        if (cancelled) return

        // Load profiles
        const profiles = await AcademicProfileService.listForClass(ctx, selectedClassId, { limit: 200 })

        if (cancelled) return

        const studentHomework: StudentHomework[] = (studentsData || []).map((s: any) => {
          const profile = profiles.find(p => p.studentId === s.id)

          return {
            id: s.id,
            name: s.full_name,
            rollNumber: s.roll_number,
            completion: profile ? Math.round(profile.homeworkCompletionPct) : 0,
            missedWhileAbsent: 0, // TODO: Calculate missed-while-absent from homework records
          }
        })

        setStudents(studentHomework)

      } catch (error) {
        console.error('Failed to load student homework:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedClassId, ctx, settled])

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>
        Loading homework data...
      </div>
    )
  }

  // Student-level view
  if (selectedClassId && selectedClassName) {
    return (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937', marginBottom: '16px' }}>
          {selectedClassName} · Homework Completion
        </h3>

        {students.length === 0 ? (
          <div style={{
            padding: '40px',
            textAlign: 'center',
            color: '#9CA3AF',
          }}>
            No students found in this class
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
                    Roll
                  </th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
                    Student Name
                  </th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
                    Completion
                  </th>
                  <th style={{ textAlign: 'center', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {students.map((student, i) => {
                  const isBelowThreshold = student.completion < HOMEWORK_THRESHOLD
                  const color = isBelowThreshold ? '#ef4444' : (student.completion >= 80 ? '#10b981' : '#1F2937')

                  return (
                    <tr
                      key={student.id}
                      style={{
                        background: i % 2 === 0 ? 'transparent' : '#F9FAFB',
                      }}
                    >
                      <td style={{ padding: '12px 16px', fontSize: '13px', color: '#6B7280' }} className="font-mono-data">
                        {student.rollNumber || '—'}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
                        {student.name}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '16px', fontWeight: 700, textAlign: 'right', color }} className="font-mono-data">
                        {student.completion}%
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        {isBelowThreshold ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <AlertCircle size={14} color="#ef4444" />
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#ef4444' }}>
                              Below threshold
                            </span>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <CheckCircle size={14} color="#10b981" />
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#10b981' }}>
                              Good
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: '#F9FAFB',
          borderRadius: '6px',
          fontSize: '11px',
          color: '#6B7280',
          fontStyle: 'italic',
        }}>
          Note: Missed-while-absent assignments shown separately in individual student profiles
        </div>
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
            <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
              Students
            </th>
            <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
              Completion (7-day)
            </th>
          </tr>
        </thead>
        <tbody>
          {classes.map((cls, i) => {
            const className = `${cls.className}${cls.section ? `-${cls.section}` : ''}`
            const hasData = cls.studentCount > 0
            const color = !hasData ? '#9CA3AF' : (cls.completion >= 75 ? '#10b981' : cls.completion >= 60 ? '#1F2937' : '#ef4444')

            return (
              <tr
                key={cls.classId}
                onClick={() => hasData && onClassClick(cls.classId, className)}
                style={{
                  background: i % 2 === 0 ? 'transparent' : '#F9FAFB',
                  cursor: hasData ? 'pointer' : 'default',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (hasData) e.currentTarget.style.background = '#F3F4F6'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#F9FAFB'
                }}
              >
                <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
                  {className}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '13px', textAlign: 'right', color: '#6B7280' }} className="font-mono-data">
                  {cls.studentCount}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '16px', fontWeight: 700, textAlign: 'right', color }} className="font-mono-data">
                  {hasData ? `${cls.completion}%` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
