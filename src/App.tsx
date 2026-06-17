import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicLayout } from "./components/PublicLayout";
import { PublicOnlyRoute } from "./components/PublicOnlyRoute";
import { Toaster } from "./components/ui/sonner";
import { ThemeProvider } from "./contexts/ThemeContext";
import {
  DashboardPage,
  IDEPage,
  LandingPage,
  LoginPage,
  OnboardingPage,
  SettingsPage,
  SignupPage,
} from "./pages";
import { CheckoutSuccess } from "./pages/CheckoutSuccess";
import { PricingPage } from "./pages/PricingPage";

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable={false}>
        <Toaster />
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
            {/* Onboarding - full screen, no sidebar */}
            <Route path="/onboarding" element={<OnboardingPage />} />
          </Route>

          {/* Public pricing page */}
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/checkout/success" element={<CheckoutSuccess />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
