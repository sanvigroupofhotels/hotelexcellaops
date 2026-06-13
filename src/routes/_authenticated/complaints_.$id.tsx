import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import {
  getComplaint, listComplaintActivities, updateComplaint, deleteComplaint,
  setComplaintStatus, assignComplaint, listComplaintCategories,
  resolveComplaint,
  COMPLAINT_STATUSES, COMPLAINT_PRIORITIES,
  priorityStyles, statusStyles,
  type ComplaintPriority, type ComplaintStatus, type ComplaintType,
} from "@/lib/complaints-api";
import { listStaff } from "@/lib/cash-api";
import { getCustomer } from "@/lib/customers-api";
import { getBooking } from "@/lib/bookings-api";
import { useUserRole } from "@/hooks/use-role";
import {
  ArrowLeft, Loader2, Trash2, User, BedDouble, Clock, Save, Pencil, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/complaints_/$id")({
  component: ComplaintDetail,
});

type EditDraft = {
  complaint_type: ComplaintType;
  room_number: string;
  category: string;
  category_other: string;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  entered_by_staff_id: string;
  assigned_to_staff_id: string;
  description: string;
};

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ComplaintDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useUserRole();

  const { data: c, isLoading } = useQuery({ queryKey: ["complaint", id], queryFn: () => getComplaint(id) });
  const { data: acts = [] } = useQuery({ queryKey: ["complaint-acts", id], queryFn: () => listComplaintActivities(id), enabled: !!c });
  const { data: customer } = useQuery({
    queryKey: ["customer", c?.customer_id], queryFn: () => getCustomer(c!.customer_id!), enabled: !!c?.customer_id,
  });
  const { data: booking } = useQuery({
    queryKey: ["booking", c?.booking_id], queryFn: () => getBooking(c!.booking_id!), enabled: !!c?.booking_id,
  });
  const { data: staff = [] } = useQuery({ queryKey: ["staff", "active"], queryFn: () => listStaff(true) });
  const { data: categories = [] } = useQuery({ queryKey: ["complaint-categories"], queryFn: () => listComplaintCategories(true) });

  const setStatusM = useMutation({
    mutationFn: (s: ComplaintStatus) => setComplaintStatus(id, s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["complaint", id] });
      qc.invalidateQueries({ queryKey: ["complaint-acts", id] });
      qc.invalidateQueries({ queryKey: ["complaints"] });
      toast.success("Status updated");
    },
  });
  const assignM = useMutation({
    mutationFn: (staffId: string) => {
      const s = staff.find(x => x.id === staffId);
      return assignComplaint(id, s ? { id: s.id, name: s.name } : null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["complaint", id] });
      qc.invalidateQueries({ queryKey: ["complaint-acts", id] });
      toast.success("Assignment updated");
    },
  });
  const del = useMutation({
    mutationFn: () => deleteComplaint(id),
    onSuccess: () => { toast.success("Deleted"); navigate({ to: "/complaints" }); },
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  useEffect(() => {
    if (c && !draft) setDraft({
      complaint_type: c.complaint_type,
      room_number: c.room_number ?? "",
      category: c.category,
      category_other: c.category_other ?? "",
      priority: c.priority,
      status: c.status,
      entered_by_staff_id: c.entered_by_staff_id ?? "",
      assigned_to_staff_id: c.assigned_to_staff_id ?? "",
      description: c.description,
    });
  }, [c, draft]);

  const saveEdit = useMutation({
    mutationFn: () => {
      const d = draft!;
      const entered = staff.find(s => s.id === d.entered_by_staff_id);
      const assigned = staff.find(s => s.id === d.assigned_to_staff_id);
      return updateComplaint(id, {
        complaint_type: d.complaint_type,
        room_number: d.complaint_type === "Room" ? d.room_number.trim() || null : null,
        category: d.category,
        category_other: d.category === "Other" ? (d.category_other.trim() || null) : null,
        priority: d.priority,
        status: d.status,
        entered_by_staff_id: d.entered_by_staff_id || null,
        entered_by_name: entered?.name ?? null,
        assigned_to_staff_id: d.assigned_to_staff_id || null,
        assigned_to_name: assigned?.name ?? null,
        description: d.description.trim(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["complaint", id] });
      qc.invalidateQueries({ queryKey: ["complaint-acts", id] });
      qc.invalidateQueries({ queryKey: ["complaints"] });
      setEditing(false);
      toast.success("Complaint updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update"),
  });

  const cancelEdit = () => {
    if (!c) return;
    setDraft({
      complaint_type: c.complaint_type,
      room_number: c.room_number ?? "",
      category: c.category, category_other: c.category_other ?? "",
      priority: c.priority, status: c.status,
      entered_by_staff_id: c.entered_by_staff_id ?? "",
      assigned_to_staff_id: c.assigned_to_staff_id ?? "",
      description: c.description,
    });
    setEditing(false);
  };


  if (isLoading || !c || !draft) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;

  return (
    <>
      <Topbar title="Complaint" subtitle={c.complaint_number} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1200px] space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Link to="/complaints" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> All complaints
          </Link>
          <div className="flex gap-2">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-gold/40">
                <Pencil className="h-4 w-4 text-gold" /> Edit
              </button>
            ) : (
              <>
                <button onClick={cancelEdit} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-gold/40">
                  <X className="h-4 w-4" /> Cancel
                </button>
                <button onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending} className="inline-flex items-center gap-2 rounded-md gold-gradient text-charcoal px-3 py-2 text-sm font-medium disabled:opacity-60">
                  <Save className="h-4 w-4" /> {saveEdit.isPending ? "Saving…" : "Save"}
                </button>
              </>
            )}
            {isAdmin && !editing && (
              <button onClick={() => { if (confirm("Delete this complaint?")) del.mutate(); }}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-4">
            {/* Complaint Info */}
            <div className="luxe-card rounded-xl p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Complaint</div>
                  <div className="font-display text-2xl">
                    {c.category}{c.category === "Other" && c.category_other ? ` — ${c.category_other}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {c.complaint_type === "Room" && c.room_number ? `Room ${c.room_number} · ` : ""}
                    Created {new Date(c.created_at).toLocaleString("en-IN")}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[c.status])}>{c.status}</span>
                  <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", priorityStyles[c.priority])}>{c.priority}</span>
                </div>
              </div>
              {editing ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <EditField label="Complaint Type">
                    <Select value={draft.complaint_type} onValueChange={v => setDraft(d => ({ ...d!, complaint_type: v as ComplaintType }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Room">Room Complaint</SelectItem>
                        <SelectItem value="General">General Complaint</SelectItem>
                      </SelectContent>
                    </Select>
                  </EditField>
                  {draft.complaint_type === "Room" && (
                    <EditField label="Room Number">
                      <Input value={draft.room_number} onChange={e => setDraft(d => ({ ...d!, room_number: e.target.value }))} placeholder="e.g. 101" />
                    </EditField>
                  )}
                  <EditField label="Category">
                    <Select value={draft.category} onValueChange={v => setDraft(d => ({ ...d!, category: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{categories.map(cat => <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </EditField>
                  {draft.category === "Other" && (
                    <EditField label="Other Category">
                      <Input value={draft.category_other} onChange={e => setDraft(d => ({ ...d!, category_other: e.target.value }))} placeholder="Describe category" />
                    </EditField>
                  )}
                  <EditField label="Priority">
                    <Select value={draft.priority} onValueChange={v => setDraft(d => ({ ...d!, priority: v as ComplaintPriority }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{COMPLAINT_PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Status">
                    <Select value={draft.status} onValueChange={v => setDraft(d => ({ ...d!, status: v as ComplaintStatus }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{COMPLAINT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Entered By">
                    <Select value={draft.entered_by_staff_id || "_none"} onValueChange={v => setDraft(d => ({ ...d!, entered_by_staff_id: v === "_none" ? "" : v }))}>
                      <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— None —</SelectItem>
                        {staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Assigned To">
                    <Select value={draft.assigned_to_staff_id || "_none"} onValueChange={v => setDraft(d => ({ ...d!, assigned_to_staff_id: v === "_none" ? "" : v }))}>
                      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— Unassigned —</SelectItem>
                        {staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </EditField>
                  <div className="md:col-span-2">
                    <EditField label="Description">
                      <Textarea rows={5} value={draft.description} onChange={e => setDraft(d => ({ ...d!, description: e.target.value }))} />
                    </EditField>
                  </div>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{c.description}</p>
              )}
              {!editing && (
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>Entered by: <span className="text-foreground">{c.entered_by_name ?? "—"}</span></div>
                  <div>Assigned to: <span className="text-foreground">{c.assigned_to_name ?? "—"}</span></div>
                  {c.resolved_at && <div>Resolved: <span className="text-foreground">{new Date(c.resolved_at).toLocaleString("en-IN")}</span></div>}
                </div>
              )}
            </div>

            {/* Customer */}
            {customer && (
              <div className="luxe-card rounded-xl p-5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Customer</div>
                <Link to="/customers/$id" params={{ id: customer.id }} className="text-sm font-medium hover:text-gold inline-flex items-center gap-2">
                  <User className="h-4 w-4 text-gold" /> {customer.guest_name} →
                </Link>
                <div className="text-xs text-muted-foreground mt-1">{customer.phone ?? ""} · {customer.customer_reference}</div>
              </div>
            )}

            {/* Booking */}
            {booking && (
              <div className="luxe-card rounded-xl p-5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Booking</div>
                <Link to="/bookings/$id" params={{ id: booking.id }} className="text-sm font-medium hover:text-gold inline-flex items-center gap-2">
                  <BedDouble className="h-4 w-4 text-gold" /> {booking.booking_reference} →
                </Link>
                <div className="text-xs text-muted-foreground mt-1">
                  {booking.guest_name} · {new Date(booking.check_in).toLocaleDateString("en-IN")} → {new Date(booking.check_out).toLocaleDateString("en-IN")}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3">Status</h4>
              <div className="grid grid-cols-1 gap-2">
                {COMPLAINT_STATUSES.map(s => (
                  <button key={s} onClick={() => setStatusM.mutate(s)} disabled={s === c.status}
                    className={cn("rounded-md border px-3 py-1.5 text-xs transition text-left",
                      s === c.status ? "border-gold/50 bg-gold-soft text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30")}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3">Assign To</h4>
              <Select value={c.assigned_to_staff_id ?? "_none"} onValueChange={(v) => assignM.mutate(v === "_none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Unassigned —</SelectItem>
                  {staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-gold" /> Activity</h4>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {acts.length === 0 ? <p className="text-xs text-muted-foreground">No activity yet.</p> :
                  acts.map(a => (
                    <div key={a.id} className="flex gap-3 text-xs">
                      <div className="h-2 w-2 rounded-full bg-gold mt-1.5 shrink-0" />
                      <div className="flex-1">
                        <div className="text-foreground">{a.summary}</div>
                        {a.field && (a.old_value || a.new_value) && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {a.field}: <span className="line-through">{a.old_value ?? "—"}</span> → <span className="text-foreground">{a.new_value ?? "—"}</span>
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {a.actor_name ?? "Someone"}{a.actor_role ? ` · ${a.actor_role}` : ""} · {new Date(a.created_at).toLocaleString("en-IN")}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
