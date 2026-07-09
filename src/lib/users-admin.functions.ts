import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Username: any non-empty trimmed string. No character/length restrictions per admin policy.
const USERNAME_Z = z.string().trim().min(1).max(255);
const ACTIVE_ROLES_Z = z.enum(["admin", "owner", "fo_staff", "housekeeping"]);

/** Synthesized login-email domain for username-only users (per approved design §10). */
const SYNTH_EMAIL_DOMAIN = "hotelexcella.in";
const synthEmail = (username: string) => `${username}@${SYNTH_EMAIL_DOMAIN}`;

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
        username: USERNAME_Z,
        email: z.string().email().max(255).optional().or(z.literal("")),
        password: z.string().min(1).max(1024),
        display_name: z.string().min(1).max(120),
        role: ACTIVE_ROLES_Z,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Username must be unique (case-insensitive).
    const { data: taken } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", data.username)
      .maybeSingle();
    if (taken) throw new Error("That username is already taken.");

    // Login email: real email if provided, otherwise synthesized <username>@hotelexcella.in
    // (per approved design §10 — synthesized emails are never shown in UI).
    const authEmail = data.email && data.email.length > 0 ? data.email : synthEmail(data.username);

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.display_name, username: data.username },
    });
    if (error) throw new Error(error.message);
    const uid = created.user!.id;

    await supabaseAdmin
      .from("profiles")
      .update({ display_name: data.display_name, username: data.username, email: authEmail } as any)
      .eq("id", uid);

    // Handle_new_user trigger typically inserts a default role — override.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role } as any);
    return { id: uid };
  });

export const updateUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        display_name: z.string().min(1).max(120).optional(),
        email: z.string().email().max(255).optional().or(z.literal("")),
        username: USERNAME_Z.optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.username) {
      const { data: taken } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("username", data.username)
        .neq("id", data.id)
        .maybeSingle();
      if (taken) throw new Error("That username is already taken.");
    }

    if (data.email && data.email.length > 0) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, { email: data.email });
      if (error) throw new Error(error.message);
    }

    const patch: any = {};
    if (data.display_name !== undefined) patch.display_name = data.display_name;
    if (data.email && data.email.length > 0) patch.email = data.email;
    if (data.username) patch.username = data.username;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const setUserActiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.id === context.userId && !data.active) throw new Error("You can't deactivate yourself");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, {
      ban_duration: data.active ? "none" : "876000h", // ~100 years
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetUserPasswordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), new_password: z.string().min(1).max(1024) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listUsersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }, adminUsers] =
      await Promise.all([
        supabaseAdmin.from("profiles").select("id, email, display_name, username, created_at").order("created_at"),
        supabaseAdmin.from("user_roles").select("user_id, role"),
        supabaseAdmin.auth.admin.listUsers({ perPage: 200 }),
      ]);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);
    type R = z.infer<typeof ACTIVE_ROLES_Z>;
    const byRole = new Map<string, R>();
    for (const r of roles ?? []) {
      const raw = (r as any).role as string;
      // Legacy audit-row values are defensively remapped; the DB trigger
      // blocks any new inserts of these values.
      const active: R =
        raw === "reception" ? "fo_staff" :
        raw === "staff" ? "housekeeping" :
        (raw as R);
      byRole.set((r as any).user_id, active);
    }
    const byActive = new Map<string, boolean>();
    for (const u of adminUsers.data?.users ?? []) {
      const banned = (u as any).banned_until && new Date((u as any).banned_until) > new Date();
      byActive.set(u.id, !banned);
    }
    return (profiles ?? []).map((p: any) => ({
      id: p.id,
      email: p.email,
      username: p.username ?? null,
      display_name: p.display_name,
      role: byRole.get(p.id) ?? ("housekeeping" as R),
      active: byActive.get(p.id) ?? true,
      created_at: p.created_at,
    }));
  });
