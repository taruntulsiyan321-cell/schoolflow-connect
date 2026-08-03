import { usePushNotifications } from "@/hooks/usePushNotifications";

/** Registers native FCM device tokens when the signed-in user is on Capacitor. */
export function PushNotificationsBootstrap() {
  usePushNotifications();
  return null;
}
