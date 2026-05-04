import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GraduationCap, Users, ClipboardCheck, Megaphone, Wallet, BookOpen, Trophy,
  Bell, ShieldCheck, Smartphone, Languages, Bus, Brain, Video, Camera,
  IdCard, Library, ArrowRight, Sparkles, CheckCircle2,
} from "lucide-react";

const roles = [
  { icon: ShieldCheck, title: "Admin / Principal", desc: "Full control: students, teachers, classes, fees, notices, analytics." },
  { icon: GraduationCap, title: "Teacher", desc: "Mark attendance, enter marks, post notices to assigned classes." },
  { icon: BookOpen, title: "Student", desc: "Track attendance, results, fees and class notices in one place." },
  { icon: Users, title: "Parent", desc: "Stay updated on child's attendance, marks, fees and announcements." },
];

const liveModules = [
  { icon: ClipboardCheck, title: "Attendance", desc: "Daily marking with present/absent/leave per class." },
  { icon: BookOpen, title: "Exams & Marks", desc: "Create exams, enter marks, share results instantly." },
  { icon: Trophy, title: "Leaderboard", desc: "Class-wise ranking by overall percentage." },
  { icon: Wallet, title: "Fees", desc: "Monthly fee generation, paid/partial/unpaid tracking." },
  { icon: Megaphone, title: "Notices", desc: "Targeted announcements: all, role, class or section." },
  { icon: Users, title: "User Linking", desc: "Map signed-up users to student/parent/teacher records." },
];

const upcoming = [
  { icon: Bell, title: "Push Notifications", desc: "Native FCM alerts for notices, fees, results." },
  { icon: Smartphone, title: "Phone OTP Login", desc: "SMS-based sign-in via Twilio." },
  { icon: Bus, title: "Bus Tracking", desc: "Live route + ETA for parents." },
  { icon: Brain, title: "Homework AI Assistant", desc: "AI-powered doubt solver for students." },
  { icon: Video, title: "Online Classes", desc: "Built-in live class scheduling & links." },
  { icon: Camera, title: "Live CCTV Alerts", desc: "Smart safety alerts to admin." },
  { icon: IdCard, title: "Digital ID Cards", desc: "Auto-generated student & staff IDs." },
  { icon: Library, title: "Library Management", desc: "Books, issues, returns and dues." },
];

const stats = [
  { k: "10+", v: "Modules ready" },
  { k: "4", v: "User roles" },
  { k: "2", v: "Languages (EN/HI)" },
  { k: "100%", v: "Cloud + Secure" },
];

export default function Landing({ noRoleBanner = false }: { noRoleBanner?: boolean } = {}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-30 backdrop-blur bg-background/80 border-b border-border">
        <div className="container mx-auto flex items-center justify-between px-4 h-16">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-card">
              <GraduationCap className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg">Vidyalaya</span>
            <Badge variant="secondary" className="ml-1">Prototype</Badge>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition">Features</a>
            <a href="#roles" className="hover:text-foreground transition">Roles</a>
            <a href="#roadmap" className="hover:text-foreground transition">Roadmap</a>
            <a href="#stack" className="hover:text-foreground transition">Stack</a>
          </nav>
          <Link to="/auth">
            <Button className="bg-gradient-primary text-primary-foreground shadow-card">
              {noRoleBanner ? "Account" : "Launch Demo"} <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
        {noRoleBanner && (
          <div className="bg-warning/10 border-t border-warning/30 text-warning-foreground">
            <div className="container mx-auto px-4 py-2.5 text-sm text-foreground flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-warning" />
              You're signed in but don't have a role yet. Explore the features below — your admin will assign your role to unlock your dashboard.
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-hero text-white">
        <div className="container mx-auto px-4 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-3 py-1 text-xs mb-5 backdrop-blur">
              <Sparkles className="w-3.5 h-3.5" /> Production-ready foundation
            </div>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight">
              The complete School Management platform.
            </h1>
            <p className="text-lg md:text-xl text-white/85 mt-5 max-w-xl">
              One app for Admin, Teachers, Students & Parents. Attendance, Exams,
              Fees, Notices and more — built mobile-first, secure by default,
              and ready to scale.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link to="/auth">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 shadow-elevated">
                  Try the live demo <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
              <a href="#features">
                <Button size="lg" variant="outline" className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white">
                  See features
                </Button>
              </a>
            </div>

            <div className="grid grid-cols-4 gap-4 mt-10 max-w-md">
              {stats.map(s => (
                <div key={s.v}>
                  <div className="text-2xl md:text-3xl font-bold">{s.k}</div>
                  <div className="text-xs text-white/70 mt-1">{s.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hero mock */}
          <div className="relative">
            <div className="absolute -inset-6 bg-white/10 rounded-[2rem] blur-2xl" />
            <Card className="relative p-6 bg-white/95 text-foreground shadow-elevated rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs text-muted-foreground">Today</div>
                  <div className="font-semibold">Class 8 — Section A</div>
                </div>
                <Badge className="bg-accent text-accent-foreground">Live</Badge>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { l: "Present", v: "42", c: "bg-accent/10 text-accent" },
                  { l: "Absent", v: "3", c: "bg-destructive/10 text-destructive" },
                  { l: "Leave", v: "1", c: "bg-warning/10 text-warning" },
                ].map(x => (
                  <div key={x.l} className={`rounded-xl p-3 ${x.c}`}>
                    <div className="text-2xl font-bold">{x.v}</div>
                    <div className="text-xs opacity-80">{x.l}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {["Aarav Sharma", "Diya Patel", "Kabir Singh"].map((n, i) => (
                  <div key={n} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                        {n[0]}
                      </div>
                      <div className="text-sm font-medium">{n}</div>
                    </div>
                    <CheckCircle2 className={`w-5 h-5 ${i === 1 ? "text-muted-foreground/40" : "text-accent"}`} />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Live modules */}
      <section id="features" className="container mx-auto px-4 py-20">
        <SectionHeading
          eyebrow="What's live today"
          title="Everything a school needs, already running"
          desc="The MVP ships with the core operational modules schools use daily."
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
          {liveModules.map(m => (
            <FeatureCard key={m.title} {...m} live />
          ))}
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="bg-gradient-soft py-20">
        <div className="container mx-auto px-4">
          <SectionHeading
            eyebrow="Built for everyone"
            title="One platform. Four tailored experiences."
            desc="Every role gets a focused dashboard with role-based access control enforced end-to-end."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
            {roles.map(r => (
              <Card key={r.title} className="p-6 hover:shadow-elevated transition-all hover:-translate-y-1 bg-card">
                <div className="w-12 h-12 rounded-xl bg-gradient-primary text-primary-foreground flex items-center justify-center mb-4 shadow-card">
                  <r.icon className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-lg mb-1">{r.title}</h3>
                <p className="text-sm text-muted-foreground">{r.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap / coming soon */}
      <section id="roadmap" className="container mx-auto px-4 py-20">
        <SectionHeading
          eyebrow="Roadmap"
          title="Architected for what's next"
          desc="The foundation is ready — these modules plug in without re-architecting."
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
          {upcoming.map(m => (
            <FeatureCard key={m.title} {...m} />
          ))}
        </div>
      </section>

      {/* Stack */}
      <section id="stack" className="bg-gradient-soft py-20">
        <div className="container mx-auto px-4">
          <SectionHeading
            eyebrow="Tech stack"
            title="Modern, secure, scalable"
          />
          <div className="grid md:grid-cols-3 gap-5 mt-10">
            <StackCard icon={Smartphone} title="Mobile + Web" desc="React + Capacitor. Ship the same app to iOS, Android and web." />
            <StackCard icon={ShieldCheck} title="Secure backend" desc="PostgreSQL with row-level security and role-based access." />
            <StackCard icon={Bell} title="Realtime + Push" desc="Live updates and native FCM push notifications." />
            <StackCard icon={Languages} title="EN + HI" desc="Bilingual ready, parent-friendly UI." />
            <StackCard icon={Wallet} title="Payments-ready" desc="Drop-in Razorpay/Stripe for online fee collection." />
            <StackCard icon={Sparkles} title="AI-ready" desc="Hooked into AI gateway for tutoring & insights." />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-20">
        <Card className="relative overflow-hidden p-10 md:p-14 text-center bg-gradient-hero text-white border-0 shadow-elevated">
          <h2 className="text-3xl md:text-4xl font-bold">Ready to digitize your school?</h2>
          <p className="text-white/85 mt-3 max-w-2xl mx-auto">
            Launch the live demo, sign in as Admin / Teacher / Student / Parent and explore every flow end-to-end.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link to="/auth">
              <Button size="lg" className="bg-white text-primary hover:bg-white/90 shadow-elevated">
                Launch demo <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </Card>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Vidyalaya — School Management Platform
      </footer>
    </div>
  );
}

function SectionHeading({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <div className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">{eyebrow}</div>
      <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{title}</h2>
      {desc && <p className="text-muted-foreground mt-3">{desc}</p>}
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc, live }: { icon: any; title: string; desc: string; live?: boolean }) {
  return (
    <Card className="p-6 group hover:shadow-elevated transition-all hover:-translate-y-1 bg-card relative">
      {live && (
        <Badge className="absolute top-4 right-4 bg-accent text-accent-foreground">Live</Badge>
      )}
      <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-gradient-primary group-hover:text-primary-foreground transition-all">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </Card>
  );
}

function StackCard({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <Card className="p-6 bg-card flex gap-4 items-start">
      <div className="w-10 h-10 rounded-xl bg-gradient-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-card">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
    </Card>
  );
}
