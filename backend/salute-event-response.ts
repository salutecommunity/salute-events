import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = new Set([
  "https://events.salute.community",
]);
const MAX_BODY_BYTES = 16 * 1024;
const RELAY_API_KEY = (Deno.env.get("SSUITE_EMAIL_RELAY_API_KEY") ?? "").trim();
const RELAY_URL = `${SUPABASE_URL}/functions/v1/ssuite-email-relay/send`;
const PURCHASE_LABELS: Record<string, string> = {
  actively_looking: "Yes, actively looking",
  beginning_to_explore: "Yes, beginning to explore",
  within_one_year: "Expecting to purchase within the next year",
  not_at_this_time: "Not at this time",
};
const CONSULT_LABELS: Record<string, string> = {
  yes: "Yes, interested",
  maybe: "Maybe, please share more information",
  no: "No, not at this time",
};

type Json = Record<string, unknown>;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function headers(origin: string | null): HeadersInit {
  const result: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) result["Access-Control-Allow-Origin"] = origin;
  return result;
}

function reply(origin: string | null, status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function text(value: unknown, max: number, required = true): string | null {
  if (value === undefined || value === null) {
    if (required) throw new Error("invalid");
    return null;
  }
  if (typeof value !== "string") throw new Error("invalid");
  const clean = value.trim().replace(/[ \t\r\n]+/g, " ");
  if ((required && !clean) || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) throw new Error("invalid");
  return clean || null;
}

function email(value: unknown): { original: string; normalized: string } {
  const original = text(value, 320, true) as string;
  const normalized = original.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error("invalid");
  return { original, normalized };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error("invalid");
  return value as T;
}

async function readJson(request: Request): Promise<Json> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) throw new Error("invalid");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new Error("invalid");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
  return parsed as Json;
}

async function triggerConfirmation(id: string, recipient: string, fullName: string, properties: Json): Promise<boolean> {
  if (!RELAY_API_KEY) return false;
  const names = fullName.trim().split(/\s+/);
  const body = {
    idempotency_key: id,
    template_id: "SALUTE Event Response Confirmation",
    template_version: 1,
    from: { name: "S.Suite by SALUTE", email: "ssuite@salute.community" },
    reply_to: "ssuite@salute.community",
    to: { email: recipient, first_name: names[0] ?? null, last_name: names.length > 1 ? names.slice(1).join(" ") : null },
    data: properties,
  };
  try {
    const response = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${RELAY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { error: "Request not allowed." });
    return new Response(null, { status: 204, headers: headers(origin) });
  }
  if (request.method !== "POST") return reply(origin, 405, { error: "Request not allowed." });
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { error: "Request not allowed." });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply(origin, 503, { error: "Submissions are temporarily unavailable." });
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return reply(origin, 415, { error: "Please refresh and try again." });
  }

  let body: Json;
  try { body = await readJson(request); } catch { return reply(origin, 400, { error: "Please check the form and try again." }); }
  if (typeof body.website === "string" && body.website.trim()) return reply(origin, 200, { accepted: true });

  try {
    const slug = oneOf(body.event_slug, ["livingwithart"] as const);
    const responseType = oneOf(body.response_type, ["rsvp", "interest"] as const);
    const contact = email(body.email);
    const fullName = text(body.full_name, 200, true) as string;
    const jobTitle = text(body.job_title, 200, true) as string;
    const company = text(body.company, 200, true) as string;
    const purchaseIntent = oneOf(body.purchase_intent, ["actively_looking", "beginning_to_explore", "within_one_year", "not_at_this_time"] as const);
    const consultationInterest = oneOf(body.consultation_interest, ["yes", "maybe", "no"] as const);
    if (body.consent_accepted !== true) throw new Error("invalid");

    const { data: event, error: eventError } = await db
      .from("salute_event_pages")
      .select("id,status,title,starts_at,timezone,venue_name,series_name")
      .eq("slug", slug)
      .maybeSingle();
    if (eventError || !event) return reply(origin, 404, { error: "This event is unavailable." });
    if (event.status !== "open") return reply(origin, 409, { error: "Responses are not open yet." });

    let rsvpStatus: "accept" | "decline" | null = null;
    let hasDietary: boolean | null = null;
    let dietaryDetails: string | null = null;
    let interestNote: string | null = null;

    if (responseType === "rsvp") {
      rsvpStatus = oneOf(body.rsvp_status, ["accept", "decline"] as const);
      const { data: invitee, error: inviteError } = await db
        .from("salute_event_invitees")
        .select("id")
        .eq("event_id", event.id)
        .eq("normalized_email", contact.normalized)
        .eq("active", true)
        .maybeSingle();
      if (inviteError) throw inviteError;
      if (!invitee) return reply(origin, 403, { code: "invitation_required", error: "We couldn’t locate a formal invitation for this email address. Please try the address that received your invitation or contact SALUTE." });
      if (rsvpStatus === "accept") {
        if (typeof body.has_dietary_restrictions !== "boolean") throw new Error("invalid");
        hasDietary = body.has_dietary_restrictions;
        dietaryDetails = hasDietary ? text(body.dietary_details, 1000, true) : null;
      }
    } else {
      interestNote = text(body.interest_note, 1000, false);
    }

    const { data: prior } = await db
      .from("salute_event_responses")
      .select("id,updated_at,submission_count")
      .eq("event_id", event.id)
      .eq("response_type", responseType)
      .eq("normalized_email", contact.normalized)
      .maybeSingle();
    if (prior && Date.now() - new Date(prior.updated_at).getTime() < 10_000) {
      return reply(origin, 429, { error: "Please wait a moment before submitting again." });
    }

    const row = {
      event_id: event.id,
      response_type: responseType,
      full_name: fullName,
      email: contact.original,
      normalized_email: contact.normalized,
      job_title: jobTitle,
      company,
      rsvp_status: rsvpStatus,
      purchase_intent: purchaseIntent,
      consultation_interest: consultationInterest,
      has_dietary_restrictions: hasDietary,
      dietary_details: dietaryDetails,
      interest_note: interestNote,
      consent_accepted: true,
      privacy_version: "salute-privacy-2026-09-02",
      terms_version: "salute-terms-2026-09-02",
      media_release_version: "salute-terms-section-4-2026-09-02",
      user_agent: text(request.headers.get("user-agent"), 500, false),
      submission_count: prior ? Number(prior.submission_count) + 1 : 1,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error: saveError } = await db
      .from("salute_event_responses")
      .upsert(row, { onConflict: "event_id,response_type,normalized_email" })
      .select("id")
      .single();
    if (saveError || !saved) throw saveError ?? new Error("save_failed");

    const confirmationAccepted = await triggerConfirmation(saved.id, contact.original, fullName, {
      full_name: fullName,
      event_series: event.series_name ?? "On the Table",
      event_title: event.title,
      event_date: "Wednesday, October 7, 2026",
      event_time: "6:30 p.m. ET",
      venue_name: event.venue_name ?? "FARZI NYC",
      response_type: responseType,
      response_summary: responseType === "rsvp" ? (rsvpStatus === "accept" ? "Attending" : "Unable to attend") : "Interest registered",
      job_title: jobTitle,
      company,
      purchase_intent: PURCHASE_LABELS[purchaseIntent] ?? purchaseIntent,
      consultation_interest: CONSULT_LABELS[consultationInterest] ?? consultationInterest,
      dietary_restrictions: hasDietary === null ? "Not applicable" : hasDietary ? dietaryDetails ?? "Yes" : "No",
      interest_note: interestNote ?? "Not provided",
      event_url: "https://events.salute.community/livingwithart/",
      submitted_at: new Date().toISOString(),
    });
    await db.from("salute_event_responses").update({
      confirmation_status: confirmationAccepted ? "trigger_accepted" : "trigger_failed",
      confirmation_triggered_at: confirmationAccepted ? new Date().toISOString() : null,
    }).eq("id", saved.id);

    return reply(origin, 200, {
      accepted: true,
      status: responseType === "rsvp" ? "rsvp_received" : "interest_received",
    });
  } catch (error) {
    console.error("salute-event-response failed", error instanceof Error ? error.message : "unknown");
    return reply(origin, 400, { error: "Please check the form and try again." });
  }
});
