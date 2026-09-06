import { useNavigate } from 'react-router-dom'
import { tokens } from '../../design-tokens'
import { Block, LoadingBlock, AllClear, DoorRow } from '../ui'
import { useBelowAttendance } from '../useBelowAttendance'
import { ATTENDANCE_LOW } from '@/academic/metrics/thresholds'

/**
 * Needs attention (§7). Flat, grey, deliberately quiet — must not compete with
 * attendance for the eye. Each line is a door to a list of named students; each
 * student opens their profile. Thresholds come from thresholds.ts — no literals.
 */
export function NeedsAttention({
  unpaidPastDueCount,
  unmarkedSubjectsCount,
}: {
  unpaidPastDueCount: number
  unmarkedSubjectsCount: number
}) {
  const navigate = useNavigate()
  const { students, loading } = useBelowAttendance()

  if (loading) return <LoadingBlock title="Needs attention" />

  const belowCount = students.length
  const nothing = belowCount === 0 && unpaidPastDueCount === 0 && unmarkedSubjectsCount === 0

  if (nothing) {
    return (
      <Block title="Needs attention" muted>
        <AllClear message="Nothing needs attention right now." />
      </Block>
    )
  }

  return (
    <Block title="Needs attention" muted>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
        {belowCount > 0 && (
          <DoorRow
            label={`Students below ${ATTENDANCE_LOW}% attendance`}
            value={belowCount}
            valueColor={tokens.color.accent}
            onClick={() => navigate('/principal/attendance')}
          />
        )}
        {unpaidPastDueCount > 0 && (
          <DoorRow
            label="Students unpaid past their due date"
            value={unpaidPastDueCount}
            valueColor={tokens.color.accent}
            onClick={() => navigate('/principal/classes')}
          />
        )}
        {unmarkedSubjectsCount > 0 && (
          <DoorRow
            label="Exam subjects still unmarked"
            value={unmarkedSubjectsCount}
            valueColor={tokens.color.warning}
            onClick={() => navigate('/principal/exams')}
          />
        )}
      </div>
    </Block>
  )
}
