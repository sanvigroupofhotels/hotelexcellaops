import { Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useUserRole } from "@/hooks/use-role";

/**
 * Client-side admin gate. Non-admins land on the House View (operator home).
 * Pair with RLS — this is UX only; backend permissions are the real guard.
 */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useUserRole();
  if (isLoading) {
    return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }
  if (!isAdmin) return <Navigate to="/house-view" />;
  return <>{children}</>;
}
