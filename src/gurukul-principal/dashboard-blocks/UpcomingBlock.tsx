import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { Calendar, ClipboardList, AlertTriangle } from 'lucide-react'

/**
 * Upcoming Block (§5.D)
 *
 * Shows two lists:
 * 1. Next exams and events from academics calendar (date, class/section, subject)
 * 2. Exam marks not yet uploaded (which class-subject combinations are outstanding, days overdue)
 *
 * This is a pointer into Academics, not a calendar widget.
 * Limit to next 5 items for exams/events, top 5 overdue for marks.
 */

interface UpcomingExam {
  id: string
  date: string
  className: string
  section: string
  subject: string
  type: 'exam' | 'test' | 'event'
  daysAway: number
}

interface OverdueMarks {
  id: string
  examName: string
  className: string
  section: string
  subject: string
  examDate: string
  daysOverdue: number
}

export function UpcomingBlock() {
  const { school } = useAuth()
  const [loading, setLoading] = useState(true)
  const [upcomingItems, setUpcomingItems] = useState<UpcomingExam[]>([])
  const [overdueMarks, setOverdueMarks] = useState<OverdueMarks[]>([])

  useEffect(() => {
    if (!school?.id) return

    let cancelled = false

    ;(async () => {
      setLoading(true)

      try {
        const now = new Date()

        // 1. Load upcoming exams/tests (next 30 days)
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 30)

        const { data: exams } = await supabase
          .from('exams')
          .select('id, exam_date, exam_name, class_id, subject_id, classes(class_name, section), subjects(subject_name)')
          .eq('school_id', school.id)
          .gte('exam_date', now.toISOString().split('T')[0])
          .lte('exam_date', futureDate.toISOString().split('T')[0])
          .order('exam_date', { ascending: true })
          .limit(5)

        if (cancelled) return

        const upcoming: UpcomingExam[] = []
        exams?.forEach((exam: any) => {
          const examDate = new Date(exam.exam_date)
          const daysAway = Math.ceil((examDate.getTime() - now.getTime()) / 86400000)

          upcoming.push({
            id: exam.id,
            date: exam.exam_date,
            className: exam.classes?.class_name || 'Unknown',
            section: exam.classes?.section || '',
            subject: exam.subjects?.subject_name || exam.exam_name,
            type: 'exam',
            daysAway,
          })
        })

        setUpcomingItems(upcoming)

        // 2. Load exams with marks not uploaded (past exams without results)
        const pastDate = new Date()
        pastDate.setDate(pastDate.getDate() - 60) // Look back 60 days

        const { data: pastExams } = await supabase
          .from('exams')
          .select(`
            id,
            exam_name,
            exam_date,
            class_id,
            subject_id,
            classes(class_name, section),
            subjects(subject_name),
            exam_results(id)
          `)
          .eq('school_id', school.id)
          .lt('exam_date', now.toISOString().split('T')[0])
          .gte('exam_date', pastDate.toISOString().split('T')[0])
          .order('exam_date', { ascending: false })

        if (cancelled) return

        const overdue: OverdueMarks[] = []
        pastExams?.forEach((exam: any) => {
          // If no results uploaded for this exam
          if (!exam.exam_results || exam.exam_results.length === 0) {
            const examDate = new Date(exam.exam_date)
            const daysOverdue = Math.floor((now.getTime() - examDate.getTime()) / 86400000)

            overdue.push({
              id: exam.id,
              examName: exam.exam_name,
              className: exam.classes?.class_name || 'Unknown',
              section: exam.classes?.section || '',
              subject: exam.subjects?.subject_name || '',
              examDate: exam.exam_date,
              daysOverdue,
            })
          }
        })

        // Sort by days overdue (most urgent first) and limit to 5
        overdue.sort((a, b) => b.daysOverdue - a.daysOverdue)
        setOverdueMarks(overdue.slice(0, 5))

      } catch (error) {
        console.error('Failed to load upcoming items:', error)
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
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937', marginBottom: '16px' }}>
          Upcoming
        </h2>
        <div className="animate-pulse" style={{ color: '#9CA3AF' }}>Loading...</div>
      </div>
    )
  }

  // Empty state - both lists empty
  if (upcomingItems.length === 0 && overdueMarks.length === 0) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        border: '1px solid #e5e7eb',
      }}>
        <div style={{ fontSize: '14px', color: '#6B7280', textAlign: 'center' }}>
          No upcoming exams or pending marks
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
    }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937', marginBottom: '20px' }}>
        Upcoming
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Next Exams/Events */}
        {upcomingItems.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Calendar size={16} color="#6B7280" />
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                NEXT EXAMS
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {upcomingItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '12px',
                    background: '#F9FAFB',
                    borderRadius: '8px',
                    borderLeft: `3px solid ${item.daysAway <= 3 ? '#f59e0b' : '#3b82f6'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
                        {item.className}{item.section && `-${item.section}`} • {item.subject}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>
                        {new Date(item.date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: item.daysAway <= 3 ? '#f59e0b' : '#6B7280',
                      background: item.daysAway <= 3 ? '#fef3c7' : '#F3F4F6',
                      padding: '4px 8px',
                      borderRadius: '4px',
                    }}>
                      {item.daysAway === 0 ? 'Today' : item.daysAway === 1 ? 'Tomorrow' : `${item.daysAway}d away`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Marks Not Uploaded */}
        {overdueMarks.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <AlertTriangle size={16} color="#ef4444" />
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                MARKS NOT UPLOADED
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {overdueMarks.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '12px',
                    background: '#fef2f2',
                    borderRadius: '8px',
                    borderLeft: '3px solid #ef4444',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
                        {item.className}{item.section && `-${item.section}`} • {item.subject}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>
                        {item.examName} • Exam: {new Date(item.examDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric'
                        })}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#ef4444',
                      background: '#fee2e2',
                      padding: '4px 8px',
                      borderRadius: '4px',
                    }}>
                      {item.daysOverdue}d overdue
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
