import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUp,
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Crown,
  Eye,
  FileImage,
  Flame,
  GraduationCap,
  HelpCircle,
  ImagePlus,
  Lightbulb,
  MessageCircle,
  Plus,
  Search,
  Send,
  Sparkles,
  Star,
  ThumbsUp,
  Trophy,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { subjectsForStreamPicker, type AcademicStream } from "@/lib/curriculumScope";
import { getNcertSubjects } from "@/lib/ncertSyllabus";
import { PracticeService, DoubtService, useAcademicContext, resolveStudentServiceContext } from "@/academic";

type DoubtStatus = "unsolved" | "teacher_answered" | "community_solved" | "solved";

interface CommunityDoubt {
  id: string;
  user_id: string;
  student_name: string;
  class_label: string;
  subject: string | null;
  chapter: string | null;
  concept: string | null;
  title: string;
  body: string;
  image_url: string | null;
  status: DoubtStatus;
  answer_count: number;
  upvote_count: number;
  view_count: number;
  teacher_answered: boolean;
  accepted_answer_id: string | null;
  last_activity_at: string;
  created_at: string;
}

interface CommunityAnswer {
  id: string;
  doubt_id: string;
  user_id: string;
  author_name: string;
  author_role: "student" | "teacher" | "admin" | "principal";
  body: string;
  image_url: string | null;
  is_teacher_verified: boolean;
  is_accepted: boolean;
  upvote_count: number;
  created_at: string;
}

interface Reputation {
  user_id: string;
  points: number;
  answer_count: number;
  accepted_count: number;
  upvote_count: number;
  badges: string[];
  top_subject: string | null;
}

interface TeacherDashboardData {
  unanswered: CommunityDoubt[];
  attention: CommunityDoubt[];
  concepts: { label: string; total: number; unresolved: number }[];
  totals: { open: number; teacher_answered: number; solved: number; total: number };
}

type FeedFilter = "recent" | "trending" | "unanswered" | "teacher" | "mine";

const FALLBACK_SUBJECTS = ["Mathematics", "English", "General"];

const FILTERS: { id: FeedFilter; label: string; icon: typeof MessageCircle }[] = [
  { id: "recent", label: "Recent Doubts", icon: MessageCircle },
  { id: "trending", label: "Trending Doubts", icon: Flame },
  { id: "unanswered", label: "Unanswered", icon: HelpCircle },
  { id: "teacher", label: "Teacher Answered", icon: BadgeCheck },
  { id: "mine", label: "My Doubts", icon: Users },
];

const statusCopy: Record<DoubtStatus, { label: string; className: string }> = {
  unsolved: { label: "Unsolved", className: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  teacher_answered: { label: "Teacher Answered", className: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  community_solved: { label: "Community Solved", className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  solved: { label: "Solved", className: "bg-primary/10 text-primary border-primary/30" },
};

const db = supabase as any;

function formatDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function normalize(text?: string | null) {
  return (text ?? "").toLowerCase().trim();
}

function includesQuery(doubt: CommunityDoubt, query: string) {
  const q = normalize(query);
  if (!q) return true;
  return [doubt.title, doubt.body, doubt.subject, doubt.chapter, doubt.concept, doubt.student_name]
    .map(normalize)
    .some((field) => field.includes(q));
}

function statusBadge(status: DoubtStatus) {
  const copy = statusCopy[status] ?? statusCopy.unsolved;
  return (
    <Badge variant="outline" className={cn("rounded-full font-semibold", copy.className)}>
      {copy.label}
    </Badge>
  );
}

async function uploadDoubtImage(file: File | null, userId: string | undefined) {
  if (!file || !userId) return null;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${userId}/${Date.now()}-${safeName}`;
  const { error } = await db.storage.from("doubt-images").upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = db.storage.from("doubt-images").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function RichBody({ body }: { body: string }) {
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
      {body}
    </div>
  );
}

function DoubtCard({
  doubt,
  selected,
  onOpen,
  onVote,
}: {
  doubt: CommunityDoubt;
  selected: boolean;
  onOpen: (doubt: CommunityDoubt) => void;
  onVote: (id: string) => void;
}) {
  return (
    <Card
      className={cn(
        "group overflow-hidden border-border/70 bg-card/95 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-elevated",
        selected && "ring-2 ring-primary/40 border-primary/40",
      )}
    >
      <button type="button" onClick={() => onOpen(doubt)} className="block w-full text-left">
        <div className="flex flex-wrap items-center gap-2">
          {statusBadge(doubt.status)}
          {doubt.teacher_answered && (
            <Badge variant="outline" className="rounded-full bg-blue-500/10 text-blue-700 border-blue-500/30">
              <BadgeCheck className="mr-1 h-3 w-3" />
              Faculty answer
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{formatDate(doubt.created_at)}</span>
        </div>

        <h3 className="mt-3 line-clamp-2 text-base font-bold text-foreground group-hover:text-primary">
          {doubt.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{doubt.body}</p>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">{doubt.subject || "Subject"}</span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{doubt.chapter || "Chapter"}</span>
          {doubt.concept && <span className="rounded-full bg-accent/10 px-2.5 py-1 font-semibold text-accent">{doubt.concept}</span>}
        </div>
      </button>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <div className="min-w-0 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{doubt.student_name}</span>
          <span> · {doubt.class_label}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{doubt.answer_count}</span>
          <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{doubt.view_count}</span>
          <button
            type="button"
            onClick={() => onVote(doubt.id)}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-semibold text-foreground transition hover:bg-primary/10 hover:text-primary"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            {doubt.upvote_count}
          </button>
        </div>
      </div>
    </Card>
  );
}

function ReputationCard({ reputation }: { reputation: Reputation | null }) {
  const badges = reputation?.badges?.length ? reputation.badges : ["New Contributor"];
  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-accent/10 p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
          <Trophy className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Knowledge reputation</p>
          <p className="text-2xl font-black">{reputation?.points ?? 0} pts</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-xl bg-background/80 p-2">
          <p className="font-bold">{reputation?.answer_count ?? 0}</p>
          <p className="text-muted-foreground">Answers</p>
        </div>
        <div className="rounded-xl bg-background/80 p-2">
          <p className="font-bold">{reputation?.accepted_count ?? 0}</p>
          <p className="text-muted-foreground">Best</p>
        </div>
        <div className="rounded-xl bg-background/80 p-2">
          <p className="font-bold">{reputation?.upvote_count ?? 0}</p>
          <p className="text-muted-foreground">Helpful</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {badges.slice(0, 4).map((badge) => (
          <Badge key={badge} variant="outline" className="rounded-full bg-background/80">
            <Award className="mr-1 h-3 w-3 text-primary" />
            {badge}
          </Badge>
        ))}
      </div>
      {reputation?.top_subject && (
        <p className="mt-3 text-xs font-semibold text-muted-foreground">Top {reputation.top_subject} contributor</p>
      )}
    </Card>
  );
}

function AskDoubtPanel({ onCreated }: { onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [stream, setStream] = useState<AcademicStream | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const subjects = useMemo(() => {
    const scoped = subjectsForStreamPicker(stream, classLevel, getNcertSubjects(classLevel) || FALLBACK_SUBJECTS);
    return scoped.includes("General") ? scoped : [...scoped, "General"];
  }, [stream, classLevel]);
  const [subject, setSubject] = useState(subjects[0] ?? "Mathematics");
  const [chapter, setChapter] = useState("");
  const [concept, setConcept] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!ctx || !academicReady) return;
    let cancelled = false;
    (async () => {
      try {
        const scope = await PracticeService.resolveCurriculumScope(ctx);
        if (cancelled) return;
        setStream(scope.stream);
        setClassLevel(scope.classLevel);
      } catch {
        if (!cancelled) {
          setStream(null);
          setClassLevel(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, academicReady]);

  useEffect(() => {
    if (subjects.length && !subjects.includes(subject)) setSubject(subjects[0]);
  }, [subjects, subject]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("Add a clear title and description.");
      return;
    }
    setPosting(true);
    try {
      const imageUrl = await uploadDoubtImage(file, user?.id);
      const serviceCtx = ctx && academicReady ? ctx : await resolveStudentServiceContext();
      const data = await DoubtService.create(serviceCtx, {
        _subject: subject,
        _chapter: chapter,
        _concept: concept,
        _title: title,
        _body: body,
        _image_url: imageUrl,
      });
      toast.success("Doubt posted to the community.");
      setChapter("");
      setConcept("");
      setTitle("");
      setBody("");
      setFile(null);
      const id =
        typeof data === "string"
          ? data
          : String((data as { id?: string } | null)?.id ?? "");
      if (id) onCreated(id);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not post doubt.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-background p-5 shadow-card">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Plus className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-black">Ask a doubt</h3>
          <p className="text-sm text-muted-foreground">Explain where you are stuck. Similar solved doubts will appear as you search.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Select value={subject} onValueChange={setSubject}>
          <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
          <SelectContent>{subjects.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="Chapter, e.g. Determinants" />
        <Input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Concept, e.g. Row operations" />
      </div>
      <Input className="mt-3" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Doubt title" />
      <Textarea
        className="mt-3 min-h-28"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write the full doubt. You can include steps, formulas, and mathematical expressions like det(A), x^2, or row operations."
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary/30 bg-background/70 px-3 py-2 text-sm font-semibold text-primary">
          <ImagePlus className="h-4 w-4" />
          {file ? file.name : "Optional image"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button onClick={submit} disabled={posting} className="bg-gradient-primary text-primary-foreground">
          <Send className="mr-2 h-4 w-4" />
          {posting ? "Posting..." : "Post Doubt"}
        </Button>
      </div>
    </Card>
  );
}

function AnswerComposer({ selected, onAnswered }: { selected: CommunityDoubt | null; onAnswered: () => void }) {
  const { user } = useAuth();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    if (!selected || !body.trim()) return;
    setPosting(true);
    try {
      const imageUrl = await uploadDoubtImage(file, user?.id);
      const serviceCtx = ctx && academicReady ? ctx : await resolveStudentServiceContext();
      await DoubtService.reply(serviceCtx, {
        _doubt_id: selected.id,
        _body: body,
        _image_url: imageUrl,
      });
      toast.success("Answer added.");
      setBody("");
      setFile(null);
      onAnswered();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not add answer.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold">
        <Lightbulb className="h-4 w-4 text-primary" />
        Share an explanation
      </div>
      <Textarea
        className="min-h-28 bg-background"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a helpful answer. Step-by-step explanations, formulas, and reasoning work best."
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs font-semibold">
          <FileImage className="h-3.5 w-3.5" />
          {file ? file.name : "Attach image"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button size="sm" onClick={submit} disabled={!selected || posting}>
          {posting ? "Posting..." : "Post Answer"}
        </Button>
      </div>
    </Card>
  );
}

function DoubtDetail({
  selected,
  answers,
  related,
  onVoteAnswer,
  onAccept,
  onOpenRelated,
  onAnswered,
}: {
  selected: CommunityDoubt | null;
  answers: CommunityAnswer[];
  related: CommunityDoubt[];
  onVoteAnswer: (id: string) => void;
  onAccept: (id: string) => void;
  onOpenRelated: (doubt: CommunityDoubt) => void;
  onAnswered: () => void;
}) {
  const { user } = useAuth();

  if (!selected) {
    return (
      <Card className="sticky top-4 p-8 text-center">
        <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h3 className="mt-3 font-bold">Open a discussion</h3>
        <p className="mt-1 text-sm text-muted-foreground">Select any doubt to view answers, related concepts, and helpful explanations.</p>
      </Card>
    );
  }

  const canAccept = selected.user_id === user?.id;

  return (
    <div className="sticky top-4 space-y-4">
      <Card className="overflow-hidden border-primary/20 shadow-card">
        <div className="bg-gradient-to-br from-primary/15 via-accent/10 to-background p-5">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(selected.status)}
            <Badge variant="outline" className="rounded-full bg-background/70">{selected.subject || "Subject"}</Badge>
            {selected.chapter && <Badge variant="outline" className="rounded-full bg-background/70">{selected.chapter}</Badge>}
          </div>
          <h2 className="mt-4 text-xl font-black leading-tight">{selected.title}</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Asked by <span className="font-semibold text-foreground">{selected.student_name}</span> · {selected.class_label} · {formatDate(selected.created_at)}
          </p>
        </div>
        <div className="space-y-4 p-5">
          <RichBody body={selected.body} />
          {selected.image_url && <img src={selected.image_url} alt="Doubt attachment" className="max-h-72 rounded-2xl border object-contain" />}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{selected.answer_count} answers</span>
            <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{selected.view_count} views</span>
            <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" />{selected.upvote_count} helpful</span>
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-black">Answers ranked by usefulness</h3>
          <Badge variant="outline">{answers.length}</Badge>
        </div>
        {answers.map((answer) => (
          <Card
            key={answer.id}
            className={cn(
              "p-4",
              answer.is_accepted && "border-emerald-500/40 bg-emerald-500/5",
              answer.is_teacher_verified && !answer.is_accepted && "border-blue-500/40 bg-blue-500/5",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{answer.author_name}</span>
                  {answer.is_accepted && <Badge className="bg-emerald-600 text-white"><Crown className="mr-1 h-3 w-3" />Best Answer</Badge>}
                  {answer.is_teacher_verified && <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-700"><BadgeCheck className="mr-1 h-3 w-3" />Teacher Verified</Badge>}
                  <span className="text-xs text-muted-foreground">{formatDate(answer.created_at)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onVoteAnswer(answer.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-bold transition hover:bg-primary/10 hover:text-primary"
              >
                <ArrowUp className="h-3.5 w-3.5" />
                {answer.upvote_count}
              </button>
            </div>
            <div className="mt-3">
              <RichBody body={answer.body} />
              {answer.image_url && <img src={answer.image_url} alt="Answer attachment" className="mt-3 max-h-64 rounded-xl border object-contain" />}
            </div>
            {canAccept && !answer.is_accepted && (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => onAccept(answer.id)}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Mark Accepted Answer
              </Button>
            )}
          </Card>
        ))}
        {answers.length === 0 && (
          <Card className="p-5 text-center text-sm text-muted-foreground">
            No answers yet. Be the first to help with a clear explanation.
          </Card>
        )}
      </div>

      <AnswerComposer selected={selected} onAnswered={onAnswered} />

      {related.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 font-black">
            <Sparkles className="h-4 w-4 text-primary" />
            Related doubts
          </h3>
          <div className="space-y-2">
            {related.slice(0, 4).map((doubt) => (
              <button
                key={doubt.id}
                type="button"
                onClick={() => onOpenRelated(doubt)}
                className="block w-full rounded-xl border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
              >
                <p className="line-clamp-1 text-sm font-bold">{doubt.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{doubt.answer_count} answers · {doubt.concept || doubt.chapter || doubt.subject}</p>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function TeacherDoubtDashboard({ data }: { data: TeacherDashboardData | null }) {
  if (!data) return null;
  const totals = data.totals ?? { open: 0, teacher_answered: 0, solved: 0, total: 0 };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Open doubts", value: totals.open, icon: HelpCircle, tone: "text-amber-700 bg-amber-500/10" },
          { label: "Teacher answered", value: totals.teacher_answered, icon: BadgeCheck, tone: "text-blue-700 bg-blue-500/10" },
          { label: "Solved", value: totals.solved, icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-500/10" },
          { label: "Total discussions", value: totals.total, icon: MessageCircle, tone: "text-primary bg-primary/10" },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <div className={cn("mb-3 flex h-10 w-10 items-center justify-center rounded-2xl", item.tone)}>
              <item.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-black">{item.value}</p>
            <p className="text-xs font-semibold text-muted-foreground">{item.label}</p>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <h3 className="mb-3 font-black">Frequently confused topics</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.concepts.map((concept) => (
            <div key={concept.label} className="rounded-2xl border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold">{concept.label}</span>
                <Badge variant="outline">{concept.total} doubts</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{concept.unresolved} still need attention</p>
            </div>
          ))}
          {data.concepts.length === 0 && <p className="text-sm text-muted-foreground">No doubt patterns yet.</p>}
        </div>
      </Card>
    </div>
  );
}

export function CommunityDoubtPortal({ mode = "student" }: { mode?: "student" | "teacher" }) {
  const { user } = useAuth();
  const [doubts, setDoubts] = useState<CommunityDoubt[]>([]);
  const [answers, setAnswers] = useState<CommunityAnswer[]>([]);
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [teacherData, setTeacherData] = useState<TeacherDashboardData | null>(null);
  const [selected, setSelected] = useState<CommunityDoubt | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FeedFilter>("recent");
  const [showAsk, setShowAsk] = useState(mode === "student");
  const [loading, setLoading] = useState(true);

  const loadDoubts = async (preferredId?: string) => {
    setLoading(true);
    const { data, error } = await db
      .from("community_doubts")
      .select("*")
      .order("last_activity_at", { ascending: false })
      .limit(120);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as CommunityDoubt[];
    setDoubts(rows);
    const next = preferredId ? rows.find((doubt) => doubt.id === preferredId) : selected ? rows.find((doubt) => doubt.id === selected.id) : rows[0];
    setSelected(next ?? rows[0] ?? null);
    setLoading(false);
  };

  const loadAnswers = async (doubt: CommunityDoubt | null) => {
    if (!doubt) {
      setAnswers([]);
      return;
    }
    await db.rpc("rpc_record_community_doubt_view", { _doubt_id: doubt.id });
    const { data, error } = await db
      .from("community_doubt_answers")
      .select("*")
      .eq("doubt_id", doubt.id)
      .order("is_accepted", { ascending: false })
      .order("is_teacher_verified", { ascending: false })
      .order("upvote_count", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    setAnswers((data ?? []) as CommunityAnswer[]);
  };

  const loadReputation = async () => {
    if (!user) return;
    const { data } = await db.from("community_reputation").select("*").eq("user_id", user.id).maybeSingle();
    setReputation((data ?? null) as Reputation | null);
  };

  const loadTeacherDashboard = async () => {
    if (mode !== "teacher") return;
    const { data, error } = await db.rpc("rpc_teacher_doubt_dashboard");
    if (!error) setTeacherData(data as TeacherDashboardData);
  };

  useEffect(() => {
    loadDoubts();
    loadReputation();
    loadTeacherDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, mode]);

  useEffect(() => {
    loadAnswers(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const filtered = useMemo(() => {
    const base = doubts.filter((doubt) => includesQuery(doubt, query));
    const scoped = base.filter((doubt) => {
      if (filter === "mine") return doubt.user_id === user?.id;
      if (filter === "unanswered") return doubt.status === "unsolved";
      if (filter === "teacher") return doubt.teacher_answered;
      return true;
    });
    if (filter === "trending") {
      return [...scoped].sort((a, b) => (b.upvote_count + b.view_count + b.answer_count * 3) - (a.upvote_count + a.view_count + a.answer_count * 3));
    }
    return scoped;
  }, [doubts, filter, query, user?.id]);

  const related = useMemo(() => {
    if (!selected) return [];
    return doubts
      .filter((doubt) => doubt.id !== selected.id)
      .filter((doubt) => {
        const sameConcept = selected.concept && normalize(doubt.concept) === normalize(selected.concept);
        const sameChapter = selected.chapter && normalize(doubt.chapter) === normalize(selected.chapter);
        const sameSubject = selected.subject && normalize(doubt.subject) === normalize(selected.subject);
        return sameConcept || sameChapter || sameSubject;
      })
      .slice(0, 6);
  }, [doubts, selected]);

  const similarBeforePosting = useMemo(() => {
    if (!query.trim()) return [];
    return doubts.filter((doubt) => includesQuery(doubt, query) && doubt.status !== "unsolved").slice(0, 3);
  }, [doubts, query]);

  const voteDoubt = async (id: string) => {
    const { error } = await db.rpc("rpc_vote_community_doubt", { _doubt_id: id });
    if (error) return toast.error(error.message);
    await loadDoubts(id);
  };

  const voteAnswer = async (id: string) => {
    const { error } = await db.rpc("rpc_vote_community_answer", { _answer_id: id });
    if (error) return toast.error(error.message);
    await loadAnswers(selected);
    await loadReputation();
  };

  const acceptAnswer = async (id: string) => {
    const { error } = await db.rpc("rpc_mark_best_community_answer", { _answer_id: id });
    if (error) return toast.error(error.message);
    toast.success("Best answer selected.");
    await loadAnswers(selected);
    await loadDoubts(selected?.id);
    await loadReputation();
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-[#083f2b] via-[#126847] to-[#b28a28] p-0 text-white shadow-elevated">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr] lg:p-8">
          <div>
            <Badge className="mb-4 bg-white/15 text-white border-white/20" variant="outline">
              <Users className="mr-1 h-3.5 w-3.5" />
              Community Learning
            </Badge>
            <h2 className="text-3xl font-black tracking-tight">Doubt Portal</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/80">
              Ask doubts, find similar solved discussions, learn from classmates, and get trusted teacher explanations in one academic community.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              {[
                { label: "Doubts", value: doubts.length },
                { label: "Answered", value: doubts.filter((doubt) => doubt.answer_count > 0).length },
                { label: "Teacher guided", value: doubts.filter((doubt) => doubt.teacher_answered).length },
                { label: "Solved", value: doubts.filter((doubt) => doubt.status === "solved").length },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur">
                  <p className="text-2xl font-black">{item.value}</p>
                  <p className="text-xs font-semibold text-white/70">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-primary">
                <Search className="h-5 w-5" />
              </div>
              <div>
                <p className="font-black">Search before asking</p>
                <p className="text-xs text-white/70">Reduce duplicate doubts and learn instantly from answered threads.</p>
              </div>
            </div>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-3 h-4 w-4 text-white/60" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="border-white/20 bg-white/15 pl-9 text-white placeholder:text-white/60"
                placeholder="Search determinants, row operations, photosynthesis..."
              />
            </div>
          </div>
        </div>
      </Card>

      {mode === "teacher" && <TeacherDoubtDashboard data={teacherData} />}

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <ReputationCard reputation={reputation} />
          {mode === "student" && (
            <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={() => setShowAsk((value) => !value)}>
              <Plus className="mr-2 h-4 w-4" />
              {showAsk ? "Hide ask form" : "Ask a new doubt"}
            </Button>
          )}
          <Card className="p-3">
            <div className="space-y-1">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition",
                    filter === item.id ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  <span className="inline-flex items-center gap-2"><item.icon className="h-4 w-4" />{item.label}</span>
                  <span>{item.id === "mine" ? doubts.filter((d) => d.user_id === user?.id).length : item.id === "unanswered" ? doubts.filter((d) => d.status === "unsolved").length : item.id === "teacher" ? doubts.filter((d) => d.teacher_answered).length : doubts.length}</span>
                </button>
              ))}
            </div>
          </Card>
          {mode === "teacher" && (
            <Card className="p-4">
              <h3 className="flex items-center gap-2 font-black"><GraduationCap className="h-4 w-4 text-primary" />Teacher actions</h3>
              <p className="mt-2 text-sm text-muted-foreground">Open any doubt and post an answer. Teacher answers are automatically marked as verified and highlighted for students.</p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {showAsk && mode === "student" && <AskDoubtPanel onCreated={(id) => loadDoubts(id)} />}

          {similarBeforePosting.length > 0 && (
            <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
              <h3 className="mb-3 flex items-center gap-2 font-black text-emerald-700">
                <Sparkles className="h-4 w-4" />
                Similar doubts already answered
              </h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {similarBeforePosting.map((doubt) => (
                  <button
                    key={doubt.id}
                    type="button"
                    onClick={() => setSelected(doubt)}
                    className="rounded-xl border bg-background p-3 text-left transition hover:border-emerald-500/50"
                  >
                    <p className="line-clamp-2 text-sm font-bold">{doubt.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{doubt.answer_count} answers · {statusCopy[doubt.status]?.label}</p>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(420px,1.15fr)]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-black">
                  <BookOpen className="h-5 w-5 text-primary" />
                  Discussion feed
                </h3>
                <Badge variant="outline">{filtered.length} results</Badge>
              </div>
              {loading ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">Loading community doubts...</Card>
              ) : filtered.length > 0 ? (
                filtered.map((doubt) => (
                  <DoubtCard
                    key={doubt.id}
                    doubt={doubt}
                    selected={selected?.id === doubt.id}
                    onOpen={setSelected}
                    onVote={voteDoubt}
                  />
                ))
              ) : (
                <Card className="p-8 text-center">
                  <HelpCircle className="mx-auto h-10 w-10 text-muted-foreground" />
                  <p className="mt-3 font-bold">No matching doubts yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Ask a new doubt or switch filters to explore the community.</p>
                </Card>
              )}
            </div>

            <DoubtDetail
              selected={selected}
              answers={answers}
              related={related}
              onVoteAnswer={voteAnswer}
              onAccept={acceptAnswer}
              onOpenRelated={setSelected}
              onAnswered={async () => {
                await loadAnswers(selected);
                await loadDoubts(selected?.id);
                await loadTeacherDashboard();
                await loadReputation();
              }}
            />
          </div>
        </div>
      </div>

      {mode === "student" && (
        <Card className="border-accent/20 bg-accent/5 p-4 text-sm text-muted-foreground">
          <Star className="mr-2 inline h-4 w-4 text-accent" />
          Helpful classmates earn reputation points for answers, upvotes, and accepted solutions. Teachers can verify answers so trusted explanations rise to the top.
          <Link to="/student/leaderboard" className="ml-1 font-semibold text-primary">View class rankings.</Link>
        </Card>
      )}
    </div>
  );
}
