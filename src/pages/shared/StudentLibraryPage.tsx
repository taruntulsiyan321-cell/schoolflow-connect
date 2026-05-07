import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { Library, BookOpen, Search, Clock, CheckCircle } from "lucide-react";

export default function StudentLibraryPage() {
  const { user } = useAuth();
  const [books, setBooks] = useState<any[]>([]);
  const [checkouts, setCheckouts] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Get student ID
      const { data: s } = await supabase
        .from("students")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      setStudentId(s?.id || null);

      // Load all books
      const { data: allBooks } = await supabase
        .from("library_books")
        .select("*")
        .order("title");
      setBooks(allBooks ?? []);

      // Load student's checkouts
      if (s?.id) {
        const { data: myCheckouts } = await supabase
          .from("library_checkouts")
          .select("*, library_books(title, author)")
          .eq("student_id", s.id)
          .order("checked_out_at", { ascending: false });
        setCheckouts(myCheckouts ?? []);
      }

      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading…</p>;
  }

  const filtered = books.filter(
    (b) =>
      !search ||
      b.title?.toLowerCase().includes(search.toLowerCase()) ||
      b.author?.toLowerCase().includes(search.toLowerCase()) ||
      b.category?.toLowerCase().includes(search.toLowerCase())
  );

  const borrowed = checkouts.filter((c) => c.status === "borrowed");
  const returned = checkouts.filter((c) => c.status === "returned");

  // Check for overdue books
  const today = new Date().toISOString().split("T")[0];
  const overdue = borrowed.filter((c) => c.due_date && c.due_date < today);

  const categories = [...new Set(books.map((b) => b.category).filter(Boolean))];

  return (
    <>
      <PageHeader title="Library" subtitle="Browse books and track borrowed items" />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard
          icon={<Library className="w-5 h-5" />}
          label="Total Books"
          value={books.length}
        />
        <StatCard
          icon={<BookOpen className="w-5 h-5" />}
          label="Borrowed"
          value={borrowed.length}
          tone="accent"
        />
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? "warning" : undefined}
        />
      </div>

      <Tabs defaultValue="catalog" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="catalog">📚 Catalog</TabsTrigger>
          <TabsTrigger value="borrowed">📖 My Books</TabsTrigger>
        </TabsList>

        {/* Catalog */}
        <TabsContent value="catalog">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by title, author, or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Category chips */}
          {categories.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-4">
              <Badge
                variant="outline"
                className={`cursor-pointer ${!search ? "bg-primary/10 text-primary border-primary/30" : ""}`}
                onClick={() => setSearch("")}
              >
                All
              </Badge>
              {categories.map((cat) => (
                <Badge
                  key={cat}
                  variant="outline"
                  className={`cursor-pointer ${search === cat ? "bg-primary/10 text-primary border-primary/30" : ""}`}
                  onClick={() => setSearch(cat)}
                >
                  {cat}
                </Badge>
              ))}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            {filtered.map((b) => (
              <Card key={b.id} className="p-4">
                <div className="flex gap-3">
                  <div className="w-12 h-16 rounded bg-muted flex items-center justify-center shrink-0">
                    <BookOpen className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{b.title}</div>
                    <div className="text-xs text-muted-foreground">{b.author}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-[10px]">{b.category}</Badge>
                      <span className={`text-xs font-medium ${b.available_copies > 0 ? "text-accent" : "text-destructive"}`}>
                        {b.available_copies > 0 ? `${b.available_copies} available` : "All borrowed"}
                      </span>
                    </div>
                    {b.shelf_location && (
                      <div className="text-[10px] text-muted-foreground mt-1">📍 {b.shelf_location}</div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full text-muted-foreground text-center py-8">
                {books.length === 0 ? "Library catalog is empty." : "No books match your search."}
              </p>
            )}
          </div>
        </TabsContent>

        {/* My Books */}
        <TabsContent value="borrowed">
          {borrowed.length > 0 && (
            <>
              <h3 className="font-semibold mb-3">Currently Borrowed</h3>
              <div className="space-y-2 mb-6">
                {borrowed.map((c) => (
                  <Card key={c.id} className={`p-4 shadow-card ${c.due_date < today ? "border-l-4 border-l-destructive" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-sm">{c.library_books?.title}</div>
                        <div className="text-xs text-muted-foreground">{c.library_books?.author}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Borrowed: {new Date(c.checked_out_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-muted-foreground">Due</div>
                        <div className={`text-sm font-medium ${c.due_date < today ? "text-destructive" : ""}`}>
                          {c.due_date ? new Date(c.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}
                        </div>
                        {c.due_date < today && (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[10px] mt-1">
                            Overdue
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {returned.length > 0 && (
            <>
              <h3 className="font-semibold mb-3">Return History</h3>
              <div className="space-y-2">
                {returned.slice(0, 10).map((c) => (
                  <Card key={c.id} className="p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{c.library_books?.title}</div>
                      <div className="text-xs text-muted-foreground">{c.library_books?.author}</div>
                    </div>
                    <div className="flex items-center gap-1 text-accent">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span className="text-xs">Returned</span>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {checkouts.length === 0 && (
            <Card className="p-8 text-center">
              <Library className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">You haven't borrowed any books yet.</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
