import { Navigate } from "react-router-dom";

/** Leaderboard lives under Gurukul Class → Rankings. */
export default function LeaderboardPage() {
  return <Navigate to="/student/leaderboard" replace />;
}
