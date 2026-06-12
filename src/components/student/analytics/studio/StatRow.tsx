type Props = {
  classRank: number | null;
  streak: number;
  totalXp: number;
  sessions: number;
};

export function StatRow({ classRank, streak, totalXp, sessions }: Props) {
  const items = [
    { label: "Class Rank", value: classRank != null ? `#${classRank}` : "—" },
    { label: "Streak", value: `${streak}d` },
    { label: "Total XP", value: totalXp.toLocaleString() },
    { label: "Sessions", value: sessions.toString() },
  ];

  return (
    <div className="as-stat-row">
      {items.map((item) => (
        <div key={item.label} className="as-stat-box">
          <div className="as-stat-box__value">{item.value}</div>
          <div className="as-stat-box__label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
