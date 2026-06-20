import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl text-gold">404</h1>
        <h2 className="mt-4 font-display text-xl text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for has checked out.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md gold-gradient px-5 py-2.5 text-sm font-medium text-charcoal transition hover:opacity-90"
          >
            Return to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-xl text-foreground">Something didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:border-gold/40"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Hotel Excella Operations" },
      { name: "description", content: "Front-desk, reservations and operations platform for Hotel Excella." },
      { name: "theme-color", content: "#0B0B0F" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Excella Ops" },
      { property: "og:site_name", content: "Hotel Excella Operations" },
      { property: "og:title", content: "Hotel Excella Operations" },
      { name: "twitter:title", content: "Hotel Excella Operations" },
      { property: "og:description", content: "Front-desk, reservations and operations platform for Hotel Excella." },
      { name: "twitter:description", content: "Front-desk, reservations and operations platform for Hotel Excella." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/261c0488-0dba-4aeb-8555-36b32d8c8a66/id-preview-cd0a4d7e--bf9d317a-170f-4eb0-82c9-ac90cf77e6ab.lovable.app-1779321940047.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/261c0488-0dba-4aeb-8555-36b32d8c8a66/id-preview-cd0a4d7e--bf9d317a-170f-4eb0-82c9-ac90cf77e6ab.lovable.app-1779321940047.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "apple-touch-icon", sizes: "192x192", href: "/icon-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Fraunces:wght@500;600;700&family=Inter:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  const themeBootstrap = `
    (function(){
      try {
        var t = localStorage.getItem('excella-theme');
        if (t !== 'light' && t !== 'dark') t = 'light';
        document.documentElement.classList.remove('light','dark');
        document.documentElement.classList.add(t);
        document.documentElement.setAttribute('data-theme', t);
      } catch(e) {
        document.documentElement.classList.add('light');
      }
    })();
  `;
  const portalGuard = `
    (function(){
      try {
        if (location.pathname.indexOf('/portal') === 0) {
          var m = document.querySelector('link[rel="manifest"]');
          if (m && m.parentNode) m.parentNode.removeChild(m);
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(rs){
              rs.forEach(function(r){ r.unregister(); });
            }).catch(function(){});
          }
        }
      } catch(e) {}
    })();
  `;
  return (
    <html lang="en" className="light">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script dangerouslySetInnerHTML={{ __html: portalGuard }} />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if (typeof window === "undefined" || (window as any).__excella_swept) return;
    (window as any).__excella_swept = true;
    import("@/integrations/supabase/client").then(({ supabase }) => {
      supabase.rpc("sweep_stay_completed" as any).then(() => {
        queryClient.invalidateQueries({ queryKey: ["bookings"] });
      });
    }).catch(() => {});
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
