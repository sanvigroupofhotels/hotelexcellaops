import { Plus, Copy, Trash2, BedDouble } from "lucide-react";
import { roomTypes, getRoomRate } from "@/lib/mock-data";
import { NumField } from "@/components/num-field";
import { cn } from "@/lib/utils";

export interface LineItem {
  room_type: string;
  adults: number;
  children: number;
  check_in: string;
  check_out: string;
  breakfast_included: boolean;
  extra_bed: number;
  rate: number;
  notes?: string | null;
}

export function emptyLine(): LineItem {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return {
    room_type: roomTypes[0].name,
    adults: 2,
    children: 0,
    check_in: today,
    check_out: tomorrow,
    breakfast_included: true,
    extra_bed: 0,
    rate: getRoomRate(roomTypes[0].name, true),
  };
}

function nights(item: LineItem) {
  return Math.max(
    1,
    Math.round(
      (new Date(item.check_out).getTime() - new Date(item.check_in).getTime()) / 86400000,
    ),
  );
}

export function lineSubtotal(item: LineItem) {
  return Number(item.rate) * nights(item);
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
  hint = "Add extra rooms with different occupancy or dates (split stay).",
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  title?: string;
  hint?: string;
}) {
  const update = (idx: number, patch: Partial<LineItem>) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const merged = { ...it, ...patch };
      // auto-update rate when room/breakfast changes
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
          No additional rooms — using the primary stay above only.
        </div>
      )}

      {items.map((it, idx) => (
        <div key={idx} className="rounded-lg border border-border bg-secondary/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-gold">
              Line #{idx + 2} · {nights(it)}N · ₹{lineSubtotal(it).toLocaleString("en-IN")}
            </span>
            <div className="flex gap-1">
              <button type="button" onClick={() => duplicate(idx)}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Duplicate">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => remove(idx)}
                className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="block col-span-2">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Room Type</span>
              <select className={inputCls} value={it.room_type} onChange={(e) => update(idx, { room_type: e.target.value })}>
                {roomTypes.map((r) => <option key={r.name}>{r.name}</option>)}
              </select>
            </label>
            <NumField label="Adults" value={it.adults} min={1} onChange={(v) => update(idx, { adults: v })} />
            <NumField label="Children" value={it.children} min={0} onChange={(v) => update(idx, { children: v })} />
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-in</span>
              <input type="date" className={inputCls} value={it.check_in} onChange={(e) => update(idx, { check_in: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-out</span>
              <input type="date" className={inputCls} value={it.check_out} onChange={(e) => update(idx, { check_out: e.target.value })} />
            </label>
            <NumField label="Extra Bed" value={it.extra_bed} min={0} onChange={(v) => update(idx, { extra_bed: v })} />
            <NumField label="Rate (₹)" value={it.rate} min={0} onChange={(v) => update(idx, { rate: v })} prefix="₹" />
            <label className="col-span-2 sm:col-span-4 flex items-center gap-2 text-sm pt-1">
              <input type="checkbox" checked={it.breakfast_included}
                onChange={(e) => update(idx, { breakfast_included: e.target.checked })}
                className="h-4 w-4 accent-gold" />
              <span>Breakfast included</span>
            </label>
          </div>
        </div>
      ))}
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
            <div>{it.room_type} · {it.adults}A{it.children ? `+${it.children}C` : ""}{it.extra_bed ? ` · +${it.extra_bed} bed` : ""}</div>
            <div className="text-[11px] text-muted-foreground">
              {new Date(it.check_in).toLocaleDateString("en-IN")} – {new Date(it.check_out).toLocaleDateString("en-IN")} · {nights(it)}N · {it.breakfast_included ? "Breakfast incl." : "No breakfast"}
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
