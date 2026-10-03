import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SERVICE_DISPLAY_NAME = "MuleSoft Integration";
const SERVICE_USERNAME = "mulesoft";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyMuleSoftClient(clientId: string, clientSecret: string): Promise<boolean> {
  const expectedId = env("MULESOFT_MCP_CLIENT_ID");
  const expectedHash = env("MULESOFT_MCP_CLIENT_SECRET_SHA256");
  const actualHash = await sha256Hex(clientSecret);
  return constantTimeEqual(clientId, expectedId) && constantTimeEqual(actualHash, expectedHash);
}

async function ensureServiceIdentity(): Promise<{ email: string; password: string }> {
  const email = env("MULESOFT_MCP_SERVICE_EMAIL");
  const password = env("MULESOFT_MCP_SERVICE_PASSWORD");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (profileError) throw profileError;

  let userId = profile?.id;
  if (!userId) {
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { is_service_account: true, integration: "mulesoft" },
      user_metadata: { display_name: SERVICE_DISPLAY_NAME, username: SERVICE_USERNAME },
    });
    if (createError || !created.user) throw createError ?? new Error("Could not create MuleSoft identity");
    userId = created.user.id;
  }

  const { data: authUser, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authUserError || !authUser.user) throw authUserError ?? new Error("Could not load MuleSoft identity");
  if (authUser.user.app_metadata?.is_service_account !== true) {
    const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...authUser.user.app_metadata,
        is_service_account: true,
        integration: "mulesoft",
      },
    });
    if (metadataError) throw metadataError;
  }

  const { error: profileUpsertError } = await supabaseAdmin.from("profiles").upsert({
    id: userId,
    email,
    display_name: SERVICE_DISPLAY_NAME,
    username: SERVICE_USERNAME,
  } as never);
  if (profileUpsertError) throw profileUpsertError;

  const { error: roleDeleteError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
  if (roleDeleteError) throw roleDeleteError;
  const { error: roleInsertError } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: userId, role: "owner" } as never);
  if (roleInsertError) throw roleInsertError;

  return { email, password };
}

function authClient() {
  const url = env("SUPABASE_URL");
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"]?.trim() ?? process.env["SUPABASE_ANON_KEY"]?.trim();
  if (!publishableKey) throw new Error("Missing SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY");
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function issueMuleSoftAccessToken() {
  const identity = await ensureServiceIdentity();
  const client = authClient();
  let result = await client.auth.signInWithPassword(identity);

  if (result.error) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", identity.email)
      .single();
    if (profileError) throw profileError;
    const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      password: identity.password,
    });
    if (passwordError) throw passwordError;
    result = await client.auth.signInWithPassword(identity);
  }

  if (result.error || !result.data.session) {
    throw result.error ?? new Error("Could not establish MuleSoft HEOS session");
  }

  return {
    access_token: result.data.session.access_token,
    token_type: "Bearer",
    expires_in: result.data.session.expires_in,
    scope: "heos.read",
  };
}
