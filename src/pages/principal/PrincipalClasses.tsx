/**
 * Classes List - Part D.1
 *
 * Shows classes (not individual sections).
 * Click a class → see section comparison.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { PALETTE, TYPE } from '@/gurukul-principal/shared/palette'
import { BookOpen } from 'lucide-react'

interface ClassGroup {
  className: string
  sectionsCount: number
  studentsTotal: number
}

export default function PrincipalClasses() {
  const navigate = useNavigate()
  const { school } = useAuth()
  const [classes, setClasses] = useState<ClassGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!school?.id) return

    const loadClasses = async () => {
      setLoading(true)

      try {
        const { data: sections } = await supabase
          .from('classes')
          .select('id, name, section')
          .eq('school_id', school.id)
          .order('name')
          .order('section')

        if (!sections || sections.length === 0) {
          setClasses([])
          setLoading(false)
          return
        }

        // Get student counts per section
        const sectionIds = sections.map(s => s.id)
        const { data: students } = await supabase
          .from('students')
          .select('id, class_id')
          .eq('school_id', school.id)
          .in('class_id', sectionIds)

        // Count students per section
        const studentCounts: Record<string, number> = {}
        students?.forEach(s => {
          // Second instance of this shape today — AcademicsAhead had the same
          // one. A student with no class_id would be counted under the literal
          // key "null", and a section that never existed would appear in the
          // roll. Skipped, not defaulted: they belong to no section, and adding
          // them to one would be inventing a fact.
          if (!s.class_id) return
          studentCounts[s.class_id] = (studentCounts[s.class_id] || 0) + 1
        })

        // Group sections by class name
        const grouped: Record<string, ClassGroup> = {}
        sections.forEach(section => {
          // classes.name is nullable. A section with no name cannot be grouped
          // under one — it would collide with every other unnamed section under
          // the key "null" and report their combined roll as a single class.
          const name = section.name
          if (!name) return
          if (!grouped[name]) {
            grouped[name] = {
              className: name,
              sectionsCount: 0,
              studentsTotal: 0,
            }
          }
          grouped[name].sectionsCount++
          grouped[name].studentsTotal += studentCounts[section.id] || 0
        })

        setClasses(Object.values(grouped))
      } catch (error) {
        console.error('Failed to load classes:', error)
      } finally {
        setLoading(false)
      }
    }

    loadClasses()
  }, [school?.id])

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: `3px solid ${PALETTE.border}`,
          borderTopColor: PALETTE.ink,
          borderRadius: '50%',
          margin: '0 auto',
          animation: 'spin 0.8s linear infinite'
        }} />
      </div>
    )
  }

  return (
    <div style={{ background: PALETTE.ground, minHeight: '100vh', padding: '16px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: PALETTE.ink, margin: 0, marginBottom: '8px' }}>
          Classes
        </h1>
        <div style={{ ...TYPE.rowSecondary }}>
          {classes.length} {classes.length === 1 ? 'class' : 'classes'}
        </div>
      </div>

      {classes.length === 0 ? (
        <div style={{
          background: PALETTE.surface,
          borderRadius: '8px',
          border: `1px solid ${PALETTE.border}`,
          padding: '40px',
          textAlign: 'center'
        }}>
          <div style={{ ...TYPE.rowSecondary }}>No classes found</div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px'
        }}>
          {classes.map((cls) => (
            <div
              key={cls.className}
              onClick={() => navigate(`/principal/classes/${cls.className}`)}
              style={{
                background: PALETTE.surface,
                borderRadius: '8px',
                border: `1px solid ${PALETTE.border}`,
                padding: '20px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = PALETTE.ink
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = PALETTE.border
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: PALETTE.ground,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                <BookOpen size={22} color={PALETTE.ink} />
              </div>

              <div style={{
                fontSize: '18px',
                fontWeight: 700,
                color: PALETTE.ink,
                marginBottom: '8px'
              }}>
                {cls.className}
              </div>

              <div style={{ display: 'flex', gap: '16px', ...TYPE.rowSecondary }}>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: PALETTE.ink }}>
                    {cls.sectionsCount}
                  </div>
                  <div style={{ fontSize: '12px' }}>
                    {cls.sectionsCount === 1 ? 'Section' : 'Sections'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: PALETTE.ink }}>
                    {cls.studentsTotal}
                  </div>
                  <div style={{ fontSize: '12px' }}>
                    {cls.studentsTotal === 1 ? 'Student' : 'Students'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
