import { CollapsibleBlock } from './CollapsibleBlock';
import { PALETTE, TYPE } from './tokens';
import { THRESHOLDS } from './thresholds';

interface ExamSubject {
  name: string;
  avg: number;
  distribution: {
    '0-40': number;
    '40-60': number;
    '60-75': number;
    '75-90': number;
    '90-100': number;
  };
  otherSection?: number;
}

interface StudentMovement {
  id: string;
  name: string;
  current: number;
  previous: number;
  change: number;
}

interface LatestExamData {
  examName: string;
  date: string;
  subjects: ExamSubject[];
  improved: StudentMovement[];
  declined: StudentMovement[];
}

interface LatestExamBlockProps {
  data: LatestExamData | null;
  otherSectionName?: string;
}

export function LatestExamBlock({ data, otherSectionName }: LatestExamBlockProps) {
  if (!data) {
    return (
      <CollapsibleBlock
        title="Latest Exam"
        summary={
          <div style={{ fontSize: '14px', color: PALETTE.inkMuted }}>
            No exams yet
          </div>
        }
      >
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: PALETTE.inkMuted,
          background: PALETTE.faint,
          borderRadius: '6px'
        }}>
          No exam data available
        </div>
      </CollapsibleBlock>
    );
  }

  return (
    <CollapsibleBlock
      title="Latest Exam"
      summary={
        <div style={{ fontSize: '14px', color: PALETTE.ink }}>
          {data.examName} · {data.subjects.map(s => s.name).join(' · ')}
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Per-subject breakdown */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: PALETTE.ink, marginBottom: '12px' }}>
            Subject-wise Performance
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data.subjects.map((subject) => (
              <div key={subject.name}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: '8px'
                }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: PALETTE.ink }}>
                    {subject.name}
                  </span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                    <span style={{ ...TYPE.figure, fontSize: '18px', fontWeight: 700, color: PALETTE.ink }}>
                      {subject.avg}%
                    </span>
                    {subject.otherSection !== undefined && otherSectionName && (
                      <span style={{ fontSize: '12px', color: PALETTE.inkMuted, ...TYPE.comparison }}>
                        {otherSectionName}: {subject.otherSection}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Distribution bars */}
                <div style={{ display: 'flex', gap: '4px', height: '24px', marginBottom: '4px' }}>
                  {[
                    { range: '0-40', key: '0-40' as const, color: PALETTE.accent },
                    { range: '40-60', key: '40-60' as const, color: PALETTE.warning },
                    { range: '60-75', key: '60-75' as const, color: PALETTE.inkMuted },
                    { range: '75-90', key: '75-90' as const, color: PALETTE.positive },
                    { range: '90-100', key: '90-100' as const, color: PALETTE.positive }
                  ].map(band => {
                    const count = subject.distribution[band.key];
                    const total = Object.values(subject.distribution).reduce((a, b) => a + b, 0);
                    const width = total > 0 ? (count / total * 100) : 0;

                    return width > 0 ? (
                      <div
                        key={band.range}
                        style={{
                          flex: width,
                          background: band.color,
                          borderRadius: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: '11px',
                          fontWeight: 600,
                          minWidth: '20px'
                        }}
                        title={`${band.range}: ${count} students`}
                      >
                        {count}
                      </div>
                    ) : null;
                  })}
                </div>

                {/* Distribution legend */}
                <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: PALETTE.inkMuted }}>
                  {[
                    { range: '0-40', key: '0-40' as const },
                    { range: '40-60', key: '40-60' as const },
                    { range: '60-75', key: '60-75' as const },
                    { range: '75-90', key: '75-90' as const },
                    { range: '90-100', key: '90-100' as const }
                  ].map(band => (
                    <span key={band.range}>{band.range}: {subject.distribution[band.key]}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Student movement */}
        {(data.improved.length > 0 || data.declined.length > 0) && (
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {/* Improved */}
            {data.improved.length > 0 && (
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: PALETTE.positive, marginBottom: '8px' }}>
                  ↑ {data.improved.length} Improved
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {data.improved.map(student => (
                    <div
                      key={student.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: `${PALETTE.positive}10`,
                        borderRadius: '4px',
                        fontSize: '13px'
                      }}
                    >
                      <span style={{ color: PALETTE.ink }}>{student.name}</span>
                      <span style={{ ...TYPE.figure, color: PALETTE.positive, fontWeight: 600 }}>
                        +{student.change}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Declined */}
            {data.declined.length > 0 && (
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: PALETTE.accent, marginBottom: '8px' }}>
                  ↓ {data.declined.length} Declined
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {data.declined.map(student => (
                    <div
                      key={student.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: `${PALETTE.accent}10`,
                        borderRadius: '4px',
                        fontSize: '13px'
                      }}
                    >
                      <span style={{ color: PALETTE.ink }}>{student.name}</span>
                      <span style={{ ...TYPE.figure, color: PALETTE.accent, fontWeight: 600 }}>
                        {student.change}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Exam date */}
        <div style={{ fontSize: '11px', color: PALETTE.inkMuted, fontStyle: 'italic', paddingTop: '8px', borderTop: `1px solid ${PALETTE.border}` }}>
          Exam held on {data.date}
        </div>
      </div>
    </CollapsibleBlock>
  );
}
