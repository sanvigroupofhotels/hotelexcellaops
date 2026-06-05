import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { toast } from "sonner";

type BIP = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton({ className }: { className?: string }) {
  const [prompt, setPrompt] = useState<BIP | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const isStandalone = () =>
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // @ts-ignore — iOS Safari
      window.navigator.standalone === true;
    setInstalled(isStandalone());

    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as BIP); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); toast.success("App installed"); };
    window.addEventListener("beforeinstallprompt", onPrompt as any);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt as any);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const click = async () => {
    if (installed) {
      toast.message("App is already installed on this device.");
      return;
    }
    if (prompt) {
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === "accepted") toast.success("Installing…");
        else toast.message("Install cancelled");
        setPrompt(null);
      } catch (e: any) {
        toast.error(e?.message ?? "Install failed");
      }
      return;
    }
    // No native prompt available — give platform-specific guidance.
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(/Windows/.test(ua));
    if (isIOS) {
      toast.message("On iOS: tap the Share button, then 'Add to Home Screen'.", { duration: 6000 });
    } else {
      toast.message("Open your browser menu and choose 'Install app' / 'Add to Home screen'.", { duration: 6000 });
    }
  };

  return (
    <button onClick={click}
      className={className ?? "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition"}>
      <Smartphone className="h-4 w-4 text-gold" />
      {installed ? "App Installed" : "Install App"}
    </button>
  );
}
