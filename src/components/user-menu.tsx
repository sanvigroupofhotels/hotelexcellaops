import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { HelpCircle, LogOut, Sun, Moon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { InstallAppButton } from "@/components/install-app-button";

function ThemeRow() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    try {
      const v = localStorage.getItem("excella-theme");
      setTheme(v === "light" ? "light" : "dark");
    } catch {}
  }, []);
  const setT = (t: "light" | "dark") => {
    setTheme(t);
    try { localStorage.setItem("excella-theme", t); } catch {}
    if (typeof document !== "undefined") {
      const html = document.documentElement;
      html.classList.remove("light", "dark");
      html.classList.add(t);
      html.setAttribute("data-theme", t);
    }
  };
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <button onClick={() => setT("light")}
        aria-label="Light theme"
        className={cn("flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition border",
          theme === "light"
            ? "border-gold/40 bg-gold-soft text-gold"
            : "border-border text-muted-foreground hover:text-foreground")}>
        <Sun className="h-3.5 w-3.5" /> Light
      </button>
      <button onClick={() => setT("dark")}
        aria-label="Dark theme"
        className={cn("flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition border",
          theme === "dark"
            ? "border-gold/40 bg-gold-soft text-gold"
            : "border-border text-muted-foreground hover:text-foreground")}>
        <Moon className="h-3.5 w-3.5" /> Dark
      </button>
    </div>
  );
}

/**
 * User menu. Settings has been removed from here intentionally — there is
 * exactly one Settings navigation model in the PMS (the expandable Settings
 * group in the sidebar). See architecture note in app-sidebar.tsx.
 */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const initials = (user?.user_metadata?.display_name || user?.email || "?")
    .split(/[\s@]/).filter(Boolean).slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase()).join("");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Open user menu"
          className="h-9 w-9 rounded-full bg-gold-soft border border-gold/30 flex items-center justify-center text-xs font-medium text-gold hover:border-gold/60 transition">
          {initials}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64 p-1.5">
        <div className="px-3 py-2 border-b border-border mb-1">
          <div className="text-sm font-medium truncate">
            {user?.user_metadata?.display_name || user?.email}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{user?.email}</div>
        </div>
        <ThemeRow />
        <div className="h-px bg-border my-1" />
        <InstallAppButton />
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/60 transition">
          <HelpCircle className="h-4 w-4 text-gold" /> Help & Support
        </button>
        <div className="h-px bg-border my-1" />
        <button
          onClick={async () => {
            await signOut();
            toast.success("Signed out");
            navigate({ to: "/login" });
          }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </PopoverContent>
    </Popover>
  );
}
