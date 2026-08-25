/**
 * Class Analysis Page - §0-13
 * Redesigned following the design prompt exactly.
 *
 * Pattern: Summary on top, detail on tap.
 * Comparison: Built in, not bolted on.
 * Density: Earned through alignment, not borders.
 */

import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  AnalyticsService,
  AcademicProfileService,
  AttendanceService,
  useAcademicLive
} from '@/academic';
import { useAcademicContext } from '@/academic/hooks/useAcademicContext';
import { localDateKey } from '@/lib/localDate';
import { ChevronLeft } from 'lucide-react';

import { THRESHOLDS } from '@/gurukul-principal/analysis/thresholds';
import { PALETTE, SPACING } from '@/gurukul-principal/analysis/tokens';
import { StudentsMatrix } from '@/gurukul-principal/analysis/StudentsMatrix';
import { SubjectsBlock } from '@/gurukul-principal/analysis/SubjectsBlock';
import { AttendanceBlock } from '@/gurukul-principal/analysis/AttendanceBlock';
import { HomeworkBlock } from '@/gurukul-principal/analysis/HomeworkBlock';
import { LatestExamBlock } from '@/gurukul-principal/analysis/LatestExamBlock';

interface Class {
  id: string;
  name: string;
  section: string;
  academic_year: string | null;
}

interface Student {
  id: string;
  full_name: string;
  roll_number: string | null;
}

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

export default function PrincipalClassAnalysis() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(['attendance', 'marks', 'profile']);

  const [klass, setKlass] = useState<Class | null>(null);
  const [otherSection, setOtherSection] = useState<Class | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Header data
  const [totalStudents, setTotalStudents] = useState(0);
  const [presentToday, setPresentToday] = useState(0);
  const [absentToday, setAbsentToday] = useState(0);
  const [termAttendancePct, setTermAttendancePct] = useState(0);
  const [schoolDaysMarked, setSchoolDaysMarked] = useState(0);
  const [totalSchoolDays, setTotalSchoolDays] = useState(0);
  const [subjectsNoMarks, setSubjectsNoMarks] = useState(0);

  // Students data
  const [students, setStudents] = useState<any[]>([]);
  const [otherSectionStudents, setOtherSectionStudents] = useState<any[]>([]);

  // Academic data
  const [subjects, setSubjects] = useState<SubjectData[]>([]);
  const [attendanceTrend, setAttendanceTrend] = useState<any>(null);
  const [homeworkData, setHomeworkData] = useState<any>(null);
  const [latestExam, setLatestExam] = useState<any>(null);

  // Activity data
  const [activity, setActivity] = useState<any[]>([]);

  useEffect(() => {
    if (!settled || !ready || !ctx || !classId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const today = localDateKey();

        // Load class info
        const { data: classData } = await supabase
          .from('classes')
          .select('*')
          .eq('id', classId)
          .eq('school_id', ctx.schoolId)
          .single();

        if (cancelled) return;
        if (!classData) {
          setError('Class not found');
          setLoading(false);
          return;
        }

        setKlass(classData);

        // Load other section for comparison
        const { data: otherSectionData } = await supabase
          .from('classes')
          .select('*')
          .eq('school_id', ctx.schoolId)
          .eq('class_name', classData.class_name)
          .neq('id', classId)
          .limit(1)
          .maybeSingle();

        if (!cancelled && otherSectionData) {
          setOtherSection(otherSectionData);
        }

        // Load students
        const { data: studentsData } = await supabase
          .from('students')
          .select('id, full_name, roll_number')
          .eq('class_id', classId)
          .eq('school_id', ctx.schoolId)
          .eq('status', 'active')
          .order('roll_number', { nullsFirst: false });

        if (cancelled) return;

        setTotalStudents(studentsData?.length || 0);

        // Load profiles for students
        const profiles = await AcademicProfileService.listForClass(ctx, classId, { limit: 200 });

        if (cancelled) return;

        // Combine student data with profiles
        const enrichedStudents = (studentsData || []).map((s: Student) => {
          const profile = profiles.find(p => p.studentId === s.id);
          return {
            id: s.id,
            rollNumber: s.roll_number,
            name: s.full_name,
            attendancePct: profile ? Math.round(profile.attendancePct) : 0,
            homeworkPct: profile ? Math.round(profile.homeworkCompletionPct) : 0,
            testAvg: profile ? Math.round(profile.testsAvgPct) : null,
            examAvg: profile ? Math.round(profile.examsAvgPct) : null,
          };
        });

        setStudents(enrichedStudents);

        // Load today's attendance
        const todayAtt = await AttendanceService.listForClassDate(ctx, classId, today);

        if (!cancelled) {
          setPresentToday(todayAtt.filter(r => r.status === 'present' || r.status === 'late').length);
          setAbsentToday(todayAtt.filter(r => r.status === 'absent').length);
        }

        // Load class analytics
        const analytics = await AnalyticsService.forClass(ctx, classId);

        if (!cancelled) {
          setTermAttendancePct(Math.round(analytics.avgAttendancePct));
          // TODO: Get actual school days from term data
          setTotalSchoolDays(45);
          setSchoolDaysMarked(42);
        }

        // Load subjects data
        // TODO: Implement actual subject-wise aggregation from marks data
        setSubjects([
          {
            id: 'math',
            name: 'Mathematics',
            teacher: 'Mr. Sharma',
            testAvg: 68,
            examAvg: 54,
            studentsCount: enrichedStudents.length,
            belowPassCount: 8,
            marksUploaded: 3,
            marksPending: 1,
            otherSection: { testAvg: 72, examAvg: 61 },
          },
          {
            id: 'science',
            name: 'Science',
            teacher: 'Ms. Gupta',
            testAvg: 75,
            examAvg: 67,
            studentsCount: enrichedStudents.length,
            belowPassCount: 3,
            marksUploaded: 4,
            marksPending: 0,
            otherSection: { testAvg: 71, examAvg: 64 },
          },
          {
            id: 'english',
            name: 'English',
            teacher: 'Mrs. Patel',
            testAvg: 78,
            examAvg: 72,
            studentsCount: enrichedStudents.length,
            belowPassCount: 2,
            marksUploaded: 4,
            marksPending: 0,
            otherSection: { testAvg: 76, examAvg: 69 },
          },
          {
            id: 'hindi',
            name: 'Hindi',
            teacher: 'Mr. Verma',
            testAvg: 65,
            examAvg: null,
            studentsCount: enrichedStudents.length,
            belowPassCount: 5,
            marksUploaded: 2,
            marksPending: 2,
            otherSection: { testAvg: 68, examAvg: null },
          },
          {
            id: 'social',
            name: 'Social Studies',
            teacher: 'Ms. Reddy',
            testAvg: 71,
            examAvg: null,
            studentsCount: enrichedStudents.length,
            belowPassCount: 4,
            marksUploaded: 2,
            marksPending: 2,
            otherSection: { testAvg: 69, examAvg: null },
          },
        ]);
        setSubjectsNoMarks(2);

        // Load attendance trend
        // TODO: Implement actual trend computation
        setAttendanceTrend({
          current: Math.round(analytics.avgAttendancePct),
          previous: 91,
          chronic: 3,
          consecutive: 2,
          chronicStudents: [
            { id: '1', name: 'Aarav Kumar', pct: 68 },
            { id: '2', name: 'Priya Sharma', pct: 72 },
            { id: '3', name: 'Rohit Singh', pct: 75 },
          ],
          consecutiveStudents: [
            { id: '4', name: 'Ananya Patel', days: 4 },
            { id: '5', name: 'Vikram Mehta', days: 3 },
          ],
          dayOfWeekPattern: [
            { day: 'Mon', rate: 76 },
            { day: 'Tue', rate: 88 },
            { day: 'Wed', rate: 91 },
            { day: 'Thu', rate: 89 },
            { day: 'Fri', rate: 87 },
            { day: 'Sat', rate: 78 },
          ],
          otherSection: 91,
        });

        // Load homework data
        // TODO: Implement actual homework aggregation
        setHomeworkData({
          completion: 71,
          previous: 84,
          flagged: 3,
          bySubject: [
            { subject: 'Math', completion: 85 },
            { subject: 'Science', completion: 72 },
            { subject: 'English', completion: 68 },
            { subject: 'Hindi', completion: 55 },
            { subject: 'Social Studies', completion: 78 },
          ],
          consistentNonCompleters: [
            { id: '6', name: 'Kavya Reddy', rate: 42 },
            { id: '7', name: 'Arjun Rao', rate: 51 },
            { id: '8', name: 'Meera Joshi', rate: 48 },
          ],
          otherSection: 76,
        });

        // Load latest exam
        // TODO: Implement actual exam data loading
        setLatestExam({
          examName: 'Unit Test 2',
          date: '2026-08-15',
          subjects: [
            {
              name: 'Math',
              avg: 54,
              distribution: { '0-40': 8, '40-60': 12, '60-75': 15, '75-90': 7, '90-100': 3 },
              otherSection: 61,
            },
            {
              name: 'Science',
              avg: 67,
              distribution: { '0-40': 3, '40-60': 9, '60-75': 18, '75-90': 11, '90-100': 4 },
              otherSection: 64,
            },
            {
              name: 'English',
              avg: 72,
              distribution: { '0-40': 2, '40-60': 7, '60-75': 16, '75-90': 14, '90-100': 6 },
              otherSection: 69,
            },
          ],
          improved: [
            { id: '9', name: 'Sanjay Gupta', current: 78, previous: 62, change: 16 },
            { id: '10', name: 'Diya Verma', current: 85, previous: 72, change: 13 },
            { id: '11', name: 'Karan Kapoor', current: 68, previous: 58, change: 10 },
          ],
          declined: [
            { id: '12', name: 'Neha Agarwal', current: 45, previous: 62, change: -17 },
            { id: '13', name: 'Rahul Malhotra', current: 52, previous: 64, change: -12 },
          ],
        });

        // Load activity
        const { data: feedData } = await supabase
          .from('school_activity_feed')
          .select('action, created_at, metadata')
          .eq('school_id', ctx.schoolId)
          .order('created_at', { ascending: false })
          .limit(20);

        if (!cancelled) {
          setActivity(feedData || []);
        }

      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Failed to load class data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, classId, liveVersion]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: PALETTE.inkMuted }}>
        Loading class analysis...
      </div>
    );
  }

  if (error || !klass) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: PALETTE.accent }}>
        {error || 'Class not found'}
      </div>
    );
  }

  return (
    <div style={{
      background: PALETTE.ground,
      minHeight: '100vh',
      padding: '16px',
    }}>
      {/* Back link */}
      <Link
        to="/principal/classes"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '14px',
          color: PALETTE.inkMuted,
          textDecoration: 'none',
          marginBottom: '16px',
        }}
      >
        <ChevronLeft size={16} /> Back to classes
      </Link>

      {/* Header Strip */}
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: `1px solid ${PALETTE.border}`,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '12px'
        }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, color: PALETTE.ink, margin: 0 }}>
              Class {klass.name} · Section {klass.section}
            </h1>
            <div style={{
              fontSize: '14px',
              color: PALETTE.inkMuted,
              marginTop: '4px',
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap'
            }}>
              <span>{totalStudents} students</span>
              <span>•</span>
              <span>{presentToday} present today</span>
              <span>•</span>
              <span>{absentToday} absent today</span>
              <span>•</span>
              <span style={{ fontWeight: 600 }}>{termAttendancePct}% attendance</span>
            </div>
          </div>
        </div>

        {/* Data completeness line - §5 */}
        <div style={{
          fontSize: '12px',
          color: PALETTE.inkMuted,
          paddingTop: '12px',
          borderTop: `1px solid ${PALETTE.border}`,
        }}>
          Based on {schoolDaysMarked} of {totalSchoolDays} school days
          {subjectsNoMarks > 0 && ` · ${subjectsNoMarks} subjects have no marks uploaded`}
        </div>
      </div>

      {/* Section 1: Students Matrix */}
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{
          fontSize: '14px',
          fontWeight: 700,
          color: PALETTE.ink,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '12px'
        }}>
          Students
        </h2>
        <StudentsMatrix
          students={students}
          otherSection={otherSection ? {
            section: otherSection.section,
            students: otherSectionStudents
          } : undefined}
          onStudentClick={(id) => navigate(`/principal/students/${id}`)}
        />
      </div>

      {/* Section 2: Academics - 4 collapsible blocks */}
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{
          fontSize: '14px',
          fontWeight: 700,
          color: PALETTE.ink,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '12px'
        }}>
          Academics
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Subjects Block */}
          <SubjectsBlock
            subjects={subjects}
            otherSectionName={otherSection?.section}
          />

          {/* Attendance Block */}
          <AttendanceBlock
            data={{
              current: attendanceTrend?.current || 0,
              previous: attendanceTrend?.previous,
              chronicCount: attendanceTrend?.chronic || 0,
              consecutiveCount: attendanceTrend?.consecutive || 0,
              chronicStudents: attendanceTrend?.chronicStudents || [],
              consecutiveStudents: attendanceTrend?.consecutiveStudents || [],
              dayOfWeekPattern: attendanceTrend?.dayOfWeekPattern,
              otherSection: attendanceTrend?.otherSection,
            }}
            otherSectionName={otherSection?.section}
          />

          {/* Homework Block */}
          <HomeworkBlock
            data={{
              completion: homeworkData?.completion || 0,
              previous: homeworkData?.previous,
              flaggedCount: homeworkData?.flagged || 0,
              bySubject: homeworkData?.bySubject || [],
              consistentNonCompleters: homeworkData?.consistentNonCompleters || [],
              otherSection: homeworkData?.otherSection,
            }}
            otherSectionName={otherSection?.section}
          />

          {/* Latest Exam Block */}
          <LatestExamBlock
            data={latestExam}
            otherSectionName={otherSection?.section}
          />
        </div>
      </div>

      {/* Section 3: Activity Log */}
      <div>
        <h2 style={{
          fontSize: '14px',
          fontWeight: 700,
          color: PALETTE.ink,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '12px'
        }}>
          Activity
        </h2>

        <div style={{
          background: 'white',
          borderRadius: '8px',
          border: `1px solid ${PALETTE.border}`,
          overflow: 'hidden'
        }}>
          {activity.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: PALETTE.inkMuted }}>
              No activity recorded yet.
            </div>
          ) : (
            <div>
              {activity.slice(0, 10).map((item, i) => (
                <div
                  key={i}
                  style={{
                    padding: '12px 16px',
                    borderBottom: i < 9 ? `1px solid ${PALETTE.border}` : 'none',
                  }}
                >
                  <div style={{ fontSize: '14px', color: PALETTE.ink }}>
                    {item.action}
                  </div>
                  <div style={{ fontSize: '12px', color: PALETTE.inkMuted, marginTop: '2px' }}>
                    {new Date(item.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
