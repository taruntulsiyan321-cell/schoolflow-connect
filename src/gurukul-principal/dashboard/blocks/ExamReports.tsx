import { useNavigate } from 'react-router-dom'
import { tokens } from '../../design-tokens'
import { Block } from '../ui'
import type { ExamSectionRow } from '../useExamSlot'

/**
 * Exam reports slot (§4/§5). One row per section: reports READY at the top
 * (the class teacher's report exactly as-is, reached via drill-down), sections
 * STILL MARKING below in muted text with progress ("4 of 6 subjects marked").
 * The incomplete half is the actionable half, so it is visible, not hidden.
 */
export function ExamReports({ ready, marking }: { ready: ExamSectionRow[]; marking: ExamSectionRow[] }) {
  const navigate = useNavigate()

  return (
    <Block title="Exam reports">
      {ready.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
          {ready.map((r) => (
            <button
              key={r.examId}
              onClick={() => navigate('/principal/exams')}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: tokens.space.md,
                background: 'white',
                border: `1px solid ${tokens.color.positive}30`,
                borderLeft: `4px solid ${tokens.color.positive}`,
                borderRadius: tokens.radius.sm,
                padding: `${tokens.space.md} ${tokens.space.md}`,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: tokens.fontSize.body, fontWeight: tokens.fontWeight.medium, color: tokens.color.ink }}>
                {r.sectionLabel} · {r.examName}
              </span>
              <span style={{ fontSize: tokens.fontSize.small, fontWeight: tokens.fontWeight.semibold, color: tokens.color.positive }}>
                Report ready
              </span>
            </button>
          ))}
        </div>
      )}

      {marking.length > 0 && (
        <div style={{ marginTop: ready.length > 0 ? tokens.space.lg : 0, display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
          {marking.map((r) => (
            <div
              key={r.examId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: tokens.space.md,
                padding: `${tokens.space.sm} ${tokens.space.md}`,
                borderRadius: tokens.radius.sm,
                border: `1px solid ${tokens.color.borderSubtle}`,
              }}
            >
              <span style={{ fontSize: tokens.fontSize.body, color: tokens.color.inkMuted }}>
                {r.sectionLabel} · {r.examName}
              </span>
              <span style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted, fontVariantNumeric: 'tabular-nums' }}>
                {r.subjectsMarked} of {r.subjectsTotal} subjects marked
              </span>
            </div>
          ))}
        </div>
      )}

      {ready.length === 0 && marking.length === 0 && (
        <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.inkMuted, margin: 0 }}>
          No sections marking right now.
        </p>
      )}
    </Block>
  )
}
