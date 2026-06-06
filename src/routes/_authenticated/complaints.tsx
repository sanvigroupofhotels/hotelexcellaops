import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import {
  listComplaints, createComplaint, listComplaintCategories,
  createComplaintCategory, updateComplaintCategory,
  COMPLAINT_PRIORITIES, COMPLAINT_STATUSES,
  priorityStyles, statusStyles,
  findActiveBookingForRoom,
  type ComplaintPriority, type ComplaintStatus, type ComplaintType,
} from "@/lib/complaints-api";
import { listStaff } from "@/lib/cash-api";
import { useUserRole } from "@/hooks/use-role";
import {
  Plus, Search, MessageSquareWarning, AlertTriangle, CheckCircle2, Clock,
  CalendarRange, Activity, Settings2, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

  // Translate "active" sentinel into a server-compatible filter, then post-filter client-side.
  const serverFilters = useMemo(() => ({
    ...filters,
    status: filters.status === "active" ? "all" as const : filters.status,
  }), [filters]);

  const { data: listRaw = [], isLoading } = useQuery({
    queryKey: ["complaints", serverFilters],
    queryFn: () => listComplaints(serverFilters as any),
  });
  const list = useMemo(() => {
    let rows = listRaw;
    if (filters.status === "active") rows = rows.filter(r => r.status === "Open" || r.status === "In Progress");
    if (filters.customer.trim()) {
      const s = filters.customer.trim().toLowerCase();
      rows = rows.filter(r =>
        (r.entered_by_name ?? "").toLowerCase().includes(s) ||
        (r.assigned_to_name ?? "").toLowerCase().includes(s) ||
        (r.description ?? "").toLowerCase().includes(s),
      );
    }
    return rows;
  }, [listRaw, filters.status, filters.customer]);
  const { data: categories = [] } = useQuery({
    queryKey: ["complaint-categories"],
    queryFn: () => listComplaintCategories(),
  });
  const { data: staff = [] } = useQuery({ queryKey: ["staff", "active"], queryFn: () => listStaff(true) });

  // Dashboard counts (independent of filters)
  const { data: allRecent = [] } = useQuery({
    queryKey: ["complaints", "all"],
    queryFn: () => listComplaints(),
  });
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const open = allRecent.filter(c => c.status === "Open").length;
    const inProgress = allRecent.filter(c => c.status === "In Progress").length;
    const resolvedToday = allRecent.filter(c => c.status === "Resolved" && c.resolved_at && new Date(c.resolved_at) >= today).length;
    const critical = allRecent.filter(c => c.priority === "Critical" && c.status !== "Resolved").length;
    const thisMonth = allRecent.filter(c => new Date(c.created_at) >= monthStart).length;
    const resolutionDeltas = allRecent
      .filter(c => c.status === "Resolved" && c.resolved_at)
      .map(c => new Date(c.resolved_at!).getTime() - new Date(c.created_at).getTime());
    const avgHrs = resolutionDeltas.length
      ? Math.round(resolutionDeltas.reduce((a, b) => a + b, 0) / resolutionDeltas.length / 3_600_000)
      : null;
    return { open, inProgress, resolvedToday, critical, thisMonth, avgHrs };
  }, [allRecent]);

  const [newOpen, setNewOpen] = useState(false);
  const [catMgrOpen, setCatMgrOpen] = useState(false);

  return (
    <>
      <Topbar title="Complaints" subtitle="Operational complaints & issues" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Dialog open={newOpen} onOpenChange={setNewOpen}>
              <DialogTrigger asChild>
                <button className="inline-flex items-center gap-2 rounded-md gold-gradient text-charcoal px-4 py-2.5 text-sm font-medium">
                  <Plus className="h-4 w-4" /> New Complaint
                </button>
              </DialogTrigger>
              <NewComplaintDialog
                open={newOpen}
                onOpenChange={setNewOpen}
                categories={categories.filter(c => c.active)}
                staff={staff}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["complaints"] });
                  setNewOpen(false);
                }}
              />
            </Dialog>
            {isAdmin && (
              <button
                onClick={() => setCatMgrOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-sm hover:border-gold/40">
                <Settings2 className="h-4 w-4 text-gold" /> Manage Categories
              </button>
            )}
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Open" value={stats.open} icon={MessageSquareWarning} tone="warning"
            active={filters.status === "Open"} onClick={() => setFilters(f => ({ ...f, status: f.status === "Open" ? "all" : "Open", priority: "all" }))} />
          <StatCard label="In Progress" value={stats.inProgress} icon={Clock} tone="gold"
            active={filters.status === "In Progress"} onClick={() => setFilters(f => ({ ...f, status: f.status === "In Progress" ? "all" : "In Progress", priority: "all" }))} />
          <StatCard label="Resolved Today" value={stats.resolvedToday} icon={CheckCircle2} tone="success"
            onClick={() => setFilters(f => ({ ...f, status: "Resolved" }))} />
          <StatCard label="Critical" value={stats.critical} icon={AlertTriangle} tone="destructive"
            active={filters.priority === "Critical"} onClick={() => setFilters(f => ({ ...f, priority: f.priority === "Critical" ? "all" : "Critical" }))} />
          <StatCard label="This Month" value={stats.thisMonth} icon={CalendarRange} tone="gold" />
          <StatCard label="Avg Resolution" value={stats.avgHrs === null ? "—" : `${stats.avgHrs}h`} icon={Activity} tone="gold" />
        </div>

        {/* Filters */}
        <div className="luxe-card rounded-xl p-3 flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2 rounded-md bg-input/60 border border-border px-2.5 py-1.5 flex-1 min-w-[200px]">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="Search complaint #, room, category…"
              className="bg-transparent text-sm outline-none flex-1"
            />
          </div>
          <FilterSelect label="Status" value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v as any }))}
            options={[["all", "All Status"], ...COMPLAINT_STATUSES.map(s => [s, s] as [string, string])]} />
          <FilterSelect label="Priority" value={filters.priority} onChange={v => setFilters(f => ({ ...f, priority: v as any }))}
            options={[["all", "All Priority"], ...COMPLAINT_PRIORITIES.map(p => [p, p] as [string, string])]} />
          <FilterSelect label="Category" value={filters.category} onChange={v => setFilters(f => ({ ...f, category: v }))}
            options={[["all", "All Categories"], ...categories.filter(c => c.active).map(c => [c.name, c.name] as [string, string])]} />
          <FilterSelect label="Assignee" value={filters.assignedTo} onChange={v => setFilters(f => ({ ...f, assignedTo: v as any }))}
            options={[["all", "Any Assignee"], ["unassigned", "Unassigned"], ...staff.map(s => [s.id, s.name] as [string, string])]} />
          <input
            value={filters.room}
            onChange={e => setFilters(f => ({ ...f, room: e.target.value }))}
            placeholder="Room"
            className="w-24 bg-input/60 border border-border rounded-md px-2.5 py-1.5 text-sm" />
          <input type="date" value={filters.from ?? ""} onChange={e => setFilters(f => ({ ...f, from: e.target.value || undefined }))}
            className="bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" />
          <input type="date" value={filters.to ?? ""} onChange={e => setFilters(f => ({ ...f, to: e.target.value || undefined }))}
            className="bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" />
        </div>

        {/* List */}
        <div className="luxe-card rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : list.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">No complaints match these filters.</div>
          ) : (
            <div className="divide-y divide-border">
              {list.map(c => (
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
                    {c.entered_by_name && <span className="hidden md:inline">by {c.entered_by_name}</span>}
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
          open={catMgrOpen}
          onOpenChange={setCatMgrOpen}
          categories={categories}
          onChanged={() => qc.invalidateQueries({ queryKey: ["complaint-categories"] })}
        />
      )}
      {/* canManage referenced to avoid unused-var lint and reflect future per-row admin actions */}
      <span className="hidden">{canManage ? "1" : "0"}</span>
    </>
  );
}

function StatCard({
  label, value, icon: Icon, tone, active, onClick,
}: {
  label: string; value: number | string; icon: any;
  tone: "gold" | "warning" | "destructive" | "success";
  active?: boolean; onClick?: () => void;
}) {
  const toneClass =
    tone === "destructive" ? "text-destructive" :
    tone === "warning" ? "text-warning" :
    tone === "success" ? "text-success" : "text-gold";
  return (
    <button onClick={onClick} disabled={!onClick}
      className={cn(
        "luxe-card rounded-xl p-3 text-left transition disabled:cursor-default",
        onClick && "hover:border-gold/40 cursor-pointer",
        active && "border-gold/60 bg-gold-soft/40",
      )}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className={cn("h-4 w-4", toneClass)} />
      </div>
      <div className="font-display text-2xl mt-1">{value}</div>
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[150px] h-9 text-xs"><SelectValue placeholder={label} /></SelectTrigger>
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
