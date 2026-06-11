import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Throws if the calling user is not an admin. */
async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const createUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email().max(255),
        password: z.string().min(8).max(128),
        display_name: z.string().min(1).max(120),
        role: z.enum(["admin", "owner", "staff"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.display_name },
    });
    if (error) throw new Error(error.message);
    const uid = created.user!.id;
    await supabaseAdmin.from("profiles").update({ display_name: data.display_name }).eq("id", uid);
    // trigger inserts 'staff'; replace if a different role requested
    if (data.role !== "staff") {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
      await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role } as any);
    }
    return { id: uid };
  });

export const updateUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        display_name: z.string().min(1).max(120).optional(),
        email: z.string().email().max(255).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.email) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, { email: data.email });
      if (error) throw new Error(error.message);
    }
    if (data.display_name !== undefined) {
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ display_name: data.display_name, ...(data.email ? { email: data.email } : {}) })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else if (data.email) {
      await supabaseAdmin.from("profiles").update({ email: data.email }).eq("id", data.id);
    }
    return { ok: true };
  });

export const setUserActiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.id === context.userId && !data.active) throw new Error("You can't deactivate yourself");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, {
      ban_duration: data.active ? "none" : "876000h", // ~100 years
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetUserPasswordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), new_password: z.string().min(8).max(128) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, {
      password: data.new_password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.id === context.userId) throw new Error("You can't delete yourself");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listUsersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }, adminUsers] =
      await Promise.all([
        supabaseAdmin.from("profiles").select("id, email, display_name, created_at").order("created_at"),
        supabaseAdmin.from("user_roles").select("user_id, role"),
        supabaseAdmin.auth.admin.listUsers({ perPage: 200 }),
      ]);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);
    const byRole = new Map<string, "admin" | "staff">();
    for (const r of roles ?? []) byRole.set((r as any).user_id, (r as any).role);
    const byActive = new Map<string, boolean>();
    for (const u of adminUsers.data?.users ?? []) {
      const banned = (u as any).banned_until && new Date((u as any).banned_until) > new Date();
      byActive.set(u.id, !banned);
    }
    return (profiles ?? []).map((p: any) => ({
      id: p.id,
      email: p.email,
      display_name: p.display_name,
      role: byRole.get(p.id) ?? ("staff" as "admin" | "staff"),
      active: byActive.get(p.id) ?? true,
      created_at: p.created_at,
    }));
  });
