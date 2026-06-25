import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Search, Users as UsersIcon, BookOpen, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  listStaffHr, createStaffHr, updateStaffHr, type StaffHrRow,
} from "@/lib/staff-hr-api";
import { useUserRole } from "@/hooks/use-role";
import { PermissionGate } from "@/components/permission-gate";
import { StaffDocumentsSection } from "@/components/staff-documents-section";

export const Route = createFileRoute("/_authenticated/staff-management/master")({
  component: () => <PermissionGate permission="staff.master"><StaffPage /></PermissionGate>,
});

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";

type FormState = Partial<StaffHrRow> & { name: string };

const empty: FormState = {
  name: "", mobile: "", employee_code: "", designation: "", department: "",
  date_of_joining: null, basic_salary: null, monthly_salary: null,
  food_provided: false, accommodation_provided: false, active: true,
  available_in_cashbook: true, available_in_dues: true, available_in_complaints: true,
};

function StaffPage() {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StaffHrRow | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [activeTab, setActiveTab] = useState<"profile" | "documents">("profile");

  const { data: staff = [] } = useQuery({ queryKey: ["staff-hr"], queryFn: () => listStaffHr(false) });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return staff.filter((s) => {
      if (!showInactive && !s.active) return false;
      if (!term) return true;
      return (
        s.name.toLowerCase().includes(term)
        || (s.employee_code ?? "").toLowerCase().includes(term)
        || (s.mobile ?? "").includes(term)
        || (s.designation ?? "").toLowerCase().includes(term)
        || (s.department ?? "").toLowerCase().includes(term)
      );
    });
  }, [staff, search, showInactive]);

  function openCreate() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(s: StaffHrRow) {
    setEditing(s);
    setForm({ ...s });
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name?.trim()) throw new Error("Name is required");
      const payload: any = {
        name: form.name.trim(),
        mobile: form.mobile?.trim() || null,
        employee_code: form.employee_code?.trim() || null,
        designation: form.designation?.trim() || null,
        department: form.department?.trim() || null,
        date_of_joining: form.date_of_joining || null,
        basic_salary: form.basic_salary !== null && form.basic_salary !== undefined && (form.basic_salary as any) !== "" ? Number(form.basic_salary) : null,
        monthly_salary: form.monthly_salary !== null && form.monthly_salary !== undefined && (form.monthly_salary as any) !== "" ? Number(form.monthly_salary) : null,
        food_provided: !!form.food_provided,
        accommodation_provided: !!form.accommodation_provided,
        active: form.active ?? true,
        available_in_cashbook: form.available_in_cashbook ?? true,
        available_in_dues: form.available_in_dues ?? true,
        available_in_complaints: form.available_in_complaints ?? true,
      };
      if (editing) await updateStaffHr(editing.id, payload);
      else await createStaffHr(payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Staff updated" : "Staff added");
      qc.invalidateQueries({ queryKey: ["staff-hr"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  return (
    <div className="min-h-screen">
      <Topbar title="Staff Master" subtitle="Manage employees, salaries and HR fields" />
      <main className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-5 w-5 text-gold" />
            <h1 className="font-display text-2xl">Staff Master</h1>
          </div>
          {isAdmin && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Staff
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, code, mobile..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} /> Show inactive
          </label>
        </div>

        <div className="rounded-md border border-border overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No staff</TableCell></TableRow>
              )}
              {filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.employee_code ?? "—"}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.designation ?? "—"}</TableCell>
                  <TableCell>{s.department ?? "—"}</TableCell>
                  <TableCell>{s.mobile ?? "—"}</TableCell>
                  <TableCell className="text-right">{s.monthly_salary != null ? `₹${Number(s.monthly_salary).toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-xs">{s.date_of_joining ?? "—"}</TableCell>
                  <TableCell>
                    <span className={s.active ? "text-emerald-500 text-xs" : "text-muted-foreground text-xs"}>
                      {s.active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Link to="/staff/$id/ledger" params={{ id: s.id }}>
                        <Button variant="ghost" size="icon" title="Ledger"><BookOpen className="h-4 w-4" /></Button>
                      </Link>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => openEdit(s)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </main>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl w-[calc(100vw-1rem)] sm:w-full max-h-[92vh] p-0 gap-0 flex flex-col"
        >
          <DialogHeader className="px-4 sm:px-6 py-4 border-b border-border flex-shrink-0">
            <DialogTitle>{editing ? "Edit Staff" : "Add Staff"}</DialogTitle>
          </DialogHeader>

          {editing && isAdmin && (
            <div className="px-4 sm:px-6 pt-3 flex gap-1 border-b border-border">
              {(["profile", "documents"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={
                    "px-3 py-2 text-xs uppercase tracking-wider rounded-t-md border-b-2 transition " +
                    (activeTab === t
                      ? "border-gold text-gold"
                      : "border-transparent text-muted-foreground hover:text-foreground")
                  }
                >
                  {t === "profile" ? "Profile" : <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> Documents</span>}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {activeTab === "profile" || !editing ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Employee Code">
                    <input className={inputCls} value={form.employee_code ?? ""} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} />
                  </Field>
                  <Field label="Full Name *">
                    <input className={inputCls} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Field>
                  <Field label="Mobile">
                    <input className={inputCls} value={form.mobile ?? ""} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
                  </Field>
                  <Field label="Designation">
                    <input className={inputCls} value={form.designation ?? ""} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
                  </Field>
                  <Field label="Department">
                    <input className={inputCls} value={form.department ?? ""} onChange={(e) => setForm({ ...form, department: e.target.value })} />
                  </Field>
                  <Field label="Date of Joining">
                    <input type="date" className={inputCls} value={form.date_of_joining ?? ""} onChange={(e) => setForm({ ...form, date_of_joining: e.target.value || null })} />
                  </Field>
                  <Field label="Basic Salary (₹)">
                    <input type="number" inputMode="decimal" className={inputCls} value={form.basic_salary as any ?? ""} onChange={(e) => setForm({ ...form, basic_salary: e.target.value === "" ? null : Number(e.target.value) })} />
                  </Field>
                  <Field label="Monthly Salary (₹)">
                    <input type="number" inputMode="decimal" className={inputCls} value={form.monthly_salary as any ?? ""} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value === "" ? null : Number(e.target.value) })} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={!!form.food_provided} onCheckedChange={(v) => setForm({ ...form, food_provided: v })} /> Food provided
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={!!form.accommodation_provided} onCheckedChange={(v) => setForm({ ...form, accommodation_provided: v })} /> Accommodation provided
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={form.active ?? true} onCheckedChange={(v) => setForm({ ...form, active: v })} /> Active
                  </label>
                </div>
                <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Availability in dropdowns</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={form.available_in_cashbook ?? true} onCheckedChange={(v) => setForm({ ...form, available_in_cashbook: v })} /> Cashbook
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={form.available_in_dues ?? true} onCheckedChange={(v) => setForm({ ...form, available_in_dues: v })} /> Due Collection
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={form.available_in_complaints ?? true} onCheckedChange={(v) => setForm({ ...form, available_in_complaints: v })} /> Complaint Assignment
                    </label>
                  </div>
                </div>
              </>
            ) : (
              editing && <StaffDocumentsSection staffId={editing.id} />
            )}
          </div>

          <DialogFooter className="px-4 sm:px-6 py-3 border-t border-border bg-background flex-shrink-0 sticky bottom-0 gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1 sm:flex-none">Cancel</Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || activeTab === "documents"}
              className="flex-1 sm:flex-none"
            >
              {save.isPending ? "Saving..." : (editing ? "Update" : "Add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
