import { supabase } from "@/integrations/supabase/client";

export interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  type: string;
  priority: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  customer_id: string | null;
  quote_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskInput {
  title: string;
  type?: string;
  priority?: string;
  due_date?: string | null;
  status?: string;
  notes?: string | null;
  customer_id?: string | null;
  quote_id?: string | null;
}

export async function listTasks() {
  const { data, error } = await supabase
    .from("tasks" as any).select("*")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as TaskRow[];
}

export async function createTask(input: TaskInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("tasks" as any)
    .insert({ ...input, user_id: user.id } as any)
    .select().single();
  if (error) throw error;
  return data as unknown as TaskRow;
}

export async function updateTask(id: string, patch: Partial<TaskInput>) {
  const { data, error } = await supabase
    .from("tasks" as any).update(patch as any).eq("id", id).select().single();
  if (error) throw error;
  return data as unknown as TaskRow;
}

export async function completeTask(id: string) {
  const { error } = await supabase
    .from("tasks" as any)
    .update({ status: "Done", completed_at: new Date().toISOString() } as any)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id: string) {
  const { error } = await supabase.from("tasks" as any).delete().eq("id", id);
  if (error) throw error;
}
