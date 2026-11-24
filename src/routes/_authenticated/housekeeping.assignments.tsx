import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { listRooms } from "@/lib/rooms-api";
import { useUserRole } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/housekeeping/assignments")({ component: HousekeepingAssignmentsPage });

type Staff = { id: string; name: string };
type Room = { id: string; room_number: string; floor: number; room_type: string };
type Assignment = { id: string; user_id: string; room_id: string; staff_name?: string; room_number?: string };

async function loadHousekeepingStaff(): Promise<Staff[]> {
  const { data: roles, error } = await supabase.from("user_roles").select("user_id").eq("role", "housekeeping");
  if (error) throw error;
  const ids = Array.from(new Set((roles ?? []).map((row) => row.user_id)));
  if (!ids.length) return [];
  const { data: profiles, error: profileError } = await supabase.from("profiles" as never).select("id,display_name,email").in("id", ids);
  if (profileError) throw profileError;
  return (profiles ?? []).map((row) => {
    const profile = row as unknown as { id: string; display_name: string | null; email: string | null };
    return { id: profile.id, name: profile.display_name || profile.email || profile.id.slice(0, 8) };
  });
}

function HousekeepingAssignmentsPage() {
  const { isAdmin, isLoading: roleLoading } = useUserRole();
  const qc = useQueryClient();
  const [staffId, setStaffId] = useState("");
  const [roomId, setRoomId] = useState("");
  const staffQ = useQuery({ queryKey: ["hk-assignment-staff"], queryFn: loadHousekeepingStaff, enabled: isAdmin });
  const roomsQ = useQuery({ queryKey: ["hk-assignment-rooms"], queryFn: async () => await listRooms(true), enabled: isAdmin });
  const assignmentQ = useQuery({
    queryKey: ["hk-room-assignments"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("housekeeping_room_assignments" as never).select("id,user_id,room_id,assigned_at").order("assigned_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Assignment[];
    },
  });
  const staff = staffQ.data ?? [];
  const rooms = (roomsQ.data ?? []) as Room[];
  const names = useMemo(() => new Map(staff.map((person) => [person.id, person.name])), [staff]);
  const roomNumbers = useMemo(() => new Map(rooms.map((room) => [room.id, room.room_number])), [rooms]);
  const add = useMutation({
    mutationFn: async () => {
      if (!staffId || !roomId) throw new Error("Choose a staff member and a room");
      const { error } = await supabase.from("housekeeping_room_assignments" as never).upsert({ user_id: staffId, room_id: roomId } as never, { onConflict: "user_id,room_id" });
      if (error) throw error;
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["hk-room-assignments"] }); toast.success("Room assigned"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("housekeeping_room_assignments" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["hk-room-assignments"] }); toast.success("Assignment removed"); },
    onError: (error: Error) => toast.error(error.message),
  });

  if (roleLoading) return <div className="p-10 text-center text-sm text-muted-foreground">Loading access…</div>;
  if (!isAdmin) return <Navigate to="/" />;
  const assignments = assignmentQ.data ?? [];
  return (
    <div>
      <Topbar title="Housekeeping Room Assignments" subtitle="Assign rooms to housekeeping staff; their task board is limited to these rooms" />
      <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
        <section className="luxe-card space-y-4 rounded-xl p-4 md:p-6">
          <div className="flex items-center gap-2 font-display text-lg"><Users className="h-5 w-5 text-gold" />Add an assignment</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger aria-label="Housekeeping staff"><SelectValue placeholder="Select staff" /></SelectTrigger>
              <SelectContent>{staff.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger aria-label="Room"><SelectValue placeholder="Select room" /></SelectTrigger>
              <SelectContent>{rooms.map((room) => <SelectItem key={room.id} value={room.id}>Room {room.room_number} · Floor {room.floor} · {room.room_type}</SelectItem>)}</SelectContent>
            </Select>
            <Button disabled={!staffId || !roomId || add.isPending} onClick={() => add.mutate()}><Plus className="mr-2 h-4 w-4" />Assign</Button>
          </div>
          {!staff.length && !staffQ.isLoading && <p className="text-xs text-muted-foreground">No active housekeeping users found. Add a user with the Housekeeping role first.</p>}
        </section>
        <section className="luxe-card divide-y divide-border rounded-xl">
          <div className="p-4 font-medium">Current assignments <span className="text-xs text-muted-foreground">({assignments.length})</span></div>
          {assignmentQ.isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : !assignments.length ? <p className="p-4 text-sm text-muted-foreground">No room assignments yet. Housekeeping staff will see no rooms until assigned.</p> : assignments.map((assignment) => (
            <div key={assignment.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1"><div className="font-medium">Room {roomNumbers.get(assignment.room_id) ?? "Unavailable"}</div><div className="truncate text-xs text-muted-foreground">{names.get(assignment.user_id) ?? "Housekeeping user"}</div></div>
              <Button size="icon" variant="ghost" aria-label="Remove room assignment" disabled={remove.isPending} onClick={() => remove.mutate(assignment.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          ))}
        </section>
        <p className="text-xs leading-relaxed text-muted-foreground">Database row-level security applies these assignments to room records, housekeeping tasks, exceptions, and laundry rows. Front Office and administrator access follows existing role policies.</p>
      </main>
    </div>
  );
}
