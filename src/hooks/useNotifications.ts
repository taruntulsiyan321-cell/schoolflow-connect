import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
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

/**
 * ONE LIST PER SIGNED-IN USER, however many screens read it.
 *
 * The header's bell and the Notifications page each called this hook, and each
 * kept its own copy: two fetches of the same fifty rows on every page load,
 * two realtime channels, and a bell that went on counting a notification the
 * page had just marked read until a realtime event happened to arrive
 * (measured 2026-09-25 on www.gurukul.study). The list now lives in the query
 * cache under one key; every reader shares it, and a change made through any
 * of them is a change to it.
 */
const notificationsKey = (uid: string | null) => ["notifications", uid] as const;

async function fetchNotifications(uid: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    // Once per failed load, not once per screen reading the list.
    toast({
      title: "Could not load notifications",
      description: toErrorMessage(error, "Showing an empty inbox until the server responds."),
      variant: "destructive",
    });
    throw new Error(error.message || "Could not load notifications");
  }
  return (data ?? []) as AppNotification[];
}

/** One realtime channel per user, shared by every reader, closed with the last. */
const channels = new Map<string, { readers: number; close: () => void }>();

function watchNotifications(uid: string, queryClient: QueryClient): () => void {
  const open = channels.get(uid);
  if (open) {
    open.readers += 1;
  } else {
    const channel = supabase
      .channel(`notif-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        () => void queryClient.invalidateQueries({ queryKey: notificationsKey(uid) }),
      )
      .subscribe();
    channels.set(uid, { readers: 1, close: () => void supabase.removeChannel(channel) });
  }
  return () => {
    const entry = channels.get(uid);
    if (!entry) return;
    entry.readers -= 1;
    if (entry.readers <= 0) {
      entry.close();
      channels.delete(uid);
    }
  };
}

export function useNotifications() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const queryClient = useQueryClient();
  const key = notificationsKey(uid);

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchNotifications(uid as string),
    enabled: uid !== null,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (!uid) return;
    return watchNotifications(uid, queryClient);
  }, [uid, queryClient]);

  const items = uid ? query.data ?? [] : [];
  const loading = uid !== null && query.isPending;
  const error = query.error ? query.error.message : null;
  const unread = items.filter((n) => !n.read).length;

  const reload = useCallback(async () => {
    if (uid) await queryClient.invalidateQueries({ queryKey: notificationsKey(uid) });
  }, [uid, queryClient]);

  const update = useCallback(
    (fn: (prev: AppNotification[]) => AppNotification[]) =>
      queryClient.setQueryData<AppNotification[]>(notificationsKey(uid), (prev) => fn(prev ?? [])),
    [uid, queryClient],
  );

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
      update((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    },
    [reload, update],
  );

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", uid)
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
    update((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [uid, reload, update]);

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
      update((prev) => prev.filter((n) => n.id !== id));
    },
    [reload, update],
  );

  return { items, unread, loading, error, reload, markRead, markAllRead, remove };
}
