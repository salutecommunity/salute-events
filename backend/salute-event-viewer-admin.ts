import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN = "https://events.salute.community";
const TARGET_EMAIL = "skrothapalli@gmail.com";
const TARGET_SCOPE = "ott_bay_area";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

function headers(origin: string | null): HeadersInit {
  const h: Record<string,string> = {"Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store","Content-Type":"application/json","Vary":"Origin"};
  if (origin === ALLOWED_ORIGIN) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function reply(origin: string | null, status: number, body: Record<string,unknown>) { return new Response(JSON.stringify(body), { status, headers: headers(origin) }); }
async function findUserByEmail(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 100) return null;
  }
  return null;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return origin === ALLOWED_ORIGIN ? new Response(null, { status: 204, headers: headers(origin) }) : reply(origin, 403, { error: "Not allowed." });
  if (request.method !== "POST" || origin !== ALLOWED_ORIGIN) return reply(origin, 403, { error: "Not allowed." });
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply(origin, 401, { error: "Please sign in to SALUTE administration first." });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return reply(origin, 401, { error: "Your admin session has expired." });
  const { data: staff } = await admin.from("staff_members").select("role,active").eq("user_id", userData.user.id).maybeSingle();
  if (!staff?.active || staff.role !== "admin") return reply(origin, 403, { error: "Administrator access is required." });
  let body: Record<string,unknown>;
  try { body = await request.json(); } catch { return reply(origin, 400, { error: "Invalid request." }); }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 12 || password.length > 128 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) return reply(origin, 400, { error: "Use at least 12 characters with uppercase, lowercase, a number and a symbol." });
  const { data: access } = await admin.from("salute_event_viewer_access").select("active").eq("email", TARGET_EMAIL).eq("scope", TARGET_SCOPE).maybeSingle();
  if (!access?.active) return reply(origin, 403, { error: "Sheela’s dashboard access is not active." });
  try {
    const existing = await findUserByEmail(TARGET_EMAIL);
    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      if (error) throw error;
    } else {
      const { error } = await admin.auth.admin.createUser({ email: TARGET_EMAIL, password, email_confirm: true, user_metadata: { access_scope: TARGET_SCOPE } });
      if (error) throw error;
    }
    return reply(origin, 200, { updated: true });
  } catch (error) {
    console.error("viewer account setup failed", error instanceof Error ? error.message : "unknown");
    return reply(origin, 500, { error: "The password could not be saved. Please try again." });
  }
});
