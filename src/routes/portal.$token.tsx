/**
 * Public Guest Portal — view booking, update details, pay, manage documents,
 * order food, raise complaints, give reviews, and self-cancel (when eligible).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2, CheckCircle2, User, Calendar, Phone, Mail, AlertTriangle, MessageSquare,
  Save, ChevronDown, FileCheck, UtensilsCrossed, MessageCircleWarning, Star, XCircle,
  ExternalLink, CreditCard, MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { validatePhoneNumber, normalizePhoneNumber } from "@/lib/phone";
import {
  getPortalBooking,
  createRazorpayOrder,
  recordPayAtHotelIntent,
  updateGuestPortalDetails,
  confirmRazorpayPayment,
  listPortalDocuments,
  listPortalComplaints,
  cancelPortalBooking,
  submitPortalComplaint,
  submitPortalReview,
} from "@/lib/portal.functions";
import { useOpsTimeLabels } from "@/lib/check-times";
import { PortalPaymentOptions, type PortalPaymentChoice } from "@/components/portal/payment-options";
import { GuestDocumentsDialog } from "@/components/guest-documents-dialog";

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
  const confirmPayment = useServerFn(confirmRazorpayPayment);
  const fetchDocs = useServerFn(listPortalDocuments);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | "paid" | "pay_at_hotel">(null);

  const q = useQuery({
    queryKey: ["portal-booking", token],
    queryFn: () => fetchBooking({ data: { token } }),
    retry: false,
  });

  const docsQ = useQuery({
    queryKey: ["guest-documents", "portal", token],
    queryFn: () => fetchDocs({ data: { token } }),
    enabled: !!q.data,
  });

  // ---- Profile completion (compute BEFORE any early return to keep hooks order stable) ----
  const b: any = q.data ?? {};
  const docs = (docsQ.data ?? []) as any[];
  const hasVerifiedDoc = docs.some((d) => !!d.verified_at);
  const hasAnyDoc = docs.some((d) => !!d.front_path);
  const docComplete = hasVerifiedDoc || hasAnyDoc;
  const arrivalHasTime = (() => {
    if (!b.expectedArrivalAt) return false;
    const d = new Date(b.expectedArrivalAt);
    return !(d.getUTCHours() === 0 && d.getUTCMinutes() === 0);
  })();
  const score = useMemo(() => {
    const checks = [
      { label: "Email Address", ok: !!b.email?.trim() },
      { label: "Expected Arrival Time", ok: arrivalHasTime },
      { label: "Guest Documents", ok: docComplete },
    ];
    const pts = checks.filter((c) => c.ok).length;
    return {
      pct: Math.round((pts / checks.length) * 100),
      missing: checks.filter((c) => !c.ok).map((c) => c.label),
    };
  }, [b.email, arrivalHasTime, docComplete]);

  if (q.isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }
  if (q.error) throw q.error instanceof Error ? q.error : new Error(errMsg(q.error, "Booking link not found"));
  if (!q.data) throw new Error("Booking link not found");

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
        handler: async (resp: any) => {
          try {
            await confirmPayment({
              data: {
                token,
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              },
            });
            setDone("paid");
            toast.success("Payment received. Thank you!");
          } catch (e: any) {
            console.error("confirmRazorpayPayment failed", e);
            toast.error(errMsg(e, "Payment received but could not be confirmed. Our team will reconcile shortly."));
          } finally {
            q.refetch();
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on("payment.failed", (resp: any) => { toast.error(resp?.error?.description || "Payment failed"); setBusy(false); });
      rzp.open();
    } catch (e: any) {
      toast.error(errMsg(e, "Could not start payment"));
    } finally { setBusy(false); }
  };



  const isCancelled = b.status === "Cancelled";

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="luxe-card rounded-xl p-5">
          <div className="text-xs uppercase tracking-wider text-gold mb-1">Booking · {b.reference}</div>
          <h1 className="font-display text-2xl mb-3">Welcome, {b.guestName}</h1>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <StayField label="Check-In" date={b.checkIn} kind="in" />
            <StayField label="Check-Out" date={b.checkOut} kind="out" />
            <Field label="Room" value={b.roomType} />
            <Field label="Guests" value={String(b.guests)} />
            <Field label="Payable" value={inr(b.payable)} />
            <Field label="Paid" value={inr(b.advancePaid)} />
          </div>

          <PricingBreakdown b={b} />
          {b.charges && b.charges.length > 0 && <ChargesBreakdown charges={b.charges} total={b.chargesTotal} />}
        </div>

        {isCancelled && (
          <div className="luxe-card rounded-xl p-5 text-center space-y-1">
            <XCircle className="h-8 w-8 text-destructive mx-auto" />
            <h3 className="font-display text-lg">Booking Cancelled</h3>
            <p className="text-xs text-muted-foreground">This booking has been cancelled. For any queries, please contact reception.</p>
          </div>
        )}

        {/* 2. Profile Completion */}
        {!isCancelled && <ProfileCompletion pct={score.pct} missing={score.missing} />}

        {/* 3. Your Details (includes Expected Arrival inside) */}
        {!isCancelled && (
          <GuestDetailsForm token={token} initial={b} onSaved={() => q.refetch()} />
        )}

        {/* 5. Guest Documents */}
        {!isCancelled && (
          <DocumentsCard
            token={token}
            count={docs.length}
            verified={hasVerifiedDoc}
            onChanged={() => docsQ.refetch()}
          />
        )}

        {/* 6. Complete Your Booking — payment */}
        {!isCancelled && (
          <section id="portal-payment" className="space-y-3">
            <h2 className="font-display text-base flex items-center gap-2 px-1">
              <CreditCard className="h-4 w-4 text-gold" /> Complete Your Booking
            </h2>
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
          </section>
        )}

        {/* 7. Additional Services — Order Food */}
        {!isCancelled && (
          <OrderFoodCard
            bookingReference={b.reference}
            guestName={b.guestName}
            roomNumber={b.roomNumber}
            phone={b.phone}
          />
        )}

        {/* 8. Report Complaint */}
        {!isCancelled && <ReportComplaintCard token={token} />}

        {/* 9. Reviews & Feedback */}
        {!isCancelled && <ReviewsCard token={token} />}

        {/* 10. Cancel Booking */}
        {!isCancelled && (
          <CancelBookingCard
            token={token}
            bookingReference={b.reference}
            checkIn={b.checkIn}
            advancePaid={b.advancePaid}
            onCancelled={() => q.refetch()}
          />
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

function StayField({ label, date, kind }: { label: string; date: string; kind: "in" | "out" }) {
  const t = useOpsTimeLabels();
  const formatted = date ? new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
  const time = kind === "in" ? t.checkIn : t.checkOut;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-foreground">{formatted || "—"}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{time}</div>
    </div>
  );
}

function ProfileCompletion({ pct, missing }: { pct: number; missing: string[] }) {
  const glyph = pct >= 100 ? "●" : pct >= 75 ? "◕" : pct >= 50 ? "◑" : pct >= 25 ? "◔" : "○";
  const anchorFor = (label: string) =>
    label === "Email Address" ? "portal-email"
      : label === "Expected Arrival Time" ? "portal-arrival"
      : label === "Guest Documents" ? "portal-documents"
      : null;
  const scrollTo = (label: string) => {
    const id = anchorFor(label); if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Soft focus highlight
    el.classList.add("ring-2", "ring-gold/60", "rounded-md");
    setTimeout(() => el.classList.remove("ring-2", "ring-gold/60", "rounded-md"), 1600);
    if (el instanceof HTMLInputElement || el instanceof HTMLButtonElement) {
      try { el.focus({ preventScroll: true }); } catch { /* noop */ }
    }
  };
  return (
    <div className="luxe-card rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Profile Completion</div>
        <div className="text-sm text-gold font-medium tabular-nums">
          <span className="mr-1.5">{glyph}</span>{pct}% Complete
        </div>
      </div>
      {missing.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div>Missing:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {missing.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  onClick={() => scrollTo(m)}
                  className="text-foreground hover:text-gold underline-offset-2 hover:underline"
                >
                  {m}
                </button>
              </li>
            ))}
          </ul>
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
  const initialArrivalDate = initial.expectedArrivalAt
    ? new Date(initial.expectedArrivalAt).toISOString().slice(0, 10)
    : initial.checkIn;
  const initialArrivalTime = initial.expectedArrivalAt
    ? new Date(initial.expectedArrivalAt).toISOString().slice(11, 16)
    : "";
  const [arrivalDate, setArrivalDate] = useState<string>(initialArrivalDate);
  const [arrivalTime, setArrivalTime] = useState<string>(initialArrivalTime);
  const [eName, setEName] = useState(initial.emergencyContactName ?? "");
  const [ePhone, setEPhone] = useState(initial.emergencyContactPhone ?? "");
  const [requests, setRequests] = useState(initial.specialRequests ?? "");
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(initial.guestName ?? "");
    setPhone(initial.phone ?? "");
    setEmail(initial.email ?? "");
    setArrivalDate(initial.expectedArrivalAt
      ? new Date(initial.expectedArrivalAt).toISOString().slice(0, 10)
      : initial.checkIn);
    setArrivalTime(initial.expectedArrivalAt
      ? new Date(initial.expectedArrivalAt).toISOString().slice(11, 16)
      : "");
    setEName(initial.emergencyContactName ?? "");
    setEPhone(initial.emergencyContactPhone ?? "");
    setRequests(initial.specialRequests ?? "");
  }, [initial.bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!name.trim()) return toast.error("Name is required");
    if (!phone.trim() || !validatePhoneNumber(phone)) return toast.error("Please enter a valid mobile number.");
    if (!arrivalDate) return toast.error("Please provide your expected arrival date.");
    setSaving(true);
    try {
      const timePart = arrivalTime || "14:00";
      const arrivalIso = new Date(`${arrivalDate}T${timePart}`).toISOString();
      await update({
        data: {
          token,
          guest_name: name.trim(),
          phone: normalizePhoneNumber(phone),
          email: email.trim() || "",
          expected_arrival_at: arrivalIso,
          emergency_contact_name: eName.trim(),
          emergency_contact_phone: ePhone.trim() ? normalizePhoneNumber(ePhone) : "",
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
        <Input id="portal-email" label="Email Address" icon={<Mail className="h-3.5 w-3.5" />} value={email} onChange={setEmail} type="email" />
      </div>

      <div id="portal-arrival" className="border-t border-border/40 pt-4 space-y-3 scroll-mt-24">
        <h4 className="text-xs font-medium flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-gold" /> Expected Arrival</h4>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Date *</span>
            <input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} required
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Time</span>
            <input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            <span className="block text-[10px] text-muted-foreground mt-1">(Approximate time is sufficient)</span>
          </label>
        </div>
      </div>

      <div className="border-t border-border/40 pt-4">
        <button
          type="button"
          onClick={() => setOptionalOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition ${optionalOpen ? "rotate-0" : "-rotate-90"}`} /> Optional
        </button>
        {optionalOpen && (
          <div className="mt-3 space-y-4">
            <div className="space-y-2">
              <h4 className="text-xs font-medium flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-gold" /> Emergency Contact</h4>
              <div className="grid grid-cols-1 gap-2">
                <Input label="Name" value={eName} onChange={setEName} />
                <Input label="Mobile" value={ePhone} onChange={setEPhone} />
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-medium flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5 text-gold" /> Special Request (Optional)</h4>
              <textarea
                value={requests} onChange={(e) => setRequests(e.target.value)}
                rows={3}
                placeholder="e.g. Airport pickup, extra pillows, late arrival, ground-floor room"
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}
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

function Input({ id, label, icon, value, onChange, type = "text" }: {
  id?: string; label: string; icon?: React.ReactNode; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <label className="block scroll-mt-24" htmlFor={id}>
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">{icon}{label}</span>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
    </label>
  );
}

// =============================== New cards =================================

function DocumentsCard({ token, count, verified, onChanged }: { token: string; count: number; verified: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div id="portal-documents" className="luxe-card rounded-xl p-5 space-y-3 scroll-mt-24">
      <h3 className="font-display text-base flex items-center gap-2"><FileCheck className="h-4 w-4 text-gold" /> Guest Documents</h3>
      <p className="text-xs text-muted-foreground">
        Upload your ID once and it will be available for this stay and your future bookings.
      </p>
      <div className="text-xs">
        <span className="text-muted-foreground">On file:</span>{" "}
        <span className="text-foreground">{count} document{count === 1 ? "" : "s"}</span>
        {verified && (
          <span className="ml-2 rounded-full border border-success/40 bg-success/10 text-success text-[10px] px-2 py-0.5">Verified</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal"
      >
        {count > 0 ? "Manage Documents" : "Upload Documents"}
      </button>
      {open && (
        <GuestDocumentsDialog
          portalToken={token}
          mode="manage"
          open={open}
          onClose={() => { setOpen(false); onChanged(); }}
          source="Guest Portal"
        />
      )}
    </div>
  );
}

function OrderFoodCard({ bookingReference, guestName, roomNumber, phone }: {
  bookingReference?: string; guestName?: string; roomNumber?: string; phone?: string;
}) {
  const params = new URLSearchParams();
  if (bookingReference) params.set("ref", bookingReference);
  if (guestName) params.set("name", guestName);
  if (roomNumber) params.set("room", roomNumber);
  if (phone) params.set("mobile", phone);
  const qs = params.toString();
  const href = `https://hotelexcella.in/orderfood${qs ? `?${qs}` : ""}`;
  return (
    <div className="luxe-card rounded-xl p-5 space-y-3">
      <h3 className="font-display text-base flex items-center gap-2">
        <UtensilsCrossed className="h-4 w-4 text-gold" /> Order Food
      </h3>
      <p className="text-xs text-muted-foreground">
        Order delicious food directly to your room.
      </p>
      <a
        href={href}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal"
      >
        Order Now <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

const COMPLAINT_CATEGORIES = [
  "Room Cleanliness",
  "AC / Electrical",
  "Plumbing",
  "WiFi / TV",
  "Food Quality",
  "Staff Service",
  "Noise",
  "Other",
];

function ReportComplaintCard({ token }: { token: string }) {
  const submit = useServerFn(submitPortalComplaint);
  const fetchList = useServerFn(listPortalComplaints);
  const listQ = useQuery({
    queryKey: ["portal-complaints", token],
    queryFn: () => fetchList({ data: { token } }),
  });
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(COMPLAINT_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const list = listQ.data ?? [];
  const openCount = list.filter((c) => c.status !== "Resolved" && c.status !== "Closed").length;

  const onSubmit = async () => {
    if (description.trim().length < 3) return toast.error("Please describe the issue (at least 3 characters)");
    setSubmitting(true);
    try {
      await submit({ data: { token, category, description: description.trim() } });
      toast.success("Complaint submitted. Our team will respond shortly.");
      setOpen(false);
      setDescription("");
      listQ.refetch();
    } catch (e: any) {
      toast.error(errMsg(e, "Could not submit complaint"));
    } finally { setSubmitting(false); }
  };

  const statusBadge = (s: string) => {
    const isResolved = s === "Resolved" || s === "Closed";
    const isProgress = s === "In Progress";
    const cls = isResolved
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
      : isProgress
      ? "border-gold/40 bg-gold-soft/40 text-foreground"
      : "border-destructive/40 bg-destructive/10 text-destructive";
    return <span className={`rounded-full border text-[10px] px-2 py-0.5 ${cls}`}>{s}</span>;
  };

  return (
    <div className="luxe-card rounded-xl p-5 space-y-3">
      <h3 className="font-display text-base flex items-center gap-2">
        <MessageCircleWarning className="h-4 w-4 text-gold" /> Report Complaint
      </h3>

      {list.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {openCount > 0 ? `Open Complaints (${openCount})` : `Past Complaints (${list.length})`}
          </div>
          <ul className="space-y-2">
            {list.map((c) => (
              <li key={c.id} className="rounded-md border border-border/60 bg-input/40 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium truncate">{c.category}</div>
                  {statusBadge(c.status)}
                </div>
                {c.description && (
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</div>
                )}
                <div className="text-[10px] text-muted-foreground mt-1">
                  {new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  {c.complaint_number ? ` · ${c.complaint_number}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!open ? (
        <>
          {list.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Raise a complaint or request assistance. Our team will follow up promptly.
            </p>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold-soft/40 px-4 py-2.5 text-sm font-medium hover:bg-gold-soft/60"
          >
            {list.length > 0 ? "Report Another Complaint" : "Report a Complaint"}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
            >
              {COMPLAINT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Describe the issue</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Please describe what happened"
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); setDescription(""); }}
              className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >Cancel</button>
            <button
              type="button"
              disabled={submitting}
              onClick={onSubmit}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-3 py-2 text-sm font-medium text-charcoal disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewsCard({ token }: { token: string }) {
  const submit = useServerFn(submitPortalReview);
  const [rating, setRating] = useState<number>(0);
  const [whatWent, setWhatWent] = useState("");
  const [additional, setAdditional] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<null | "external" | "feedback">(null);

  const onPick = async (r: number) => {
    setRating(r);
    if (r >= 4) {
      // Submit immediately and redirect
      setSubmitting(true);
      try {
        const res = await submit({ data: { token, rating: r } });
        setSubmitted("external");
        if ((res as any)?.externalReviewUrl) {
          window.open((res as any).externalReviewUrl, "_blank", "noopener,noreferrer");
        }
      } catch (e: any) {
        toast.error(errMsg(e, "Could not record rating"));
      } finally { setSubmitting(false); }
    }
  };

  const onSubmitFeedback = async () => {
    if (rating < 1) return;
    setSubmitting(true);
    try {
      await submit({
        data: {
          token, rating,
          feedback_what_went_wrong: whatWent.trim(),
          feedback_additional_comments: additional.trim(),
        },
      });
      setSubmitted("feedback");
    } catch (e: any) {
      toast.error(errMsg(e, "Could not submit feedback"));
    } finally { setSubmitting(false); }
  };

  if (submitted === "external") {
    return (
      <div className="luxe-card rounded-xl p-5 text-center space-y-1">
        <CheckCircle2 className="h-6 w-6 mx-auto text-emerald-500" />
        <div className="text-sm">Thank you for your rating!</div>
        <div className="text-xs text-muted-foreground">A new tab opened so you can share your review publicly.</div>
      </div>
    );
  }
  if (submitted === "feedback") {
    return (
      <div className="luxe-card rounded-xl p-5 text-center space-y-1">
        <CheckCircle2 className="h-6 w-6 mx-auto text-emerald-500" />
        <div className="text-sm">Thank you for your feedback.</div>
        <div className="text-xs text-muted-foreground">We take your concerns seriously and our team may contact you to help resolve the issue.</div>
      </div>
    );
  }

  return (
    <div className="luxe-card rounded-xl p-5 space-y-3">
      <h3 className="font-display text-base flex items-center gap-2"><Star className="h-4 w-4 text-gold" /> Reviews & Feedback</h3>
      <p className="text-xs text-muted-foreground">How was your stay?</p>
      <div className="flex items-center justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={submitting}
            onClick={() => onPick(n)}
            className="p-1"
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
          >
            <Star className={`h-7 w-7 ${rating >= n ? "fill-gold text-gold" : "text-muted-foreground"}`} />
          </button>
        ))}
      </div>
      {rating > 0 && rating <= 3 && (
        <div className="space-y-3 border-t border-border/40 pt-3">
          <p className="text-xs text-muted-foreground">We're sorry your stay didn't meet expectations. Please tell us more so we can do better.</p>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">What went wrong?</span>
            <textarea
              value={whatWent}
              onChange={(e) => setWhatWent(e.target.value)}
              rows={3}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Additional comments</span>
            <textarea
              value={additional}
              onChange={(e) => setAdditional(e.target.value)}
              rows={3}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={submitting}
            onClick={onSubmitFeedback}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Submit Feedback
          </button>
        </div>
      )}
    </div>
  );
}

const RECEPTION_PHONE = "+919985908131";
const RECEPTION_PHONE_DISPLAY = "+91 9985908131";

function CancelBookingCard({ token, bookingReference, checkIn, advancePaid, onCancelled }: {
  token: string; bookingReference?: string; checkIn: string; advancePaid: number; onCancelled: () => void;
}) {
  const cancel = useServerFn(cancelPortalBooking);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // 24h cutoff vs check-in (14:00 IST)
  const checkInIso = `${checkIn}T14:00:00+05:30`;
  const within24h = (new Date(checkInIso).getTime() - 24 * 60 * 60 * 1000) < Date.now();
  const hasPaid = Number(advancePaid || 0) > 0;
  const eligible = !hasPaid && !within24h;

  const onConfirm = async () => {
    setBusy(true);
    try {
      await cancel({ data: { token } });
      toast.success("Booking cancelled.");
      onCancelled();
    } catch (e: any) {
      toast.error(errMsg(e, "Could not cancel booking"));
    } finally { setBusy(false); setConfirming(false); }
  };

  if (!eligible) {
    const refTxt = bookingReference ? ` ${bookingReference}` : "";
    const waMsg = `Hi Hotel Excella, I would like to cancel my booking${refTxt}`;
    const waHref = `https://wa.me/919985908131?text=${encodeURIComponent(waMsg)}`;
    return (
      <div className="luxe-card rounded-xl p-5 space-y-3">
        <h3 className="font-display text-base flex items-center gap-2"><XCircle className="h-4 w-4 text-gold" /> Cancel Booking</h3>
        <p className="text-xs text-muted-foreground">Please contact reception to cancel your booking.</p>
        <div className="flex items-center gap-2 text-sm">
          <Phone className="h-3.5 w-3.5 text-gold" />
          <span className="tabular-nums">{RECEPTION_PHONE_DISPLAY}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500/20"
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp Us
          </a>
          <a
            href={`tel:${RECEPTION_PHONE}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft/40 px-3 py-2 text-sm font-medium hover:bg-gold-soft/60"
          >
            <Phone className="h-4 w-4" /> Call Reception
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="luxe-card rounded-xl p-5 space-y-3">
      <h3 className="font-display text-base flex items-center gap-2"><XCircle className="h-4 w-4 text-gold" /> Cancel Booking</h3>
      {!confirming ? (
        <>
          <p className="text-xs text-muted-foreground">Free cancellation available up to 24 hours before check-in.</p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-full rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-4 py-2.5 text-sm font-medium hover:bg-destructive/20"
          >
            Cancel Booking
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs">Are you sure you want to cancel this booking? This action cannot be undone.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >Keep Booking</button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-destructive text-destructive-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Yes, Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================ Pricing helpers =============================

function PricingBreakdown({ b }: { b: any }) {
  const [open, setOpen] = useState(false);
  const taxRate = Number(b.taxRate || 0);
  const taxPct = taxRate > 0 ? Math.round(taxRate * 100) : null;
  const taxableAmount = Number(b.subtotal || 0);
  const taxes = Number(b.taxes || 0);
  const balance = Number(b.balanceDue || 0);
  return (
    <div className="mt-4 border-t border-border/40 pt-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-xs font-medium text-gold hover:text-gold/80">
        <span className="inline-flex items-center gap-1.5"><ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} /> View Detailed Breakdown</span>
      </button>
      {open && (
        <div className="mt-3 space-y-1.5 text-xs">
          <Row label="Room Charges" value={inr(b.roomCharges || 0)} />
          {b.additionalStay > 0 && <Row label="Additional Stay Charges" value={inr(b.additionalStay)} />}
          {b.chargesTotal > 0 && <Row label="In-House Charges" value={inr(b.chargesTotal)} />}
          <Row label="Taxable Amount" value={inr(taxableAmount + (b.chargesTotal || 0))} />
          <Row label={`Tax${taxPct ? ` (${taxPct}%)` : ""}${b.taxesIncluded ? " · included" : ""}`} value={inr(taxes)} />
          <Row label="Final Amount" value={inr(b.payable)} strong />
          <Row label="Amount Paid" value={inr(b.advancePaid)} />
          <Row label="Balance Due" value={inr(balance)} strong tone={balance > 0 ? "warning" : "success"} />
        </div>
      )}
    </div>
  );
}

function ChargesBreakdown({ charges, total }: { charges: any[]; total: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t border-border/40 pt-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-xs font-medium hover:text-gold">
        <span className="inline-flex items-center gap-1.5"><ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} /> In-House Charges {inr(total)}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">View Charges</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 text-xs">
          {charges.map((c) => (
            <div key={c.id} className="flex items-center justify-between border-b border-border/40 pb-1.5 last:border-0">
              <div className="min-w-0">
                <div className="font-medium truncate">{c.category}{c.description ? ` — ${c.description}` : ""}</div>
                <div className="text-[10px] text-muted-foreground">Qty {c.quantity} × {inr(c.unitPrice)}</div>
              </div>
              <div className="tabular-nums">{inr(c.amount)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "warning" | "success" }) {
  const toneCls = tone === "warning" ? "text-warning" : tone === "success" ? "text-emerald-600" : "";
  return (
    <div className={`flex justify-between ${strong ? "font-medium" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${toneCls}`}>{value}</span>
    </div>
  );
}
