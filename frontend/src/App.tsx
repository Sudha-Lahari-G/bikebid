import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import type { Role } from "./lib/types";
import { AdminAuctionForm } from "./pages/AdminAuctionForm";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AuctionDetailPage } from "./pages/AuctionDetailPage";
import { AuctionsPage } from "./pages/AuctionsPage";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import { MyBidsPage } from "./pages/MyBidsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="h-6 w-6 text-zinc-500" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AuctionsPage />} />
        <Route path="auctions/:id" element={<AuctionDetailPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route
          path="my-bids"
          element={
            <RequireRole role="user">
              <MyBidsPage />
            </RequireRole>
          }
        />
        <Route
          path="admin"
          element={
            <RequireRole role="admin">
              <AdminDashboard />
            </RequireRole>
          }
        />
        <Route
          path="admin/auctions/new"
          element={
            <RequireRole role="admin">
              <AdminAuctionForm />
            </RequireRole>
          }
        />
        <Route
          path="admin/auctions/:id/edit"
          element={
            <RequireRole role="admin">
              <AdminAuctionForm />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
