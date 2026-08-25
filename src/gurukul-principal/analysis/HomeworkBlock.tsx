import { CollapsibleBlock, MetricSummary } from './CollapsibleBlock';
import { PALETTE } from './tokens';
import { THRESHOLDS } from './thresholds';

interface HomeworkData {
  completion: number;
  previous?: number;
  flaggedCount: number;
  bySubject: Array<{ subject: string; completion: number }>;
  consistentNonCompleters: Array<{ id: string; name: string; rate: number }>;
  otherSection?: number;
}

interface HomeworkBlockProps {
  data: HomeworkData;
  otherSectionName?: string;
}

export function HomeworkBlock({ data, otherSectionName }: HomeworkBlockProps) {
  return (
    <CollapsibleBlock
      title="Homework"
      summary={
        <MetricSummary
          value={data.completion}
          label="%"
          trend={data.previous ? {
            direction: data.completion < data.previous ? 'down' : 'up',
            from: data.previous
          } : undefined}
          flaggedCount={data.flaggedCount}
          comparison={data.otherSection && otherSectionName ? {
            section: otherSectionName,
            value: data.otherSection
          } : undefined}
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Completion by Subject */}
        {data.bySubject && data.bySubject.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: PALETTE.ink, marginBottom: '12px' }}>
              Completion by Subject (7-day window)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {data.bySubject
                .sort((a, b) => a.completion - b.completion)
                .map(({ subject, completion }) => {
                  const isBelowThreshold = completion < THRESHOLDS.homework.completion;
                  return (
                    <div
                      key={subject}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '8px 12px',
                        background: isBelowThreshold ? `${PALETTE.accent}10` : PALETTE.faint,
                        borderRadius: '4px',
                      }}
                    >
                      <span style={{ flex: 1, fontSize: '13px', color: PALETTE.ink }}>
                        {subject}
                      </span>
                      <div style={{ width: '120px', height: '8px', background: PALETTE.border, borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${completion}%`,
                          height: '100%',
                          background: isBelowThreshold ? PALETTE.accent : PALETTE.positive,
                          transition: 'width 0.3s'
                        }} />
                      </div>
                      <span style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: isBelowThreshold ? PALETTE.accent : PALETTE.ink,
                        width: '40px',
                        textAlign: 'right'
                      }}>
                        {completion}%
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Consistent Non-Completers */}
        {data.consistentNonCompleters.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: PALETTE.accent, marginBottom: '8px' }}>
              {data.consistentNonCompleters.length} Student{data.consistentNonCompleters.length > 1 ? 's' : ''} with Low Completion
              <span style={{ fontWeight: 400, color: PALETTE.inkMuted }}>
                {' '}(below {THRESHOLDS.homework.completion}% consistently)
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {data.consistentNonCompleters.map(student => (
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
                    {student.rate}%
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '11px', color: PALETTE.inkMuted, marginTop: '8px', fontStyle: 'italic' }}>
              Missed-while-absent shown separately in student profiles
            </div>
          </div>
        )}

        {/* Empty state */}
        {data.consistentNonCompleters.length === 0 && (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: PALETTE.positive,
            background: `${PALETTE.positive}10`,
            borderRadius: '6px'
          }}>
            ✓ All students maintaining homework completion
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}
