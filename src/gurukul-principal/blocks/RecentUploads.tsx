import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { tokens, timeAgo } from '../design-tokens'
import { Loader2 } from 'lucide-react'
import { toErrorMessage } from '@/lib/presentation'

interface Upload {
  id: string
  teacherName: string
  className: string
  section?: string
  subject: string
  uploadedAt: string
}

export function RecentUploads() {
  const navigate = useNavigate()
  const { school } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])

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
        // Query test_marks or examination_marks for recent uploads
        // Join with teacher, class, subject data
        // This is a simplified query - adjust based on actual schema

        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

        // Real chain is marks -> exams -> classes. There is no `test_marks` or
        // `tests` table; `subject` and `class_id` live on `exams`, and the
        // uploading teacher is the exam's `created_by`.
        const { data, error: marksErr } = await supabase
          .from('marks')
          .select(`
            id,
            created_at,
            exams(subject, created_by, classes(name, section))
          `)
          .eq('school_id', school.id)
          .gte('created_at', sevenDaysAgo.toISOString())
          .order('created_at', { ascending: false })
          .limit(5)

        if (marksErr) throw marksErr
        if (cancelled) return

        const transformed: Upload[] = (data || []).map((row: any) => ({
          id: row.id,
          teacherName: row.exams?.created_by ? 'Teacher' : 'Unknown Teacher',
          className: row.exams?.classes?.name || 'Unknown Class',
          section: row.exams?.classes?.section ?? undefined,
          subject: row.exams?.subject || 'Unknown Subject',
          uploadedAt: row.created_at,
        }))

        setUploads(transformed)
      } catch (err) {
        if (!cancelled) {
          setError(toErrorMessage(err, 'Failed to load uploads'))
        }
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
          Recent Marks Uploaded
        </h2>
        <Loader2 className="animate-spin" size={20} color={tokens.color.inkMuted} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        background: 'white',
        border: `1px solid ${tokens.color.accent}20`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.xl,
      }}>
        <h2 style={{
          fontSize: tokens.fontSize.blockTitle,
          fontWeight: tokens.fontWeight.semibold,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: tokens.color.inkMuted,
          margin: `0 0 ${tokens.space.md}`,
        }}>
          Recent Marks Uploaded
        </h2>
        <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.accent }}>{error}</p>
      </div>
    )
  }

  const isEmpty = uploads.length === 0

  if (isEmpty) {
    return (
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
          margin: `0 0 ${tokens.space.md}`,
        }}>
          Recent Marks Uploaded
        </h2>
        <p style={{
          fontSize: tokens.fontSize.body,
          color: tokens.color.inkMuted,
          margin: 0,
        }}>
          No marks uploaded in the last 7 days
        </p>
      </div>
    )
  }

  return (
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
        Recent Marks Uploaded
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
        {uploads.map((upload) => (
          <button
            key={upload.id}
            onClick={() => navigate('/principal/students')}
            style={{
              background: 'none',
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.sm,
              padding: `${tokens.space.sm} ${tokens.space.md}`,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = tokens.color.borderSubtle
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
            }}
          >
            <div>
              <div style={{
                fontSize: tokens.fontSize.body,
                fontWeight: tokens.fontWeight.medium,
                color: tokens.color.ink,
              }}>
                {upload.teacherName}
              </div>
              <div style={{
                fontSize: tokens.fontSize.small,
                color: tokens.color.inkMuted,
                marginTop: tokens.space.xs,
              }}>
                {upload.className}{upload.section && `-${upload.section}`} • {upload.subject}
              </div>
            </div>
            <div style={{
              fontSize: tokens.fontSize.small,
              color: tokens.color.inkMuted,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {timeAgo(upload.uploadedAt)}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
