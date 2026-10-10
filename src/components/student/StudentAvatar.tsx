import { useState } from "react";
import { User } from "lucide-react";

/**
 * What stands for the student wherever their initials used to (D1): their
 * photo when they have one and it loads; else their initials; else a plain
 * figure until the name is known — never a made-up pair. The one place this is
 * decided, so the top bar, the account menu, the Account tab and the Profile
 * card cannot disagree. The caller gives the circle its size, colour and
 * `overflow-hidden`, so the photo is cut to it.
 */
export function StudentAvatar({ url, initials, iconClassName }: { url: string | null; initials: string; iconClassName: string }) {
  // A link that fails (expired, offline) falls back to the initials, not a broken image.
  const [broken, setBroken] = useState<string | null>(null);
  if (url && broken !== url) {
    return <img src={url} alt="" className="h-full w-full object-cover" onError={() => setBroken(url)} data-testid="student-photo" />;
  }
  return initials ? <>{initials}</> : <User className={iconClassName} aria-hidden />;
}
