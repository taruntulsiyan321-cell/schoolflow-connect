import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/auth";
import { AcademicLiveProvider } from "@/academic/live";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PushNotificationsBootstrap } from "@/components/PushNotificationsBootstrap";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Unauthorized from "./pages/Unauthorized";
import NotFound from "./pages/NotFound";

// Route-level code splitting keeps the initial bundle lean.
// The live app is the INDIVIDUAL student panel only (2026-10-01). The school
// side — admin, principal, teacher, parent, super admin and the school-only
// student screens — is kept whole on the `organisation` branch (tag
// organisation-archive-2026-10-01), not shipped here.
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const Legal = lazy(() => import("./pages/Legal"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
    <span className="animate-pulse">Loading…</span>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <PushNotificationsBootstrap />
          <AcademicLiveProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/login" element={<Navigate to="/auth" replace />} />
                <Route path="/signup" element={<Navigate to="/auth" replace />} />
                <Route path="/terms" element={<Legal slug="terms" />} />
                <Route path="/refund-policy" element={<Legal slug="refund-policy" />} />
                <Route path="/privacy" element={<Legal slug="privacy" />} />
                <Route path="/unauthorized" element={<ProtectedRoute><Unauthorized /></ProtectedRoute>} />
                <Route path="/student/*" element={<ProtectedRoute allow={["student"]}><StudentDashboard /></ProtectedRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AcademicLiveProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
