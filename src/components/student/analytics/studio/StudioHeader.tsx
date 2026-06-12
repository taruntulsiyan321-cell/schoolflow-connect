import { Flame, Zap } from "lucide-react";

type Props = {
  streak: number;
  xp: number;
  level: number;
  initials: string;
};

export function StudioHeader({ streak, xp, level, initials }: Props) {
  return (
    <header className="as-header">
      <div className="as-header__brand">Analytics Studio</div>
      <div className="as-header__pills">
        <span className="as-pill as-pill--streak">
          <Flame className="w-3.5 h-3.5" />
          {streak}d
        </span>
        <span className="as-pill as-pill--xp">
          <Zap className="w-3.5 h-3.5" />
          L{level} · {xp.toLocaleString()} XP
        </span>
        <div className="as-avatar" aria-label="Your profile">
          {initials}
        </div>
      </div>
    </header>
  );
}
