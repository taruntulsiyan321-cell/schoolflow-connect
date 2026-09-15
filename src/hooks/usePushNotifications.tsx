import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Capacitor } from "@capacitor/core";

/** An in-app path only: "/parent/children", never "https://…" or "//host". */
export function pushLinkOf(data: unknown): string | null {
  const link = (data as { link?: unknown } | null)?.link;
  return typeof link === "string" && link.startsWith("/") && !link.startsWith("//") ? link : null;
}

/**
 * On the Android app: registers this phone's FCM token for the signed-in user,
 * and opens what a notification is about when it is tapped.
 *
 * The token is what `notification-push` sends to (20260925190000): every
 * notification written for this user reaches this phone with the app closed.
 * Each push carries the notification's link as data; tapping it lands on that
 * page. Listeners are attached before `register()` so the token event cannot
 * fire before anything is listening.
 */
export function usePushNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (!Capacitor.isNativePlatform()) return;

    let mounted = true;
    const handles: { remove: () => Promise<void> }[] = [];
    const keep = (handle: { remove: () => Promise<void> }) => {
      if (mounted) handles.push(handle);
      else void handle.remove();
    };

    (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const perm = await PushNotifications.checkPermissions();
      let status = perm.receive;
      if (status === "prompt" || status === "prompt-with-rationale") {
        status = (await PushNotifications.requestPermissions()).receive;
      }
      if (status !== "granted" || !mounted) return;

      keep(
        await PushNotifications.addListener("registration", async (token) => {
          if (!mounted) return;
          const platform = Capacitor.getPlatform();
          const { error } = await supabase
            .from("device_tokens")
            .upsert({ user_id: user.id, token: token.value, platform }, { onConflict: "token" });
          if (error) console.error("Push token was not saved", error.message);
        }),
      );
      keep(
        await PushNotifications.addListener("registrationError", (err) => {
          console.error("Push registration error", err);
        }),
      );
      keep(
        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          const link = pushLinkOf(action.notification.data);
          if (link) navigate(link);
        }),
      );
      if (mounted) await PushNotifications.register();
    })();

    return () => {
      mounted = false;
      for (const handle of handles.splice(0)) void handle.remove();
    };
  }, [user, navigate]);
}
