import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { Loader2 } from "lucide-react";
import { usePushNotifications } from "@/hooks/use-push-notifications";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  // Auto-refresh push subscription on every authenticated mount. If permission
  // is not yet granted, this is a no-op — users opt in from Settings.
  usePushNotifications({ autoRegister: true });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;

  return (
    <div className="min-h-screen bg-background grain">
      <AppSidebar />
      <main className="md:pl-64 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
