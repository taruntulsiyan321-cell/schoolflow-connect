import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Capacitor } from "@capacitor/core";

export function usePushNotifications() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    if (!Capacitor.isNativePlatform()) return;

    let mounted = true;
    (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const perm = await PushNotifications.checkPermissions();
      let status = perm.receive;
      if (status === "prompt" || status === "prompt-with-rationale") {
        status = (await PushNotifications.requestPermissions()).receive;
      }
      if (status !== "granted") return;
      await PushNotifications.register();

      PushNotifications.addListener("registration", async (token) => {
        if (!mounted) return;
        const platform = Capacitor.getPlatform();
        await supabase.from("device_tokens").upsert(
          { user_id: user.id, token: token.value, platform },
          { onConflict: "token" }
        );
      });

      PushNotifications.addListener("registrationError", (err) => {
        console.error("Push registration error", err);
      });
    })();

    return () => { mounted = false; };
  }, [user]);
}
