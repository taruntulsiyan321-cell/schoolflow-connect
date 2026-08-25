import { useState } from 'react';
import { CollapsibleBlock, MetricSummary } from './CollapsibleBlock';
import { PALETTE, TYPE } from './tokens';
import { THRESHOLDS } from './thresholds';

interface SubjectData {
  id: string;
  name: string;
  teacher: string;
  testAvg: number | null;
  examAvg: number | null;
  studentsCount: number;
  belowPassCount: number;
  marksUploaded: number;
  marksPending: number;
  otherSection?: {
    testAvg: number | null;
    examAvg: number | null;
  };
}

interface SubjectsBlockProps {
  subjects: SubjectData[];
  otherSectionName?: string;
}

export function SubjectsBlock({ subjects, otherSectionName }: SubjectsBlockProps) {
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);

  const flaggedCount = subjects.filter(s =>
    s.belowPassCount / s.studentsCount >= THRESHOLDS.marks.classFlag / 100
  ).length;

  return (
    <CollapsibleBlock
      title="Subjects"
      summary={
        <MetricSummary
          value={subjects.length}
          label=" subjects"
          flaggedCount={flaggedCount}
        />
      }
    >
      {subjects.length === 0 ? (
        <div style={{ color: PALETTE.inkMuted, textAlign: 'center', padding: '20px' }}>
          No subjects data available.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {subjects.map((subject) => (
            <div key={subject.id}>
              <button
                onClick={() => setExpandedSubject(
                  expandedSubject === subject.id ? null : subject.id
                )}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: PALETTE.faint,
                  border: `1px solid ${PALETTE.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = PALETTE.hover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = PALETTE.faint;
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: PALETTE.ink }}>
                      {subject.name}
                    </div>
                    <div style={{ fontSize: '12px', color: PALETTE.inkMuted, marginTop: '2px' }}>
                      {subject.teacher}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    {/* Test Avg */}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: PALETTE.inkMuted, marginBottom: '2px' }}>
                        Test Avg
                      </div>
                      <div style={{ ...TYPE.figure, fontSize: '16px', fontWeight: 600, color: PALETTE.ink }}>
                        {subject.testAvg !== null ? subject.testAvg : '—'}
                      </div>
                      {subject.otherSection?.testAvg !== null && (
                        <div style={{ fontSize: '10px', color: PALETTE.inkMuted, ...TYPE.comparison }}>
                          {otherSectionName}: {subject.otherSection.testAvg}
                        </div>
                      )}
                    </div>

                    {/* Exam Avg */}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: PALETTE.inkMuted, marginBottom: '2px' }}>
                        Exam Avg
                      </div>
                      <div style={{ ...TYPE.figure, fontSize: '16px', fontWeight: 600, color: PALETTE.ink }}>
                        {subject.examAvg !== null ? subject.examAvg : '—'}
                      </div>
                      {subject.otherSection?.examAvg !== null && (
                        <div style={{ fontSize: '10px', color: PALETTE.inkMuted, ...TYPE.comparison }}>
                          {otherSectionName}: {subject.otherSection.examAvg}
                        </div>
                      )}
                    </div>

                    {/* Below Pass */}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: PALETTE.inkMuted, marginBottom: '2px' }}>
                        Below {THRESHOLDS.marks.pass}%
                      </div>
                      <div style={{
                        ...TYPE.figure,
                        fontSize: '16px',
                        fontWeight: 600,
                        color: subject.belowPassCount > 0 ? PALETTE.accent : PALETTE.positive
                      }}>
                        {subject.belowPassCount}
                      </div>
                    </div>

                    {/* Marks Status */}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: PALETTE.inkMuted, marginBottom: '2px' }}>
                        Marks Status
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 600 }}>
                        {subject.marksPending > 0 ? (
                          <span style={{ color: PALETTE.warning }}>
                            {subject.marksPending} pending
                          </span>
                        ) : (
                          <span style={{ color: PALETTE.positive }}>
                            Up to date
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </button>

              {/* Detail view when expanded */}
              {expandedSubject === subject.id && (
                <div style={{
                  padding: '16px',
                  background: 'white',
                  border: `1px solid ${PALETTE.border}`,
                  borderTop: 'none',
                  borderRadius: '0 0 6px 6px',
                }}>
                  <div style={{ fontSize: '12px', color: PALETTE.inkMuted }}>
                    {/* Mark Distribution */}
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontWeight: 600, marginBottom: '8px' }}>Mark Distribution</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {[
                          { range: '0-40', color: PALETTE.accent },
                          { range: '40-60', color: PALETTE.warning },
                          { range: '60-75', color: PALETTE.inkMuted },
                          { range: '75-90', color: PALETTE.positive },
                          { range: '90-100', color: PALETTE.positive }
                        ].map(band => (
                          <div key={band.range} style={{
                            flex: 1,
                            padding: '8px',
                            background: PALETTE.faint,
                            borderRadius: '4px',
                            textAlign: 'center'
                          }}>
                            <div style={{ fontSize: '11px', color: PALETTE.inkMuted }}>{band.range}</div>
                            <div style={{ fontSize: '16px', fontWeight: 700, color: band.color }}>
                              —
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Students Below Threshold */}
                    {subject.belowPassCount > 0 && (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                          {subject.belowPassCount} student{subject.belowPassCount > 1 ? 's' : ''} below pass threshold
                        </div>
                        <div style={{ fontSize: '11px', color: PALETTE.inkMuted }}>
                          Click row in Students table to view individual performance
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </CollapsibleBlock>
  );
}
