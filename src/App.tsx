import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicLayout } from "./components/PublicLayout";
import { PublicOnlyRoute } from "./components/PublicOnlyRoute";
import { Toaster } from "./components/ui/sonner";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useIdleTimeout } from "./hooks/useIdleTimeout";
import { LandingPage, LoginPage, SignupPage } from "./pages";

// Lazy-load heavy pages to reduce initial bundle
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then(m => ({ default: m.DashboardPage })),
);
const IDEPage = lazy(() =>
  import("./pages/IDEPage").then(m => ({ default: m.IDEPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })),
);
const OnboardingPage = lazy(() =>
  import("./pages/OnboardingPage").then(m => ({ default: m.OnboardingPage })),
);
const PricingPage = lazy(() =>
  import("./pages/PricingPage").then(m => ({ default: m.PricingPage })),
);
const CheckoutSuccess = lazy(() =>
  import("./pages/CheckoutSuccess").then(m => ({
    default: m.CheckoutSuccess,
  })),
);
const XRayPage = lazy(() =>
  import("./pages/XRayPage").then(m => ({ default: m.XRayPage })),
);
const JoinPage = lazy(() =>
  import("./pages/JoinPage").then(m => ({ default: m.JoinPage })),
);

// Simple full-screen loading spinner for lazy pages
function PageLoader() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

function App() {
  useIdleTimeout();

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable={false}>
        <Toaster />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Landing page has its own header */}
            <Route path="/" element={<LandingPage />} />

            <Route element={<PublicLayout />}>
              <Route element={<PublicOnlyRoute />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              {/* IDE page - full screen, no sidebar */}
              <Route path="/project/:projectId" element={<IDEPage />} />
              {/* X-Ray dashboard - full screen, no sidebar */}
              <Route path="/project/:projectId/xray" element={<XRayPage />} />
              {/* Onboarding - full screen, no sidebar */}
              <Route path="/onboarding" element={<OnboardingPage />} />
              {/* Collaboration invite links - resolves inviteCode -> real project, full screen */}
              <Route path="/join/:inviteCode" element={<JoinPage />} />
            </Route>

            {/* Public pricing page */}
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/checkout/success" element={<CheckoutSuccess />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
