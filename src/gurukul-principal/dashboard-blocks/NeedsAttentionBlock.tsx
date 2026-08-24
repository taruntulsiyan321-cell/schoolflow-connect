import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { AttendanceService, AnalyticsService } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { localDateKey } from '@/lib/localDate'
import { AlertCircle, X } from 'lucide-react'

/**
 * Needs Attention Block (§5.E)
 *
 * Should be empty most days - only shows items that cross thresholds:
 * - Attendance below range (< 75%)
 * - Homework rate below range (< 60%)
 * - Attendance not marked (for classes that should have marked by now)
 * - Exam marks overdue (> 7 days past exam date)
 *
 * Each row shows: class, section, subject/student, reason, value
 * Cap at 6 rows (most urgent first)
 * Dismiss functionality: suppresses but doesn't delete, returns if worsens
 */

interface AttentionItem {
  id: string
  type: 'low-attendance' | 'low-homework' | 'unmarked-attendance' | 'marks-overdue'
  className: string
  section: string
  subject?: string
  studentName?: string
  reason: string
  value: string
  severity: number // Higher = more urgent
  // For dismiss tracking
  dismissedAt?: string
  dismissedValue?: number
}

const ATTENDANCE_THRESHOLD = 75
const HOMEWORK_THRESHOLD = 60
const MARKS_OVERDUE_DAYS = 7

export function NeedsAttentionBlock() {
  const { school, profile } = useAuth()
  const { ctx, settled } = useAcademicContext()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<AttentionItem[]>([])
  const [dismissedItems, setDismissedItems] = useState<Set<string>>(new Set())

  const load = async () => {
    if (!school?.id || !settled || !ctx) return

    setLoading(true)
    const allItems: AttentionItem[] = []

    try {
      // Load dismissed items from localStorage
      const dismissed = localStorage.getItem(`principal-dismissed-attention-${profile?.id}`)
      const dismissedMap = dismissed ? JSON.parse(dismissed) : {}
      const dismissedSet = new Set<string>()

      // 1. Check for low attendance classes
      const classRollups = await AnalyticsService.classRollups(ctx)

      classRollups.forEach((cls) => {
        const attendancePct = cls.avgAttendancePct || 0

        if (attendancePct < ATTENDANCE_THRESHOLD) {
          const itemId = `low-attendance-${cls.classId}`

          // Check if dismissed and if it has worsened
          if (dismissedMap[itemId]) {
            const dismissed = dismissedMap[itemId]
            const previousValue = dismissed.value

            // If it has worsened (gone lower), show it again
            if (attendancePct >= previousValue - 5) {
              dismissedSet.add(itemId)
              return // Still suppressed
            }
          }

          allItems.push({
            id: itemId,
            type: 'low-attendance',
            className: cls.className,
            section: cls.section || '',
            reason: 'Attendance below threshold',
            value: `${attendancePct.toFixed(1)}%`,
            severity: ATTENDANCE_THRESHOLD - attendancePct,
          })
        }
      })

      // 2. Check for low homework completion classes
      classRollups.forEach((cls) => {
        const homeworkPct = cls.avgHomeworkCompletionPct || 0

        if (homeworkPct < HOMEWORK_THRESHOLD) {
          const itemId = `low-homework-${cls.classId}`

          if (dismissedMap[itemId]) {
            const dismissed = dismissedMap[itemId]
            const previousValue = dismissed.value

            if (homeworkPct >= previousValue - 5) {
              dismissedSet.add(itemId)
              return
            }
          }

          allItems.push({
            id: itemId,
            type: 'low-homework',
            className: cls.className,
            section: cls.section || '',
            reason: 'Homework completion low',
            value: `${homeworkPct.toFixed(1)}%`,
            severity: HOMEWORK_THRESHOLD - homeworkPct,
          })
        }
      })

      // 3. Check for unmarked attendance (after 10 AM)
      const now = new Date()
      const currentHour = now.getHours()

      if (currentHour >= 10) {
        const today = localDateKey()
        const summary = await AttendanceService.summarizeSchoolDate(ctx, today)

        // TODO: Parse summary.byClass to find unmarked classes
        // For now, placeholder logic
        const totalClasses = 22 // TODO: Get from school data
        const markedCount = summary?.byClass ? Object.keys(summary.byClass).length : 0

        if (markedCount < totalClasses) {
          const unmarkedCount = totalClasses - markedCount

          allItems.push({
            id: 'unmarked-attendance-today',
            type: 'unmarked-attendance',
            className: 'Multiple',
            section: '',
            reason: 'Attendance not marked',
            value: `${unmarkedCount} classes`,
            severity: unmarkedCount * 2, // Higher multiplier for urgency
          })
        }
      }

      // 4. Check for overdue exam marks
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 60)

      const { data: overdueExams } = await supabase
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

      overdueExams?.forEach((exam: any) => {
        if (!exam.exam_results || exam.exam_results.length === 0) {
          const examDate = new Date(exam.exam_date)
          const daysOverdue = Math.floor((now.getTime() - examDate.getTime()) / 86400000)

          if (daysOverdue > MARKS_OVERDUE_DAYS) {
            const itemId = `marks-overdue-${exam.id}`

            if (dismissedMap[itemId]) {
              const dismissed = dismissedMap[itemId]
              const previousDays = dismissed.value

              // If not significantly worse, keep suppressed
              if (daysOverdue <= previousDays + 3) {
                dismissedSet.add(itemId)
                return
              }
            }

            allItems.push({
              id: itemId,
              type: 'marks-overdue',
              className: exam.classes?.class_name || 'Unknown',
              section: exam.classes?.section || '',
              subject: exam.subjects?.subject_name,
              reason: 'Exam marks not uploaded',
              value: `${daysOverdue}d overdue`,
              severity: daysOverdue,
            })
          }
        }
      })

      // Sort by severity (most urgent first) and cap at 6
      allItems.sort((a, b) => b.severity - a.severity)
      setItems(allItems.slice(0, 6))
      setDismissedItems(dismissedSet)

    } catch (error) {
      console.error('Failed to load attention items:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [school?.id, settled, ctx])

  const dismissItem = (item: AttentionItem) => {
    // Save to localStorage with current value
    const dismissed = localStorage.getItem(`principal-dismissed-attention-${profile?.id}`)
    const dismissedMap = dismissed ? JSON.parse(dismissed) : {}

    dismissedMap[item.id] = {
      dismissedAt: new Date().toISOString(),
      value: parseFloat(item.value) || 0,
    }

    localStorage.setItem(`principal-dismissed-attention-${profile?.id}`, JSON.stringify(dismissedMap))

    // Remove from current list
    setItems(items.filter(i => i.id !== item.id))
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
          Needs Attention
        </h2>
        <div className="animate-pulse" style={{ color: '#9CA3AF' }}>Loading...</div>
      </div>
    )
  }

  // Empty state - the ideal state
  if (items.length === 0) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        border: '1px solid #d1fae5',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#10b981', textAlign: 'center' }}>
          ✓ All clear — nothing needs immediate attention
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
      border: '2px solid #fef2f2',
      borderLeft: '6px solid #ef4444',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937' }}>
          Needs Attention
        </h2>
        <div style={{
          background: '#ef4444',
          color: 'white',
          fontSize: '12px',
          fontWeight: 700,
          padding: '4px 10px',
          borderRadius: '12px',
          minWidth: '24px',
          textAlign: 'center',
        }}>
          {items.length}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map((item) => {
          const bgColor = item.type === 'unmarked-attendance' || item.type === 'marks-overdue'
            ? '#fef2f2'
            : '#fefce8'
          const borderColor = item.type === 'unmarked-attendance' || item.type === 'marks-overdue'
            ? '#ef4444'
            : '#f59e0b'

          return (
            <div
              key={item.id}
              style={{
                padding: '12px',
                background: bgColor,
                borderRadius: '8px',
                borderLeft: `3px solid ${borderColor}`,
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <AlertCircle size={16} color={borderColor} style={{ marginTop: '2px', flexShrink: 0 }} />

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
                    {item.className}{item.section && `-${item.section}`}
                    {item.subject && ` • ${item.subject}`}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>
                    {item.reason}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: borderColor,
                  }}>
                    {item.value}
                  </div>

                  <button
                    onClick={() => dismissItem(item)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Dismiss (returns if worsens)"
                  >
                    <X size={16} color="#9CA3AF" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{
        marginTop: '12px',
        fontSize: '11px',
        color: '#9CA3AF',
        fontStyle: 'italic',
      }}>
        Dismissed items return if they worsen
      </div>
    </div>
  )
}
