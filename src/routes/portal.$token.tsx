/**
 * Public Guest Portal — view booking, update details, and pay via Razorpay.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, User, Calendar, Phone, Mail, AlertTriangle, MessageSquare, Save } from "lucide-react";
import { toast } from "sonner";
import {
  getPortalBooking,
  createRazorpayOrder,
  recordPayAtHotelIntent,
  updateGuestPortalDetails,
  confirmRazorpayPayment,
} from "@/lib/portal.functions";
import { PortalPaymentOptions, type PortalPaymentChoice } from "@/components/portal/payment-options";

export const Route = createFileRoute("/portal/$token")({
  component: GuestPortal,
  head: () => ({
    meta: [
      { title: "Complete Your Booking" },
      { name: "description", content: "Review your booking and complete your payment securely." },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="luxe-card rounded-xl p-6 max-w-md text-center space-y-2">
        <h1 className="font-display text-xl">Link unavailable</h1>
        <p className="text-sm text-muted-foreground">{error?.message ?? "This booking link could not be loaded."}</p>
      </div>
    </div>
  ),
});

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

function errMsg(e: any, fallback = "Something went wrong"): string {
  if (!e) return fallback;
  if (typeof e === "string") return e;
  if (e instanceof Error && e.message) return e.message;
  const m = e?.message ?? e?.error?.message ?? e?.body?.message ?? e?.data?.message ?? e?.json?.message;
  if (typeof m === "string" && m) return m;
  try { const s = JSON.stringify(e); if (s && s !== "{}") return s; } catch {}
  return fallback;
}

declare global { interface Window { Razorpay?: any; } }

function loadRazorpayCheckout(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Not in browser"));
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.body.appendChild(s);
  });
}

function GuestPortal() {
  const { token } = Route.useParams();
  const fetchBooking = useServerFn(getPortalBooking);
  const createOrder = useServerFn(createRazorpayOrder);
  const recordIntent = useServerFn(recordPayAtHotelIntent);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | "paid" | "pay_at_hotel">(null);

  const q = useQuery({
    queryKey: ["portal-booking", token],
    queryFn: () => fetchBooking({ data: { token } }),
    retry: false,
  });

  if (q.isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }
  if (q.error) throw q.error instanceof Error ? q.error : new Error(errMsg(q.error, "Booking link not found"));
  if (!q.data) throw new Error("Booking link not found");
  const b = q.data;

  const onChoose = async (choice: PortalPaymentChoice) => {
    setBusy(true);
    try {
      if (choice.kind === "pay_at_hotel") {
        await recordIntent({ data: { token } });
        setDone("pay_at_hotel");
        toast.success("Noted — you can pay at the hotel on check-in.");
        return;
      }
      const amount = choice.kind === "full" ? b.balanceDue : choice.amount;
      const order = await createOrder({ data: { token, amount, intent: choice.kind } });
      await loadRazorpayCheckout();
      const rzp = new window.Razorpay({
        key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
        name: "Hotel Excella", description: `Booking ${order.bookingReference}`,
        prefill: { name: order.guestName, contact: order.phone || "" },
        theme: { color: "#D4AF37" },
        handler: () => { setDone("paid"); toast.success("Payment received. We're confirming with the bank."); q.refetch(); },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on("payment.failed", (resp: any) => { toast.error(resp?.error?.description || "Payment failed"); setBusy(false); });
      rzp.open();
    } catch (e: any) {
      toast.error(errMsg(e, "Could not start payment"));
    } finally { setBusy(false); }
  };

  // ---- Profile completion ----
  const score = (() => {
    let pts = 0; const checks = [
      !!b.guestName?.trim(), !!b.phone?.trim(), !!b.email?.trim(),
      !!b.expectedArrivalAt, !!b.emergencyContactName?.trim(), !!b.emergencyContactPhone?.trim(),
    ];
    checks.forEach((c) => { if (c) pts++; });
    return { pct: Math.round((pts / checks.length) * 100), missing: [
      ...(!b.guestName?.trim() ? ["Guest Name"] : []),
      ...(!b.phone?.trim() ? ["Mobile Number"] : []),
      ...(!b.email?.trim() ? ["Email Address"] : []),
      ...(!b.expectedArrivalAt ? ["Expected Arrival Date & Time"] : []),
      ...(!b.emergencyContactName?.trim() ? ["Emergency Contact Name"] : []),
      ...(!b.emergencyContactPhone?.trim() ? ["Emergency Contact Mobile"] : []),
    ]};
  })();

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="luxe-card rounded-xl p-5">
          <div className="text-xs uppercase tracking-wider text-gold mb-1">Booking · {b.reference}</div>
          <h1 className="font-display text-2xl mb-3">Welcome, {b.guestName}</h1>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Check-In" value={b.checkIn} />
            <Field label="Check-Out" value={b.checkOut} />
            <Field label="Room" value={b.roomType} />
            <Field label="Guests" value={String(b.guests)} />
            <Field label="Room Total" value={inr(b.totalAmount)} />
            {b.chargesTotal > 0 && <Field label="In-House Charges" value={inr(b.chargesTotal)} />}
            <Field label="Payable" value={inr(b.payable)} />
            <Field label="Paid" value={inr(b.advancePaid)} />
          </div>
        </div>

        {/* Profile Completion */}
        <ProfileCompletion pct={score.pct} missing={score.missing} />

        {/* Guest Details + Arrival + Emergency + Special Requests */}
        <GuestDetailsForm token={token} initial={b} onSaved={() => q.refetch()} />

        {done ? (
          <div className="luxe-card rounded-xl p-6 text-center space-y-2">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
            <h3 className="font-display text-lg">
              {done === "paid" ? "Thank you — payment received" : "We'll see you at check-in"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {done === "paid" ? "Your booking will reflect the updated balance shortly." : "Please complete your remaining payment when you arrive."}
            </p>
          </div>
        ) : b.balanceDue > 0 ? (
          <PortalPaymentOptions
            totalAmount={b.payable}
            advancePaid={b.advancePaid}
            minPartPayment={b.minPartPayment}
            allowFull={b.allowFullPayment}
            allowPart={b.allowPartPayment}
            allowPayAtHotel={b.allowPayAtHotel}
            defaultPartPercent={b.defaultPartPercent}
            busy={busy}
            onChoose={onChoose}
          />
        ) : (
          <div className="luxe-card rounded-xl p-5 text-center text-sm text-emerald-600">
            <CheckCircle2 className="h-6 w-6 mx-auto mb-2" /> No balance due.
          </div>
        )}

        <p className="text-[10px] text-center text-muted-foreground pt-4">
          Secured by Razorpay · Your payment details never touch our servers.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-foreground">{value || "—"}</div>
    </div>
  );
}

function ProfileCompletion({ pct, missing }: { pct: number; missing: string[] }) {
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-gold" : "bg-warning";
  return (
    <div className="luxe-card rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Booking Profile</div>
        <div className="text-sm text-gold font-medium">{pct}% Complete</div>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {missing.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Missing: <span className="text-foreground">{missing.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function GuestDetailsForm({ token, initial, onSaved }: { token: string; initial: any; onSaved: () => void }) {
  const update = useServerFn(updateGuestPortalDetails);
  const [name, setName] = useState(initial.guestName ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [arrival, setArrival] = useState<string>(
    initial.expectedArrivalAt
      ? new Date(initial.expectedArrivalAt).toISOString().slice(0, 16)
      : `${initial.checkIn}T14:00`,
  );
  const [eName, setEName] = useState(initial.emergencyContactName ?? "");
  const [ePhone, setEPhone] = useState(initial.emergencyContactPhone ?? "");
  const [requests, setRequests] = useState(initial.specialRequests ?? "");
  const [saving, setSaving] = useState(false);

  // Re-init if refetch changes the source
  useEffect(() => {
    setName(initial.guestName ?? "");
    setPhone(initial.phone ?? "");
    setEmail(initial.email ?? "");
    setArrival(initial.expectedArrivalAt
      ? new Date(initial.expectedArrivalAt).toISOString().slice(0, 16)
      : `${initial.checkIn}T14:00`);
    setEName(initial.emergencyContactName ?? "");
    setEPhone(initial.emergencyContactPhone ?? "");
    setRequests(initial.specialRequests ?? "");
  }, [initial.bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!name.trim()) return toast.error("Name is required");
    if (!phone.trim() || !/^[+0-9 ()-]{7,}$/.test(phone.trim())) return toast.error("Valid mobile number is required");
    if (!arrival) return toast.error("Please provide your expected arrival date and time.");
    setSaving(true);
    try {
      await update({
        data: {
          token,
          guest_name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || "",
          expected_arrival_at: arrival ? new Date(arrival).toISOString() : "",
          emergency_contact_name: eName.trim(),
          emergency_contact_phone: ePhone.trim(),
          special_requests: requests.trim(),
        },
      });
      toast.success("Details saved");
      onSaved();
    } catch (e: any) {
      toast.error(errMsg(e, "Could not save"));
    } finally { setSaving(false); }
  };

  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <h3 className="font-display text-base flex items-center gap-2"><User className="h-4 w-4 text-gold" /> Your Details</h3>

      <div className="grid grid-cols-1 gap-3">
        <Input label="Full Name *" icon={<User className="h-3.5 w-3.5" />} value={name} onChange={setName} />
        <Input label="Mobile Number *" icon={<Phone className="h-3.5 w-3.5" />} value={phone} onChange={setPhone} />
        <Input label="Email Address" icon={<Mail className="h-3.5 w-3.5" />} value={email} onChange={setEmail} type="email" />
      </div>

      <div className="border-t border-border/40 pt-4 space-y-2">
        <h4 className="text-xs font-medium flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-gold" /> Expected Arrival *</h4>
        <input
          type="datetime-local" value={arrival} onChange={(e) => setArrival(e.target.value)}
          required
          className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
        />
        <p className="text-[10px] text-muted-foreground">Please provide your expected arrival date and time.</p>
      </div>

      <div className="border-t border-border/40 pt-4 space-y-2">
        <h4 className="text-xs font-medium flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-gold" /> Emergency Contact (optional)</h4>
        <div className="grid grid-cols-1 gap-2">
          <Input label="Name" value={eName} onChange={setEName} />
          <Input label="Mobile" value={ePhone} onChange={setEPhone} />
        </div>
      </div>

      <div className="border-t border-border/40 pt-4 space-y-2">
        <h4 className="text-xs font-medium flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5 text-gold" /> Special Requests</h4>
        <textarea
          value={requests} onChange={(e) => setRequests(e.target.value)}
          rows={3}
          placeholder="e.g. Airport pickup, extra pillows, late arrival, ground-floor room"
          className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
        />
      </div>

      <button
        disabled={saving}
        onClick={save}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save Details
      </button>
    </div>
  );
}

function Input({ label, icon, value, onChange, type = "text" }: {
  label: string; icon?: React.ReactNode; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">{icon}{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
    </label>
  );
}
