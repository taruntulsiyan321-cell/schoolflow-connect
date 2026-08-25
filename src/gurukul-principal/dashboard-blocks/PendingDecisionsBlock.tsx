import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { Clock, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react'

/**
 * Pending Decisions Block (§5.B) - COMPACT VERSION
 *
 * Collapsed by default: shows compact summary
 * Expand to see full list and take actions
 */

interface PendingItem {
  id: string
  type: 'leave' | 'complaint' | 'inquiry' | 'message'
  title: string
  who: string
  waitingDays: number
  createdAt: string
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
  const [expanded, setExpanded] = useState(false)

  const load = async () => {
    if (!school?.id) return

    setLoading(true)
    const allItems: PendingItem[] = []

    try {
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
        borderRadius: '8px',
        padding: '16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          PENDING DECISIONS
        </div>
        {/* Skeleton */}
        <div className="animate-pulse" style={{ height: '60px', background: '#F3F4F6', borderRadius: '6px' }} />
      </div>
    )
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        border: '1px solid #d1fae5',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#10b981' }}>
          ✓ Nothing pending
        </div>
      </div>
    )
  }

  // Compact collapsed state
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
          borderLeft: '4px solid #ef4444',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(239,68,68,0.15)'
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
              background: '#ef4444',
              color: 'white',
              fontSize: '12px',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '12px',
              minWidth: '28px',
              textAlign: 'center',
              boxShadow: '0 2px 4px rgba(239,68,68,0.3)',
            }}>
              {items.length}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
                Pending Decisions
              </div>
              <div style={{ fontSize: '12px', color: '#6B7280' }}>
                {items.filter(i => i.type === 'leave').length} leaves • {items.filter(i => i.type === 'complaint').length} complaints • {items.filter(i => i.type === 'inquiry').length} inquiries
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

  // Expanded state
  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      border: '2px solid #fef2f2',
      borderLeft: '4px solid #ef4444',
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
            background: '#ef4444',
            color: 'white',
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: '10px',
          }}>
            {items.length}
          </div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', margin: 0 }}>
            Pending Decisions
          </h3>
        </div>
        <ChevronUp size={18} color="#9CA3AF" />
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              padding: '10px',
              background: '#F9FAFB',
              borderRadius: '6px',
              borderLeft: `3px solid ${item.waitingDays > 2 ? '#ef4444' : '#f59e0b'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1F2937' }}>
                  {item.title} • {item.who}
                </div>
                {item.type === 'leave' && (
                  <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
                    {item.startDate} to {item.endDate}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#9CA3AF', flexShrink: 0, marginLeft: '8px' }}>
                <Clock size={10} />
                {item.waitingDays}d
              </div>
            </div>

            {item.type === 'leave' && (
              <>
                {showRejectField === item.id && (
                  <input
                    type="text"
                    placeholder="Reason for rejection"
                    value={rejectReason[item.id] || ''}
                    onChange={(e) => setRejectReason({ ...rejectReason, [item.id]: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      border: '1px solid #D1D5DB',
                      borderRadius: '4px',
                      fontSize: '12px',
                      marginBottom: '6px',
                    }}
                    autoFocus
                  />
                )}

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => approveLeave(item.id)}
                    disabled={processingId === item.id}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: processingId === item.id ? 'not-allowed' : 'pointer',
                      opacity: processingId === item.id ? 0.6 : 1,
                    }}
                  >
                    ✓ Approve
                  </button>

                  {showRejectField === item.id ? (
                    <>
                      <button
                        onClick={() => rejectLeave(item.id)}
                        disabled={processingId === item.id}
                        style={{
                          flex: 1,
                          padding: '6px 12px',
                          background: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: processingId === item.id ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => {
                          setShowRejectField(null)
                          setRejectReason({ ...rejectReason, [item.id]: '' })
                        }}
                        style={{
                          padding: '6px 12px',
                          background: '#F3F4F6',
                          color: '#6B7280',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '11px',
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
                        padding: '6px 12px',
                        background: '#F3F4F6',
                        color: '#1F2937',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      × Reject
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Fix 2 & 5: Remove blue buttons, use neutral "View" for non-leaves */}
            {item.type !== 'leave' && (
              <button
                style={{
                  padding: '6px 12px',
                  background: 'white',
                  color: '#1F2937',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: '100%',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#F3F4F6'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'white'
                }}
              >
                View
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
