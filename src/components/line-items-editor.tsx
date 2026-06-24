import { useState } from "react";
import { Plus, Copy, Trash2, BedDouble, ChevronDown, ChevronUp } from "lucide-react";
import {
  roomTypes,
  getRoomRate,
  EARLY_CHECK_IN_SLOTS,
  LATE_CHECK_OUT_SLOTS,
  PET_OPTIONS,
  PET_RATES,
  EXTRA_ADULT_RATE,
  DRIVER_RATE,
  type EarlyCheckInSlot,
  type LateCheckOutSlot,
  type PetSize,
} from "@/lib/mock-data";
import { NumField } from "@/components/num-field";
import { cn, toLocalYMD, localYMDOffset } from "@/lib/utils";

export interface LineItem {
  room_type: string;
  rooms: number;
  adults: number;
  children: number;
  check_in: string;
  check_out: string;
  breakfast_included: boolean;
  extra_bed: number;
  rate: number;
  early_check_in: boolean;
  early_check_in_slot: EarlyCheckInSlot | null;
  late_check_out: boolean;
  late_check_out_slot: LateCheckOutSlot | null;
  pet_size: PetSize;
  extra_adults: number;
  drivers: number;
  notes?: string | null;
}

export function emptyLine(): LineItem {
  const today = toLocalYMD();
  const tomorrow = localYMDOffset(1);
  return {
    room_type: roomTypes[0].name,
    rooms: 1,
    adults: 2,
    children: 0,
    check_in: today,
    check_out: tomorrow,
    breakfast_included: false,
    extra_bed: 0,
    rate: getRoomRate(roomTypes[0].name, false),
    early_check_in: false,
    early_check_in_slot: null,
    late_check_out: false,
    late_check_out_slot: null,
    pet_size: "none",
    extra_adults: 0,
    drivers: 0,
  };
}

export function nightsOf(item: { check_in: string; check_out: string }) {
  return Math.max(
    1,
    Math.round(
      (new Date(item.check_out).getTime() - new Date(item.check_in).getTime()) / 86400000,
    ),
  );
}

/** Full per-line subtotal including extras (rooms, early/late, pet, extra adults, drivers). */
export function lineSubtotal(item: LineItem) {
  const n = nightsOf(item);
  const rooms = Math.max(1, item.rooms || 1);
  const rate = Number(item.rate) || 0;
  let total = rate * n * rooms;
  if (item.early_check_in && item.early_check_in_slot) {
    const s = EARLY_CHECK_IN_SLOTS.find((x) => x.value === item.early_check_in_slot);
    total += s?.fee ?? rate * rooms;
  }
  if (item.late_check_out && item.late_check_out_slot) {
    const s = LATE_CHECK_OUT_SLOTS.find((x) => x.value === item.late_check_out_slot);
    total += s?.fee ?? rate * rooms;
  }
  total += (PET_RATES[item.pet_size] ?? 0) * n;
  total += (item.extra_adults || 0) * EXTRA_ADULT_RATE * n;
  total += (item.drivers || 0) * DRIVER_RATE * n;
  return total;
}

export function lineItemsTotal(items: LineItem[]) {
  return items.reduce((s, i) => s + lineSubtotal(i), 0);
}

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

export function LineItemsEditor({
  items,
  onChange,
  title = "Additional Rooms / Stays",
  hint = "Add extra rooms with different occupancy, dates, or extras.",
  startIndex = 2,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  title?: string;
  hint?: string;
  /** Display number for the first line item (2 when editor is for extras; 1 when it's primary). */
  startIndex?: number;
}) {
  const update = (idx: number, patch: Partial<LineItem>) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const merged = { ...it, ...patch };
      if (patch.room_type !== undefined || patch.breakfast_included !== undefined) {
        merged.rate = getRoomRate(merged.room_type, merged.breakfast_included);
      }
      return merged;
    });
    onChange(next);
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const duplicate = (idx: number) => {
    const copy = [...items.slice(0, idx + 1), { ...items[idx] }, ...items.slice(idx + 1)];
    onChange(copy);
  };
  const add = () => onChange([...items, emptyLine()]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-display text-lg flex items-center gap-2">
            <BedDouble className="h-4 w-4 text-gold" /> {title}
          </h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add Line Item
        </button>
      </div>

      {items.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-secondary/30 p-4 text-center text-xs text-muted-foreground">
          No additional items yet.
        </div>
      )}

      {items.map((it, idx) => (
        <LineItemRow
          key={idx}
          label={`Line #${idx + startIndex}`}
          item={it}
          onChange={(patch) => update(idx, patch)}
          onDuplicate={() => duplicate(idx)}
          onRemove={() => remove(idx)}
        />
      ))}
    </div>
  );
}

function LineItemRow({
  label,
  item,
  onChange,
  onDuplicate,
  onRemove,
}: {
  label: string;
  item: LineItem;
  onChange: (patch: Partial<LineItem>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  // Collapsed by default — most bookings don't need extras.
  const [extrasOpen, setExtrasOpen] = useState(false);
  const n = nightsOf(item);
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-gold">
          {label} · {n}N{item.rooms > 1 ? ` · ${item.rooms} Rooms` : ""} · ₹{lineSubtotal(item).toLocaleString("en-IN")}
        </span>
        <div className="flex gap-1">
          <button type="button" onClick={onDuplicate}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Duplicate">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onRemove}
            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Remove">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="block col-span-2">
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Room Type</span>
          <select className={inputCls} value={item.room_type} onChange={(e) => onChange({ room_type: e.target.value })}>
            {roomTypes.map((r) => <option key={r.name}>{r.name}</option>)}
          </select>
        </label>
        <NumField label="Rooms" value={item.rooms} min={1} onChange={(v) => onChange({ rooms: v })} />
        <NumField label="Adults" value={item.adults} min={1} onChange={(v) => onChange({ adults: v })} />

        <NumField label="Children" value={item.children} min={0} onChange={(v) => onChange({ children: v })} />
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-in</span>
          <input type="date" className={inputCls} value={item.check_in} onChange={(e) => onChange({ check_in: e.target.value })} />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-out</span>
          <input type="date" className={inputCls} value={item.check_out} onChange={(e) => onChange({ check_out: e.target.value })} />
        </label>

        <NumField label="Rate (₹/night)" value={item.rate} min={0} onChange={(v) => onChange({ rate: v })} prefix="₹" />
        <label className="col-span-2 sm:col-span-3 flex items-center gap-2 text-sm pt-5">
          <input type="checkbox" checked={item.breakfast_included}
            onChange={(e) => onChange({ breakfast_included: e.target.checked })}
            className="h-4 w-4 accent-gold" />
          <span>Breakfast included</span>
        </label>
      </div>

      <button
        type="button"
        onClick={() => setExtrasOpen((v) => !v)}
        className="w-full inline-flex items-center justify-between rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-gold/30 transition"
      >
        <span>Extras (Early / Late / Pet / Extra Adults / Drivers)</span>
        {extrasOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {extrasOpen && (
        <div className="space-y-3 pt-1">
          <SlotMini
            title="Early Check-in"
            options={EARLY_CHECK_IN_SLOTS}
            active={item.early_check_in}
            selectedValue={item.early_check_in_slot}
            onSelect={(v) => {
              if (v === null) onChange({ early_check_in: false, early_check_in_slot: null });
              else onChange({ early_check_in: true, early_check_in_slot: v as EarlyCheckInSlot });
            }}
          />
          <SlotMini
            title="Late Check-out"
            options={LATE_CHECK_OUT_SLOTS}
            active={item.late_check_out}
            selectedValue={item.late_check_out_slot}
            onSelect={(v) => {
              if (v === null) onChange({ late_check_out: false, late_check_out_slot: null });
              else onChange({ late_check_out: true, late_check_out_slot: v as LateCheckOutSlot });
            }}
          />
          <div className="rounded-md bg-card/40 border border-border p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Pet</div>
            <div className="grid grid-cols-4 gap-2">
              {PET_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => onChange({ pet_size: p.value as PetSize })}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-[11px]",
                    item.pet_size === p.value
                      ? "border-gold/60 bg-gold-soft text-gold"
                      : "border-border bg-input/40 text-muted-foreground hover:text-foreground hover:border-gold/30",
                  )}
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="text-[10px] opacity-80">{p.fee ? `₹${p.fee}/n` : "—"}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumField label={`Extra Adults (₹${EXTRA_ADULT_RATE}/n)`} value={item.extra_adults} min={0} onChange={(v) => onChange({ extra_adults: v })} />
            <NumField label={`Drivers (₹${DRIVER_RATE}/n)`} value={item.drivers} min={0} onChange={(v) => onChange({ drivers: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

function SlotMini({
  title, options, active, selectedValue, onSelect,
}: {
  title: string;
  options: { value: string; label: string; fee: number | null }[];
  active: boolean;
  selectedValue: string | null | undefined;
  onSelect: (v: string | null) => void;
}) {
  return (
    <div className="rounded-md bg-card/40 border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
        {active && (
          <button type="button" onClick={() => onSelect(null)} className="text-[10px] text-muted-foreground hover:text-gold">Clear</button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {options.map((o) => {
          const selected = active && selectedValue === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onSelect(selected ? null : o.value)}
              className={cn(
                "rounded-md border px-2 py-1.5 text-[11px] text-left",
                selected
                  ? "border-gold/60 bg-gold-soft text-gold"
                  : "border-border bg-input/40 text-muted-foreground hover:text-foreground hover:border-gold/30",
              )}
            >
              <div className="font-medium leading-tight">{o.label}</div>
              <div className="text-[10px] opacity-80 mt-0.5">{o.fee === null ? "Full day" : `₹${o.fee}`}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LineItemsReadOnly({ items }: { items: LineItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className={cn("grid grid-cols-[1fr_auto] gap-2 py-2 text-sm border-t border-border/40 first:border-0")}>
          <div>
            <div>{it.room_type}{it.rooms > 1 ? ` × ${it.rooms}` : ""} · {it.adults}A{it.children ? `+${it.children}C` : ""}{it.extra_bed ? ` · +${it.extra_bed} bed` : ""}</div>
            <div className="text-[11px] text-muted-foreground">
              {new Date(it.check_in).toLocaleDateString("en-IN")} – {new Date(it.check_out).toLocaleDateString("en-IN")} · {nightsOf(it)}N · {it.breakfast_included ? "Breakfast incl." : "No breakfast"}
            </div>
          </div>
          <div className="tabular-nums self-center">
            ₹{lineSubtotal(it).toLocaleString("en-IN")}
          </div>
        </div>
      ))}
    </div>
  );
}
