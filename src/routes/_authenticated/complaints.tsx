import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import {
  listComplaints, createComplaint, listComplaintCategories,
  createComplaintCategory, updateComplaintCategory,
  COMPLAINT_PRIORITIES, COMPLAINT_STATUSES, ISSUE_TYPES,
  priorityStyles, statusStyles,
  findActiveBookingForRoom,
  type ComplaintPriority, type ComplaintStatus, type ComplaintType,
} from "@/lib/complaints-api";
import { listStaff } from "@/lib/cash-api";
import { useUserRole } from "@/hooks/use-role";
import {
  Plus, Search, Settings2, Loader2, BarChart3, Download,
} from "lucide-react";
import { downloadCSV } from "@/lib/csv";
import { cn, toLocalYMD } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/complaints")({
  component: ComplaintsPage,
});

function ComplaintsPage() {
  const qc = useQueryClient();
  const { isAdmin, canManage } = useUserRole();

  const [filters, setFilters] = useState<{
    status: ComplaintStatus | "all" | "active";
    priority: ComplaintPriority | "all";
    category: string | "all";
    assignedTo: string | "all" | "unassigned";
    room: string;
    customer: string;
    from?: string; to?: string;
    search: string;
  }>({ status: "active", priority: "all", category: "all", assignedTo: "all", room: "", customer: "", search: "" });

  const { data: listRaw = [], isLoading } = useQuery({
    queryKey: ["complaints", "all"],
    queryFn: () => listComplaints(),
  });
  // Main screen: active only + search box
  const activeList = useMemo(() => {
    let rows = listRaw.filter(r => r.status === "Open" || r.status === "In Progress");
    if (filters.search.trim()) {
      const s = filters.search.trim().toLowerCase();
      rows = rows.filter(r =>
        r.complaint_number.toLowerCase().includes(s) ||
        (r.room_number ?? "").toLowerCase().includes(s) ||
        r.category.toLowerCase().includes(s) ||
        (r.description ?? "").toLowerCase().includes(s) ||
        (r.assigned_to_name ?? "").toLowerCase().includes(s),
      );
    }
    return rows;
  }, [listRaw, filters.search]);

  const { data: categories = [] } = useQuery({
    queryKey: ["complaint-categories"],
    queryFn: () => listComplaintCategories(),
  });
  const { data: staff = [] } = useQuery({ queryKey: ["staff", "active"], queryFn: () => listStaff(true) });

  const [newOpen, setNewOpen] = useState(false);
  const [catMgrOpen, setCatMgrOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);

  return (
    <>
      <Topbar title="Issues" subtitle={`${activeList.length} active`} />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-md bg-card border border-border">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="Search active issues…"
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
            />
          </div>
          <button onClick={() => setReportsOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40">
            <BarChart3 className="h-4 w-4 text-gold" /> View Reports
          </button>
          {isAdmin && (
            <button onClick={() => setCatMgrOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-sm hover:border-gold/40">
              <Settings2 className="h-4 w-4 text-gold" /> Categories
            </button>
          )}
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild>
              <button className="inline-flex items-center gap-2 rounded-md gold-gradient text-charcoal px-4 py-2.5 text-sm font-medium">
                <Plus className="h-4 w-4" /> New Issue
              </button>
            </DialogTrigger>
            <NewComplaintDialog
              open={newOpen} onOpenChange={setNewOpen}
              categories={categories.filter(c => c.active)} staff={staff}
              onSaved={() => { qc.invalidateQueries({ queryKey: ["complaints"] }); setNewOpen(false); }}
            />
          </Dialog>
        </div>

        {/* Active list */}
        <div className="luxe-card rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : activeList.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">No active issues. 🎉</div>
          ) : (
            <div className="divide-y divide-border">
              {activeList.map(c => (
                <Link key={c.id} to="/complaints/$id" params={{ id: c.id }}
                  className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 px-4 py-3 hover:bg-accent/30">
                  <div className="flex items-center gap-2 md:w-44">
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", priorityStyles[c.priority])}>
                      {c.priority}
                    </span>
                    <span className="text-xs font-mono">{c.complaint_number}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      {c.complaint_type === "Room" && c.room_number && <span className="text-gold font-medium mr-2">Room {c.room_number}</span>}
                      <span className="font-medium">{c.category}{c.category === "Other" && c.category_other ? ` — ${c.category_other}` : ""}</span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{c.description}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 font-medium", statusStyles[c.status])}>
                      {c.status}
                    </span>
                    {c.assigned_to_name && <span>→ {c.assigned_to_name}</span>}
                    <span>{new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {isAdmin && (
        <CategoryManagerDialog
          open={catMgrOpen} onOpenChange={setCatMgrOpen} categories={categories}
          onChanged={() => qc.invalidateQueries({ queryKey: ["complaint-categories"] })}
        />
      )}
      <ComplaintsReportsDialog
        open={reportsOpen} onOpenChange={setReportsOpen}
        all={listRaw} categories={categories.filter(c => c.active)} staff={staff}
        filters={filters} setFilters={setFilters}
      />
      <span className="hidden">{canManage ? "1" : "0"}</span>
    </>
  );
}

function ComplaintsReportsDialog({
  open, onOpenChange, all, categories, staff, filters, setFilters,
}: {
  open: boolean; onOpenChange: (b: boolean) => void;
  all: any[];
  categories: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  filters: any; setFilters: (fn: (f: any) => any) => void;
}) {
  const filtered = useMemo(() => all.filter((c: any) => {
    if (filters.status !== "all" && filters.status !== "active" && c.status !== filters.status) return false;
    if (filters.status === "active" && !(c.status === "Open" || c.status === "In Progress")) return false;
    if (filters.priority !== "all" && c.priority !== filters.priority) return false;
    if (filters.category !== "all" && c.category !== filters.category) return false;
    if (filters.assignedTo === "unassigned" && c.assigned_to_staff_id) return false;
    if (filters.assignedTo !== "all" && filters.assignedTo !== "unassigned" && c.assigned_to_staff_id !== filters.assignedTo) return false;
    if (filters.room.trim() && !(c.room_number ?? "").toLowerCase().includes(filters.room.trim().toLowerCase())) return false;
    if (filters.customer.trim()) {
      const s = filters.customer.trim().toLowerCase();
      if (!(c.entered_by_name ?? "").toLowerCase().includes(s) && !(c.assigned_to_name ?? "").toLowerCase().includes(s)) return false;
    }
    if (filters.from && c.created_at.slice(0,10) < filters.from) return false;
    if (filters.to && c.created_at.slice(0,10) > filters.to) return false;
    return true;
  }), [all, filters]);

  const onExport = () => {
    try {
      downloadCSV(`complaints-${toLocalYMD()}.csv`,
        filtered.map((c: any) => ({
          Number: c.complaint_number,
          Type: c.complaint_type,
          Room: c.room_number ?? "",
          Category: c.category,
          "Category Other": c.category_other ?? "",
          Priority: c.priority,
          Status: c.status,
          "Entered By": c.entered_by_name ?? "",
          "Assigned To": c.assigned_to_name ?? "",
          Description: c.description ?? "",
          Created: new Date(c.created_at).toISOString(),
          Resolved: c.resolved_at ? new Date(c.resolved_at).toISOString() : "",
        })));
      toast.success(`Exported ${filtered.length} complaint${filtered.length === 1 ? "" : "s"}`);
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Complaints Report</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <FilterSelect label="Status" value={filters.status} onChange={v => setFilters((f: any) => ({ ...f, status: v }))}
            options={[["active", "Active (Open+In Progress)"], ["all", "All Status"], ...COMPLAINT_STATUSES.map(s => [s, s] as [string, string])]} />
          <FilterSelect label="Priority" value={filters.priority} onChange={v => setFilters((f: any) => ({ ...f, priority: v }))}
            options={[["all", "All Priority"], ...COMPLAINT_PRIORITIES.map(p => [p, p] as [string, string])]} />
          <FilterSelect label="Category" value={filters.category} onChange={v => setFilters((f: any) => ({ ...f, category: v }))}
            options={[["all", "All Categories"], ...categories.map(c => [c.name, c.name] as [string, string])]} />
          <FilterSelect label="Assignee" value={filters.assignedTo} onChange={v => setFilters((f: any) => ({ ...f, assignedTo: v }))}
            options={[["all", "Any Assignee"], ["unassigned", "Unassigned"], ...staff.map(s => [s.id, s.name] as [string, string])]} />
          <input value={filters.room} onChange={e => setFilters((f: any) => ({ ...f, room: e.target.value }))}
            placeholder="Room number" className="bg-input/60 border border-border rounded-md px-2.5 py-1.5 text-sm" />
          <input value={filters.customer} onChange={e => setFilters((f: any) => ({ ...f, customer: e.target.value }))}
            placeholder="Customer / staff name" className="bg-input/60 border border-border rounded-md px-2.5 py-1.5 text-sm" />
          <input type="date" value={filters.from ?? ""} onChange={e => setFilters((f: any) => ({ ...f, from: e.target.value || undefined }))}
            className="bg-input/60 border border-border rounded-md px-2.5 py-1.5 text-sm" />
          <input type="date" value={filters.to ?? ""} onChange={e => setFilters((f: any) => ({ ...f, to: e.target.value || undefined }))}
            className="bg-input/60 border border-border rounded-md px-2.5 py-1.5 text-sm" />
        </div>
        <div className="text-xs text-muted-foreground">{filtered.length} complaint{filtered.length === 1 ? "" : "s"} match</div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="rounded-md border border-border px-4 py-2 text-sm">Close</button>
          <button onClick={onExport} className="inline-flex items-center gap-2 rounded-md gold-gradient text-charcoal px-4 py-2 text-sm font-medium">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full h-9 text-xs"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/* ---------------- New Complaint Dialog ---------------- */

function NewComplaintDialog({
  open, onOpenChange, categories, staff, onSaved,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  categories: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    complaint_type: "Room" as ComplaintType,
    room_number: "",
    customer_id: null as string | null,
    booking_id: null as string | null,
    category: "",
    category_other: "",
    priority: "Medium" as ComplaintPriority,
    status: "Open" as ComplaintStatus,
    entered_by_staff_id: "",
    assigned_to_staff_id: "",
    description: "",
    issue_type: "Complaint" as string,
    guest_impacted: false,
  });
  const [suggestion, setSuggestion] = useState<any | null>(null);
  const [checkingRoom, setCheckingRoom] = useState(false);

  const onRoomBlur = async () => {
    setSuggestion(null);
    if (form.complaint_type !== "Room" || !form.room_number.trim()) return;
    setCheckingRoom(true);
    try { setSuggestion(await findActiveBookingForRoom(form.room_number.trim())); }
    finally { setCheckingRoom(false); }
  };

  const create = useMutation({
    mutationFn: async () => {
      const entered = staff.find(s => s.id === form.entered_by_staff_id);
      const assigned = staff.find(s => s.id === form.assigned_to_staff_id);
      return createComplaint({
        complaint_type: form.complaint_type,
        room_number: form.complaint_type === "Room" ? form.room_number.trim() : null,
        customer_id: form.customer_id, booking_id: form.booking_id,
        category: form.category,
        category_other: form.category === "Other" ? form.category_other.trim() : null,
        priority: form.priority,
        status: form.status,
        entered_by_staff_id: form.entered_by_staff_id || null,
        entered_by_name: entered?.name ?? null,
        assigned_to_staff_id: form.assigned_to_staff_id || null,
        assigned_to_name: assigned?.name ?? null,
        description: form.description.trim(),
      });
    },
    onSuccess: () => { toast.success("Complaint recorded"); onSaved(); reset(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save complaint"),
  });

  const reset = () => {
    setForm({
      complaint_type: "Room", room_number: "", customer_id: null, booking_id: null,
      category: "", category_other: "", priority: "Medium", status: "Open",
      entered_by_staff_id: "", assigned_to_staff_id: "", description: "",
      issue_type: "Complaint", guest_impacted: false,
    });
    setSuggestion(null);
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>New Complaint</DialogTitle></DialogHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Complaint Type *">
          <Select value={form.complaint_type} onValueChange={v => setForm(f => ({ ...f, complaint_type: v as ComplaintType }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Room">Room Complaint</SelectItem>
              <SelectItem value="General">General Complaint</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {form.complaint_type === "Room" && (
          <Field label="Room Number *">
            <Input
              value={form.room_number}
              onChange={e => setForm(f => ({ ...f, room_number: e.target.value }))}
              onBlur={onRoomBlur}
              placeholder="e.g. 101"
            />
          </Field>
        )}
      </div>

      {form.complaint_type === "Room" && (checkingRoom || suggestion) && (
        <div className="rounded-md border border-gold/30 bg-gold-soft/40 p-3 text-sm">
          {checkingRoom ? (
            <div className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking up current booking…</div>
          ) : suggestion ? (
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <div className="font-medium">{suggestion.guest_name}</div>
                <div className="text-xs text-muted-foreground">Booking {suggestion.booking_reference}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setForm(f => ({ ...f, customer_id: suggestion.customer_id, booking_id: suggestion.id }));
                    setSuggestion(null);
                    toast.success("Linked to current guest");
                  }}
                  className="rounded-md gold-gradient text-charcoal text-xs font-medium px-3 py-1.5">
                  Use Current Guest
                </button>
                <button onClick={() => setSuggestion(null)} className="rounded-md border border-border text-xs px-3 py-1.5">Skip</button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Category *">
          <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {form.category === "Other" && (
          <Field label="Enter Complaint Category *">
            <Input value={form.category_other} onChange={e => setForm(f => ({ ...f, category_other: e.target.value }))} placeholder="Describe category" />
          </Field>
        )}
        <Field label="Priority *">
          <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as ComplaintPriority }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{COMPLAINT_PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Status *">
          <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as ComplaintStatus }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{COMPLAINT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Entered By *">
          <Select value={form.entered_by_staff_id} onValueChange={v => setForm(f => ({ ...f, entered_by_staff_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
            <SelectContent>{staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Assigned To">
          <Select value={form.assigned_to_staff_id || "_none"} onValueChange={v => setForm(f => ({ ...f, assigned_to_staff_id: v === "_none" ? "" : v }))}>
            <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— Unassigned —</SelectItem>
              {staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Description *">
        <Textarea
          rows={4}
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Describe the complaint…"
        />
      </Field>

      <DialogFooter>
        <button onClick={() => onOpenChange(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
        <button onClick={() => create.mutate()} disabled={create.isPending}
          className="rounded-md gold-gradient text-charcoal px-4 py-2 text-sm font-medium disabled:opacity-60">
          {create.isPending ? "Saving…" : "Save Complaint"}
        </button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/* ---------------- Category Manager Dialog ---------------- */

function CategoryManagerDialog({ open, onOpenChange, categories, onChanged }: {
  open: boolean; onOpenChange: (b: boolean) => void;
  categories: { id: string; name: string; active: boolean }[];
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Complaint Categories</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New category name" />
            <button
              onClick={async () => {
                if (!newName.trim()) return;
                try { await createComplaintCategory(newName.trim()); setNewName(""); onChanged(); toast.success("Added"); }
                catch (e: any) { toast.error(e?.message ?? "Failed"); }
              }}
              className="rounded-md gold-gradient text-charcoal text-sm px-3 py-1.5 font-medium">Add</button>
          </div>
          <div className="divide-y divide-border max-h-80 overflow-y-auto">
            {categories.map(c => (
              <div key={c.id} className="flex items-center justify-between py-2">
                <span className={cn("text-sm", !c.active && "text-muted-foreground line-through")}>{c.name}</span>
                <button
                  onClick={async () => {
                    try { await updateComplaintCategory(c.id, { active: !c.active }); onChanged(); }
                    catch (e: any) { toast.error(e?.message ?? "Failed"); }
                  }}
                  className="text-xs text-gold hover:underline">{c.active ? "Deactivate" : "Activate"}</button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
