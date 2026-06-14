import { Navigate } from "react-router-dom";

/** Leaderboard lives inside Classes — redirect legacy URL. */
export default function LeaderboardPage() {
  return <Navigate to="/student/classes#leaderboard" replace />;
}
