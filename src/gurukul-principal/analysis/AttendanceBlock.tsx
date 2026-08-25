import { CollapsibleBlock, MetricSummary } from './CollapsibleBlock';
import { PALETTE } from './tokens';
import { THRESHOLDS } from './thresholds';

interface AttendanceData {
  current: number;
  previous?: number;
  chronicCount: number;
  consecutiveCount: number;
  chronicStudents: Array<{ id: string; name: string; pct: number }>;
  consecutiveStudents: Array<{ id: string; name: string; days: number }>;
  dayOfWeekPattern?: Array<{ day: string; rate: number }>;
  otherSection?: number;
}

interface AttendanceBlockProps {
  data: AttendanceData;
  otherSectionName?: string;
}

export function AttendanceBlock({ data, otherSectionName }: AttendanceBlockProps) {
  return (
    <CollapsibleBlock
      title="Attendance"
      summary={
        <MetricSummary
          value={data.current}
          label="%"
          trend={data.previous ? {
            direction: data.current < data.previous ? 'down' : 'up',
            from: data.previous
          } : undefined}
          flaggedCount={data.chronicCount + data.consecutiveCount}
          comparison={data.otherSection && otherSectionName ? {
            section: otherSectionName,
            value: data.otherSection
          } : undefined}
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Day of Week Pattern */}
        {data.dayOfWeekPattern && data.dayOfWeekPattern.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: PALETTE.ink, marginBottom: '12px' }}>
              Day-of-Week Pattern
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {data.dayOfWeekPattern.map(({ day, rate }) => {
                const isLow = rate < THRESHOLDS.attendance.low;
                return (
                  <div key={day} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      height: `${Math.max(rate, 10)}px`,
                      background: isLow ? PALETTE.accent : PALETTE.positive,
                      borderRadius: '4px 4px 0 0',
                      marginBottom: '4px',
                    }} />
                    <div style={{ fontSize: '10px', color: PALETTE.inkMuted, marginBottom: '2px' }}>
                      {day}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: isLow ? PALETTE.accent : PALETTE.ink
                    }}>
                      {rate}%
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: '11px', color: PALETTE.inkMuted, marginTop: '8px', fontStyle: 'italic' }}>
              Monday and Saturday absence patterns are common indicators
            </div>
          </div>
        )}

        {/* Chronic Absentees */}
        {data.chronicStudents.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: PALETTE.accent, marginBottom: '8px' }}>
              {data.chronicStudents.length} Chronic Absentee{data.chronicStudents.length > 1 ? 's' : ''}
              <span style={{ fontWeight: 400, color: PALETTE.inkMuted }}>
                {' '}(below {THRESHOLDS.attendance.chronic}% across term)
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {data.chronicStudents.map(student => (
                <div
                  key={student.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: `${PALETTE.accent}10`,
                    borderRadius: '4px',
                    borderLeft: `3px solid ${PALETTE.accent}`
                  }}
                >
                  <span style={{ fontSize: '13px', color: PALETTE.ink }}>{student.name}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: PALETTE.accent }}>
                    {student.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Consecutive Absences */}
        {data.consecutiveStudents.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: PALETTE.warning, marginBottom: '8px' }}>
              {data.consecutiveStudents.length} Consecutive Absence{data.consecutiveStudents.length > 1 ? 's' : ''}
              <span style={{ fontWeight: 400, color: PALETTE.inkMuted }}>
                {' '}({THRESHOLDS.attendance.consecutive}+ days running)
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {data.consecutiveStudents.map(student => (
                <div
                  key={student.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: `${PALETTE.warning}10`,
                    borderRadius: '4px',
                    borderLeft: `3px solid ${PALETTE.warning}`
                  }}
                >
                  <span style={{ fontSize: '13px', color: PALETTE.ink }}>{student.name}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: PALETTE.warning }}>
                    {student.days} days
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {data.chronicStudents.length === 0 && data.consecutiveStudents.length === 0 && (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: PALETTE.positive,
            background: `${PALETTE.positive}10`,
            borderRadius: '6px'
          }}>
            ✓ No students below attendance thresholds
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}
