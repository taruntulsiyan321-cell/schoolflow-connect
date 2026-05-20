import { ReactNode } from "react";

// Auth temporarily disabled — all routes are open and treated as admin.
export const ProtectedRoute = ({ children }: { children: ReactNode; allow?: any }) => {
  return <>{children}</>;
};
