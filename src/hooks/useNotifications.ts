import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { toErrorMessage } from "@/lib/presentation";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  icon: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export function useNotifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    const { data, error: loadError } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (loadError) {
      setItems([]);
      setError(loadError.message || "Could not load notifications");
      toast({
        title: "Could not load notifications",
        description: toErrorMessage(loadError, "Showing an empty inbox until the server responds."),
        variant: "destructive",
      });
    } else {
      setItems(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notif-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          void reload();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, reload]);

  const unread = items.filter((n) => !n.read).length;

  const markRead = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
      if (error) {
        toast({
          title: "Could not mark notification as read",
          description: toErrorMessage(error, "Please try again."),
          variant: "destructive",
        });
        await reload();
        return;
      }
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    },
    [reload],
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    if (error) {
      toast({
        title: "Could not mark all notifications as read",
        description: toErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
      await reload();
      return;
    }
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [user, reload]);

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("notifications").delete().eq("id", id);
      if (error) {
        toast({
          title: "Could not delete notification",
          description: toErrorMessage(error, "Please try again."),
          variant: "destructive",
        });
        await reload();
        return;
      }
      setItems((prev) => prev.filter((n) => n.id !== id));
    },
    [reload],
  );

  return { items, unread, loading, error, reload, markRead, markAllRead, remove };
}
