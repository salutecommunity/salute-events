import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = new Set(["https://events.salute.community"]);
const MAX_BODY_BYTES = 16 * 1024;
const CITIES = new Set(["San Francisco", "Palo Alto", "Washington, D.C.", "Boston", "New York", "Chicago", "Atlanta", "Dallas", "Los Angeles"]);
const INVOLVEMENTS = new Set(["attend", "host_or_cohost", "partner_or_sponsor"]);
const AVAILABILITY = new Set(["can_attend_october_14", "future_interest"]);
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

type Json = Record<string, unknown>;
function responseHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {"Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store","Content-Type":"application/json","Vary":"Origin"};
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function reply(origin: string | null, status: number, body: Json) { return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) }); }
function cleanText(value: unknown, max: number, required = true): string | null {
  if (value === undefined || value === null) { if (required) throw new Error("invalid"); return null; }
  if (typeof value !== "string") throw new Error("invalid");
  const clean = value.trim().replace(/[ \t\r\n]+/g, " ");
  if ((required && !clean) || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) throw new Error("invalid");
  return clean || null;
}
function cleanEmail(value: unknown) {
  const original = cleanText(value, 320, true) as string, normalized = original.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) || normalized.includes("..")) throw new Error("invalid");
  return { original, normalized };
}
function cleanLinkedIn(value: unknown) {
  const text = cleanText(value, 500, false); if (!text) return null;
  let url: URL; try { url = new URL(text); } catch { throw new Error("invalid"); }
  if (url.protocol !== "https:" || !/(^|\.)linkedin\.com$/i.test(url.hostname)) throw new Error("invalid");
  return url.toString();
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") { if (!origin || !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { error: "Request not allowed." }); return new Response(null, { status: 204, headers: responseHeaders(origin) }); }
  if (request.method !== "POST") return reply(origin, 405, { error: "Request not allowed." });
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { error: "Request not allowed." });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply(origin, 503, { error: "Submissions are temporarily unavailable." });
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return reply(origin, 415, { error: "Please refresh and try again." });
  try {
    const raw = await request.text(); if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new Error("invalid");
    const body = JSON.parse(raw) as Json; if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    if (typeof body.website === "string" && body.website.trim()) return reply(origin, 200, { accepted: true });
    const firstName = cleanText(body.first_name, 100, true) as string, lastName = cleanText(body.last_name, 100, true) as string;
    const contact = cleanEmail(body.email), city = cleanText(body.city, 40, true) as string; if (!CITIES.has(city)) throw new Error("invalid");
    const jobTitle = cleanText(body.job_title, 200, true) as string, company = cleanText(body.company, 200, true) as string;
    const linkedIn = cleanLinkedIn(body.linkedin_url), availability = cleanText(body.availability, 40, false), sourceEvent = cleanText(body.source_event, 100, false);
    if (availability && !AVAILABILITY.has(availability)) throw new Error("invalid");
    if (!Array.isArray(body.involvement) || body.involvement.length > INVOLVEMENTS.size) throw new Error("invalid");
    const involvement = [...new Set(body.involvement.map((item) => cleanText(item, 40, true) as string))]; if (involvement.some((item) => !INVOLVEMENTS.has(item))) throw new Error("invalid");
    const themes = cleanText(body.themes, 1500, false); if (body.consent_accepted !== true) throw new Error("invalid");
    if (sourceEvent === "palo_alto_2026_10_14" && (!linkedIn || !availability || city !== "Palo Alto")) throw new Error("invalid");
    const { data: prior, error: priorError } = await db.from("salute_on_the_table_interests").select("id,updated_at,submission_count").eq("normalized_email", contact.normalized).maybeSingle();
    if (priorError) throw priorError; if (prior && Date.now() - new Date(prior.updated_at).getTime() < 10000) return reply(origin, 429, { error: "Please wait a moment before submitting again." });
    const row = {first_name:firstName,last_name:lastName,email:contact.original,normalized_email:contact.normalized,city,job_title:jobTitle,company,linkedin_url:linkedIn,availability,source_event:sourceEvent,involvement,themes,consent_accepted:true,privacy_version:"salute-privacy-2026-09-02",user_agent:cleanText(request.headers.get("user-agent"),500,false),submission_count:prior?Number(prior.submission_count)+1:1,updated_at:new Date().toISOString()};
    const { error: saveError } = await db.from("salute_on_the_table_interests").upsert(row, { onConflict: "normalized_email" }); if (saveError) throw saveError;
    return reply(origin, 200, { accepted: true });
  } catch (error) { console.error("salute-on-the-table-interest failed", error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : JSON.stringify(error)); return reply(origin, 400, { error: "Please check the form and try again." }); }
});
