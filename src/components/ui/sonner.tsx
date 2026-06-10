import { Toaster as Sonner, toast as sonnerToast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Notification UX
 *   Success / info / warning → auto-dismiss after 7 seconds.
 *   Errors (critical) → stay visible until user dismisses (manual close).
 */
let __patched = false;
function patchPersistentToasts() {
  if (__patched) return;
  __patched = true;
  const t: any = sonnerToast;
  const wrap = (fn: any) => (msg: any, opts: any = {}) =>
    fn(msg, { duration: Infinity, closeButton: true, ...opts });
  if (typeof t.error === "function") t.error = wrap(t.error.bind(sonnerToast));
}
patchPersistentToasts();

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      duration={7000}
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
