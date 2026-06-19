import { Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";

interface PermissionGateProps {
  permission?: string;
  anyOf?: string[];
  allOf?: string[];
  redirectTo?: string;
  children: React.ReactNode;
}

export function PermissionGate({
  permission,
  anyOf,
  allOf,
  redirectTo = "/",
  children,
}: PermissionGateProps) {
  const { has, hasAny, isLoading } = usePermissions();

  if (isLoading) {
    return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }

  const allowed = permission
    ? has(permission)
    : anyOf
      ? hasAny(anyOf)
      : allOf
        ? allOf.every((key) => has(key))
        : true;

  if (!allowed) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}