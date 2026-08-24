import { useState, useMemo } from 'react';
import { THRESHOLDS, isBelowThreshold } from './thresholds';
import { PALETTE, TYPE } from './tokens';

interface StudentRow {
  id: string;
  rollNumber: string | null;
  name: string;
  attendancePct: number;
  homeworkPct: number;
  testAvg: number | null;
  examAvg: number | null;
  partialEnrollment?: boolean;  // Mid-term joiner/leaver flag
}

interface StudentsMatrixProps {
  students: StudentRow[];
  otherSection?: {
    section: string;
    students: StudentRow[];
  };
  onStudentClick?: (studentId: string) => void;
}

type SortColumn = 'roll' | 'name' | 'attendance' | 'homework' | 'test' | 'exam';
type SortDirection = 'asc' | 'desc';

export function StudentsMatrix({ students, otherSection, onStudentClick }: StudentsMatrixProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('roll');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => {
      let aVal: any, bVal: any;

      switch (sortColumn) {
        case 'roll':
          aVal = parseInt(a.rollNumber || '999');
          bVal = parseInt(b.rollNumber || '999');
          break;
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'attendance':
          aVal = a.attendancePct;
          bVal = b.attendancePct;
          break;
        case 'homework':
          aVal = a.homeworkPct;
          bVal = b.homeworkPct;
          break;
        case 'test':
          aVal = a.testAvg ?? -1;
          bVal = b.testAvg ?? -1;
          break;
        case 'exam':
          aVal = a.examAvg ?? -1;
          bVal = b.examAvg ?? -1;
          break;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [students, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc'); // Default to desc for metrics (highest first)
    }
  };

  const getOtherSectionValue = (studentRoll: string | null, metric: 'attendance' | 'homework') => {
    if (!otherSection || !studentRoll) return null;
    const match = otherSection.students.find(s => s.rollNumber === studentRoll);
    if (!match) return null;
    return metric === 'attendance' ? match.attendancePct : match.homeworkPct;
  };

  if (students.length === 0) {
    return (
      <div style={{
        padding: '32px',
        textAlign: 'center',
        color: PALETTE.inkMuted,
        background: PALETTE.faint,
        borderRadius: '8px'
      }}>
        No students in this class.
      </div>
    );
  }

  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      border: `1px solid ${PALETTE.border}`,
      overflow: 'hidden'
    }}>
      {/* Table wrapper with horizontal scroll on mobile */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          ...TYPE.figure,
        }}>
          <thead>
            <tr style={{ background: PALETTE.faint, borderBottom: `2px solid ${PALETTE.border}` }}>
              <SortHeader
                label="Roll"
                active={sortColumn === 'roll'}
                direction={sortDirection}
                onClick={() => handleSort('roll')}
                sticky
              />
              <SortHeader
                label="Name"
                active={sortColumn === 'name'}
                direction={sortDirection}
                onClick={() => handleSort('name')}
                sticky
                leftOffset="60px"
              />
              <SortHeader
                label="Attendance %"
                active={sortColumn === 'attendance'}
                direction={sortDirection}
                onClick={() => handleSort('attendance')}
              />
              <SortHeader
                label="Homework %"
                active={sortColumn === 'homework'}
                direction={sortDirection}
                onClick={() => handleSort('homework')}
              />
              <SortHeader
                label="Test Avg"
                active={sortColumn === 'test'}
                direction={sortDirection}
                onClick={() => handleSort('test')}
              />
              <SortHeader
                label="Exam Avg"
                active={sortColumn === 'exam'}
                direction={sortDirection}
                onClick={() => handleSort('exam')}
              />
            </tr>
          </thead>
          <tbody>
            {sortedStudents.map((student, index) => {
              const attBelowThreshold = isBelowThreshold(student.attendancePct, THRESHOLDS.attendance.low);
              const hwBelowThreshold = isBelowThreshold(student.homeworkPct, THRESHOLDS.homework.completion);
              const testBelowPass = student.testAvg !== null && isBelowThreshold(student.testAvg, THRESHOLDS.marks.pass);
              const examBelowPass = student.examAvg !== null && isBelowThreshold(student.examAvg, THRESHOLDS.marks.pass);

              const otherAtt = getOtherSectionValue(student.rollNumber, 'attendance');
              const otherHw = getOtherSectionValue(student.rollNumber, 'homework');

              return (
                <tr
                  key={student.id}
                  onClick={() => onStudentClick?.(student.id)}
                  style={{
                    borderBottom: `1px solid ${PALETTE.border}`,
                    cursor: onStudentClick ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (onStudentClick) e.currentTarget.style.background = PALETTE.hover;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = index % 2 === 0 ? 'white' : PALETTE.faint;
                  }}
                >
                  {/* Roll - sticky */}
                  <td style={{
                    padding: '12px 16px',
                    fontWeight: 500,
                    color: PALETTE.ink,
                    position: 'sticky',
                    left: 0,
                    background: index % 2 === 0 ? 'white' : PALETTE.faint,
                    zIndex: 1,
                  }}>
                    {student.rollNumber || '—'}
                  </td>

                  {/* Name - sticky */}
                  <td style={{
                    padding: '12px 16px',
                    fontWeight: 600,
                    color: PALETTE.ink,
                    position: 'sticky',
                    left: '60px',
                    background: index % 2 === 0 ? 'white' : PALETTE.faint,
                    zIndex: 1,
                    minWidth: '180px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {student.name}
                      {student.partialEnrollment && (
                        <span style={{
                          fontSize: '10px',
                          background: PALETTE.warning,
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontWeight: 600,
                        }}>
                          ⚠
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Attendance % */}
                  <MetricCell
                    value={student.attendancePct}
                    flagged={attBelowThreshold}
                    suffix="%"
                    otherValue={otherAtt}
                    otherSection={otherSection?.section}
                  />

                  {/* Homework % */}
                  <MetricCell
                    value={student.homeworkPct}
                    flagged={hwBelowThreshold}
                    suffix="%"
                    otherValue={otherHw}
                    otherSection={otherSection?.section}
                  />

                  {/* Test Avg */}
                  <MetricCell
                    value={student.testAvg}
                    flagged={testBelowPass}
                  />

                  {/* Exam Avg */}
                  <MetricCell
                    value={student.examAvg}
                    flagged={examBelowPass}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  active,
  direction,
  onClick,
  sticky,
  leftOffset
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  sticky?: boolean;
  leftOffset?: string;
}) {
  return (
    <th
      onClick={onClick}
      style={{
        padding: '12px 16px',
        textAlign: 'left',
        fontSize: '12px',
        fontWeight: 600,
        color: active ? PALETTE.ink : PALETTE.inkMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        cursor: 'pointer',
        userSelect: 'none',
        position: sticky ? 'sticky' : 'relative',
        left: sticky ? (leftOffset || 0) : 'auto',
        background: PALETTE.faint,
        zIndex: sticky ? 2 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {label}
        {active && (
          <span style={{ fontSize: '10px' }}>
            {direction === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </div>
    </th>
  );
}

function MetricCell({
  value,
  flagged,
  suffix = '',
  otherValue,
  otherSection
}: {
  value: number | null;
  flagged?: boolean;
  suffix?: string;
  otherValue?: number | null;
  otherSection?: string;
}) {
  const displayValue = value !== null ? `${value}${suffix}` : '—';

  return (
    <td style={{
      padding: '12px 16px',
      fontWeight: flagged ? 600 : 500,
      color: flagged ? PALETTE.accent : PALETTE.ink,
      background: flagged ? `${PALETTE.accent}10` : 'transparent',
      ...TYPE.figure,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span>{displayValue}</span>
        {otherValue !== null && otherValue !== undefined && (
          <span style={{
            fontSize: '11px',
            color: PALETTE.inkMuted,
            ...TYPE.comparison,
          }}>
            {otherSection}: {otherValue}{suffix}
          </span>
        )}
      </div>
    </td>
  );
}
