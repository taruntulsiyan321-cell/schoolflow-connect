import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { ChevronDown, ChevronUp, Calendar, AlertTriangle } from 'lucide-react'

interface UpcomingExam {
  id: string
  date: string
  className: string
  section: string
  subject: string
  daysAway: number
}

interface OverdueMarks {
  id: string
  examName: string
  className: string
  section: string
  daysOverdue: number
}

export function UpcomingBlock() {
  const { school } = useAuth()
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [upcomingItems, setUpcomingItems] = useState<UpcomingExam[]>([])
  const [overdueMarks, setOverdueMarks] = useState<OverdueMarks[]>([])

  useEffect(() => {
    if (!school?.id) return

    let cancelled = false

    ;(async () => {
      setLoading(true)

      try {
        const now = new Date()
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 30)

        const { data: exams } = await supabase
          .from('exams')
          .select('id, exam_date, exam_name, class_id, subject_id, classes(class_name, section), subjects(subject_name)')
          .eq('school_id', school.id)
          .gte('exam_date', now.toISOString().split('T')[0])
          .lte('exam_date', futureDate.toISOString().split('T')[0])
          .order('exam_date', { ascending: true })
          .limit(3)

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
            daysAway,
          })
        })

        setUpcomingItems(upcoming)

        // Load overdue marks
        const pastDate = new Date()
        pastDate.setDate(pastDate.getDate() - 60)

        const { data: pastExams } = await supabase
          .from('exams')
          .select(`
            id,
            exam_name,
            exam_date,
            classes(class_name, section),
            exam_results(id)
          `)
          .eq('school_id', school.id)
          .lt('exam_date', now.toISOString().split('T')[0])
          .gte('exam_date', pastDate.toISOString().split('T')[0])
          .order('exam_date', { ascending: false })
          .limit(3)

        if (cancelled) return

        const overdue: OverdueMarks[] = []
        pastExams?.forEach((exam: any) => {
          if (!exam.exam_results || exam.exam_results.length === 0) {
            const examDate = new Date(exam.exam_date)
            const daysOverdue = Math.floor((now.getTime() - examDate.getTime()) / 86400000)

            overdue.push({
              id: exam.id,
              examName: exam.exam_name,
              className: exam.classes?.class_name || 'Unknown',
              section: exam.classes?.section || '',
              daysOverdue,
            })
          }
        })

        setOverdueMarks(overdue)

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
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}>
        <div className="animate-pulse" style={{ fontSize: '13px', color: '#9CA3AF' }}>Loading...</div>
      </div>
    )
  }

  if (upcomingItems.length === 0 && overdueMarks.length === 0) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        border: '1px solid #e5e7eb',
      }}>
        <div style={{ fontSize: '13px', color: '#6B7280' }}>
          No upcoming exams or pending marks
        </div>
      </div>
    )
  }

  // Compact collapsed
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '12px 16px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          border: '2px solid #f3f4f6',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', marginBottom: '4px' }}>
              UPCOMING
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1F2937' }}>
              {upcomingItems.length} exams{overdueMarks.length > 0 && `, ${overdueMarks.length} marks pending`}
            </div>
          </div>
          <ChevronDown size={18} color="#9CA3AF" />
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
      border: '2px solid #f3f4f6',
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
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', margin: 0 }}>
          Upcoming
        </h3>
        <ChevronUp size={18} color="#9CA3AF" />
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {upcomingItems.length > 0 && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase' }}>
              Next Exams
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {upcomingItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '8px',
                    background: '#F9FAFB',
                    borderRadius: '6px',
                    borderLeft: `3px solid ${item.daysAway <= 3 ? '#f59e0b' : '#3b82f6'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1F2937' }}>
                        {item.className}{item.section && `-${item.section}`} • {item.subject}
                      </div>
                      <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                        {new Date(item.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: item.daysAway <= 3 ? '#f59e0b' : '#6B7280',
                      background: item.daysAway <= 3 ? '#fef3c7' : '#F3F4F6',
                      padding: '3px 6px',
                      borderRadius: '3px',
                    }}>
                      {item.daysAway === 0 ? 'Today' : item.daysAway === 1 ? 'Tomorrow' : `${item.daysAway}d`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {overdueMarks.length > 0 && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#ef4444', marginBottom: '6px', textTransform: 'uppercase' }}>
              Marks Not Uploaded
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {overdueMarks.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '8px',
                    background: '#fef2f2',
                    borderRadius: '6px',
                    borderLeft: '3px solid #ef4444',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1F2937' }}>
                        {item.className}{item.section && `-${item.section}`}
                      </div>
                      <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                        {item.examName}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#ef4444',
                      background: '#fee2e2',
                      padding: '3px 6px',
                      borderRadius: '3px',
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
