import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { Clock, CheckCircle, XCircle, MessageCircle } from 'lucide-react'

/**
 * Pending Decisions Block (§5.B)
 *
 * Four queues merged and sorted by age (oldest first):
 * - Leave requests (approve/reject INLINE with reason)
 * - Complaints
 * - Inquiries
 * - Unread message replies
 *
 * Collapses to one calm line when all empty.
 */

interface PendingItem {
  id: string
  type: 'leave' | 'complaint' | 'inquiry' | 'message'
  title: string
  who: string
  waitingDays: number
  createdAt: string
  // For leaves
  studentName?: string
  startDate?: string
  endDate?: string
  reason?: string
}

export function PendingDecisionsBlock() {
  const { school, profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<PendingItem[]>([])
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<{ [id: string]: string }>({})
  const [showRejectField, setShowRejectField] = useState<string | null>(null)

  const load = async () => {
    if (!school?.id) return

    setLoading(true)
    const allItems: PendingItem[] = []

    try {
      // 1. Leave requests
      const { data: leaves } = await supabase
        .from('leave_requests')
        .select('id, created_at, student_id, start_date, end_date, reason, students(full_name)')
        .eq('school_id', school.id)
        .eq('status', 'pending')

      leaves?.forEach((l: any) => {
        const daysWaiting = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000)
        allItems.push({
          id: l.id,
          type: 'leave',
          title: 'Leave request',
          who: l.students?.full_name || 'Unknown',
          waitingDays: daysWaiting,
          createdAt: l.created_at,
          studentName: l.students?.full_name,
          startDate: l.start_date,
          endDate: l.end_date,
          reason: l.reason,
        })
      })

      // 2. Complaints
      const { data: complaints } = await supabase
        .from('school_complaints')
        .select('id, created_at, complainant_name, subject')
        .eq('school_id', school.id)
        .in('status', ['open', 'in_progress'])

      complaints?.forEach((c: any) => {
        const daysWaiting = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
        allItems.push({
          id: c.id,
          type: 'complaint',
          title: c.subject,
          who: c.complainant_name,
          waitingDays: daysWaiting,
          createdAt: c.created_at,
        })
      })

      // 3. Inquiries
      const { data: inquiries } = await supabase
        .from('school_inquiries')
        .select('id, created_at, contact_name, grade_interest')
        .eq('school_id', school.id)
        .eq('status', 'open')

      inquiries?.forEach((i: any) => {
        const daysWaiting = Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000)
        allItems.push({
          id: i.id,
          type: 'inquiry',
          title: `Inquiry for Grade ${i.grade_interest || 'unknown'}`,
          who: i.contact_name,
          waitingDays: daysWaiting,
          createdAt: i.created_at,
        })
      })

      // TODO: 4. Unread message replies

      // Sort by age (oldest first)
      allItems.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      setItems(allItems)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [school?.id])

  const approveLeave = async (id: string) => {
    setProcessingId(id)
    try {
      await supabase
        .from('leave_requests')
        .update({
          status: 'approved',
          decided_by: profile?.id,
          decided_at: new Date().toISOString(),
        })
        .eq('id', id)

      // Remove from list immediately
      setItems(items.filter(i => i.id !== id))
    } catch (error) {
      console.error('Failed to approve leave:', error)
    } finally {
      setProcessingId(null)
    }
  }

  const rejectLeave = async (id: string) => {
    const reason = rejectReason[id]
    if (!reason?.trim()) {
      alert('Please provide a reason for rejection')
      return
    }

    setProcessingId(id)
    try {
      await supabase
        .from('leave_requests')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          decided_by: profile?.id,
          decided_at: new Date().toISOString(),
        })
        .eq('id', id)

      // Remove from list immediately
      setItems(items.filter(i => i.id !== id))
      setShowRejectField(null)
      setRejectReason({ ...rejectReason, [id]: '' })
    } catch (error) {
      console.error('Failed to reject leave:', error)
    } finally {
      setProcessingId(null)
    }
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
          Pending Decisions
        </h2>
        <div className="animate-pulse" style={{ color: '#9CA3AF' }}>Loading...</div>
      </div>
    )
  }

  // Empty state - collapse to one calm line
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
          ✓ Nothing pending
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937' }}>
          Pending Decisions
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              padding: '16px',
              background: '#F9FAFB',
              borderRadius: '8px',
              borderLeft: `3px solid ${item.waitingDays > 2 ? '#ef4444' : '#f59e0b'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937' }}>
                  {item.title}
                </div>
                <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>
                  {item.who}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#9CA3AF' }}>
                <Clock size={12} />
                {item.waitingDays}d
              </div>
            </div>

            {/* Leave request - show details and actions */}
            {item.type === 'leave' && (
              <>
                <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '12px' }}>
                  {item.startDate} to {item.endDate} • {item.reason}
                </div>

                {showRejectField === item.id ? (
                  <div style={{ marginBottom: '8px' }}>
                    <input
                      type="text"
                      placeholder="Reason for rejection"
                      value={rejectReason[item.id] || ''}
                      onChange={(e) => setRejectReason({ ...rejectReason, [item.id]: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '6px',
                        fontSize: '13px',
                        marginBottom: '8px',
                      }}
                      autoFocus
                    />
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => approveLeave(item.id)}
                    disabled={processingId === item.id}
                    style={{
                      flex: 1,
                      padding: '8px 16px',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: processingId === item.id ? 'not-allowed' : 'pointer',
                      opacity: processingId === item.id ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <CheckCircle size={14} />
                    Approve
                  </button>

                  {showRejectField === item.id ? (
                    <>
                      <button
                        onClick={() => rejectLeave(item.id)}
                        disabled={processingId === item.id}
                        style={{
                          flex: 1,
                          padding: '8px 16px',
                          background: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: processingId === item.id ? 'not-allowed' : 'pointer',
                          opacity: processingId === item.id ? 0.6 : 1,
                        }}
                      >
                        Confirm Reject
                      </button>
                      <button
                        onClick={() => {
                          setShowRejectField(null)
                          setRejectReason({ ...rejectReason, [item.id]: '' })
                        }}
                        style={{
                          padding: '8px 16px',
                          background: '#F3F4F6',
                          color: '#6B7280',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setShowRejectField(item.id)}
                      style={{
                        flex: 1,
                        padding: '8px 16px',
                        background: '#F3F4F6',
                        color: '#1F2937',
                        border: '1px solid #D1D5DB',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <XCircle size={14} />
                      Reject
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Other types - show view button */}
            {item.type !== 'leave' && (
              <button
                style={{
                  padding: '8px 16px',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                View {item.type}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
