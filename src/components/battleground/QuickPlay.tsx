import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Sword, Zap, Sparkles, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

const SUBJECTS = ["Mathematics", "Science", "Physics", "Chemistry", "Biology", "English", "Social Studies", "General Knowledge", "Computer Science"];
const DIFFICULTIES = ["easy", "medium", "hard"];

export function QuickPlay({ defaultClassId }: { defaultClassId?: string | null }) {
  const nav = useNavigate();
  const [subject, setSubject] = useState("Mathematics");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [perQ, setPerQ] = useState(20);
  const [loading, setLoading] = useState(false);

  const launch = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("rpc_create_quick_battle" as any, {
      _subject: subject, _difficulty: difficulty, _count: count, _per_q: perQ,
      _chapter: null, _class_id: defaultClassId ?? null,
    });
    setLoading(false);
    if (error) { toast({ title: error.message, variant: "destructive" }); return; }
    toast({ title: "Quick battle ready!" });
    nav(`/student/battleground/battle/${data}`);
  };

  return (
    <Card className="p-5 space-y-4 border-2 border-primary/20 bg-gradient-to-br from-card to-primary/5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-battle text-white flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold flex items-center gap-2">Quick Play <Sparkles className="w-3.5 h-3.5 text-warning" /></div>
          <div className="text-xs text-muted-foreground">Random questions from the bank — instant battle.</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Subject</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SUBJECTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Difficulty</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DIFFICULTIES.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Questions</Label>
          <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[5,8,10,15,20].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Seconds / Q</Label>
          <Select value={String(perQ)} onValueChange={(v) => setPerQ(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[10,15,20,30,45,60].map(n => <SelectItem key={n} value={String(n)}>{n}s</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={launch} disabled={loading} className="w-full bg-gradient-battle text-white font-bold">
        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sword className="w-4 h-4 mr-2" />}
        Launch Quick Battle
      </Button>
    </Card>
  );
}
