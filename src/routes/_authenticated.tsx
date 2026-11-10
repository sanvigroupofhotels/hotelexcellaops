import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { Loader2 } from "lucide-react";
import { CopilotDrawer } from "@/components/copilot/copilot-drawer";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePushNotifications } from "@/hooks/use-push-notifications";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  // Auto-refresh push subscription on every authenticated mount. If permission
  // is not yet granted, this is a no-op — users opt in from Settings.
  usePushNotifications({ autoRegister: true });
  const queryClient = useQueryClient();
  // Stay sweep runs only once signed in, so the login screen never waits on it.
  useEffect(() => {
    if (!user || (window as any).__excella_swept) return;
    (window as any).__excella_swept = true;
    supabase.rpc("sweep_stay_completed" as any).then(() => queryClient.invalidateQueries({ queryKey: ["bookings"] }));
  }, [user, queryClient]);

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
      <CopilotDrawer />
    </div>
  );
}
