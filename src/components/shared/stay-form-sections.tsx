/**
 * SHARED stay-form sections used identically by:
 *   - New Quote  (src/routes/_authenticated/generate.tsx)
 *   - Edit Quote (src/routes/_authenticated/quote.$id_.edit.tsx)
 *   - New Booking  (src/routes/_authenticated/bookings_.new.tsx)
 *   - Edit Booking (src/routes/_authenticated/bookings_.$id_.edit.tsx)
 *
 * Renders, in this exact order, on all four screens:
 *   1. Guest Details
 *   2. Stay Details (dates + nights)
 *   3. Room & Extras (primary room — incl. PolicyFields)
 *   4. Additional Rooms / Split Stay (LineItemsEditor)
 *   5. Additional (Discount + Internal Notes)
 *
 * It is a presentational, controlled component. Hosts own persistence and
 * convert to/from their own DB shapes via the small adapter helpers exported
 * at the bottom of this file.
 */
import { motion } from "framer-motion";
import { User, Phone, Mail, Users, CalendarDays, Bed, Plus, Minus } from "lucide-react";
import {
  roomTypes,
  LEAD_SOURCES,
  type EarlyCheckInSlot,
  type LateCheckOutSlot,
  type PetSize,
} from "@/lib/mock-data";
import { NumField } from "@/components/num-field";
import { PolicyFields } from "@/components/policy-fields";
import {
  LineItemsEditor,
  lineItemsTotal,
  lineSubtotal,
  type LineItem,
} from "@/components/line-items-editor";
import { useMasterData } from "@/hooks/use-master-data";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

/**
 * The unified in-memory shape rendered by the shared sections.
 * Both Quote (which flattens these on `quotes`) and Booking (which represents
 * them as the first `booking_items` row + `bookings.discount` / `internal_notes`)
 * can be adapted to/from this shape with the helpers below.
 */
export interface SharedStayValue {
  // 1. Guest Details
  guest_name: string;
  phone: string;
  email: string;
  lead_source: string;
  special_requests: string;
  adults: number;
  children: number;
  guests: number;

  // 2. Stay Details
  check_in: string;
  check_out: string;

  // 3. Room & Extras (primary room)
  room_type: string;
  rooms: number;
  extra_bed: number;
  breakfast_included: boolean;
  extra_breakfast_guests: number;
  early_check_in: boolean;
  early_check_in_slot: EarlyCheckInSlot | null;
  late_check_out: boolean;
  late_check_out_slot: LateCheckOutSlot | null;
  pet_size: PetSize;
  pet_charges: boolean;
  extra_adults: number;
  drivers: number;

  // 5. Additional
  discount: number;
  internal_notes: string;
}

export function emptyStayValue(): SharedStayValue {
  const today = toLocalYMD();
  const tomorrow = localYMDOffset(1);
  return {
    guest_name: "", phone: "", email: "",
    lead_source: "Direct", special_requests: "",
    adults: 2, children: 0, guests: 2,
    check_in: today, check_out: tomorrow,
    room_type: roomTypes[0].name, rooms: 1, extra_bed: 0,
    breakfast_included: false, extra_breakfast_guests: 0,
    early_check_in: false, early_check_in_slot: null,
    late_check_out: false, late_check_out_slot: null,
    pet_size: "none", pet_charges: false,
    extra_adults: 0, drivers: 0,
    discount: 0, internal_notes: "",
  };
}

/** Convert SharedStayValue's primary-room fields into a LineItem (for booking_items[0]). */
export function primaryToLineItem(v: SharedStayValue, rate: number): LineItem {
  return {
    room_type: v.room_type,
    rooms: v.rooms,
    adults: v.adults,
    children: v.children,
    check_in: v.check_in,
    check_out: v.check_out,
    breakfast_included: v.breakfast_included,
    extra_bed: v.extra_bed,
    rate,
    early_check_in: v.early_check_in,
    early_check_in_slot: v.early_check_in ? v.early_check_in_slot : null,
    late_check_out: v.late_check_out,
    late_check_out_slot: v.late_check_out ? v.late_check_out_slot : null,
    pet_size: v.pet_size,
    extra_adults: v.extra_adults,
    drivers: v.drivers,
  };
}

/** Adopt a primary-room LineItem back into SharedStayValue (for editing a booking). */
export function lineItemToPrimary(it: LineItem): Partial<SharedStayValue> {
  return {
    room_type: it.room_type,
    rooms: it.rooms,
    adults: it.adults,
    children: it.children,
    check_in: it.check_in,
    check_out: it.check_out,
    breakfast_included: it.breakfast_included,
    extra_bed: it.extra_bed,
    early_check_in: it.early_check_in,
    early_check_in_slot: it.early_check_in_slot,
    late_check_out: it.late_check_out,
    late_check_out_slot: it.late_check_out_slot,
    pet_size: it.pet_size,
    pet_charges: it.pet_size !== "none",
    extra_adults: it.extra_adults,
    drivers: it.drivers,
  };
}

/** Sum primary + extras for live totals. */
export function stayItemsSubtotal(v: SharedStayValue, extras: LineItem[], primaryRate: number) {
  return lineSubtotal(primaryToLineItem(v, primaryRate)) + lineItemsTotal(extras);
}

export interface StayFormSectionsProps {
  value: SharedStayValue;
  onChange: (next: SharedStayValue) => void;
  extras: LineItem[];
  onExtrasChange: (items: LineItem[]) => void;
  /** Mounted under Guest Details — used for existing-customer banner / autocomplete. */
  customerSlot?: React.ReactNode;
  /** Optional hint shown next to the nights readout in the Stay Details card. */
  nightsLabel?: string;
  /** "quote" | "booking" — only used for tiny copy nuances. */
  mode?: "quote" | "booking";
}

export function StayFormSections({
  value, onChange, extras, onExtrasChange, customerSlot, nightsLabel,
}: StayFormSectionsProps) {
  const update = <K extends keyof SharedStayValue>(k: K, v: SharedStayValue[K]) =>
    onChange({ ...value, [k]: v });
  // Atomic multi-field write — prevents the closure-based clobber that
  // occurred when PolicyFields called `update(...)` twice in a row for paired
  // fields (e.g. early_check_in + early_check_in_slot, pet_size + pet_charges).
  const apply = (patch: Partial<SharedStayValue>) => onChange({ ...value, ...patch });

  // Single source of truth: Master Data → lead_source. Hardcoded LEAD_SOURCES used only as fallback.
  const { values: leadSources, labels: leadLabels } = useMasterData("lead_source", [...LEAD_SOURCES]);
  // Ensure the currently-selected value is always visible even if it has been deactivated.
  const leadOptions = leadSources.includes(value.lead_source) ? leadSources : [value.lead_source, ...leadSources].filter(Boolean);

  return (
    <div className="space-y-6">
      {/* 1. Guest Details */}
      <Card title="Guest Details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Guest Name" icon={User} required>
            <input className={inputCls} value={value.guest_name} onChange={(e) => update("guest_name", e.target.value)} />
          </Field>
          <Field label="Phone" icon={Phone} required>
            <input className={inputCls} placeholder="+91 ..." value={value.phone} onChange={(e) => update("phone", e.target.value)} />
          </Field>
        </div>

        {customerSlot}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <Field label="Email" icon={Mail}>
            <input className={inputCls} value={value.email} onChange={(e) => update("email", e.target.value)} />
          </Field>
          <Field label="Lead Source">
            <select className={inputCls} value={value.lead_source} onChange={(e) => update("lead_source", e.target.value)}>
              {leadOptions.map((o) => <option key={o} value={o}>{leadLabels[o] ?? o}</option>)}
            </select>
          </Field>
          <Field label="Special Requests (visible to guest)">
            <input className={inputCls} value={value.special_requests} onChange={(e) => update("special_requests", e.target.value)} placeholder="Any specific guest requests…" />
          </Field>
        </div>

        <div className="mt-5 rounded-lg border border-border bg-secondary/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-gold" />
            <span className="text-sm font-medium">Group Size</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumField label="# of Guests" hint="Primary count" value={value.guests} min={1}
              onChange={(v) => {
                const next = { ...value, guests: v };
                if (value.adults > v) next.adults = v;
                onChange(next);
              }} />
            <NumField label="# of Adults" value={value.adults} min={0} onChange={(v) => update("adults", v)} />
            <NumField label="# of Children" hint="Age below 8 years" value={value.children} min={0} onChange={(v) => update("children", v)} />
          </div>
          {value.adults > 0 && value.adults + value.children !== value.guests && (
            <p className="mt-2 text-[11px] text-warning">
              Adults ({value.adults}) + Children ({value.children}) ≠ Total Guests ({value.guests}).
            </p>
          )}
        </div>
      </Card>

      {/* 2. Stay Details */}
      <Card title="Stay Details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Check-in" icon={CalendarDays} required>
            <input type="date" className={inputCls} value={value.check_in} onChange={(e) => update("check_in", e.target.value)} />
          </Field>
          <Field label="Check-out" icon={CalendarDays} required>
            <input type="date" className={inputCls} value={value.check_out} onChange={(e) => update("check_out", e.target.value)} />
          </Field>
        </div>
        {nightsLabel && <div className="mt-2 text-right text-xs text-gold">{nightsLabel}</div>}
      </Card>

      {/* 3. Room & Extras */}
      <Card title="Room & Extras">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Room Type" icon={Bed}>
            <select className={inputCls} value={value.room_type} onChange={(e) => update("room_type", e.target.value)}>
              {roomTypes.map((r) => <option key={r.name}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Rooms">
            <Stepper value={value.rooms} min={1} onChange={(v) => update("rooms", v)} />
          </Field>
          <Field label="Extra Bed">
            <Stepper value={value.extra_bed} min={0} onChange={(v) => update("extra_bed", v)} />
          </Field>
          <div />
        </div>
        <div className="mt-4">
          <PolicyFields form={value as any} update={update as any} apply={apply as any} />
        </div>
      </Card>

      {/* 4. Additional Rooms / Split Stay */}
      <Card title="Additional Rooms / Split Stay">
        <LineItemsEditor items={extras} onChange={onExtrasChange} />
      </Card>

      {/* 5. Additional */}
      <Card title="Additional">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumField label="Discount (₹)" value={value.discount} min={0} onChange={(v) => update("discount", v)} prefix="₹" />
        </div>
        <Field label="Internal Notes (never shared)">
          <textarea rows={3} className={cn(inputCls, "resize-none mt-1")} value={value.internal_notes} onChange={(e) => update("internal_notes", e.target.value)} />
        </Field>
      </Card>
    </div>
  );
}

/* ---------- tiny shared atoms ---------- */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="luxe-card rounded-xl p-5 md:p-6">
      <h4 className="font-display text-lg mb-4">{title}</h4>
      {children}
    </motion.section>
  );
}

function Field({ label, icon: Icon, children, required }: any) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
        {required && <span className="text-gold">*</span>}
      </span>
      {children}
    </label>
  );
}

function Stepper({ value, min = 0, onChange }: { value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center bg-input/60 border border-border rounded-md overflow-hidden">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))}
        className="p-2.5 hover:bg-secondary transition text-muted-foreground hover:text-foreground">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 text-center text-sm font-medium">{value}</div>
      <button type="button" onClick={() => onChange(value + 1)}
        className="p-2.5 hover:bg-secondary transition text-muted-foreground hover:text-foreground">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
