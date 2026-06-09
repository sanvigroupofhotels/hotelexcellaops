import { Toaster as Sonner, toast as sonnerToast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * P4 — Notification UX
 *   Success / info  → auto-dismiss after 2 seconds.
 *   Error / warning → stay visible until user dismisses (manual close).
 *
 * sonner's global `duration` prop sets the default; per-type overrides
 * are applied once on the singleton `toast` so every existing call site
 * (`toast.error(...)`, `toast.warning(...)`) is automatically persistent
 * without changing dozens of imports.
 */
let __patched = false;
function patchPersistentToasts() {
  if (__patched) return;
  __patched = true;
  const t: any = sonnerToast;
  const wrap = (fn: any) => (msg: any, opts: any = {}) =>
    fn(msg, { duration: Infinity, closeButton: true, ...opts });
  if (typeof t.error === "function") t.error = wrap(t.error.bind(sonnerToast));
  if (typeof t.warning === "function") t.warning = wrap(t.warning.bind(sonnerToast));
}
patchPersistentToasts();

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      duration={2000}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
