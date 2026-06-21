/**
 * Settings → CRM
 *
 * - Abandon timeout (minutes)
 * - Notification recipients (emails)
 * - Per-event toggles
 *
 * Default recipient is hotelexcellaoperations@gmail.com (added in seed).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getCrmSettings, updateCrmSettings } from "@/lib/leads.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, X, Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/crm")({ component: SettingsCrm });

function SettingsCrm() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getCrmSettings);
  const saveSettings = useServerFn(updateCrmSettings);
  const { data, isLoading } = useQuery({ queryKey: ["crm-settings"], queryFn: () => fetchSettings() });

  const [abandonMins, setAbandonMins] = useState(10);
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [onLead, setOnLead] = useState(true);
  const [onAbandon, setOnAbandon] = useState(true);
  const [onConverted, setOnConverted] = useState(false);
  const [onLost, setOnLost] = useState(false);

  useEffect(() => {
    if (!data) return;
    setAbandonMins(data.abandon_minutes);
    setEmails(data.notify_reception_emails);
    setOnLead(data.notify_on_lead);
    setOnAbandon(data.notify_on_abandon);
    setOnConverted(data.notify_on_converted);
    setOnLost(data.notify_on_lost);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      saveSettings({ data: {
        abandon_minutes: abandonMins,
        notify_reception_emails: emails,
        notify_on_lead: onLead,
        notify_on_abandon: onAbandon,
        notify_on_converted: onConverted,
        notify_on_lost: onLost,
      } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-settings"] });
      toast.success("CRM settings saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  function addEmail() {
    const e = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { toast.error("Enter a valid email"); return; }
    if (emails.includes(e)) { toast.error("Already added"); return; }
    setEmails([...emails, e]);
    setNewEmail("");
  }

  if (isLoading) return <div className="flex items-center gap-2 p-6"><Loader2 className="h-4 w-4 animate-spin"/> Loading…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl">CRM & Lead Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Configure lead-lifecycle automation and who gets notified.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <p className="font-display text-base">Lead lifecycle</p>
        <div className="grid gap-3 sm:max-w-xs">
          <div>
            <Label className="text-xs">Abandon timeout (minutes)</Label>
            <Input type="number" min={1} max={1440} value={abandonMins}
              onChange={(e) => setAbandonMins(Math.max(1, Number(e.target.value) || 0))} />
            <p className="text-[11px] text-muted-foreground mt-1">
              Interested leads inactive longer than this flip to Abandoned.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <p className="font-display text-base">Notification recipients</p>
        <p className="text-xs text-muted-foreground">
          Emails CC'd on every CRM notification. Default: hotelexcellaoperations@gmail.com.
        </p>
        <div className="space-y-2">
          {emails.length === 0 && <p className="text-xs text-muted-foreground italic">No recipients yet.</p>}
          {emails.map((e) => (
            <div key={e} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
              <span className="inline-flex items-center gap-2 text-sm"><Mail className="h-3.5 w-3.5 text-gold"/> {e}</span>
              <Button size="icon" variant="ghost" onClick={() => setEmails(emails.filter((x) => x !== e))}><X className="h-3.5 w-3.5"/></Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
            placeholder="add@email.com" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }} />
          <Button onClick={addEmail} variant="outline"><Plus className="h-4 w-4 mr-1"/> Add</Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <p className="font-display text-base">Send notifications when…</p>
        <Toggle label="New lead is created" v={onLead} on={setOnLead} />
        <Toggle label="Lead is abandoned (10-min inactivity)" v={onAbandon} on={setOnAbandon} />
        <Toggle label="Lead converts to a booking" v={onConverted} on={setOnConverted} />
        <Toggle label="Lead is marked Lost" v={onLost} on={setOnLost} />
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1"/> : null} Save settings
        </Button>
      </div>
    </div>
  );
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (b: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={v} onCheckedChange={on} />
    </div>
  );
}
