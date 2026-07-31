import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./shared";
import { type ClassInfo } from "./data";
import { TeacherAttendanceWorkspace } from "./TeacherAttendancePage";
import {
  LiveStudentsTab,
  LiveAcademicWorkTab,
  LiveTestsTab,
  LiveExamsMarksTab,
  LiveInsightsTab,
} from "./LiveClassPanels";
import { AttendanceService, type AssignedClass } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

type SubTab =
  | "students"
  | "attendance"
  | "homework"
  | "tests"
  | "exams-marks"
  | "insights";

function readOpenTab(): SubTab {
  try {
    const t = sessionStorage.getItem("teacher.openTab");
    if (
      t === "students" ||
      t === "attendance" ||
      t === "homework" ||
      t === "academic-work" ||
      t === "tests" ||
      t === "exams-marks" ||
      t === "insights"
    ) {
      sessionStorage.removeItem("teacher.openTab");
      return t === "academic-work" ? "homework" : (t as SubTab);
    }
  } catch {
    /* ignore */
  }
  return "students";
}

function assignedToClassInfo(c: AssignedClass): ClassInfo {
  return {
    id: c.id,
    className: c.name,
    section: c.section,
    subject: c.subject ?? "—",
    isClassTeacher: c.isClassTeacher,
    studentCount: c.studentCount,
    schedule: [],
  };
}

function TabBtn({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative px-4 py-2.5 text-xs font-semibold transition-all whitespace-nowrap border-b-2",
        active
          ? "border-[#3b5bdb] text-[#3b5bdb]"
          : "border-transparent text-[#78788c] hover:text-white",
      )}
    >
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-[#cc5069]/20 text-[#cc5069]">
          {badge}
        </span>
      )}
    </button>
  );
}

function ClassSelector({
  classes,
  selected,
  onSelect,
}: {
  classes: ClassInfo[];
  selected: ClassInfo | null;
  onSelect: (c: ClassInfo) => void;
}) {
  if (classes.length === 0) {
    return (
      <div className="text-xs text-[#78788c] py-2">
        No classes assigned via Teacher–Class–Subject mapping.
      </div>
    );
  }
  return (
    <div className="flex gap-2 flex-wrap">
      {classes.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c)}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all",
            selected?.id === c.id
              ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
              : "bg-[#131316] border-white/7 text-[#78788c] hover:border-white/15 hover:text-white",
          )}
        >
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center text-[8px] font-black"
            style={{
              background: selected?.id === c.id ? "#f59e0b20" : "#ffffff12",
              color: selected?.id === c.id ? "#f59e0b" : "#78788c",
            }}
          >
            {c.section}
          </div>
          {c.className} {c.section} · {c.subject}
          {c.isClassTeacher && (
            <span className="text-[8px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/10 px-1 py-0.5 rounded-full">
              CT
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * My Classes — Academic Engine only for academic tabs.
 * No mock students / homework / tests / assignments.
 */
export default function MyClasses() {
  const { ctx, ready } = useAcademicContext();
  const [liveClasses, setLiveClasses] = useState<ClassInfo[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassInfo | null>(null);
  const [subTab, setSubTab] = useState<SubTab>(() => readOpenTab());
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [classError, setClassError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoadingClasses(true);
      setClassError(null);
      try {
        const list = await AttendanceService.listAssignedClasses(ctx);
        if (cancelled) return;
        const mapped = list.map(assignedToClassInfo);
        setLiveClasses(mapped);
        setSelectedClass((prev) => {
          if (prev && mapped.some((c) => c.id === prev.id)) return prev;
          return mapped[0] ?? null;
        });
      } catch (e) {
        if (!cancelled) {
          setClassError(e instanceof Error ? e.message : "Failed to load assigned classes");
          setLiveClasses([]);
          setSelectedClass(null);
        }
      } finally {
        if (!cancelled) setLoadingClasses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx]);

  if (loadingClasses) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading assigned classes…
      </div>
    );
  }

  if (!selectedClass) {
    return (
      <div className="space-y-3 py-10 text-center">
        <div className="text-sm text-[#78788c]">
          {classError ??
            "No classes assigned. Ask admin to create Teacher–Class–Subject mapping."}
        </div>
      </div>
    );
  }

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "students", label: `Students (${selectedClass.studentCount})` },
    { key: "attendance", label: "Attendance" },
    { key: "homework", label: "Homework" },
    { key: "tests", label: "Tests" },
    { key: "exams-marks", label: "Exams & Marks" },
    { key: "insights", label: "Insights" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">
          Select Class
        </div>
        <ClassSelector
          classes={liveClasses}
          selected={selectedClass}
          onSelect={(c) => {
            setSelectedClass(c);
            setSubTab("students");
          }}
        />
      </div>

      <div className="border-b border-white/7 flex gap-0 overflow-x-auto -mb-px">
        {subTabs.map((t) => (
          <TabBtn
            key={t.key}
            label={t.label}
            active={subTab === t.key}
            onClick={() => setSubTab(t.key)}
          />
        ))}
      </div>

      <div>
        {subTab === "students" && <LiveStudentsTab classId={selectedClass.id} />}
        {subTab === "attendance" && (
          <TeacherAttendanceWorkspace fixedClassId={selectedClass.id} showBackLink={false} />
        )}
        {subTab === "homework" && (
          <LiveAcademicWorkTab classId={selectedClass.id} subject={selectedClass.subject} />
        )}
        {subTab === "tests" && (
          <LiveTestsTab classId={selectedClass.id} subject={selectedClass.subject} />
        )}
        {subTab === "exams-marks" && (
          <LiveExamsMarksTab
            classId={selectedClass.id}
            subject={selectedClass.subject}
            isClassTeacher={selectedClass.isClassTeacher}
          />
        )}
        {subTab === "insights" && <LiveInsightsTab classId={selectedClass.id} />}
      </div>
    </div>
  );
}
