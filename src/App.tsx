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
import ResetPassword from "./pages/ResetPassword";
import Unauthorized from "./pages/Unauthorized";
import NotFound from "./pages/NotFound";
import OAuthConsent from "./pages/OAuthConsent";

// Route-level code splitting keeps the initial bundle lean.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const PrincipalDashboard = lazy(() => import("./pages/PrincipalDashboard"));
const TeacherDashboard = lazy(() => import("./pages/TeacherDashboard"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const ParentDashboard = lazy(() => import("./pages/ParentDashboard"));

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
                <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/unauthorized" element={<ProtectedRoute><Unauthorized /></ProtectedRoute>} />
                <Route path="/admin/*" element={<ProtectedRoute allow={["admin", "super_admin"]}><AdminDashboard /></ProtectedRoute>} />
                <Route path="/principal/*" element={<ProtectedRoute allow={["principal"]}><PrincipalDashboard /></ProtectedRoute>} />
                <Route path="/teacher/*" element={<ProtectedRoute allow={["teacher"]}><TeacherDashboard /></ProtectedRoute>} />
                <Route path="/student/*" element={<ProtectedRoute allow={["student"]}><StudentDashboard /></ProtectedRoute>} />
                <Route path="/parent/*" element={<ProtectedRoute allow={["parent"]}><ParentDashboard /></ProtectedRoute>} />
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
