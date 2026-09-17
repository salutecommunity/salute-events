// S.Suite email relay.
//
// This is the component `email-operations-dispatch` posts to. The dispatcher deliberately
// refuses to be a Klaviyo client, so every provider-specific detail lives here and nowhere
// else. Built against documented Klaviyo behaviour recorded in KLAVIYO_API_FACTS.md; no
// endpoint, header, or payload here is guessed.
//
// Two routes, both POST:
//   /send           dispatcher -> Klaviyo Create Event (a flow renders and sends the email)
//   /flow-callback  Klaviyo flow webhook action -> signed forward to email-operations-callback
//
// Deploy with JWT verification DISABLED. Both routes authenticate with their own bearer
// secret; neither accepts a Supabase JWT, and no browser origin is ever allowed.
//
// TRUTHFULNESS NOTE, deliberate and load-bearing:
// Klaviyo's Create Event endpoint returns 202 with no body and no identifier of any kind.
// There is therefore no provider-issued message id to report. We return our own outbox id,
// prefixed so it can never be mistaken for one Klaviyo minted. A 202 proves Klaviyo accepted
// the trigger event. It does NOT prove an email was sent: the flow can still skip the profile
// for suppression or Smart Sending. Proof that the flow actually sent arrives only via the
// /flow-callback route, which is why each flow must carry a webhook action after its email.

const APPROVED_SENDER = {
  name: "S.Suite by SALUTE",
  email: "ssuite@salute.community",
  replyTo: "ssuite@salute.community",
} as const;

const RELAY_API_KEY = (Deno.env.get("SSUITE_EMAIL_RELAY_API_KEY") ?? "").trim();
const KLAVIYO_API_KEY = (Deno.env.get("SSUITE_KLAVIYO_API_KEY") ?? "").trim();
const KLAVIYO_REVISION = (Deno.env.get("SSUITE_KLAVIYO_REVISION") ?? "2026-07-15").trim();
const FLOW_CALLBACK_KEY = (Deno.env.get("SSUITE_KLAVIYO_FLOW_CALLBACK_KEY") ?? "").trim();
const CALLBACK_URL = (Deno.env.get("SSUITE_EMAIL_CALLBACK_URL") ?? "").trim();
const CALLBACK_SECRET = (Deno.env.get("SSUITE_EMAIL_CALLBACK_SHARED_SECRET") ?? "").trim();
const CALLBACK_AUTH = (Deno.env.get("SSUITE_EMAIL_CALLBACK_AUTHORIZATION") ?? "").trim();

const KLAVIYO_EVENTS_URL = "https://a.klaviyo.com/api/events";
const CALLBACK_EVENT_TYPES = new Set(["accepted", "delivered", "bounced", "complained", "unsubscribed", "suppressed"]);
const MESSAGE_ID_PREFIX = "klaviyo-event:";

type JsonObject = Record<string, unknown>;

function json(status: number, body: JsonObject): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Pragma": "no-cache" },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length || !a.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function bearerMatches(header: string | null, secret: string): boolean {
  return !!secret && secret.length >= 24 && constantTimeEqual((header ?? "").trim(), `Bearer ${secret}`);
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Allowed metric names. The relay may only ever trigger a metric on this list, so a leaked
 *  relay key cannot be used to fire arbitrary Klaviyo metrics into the account. */
function allowedMetrics(): Set<string> | null {
  try {
    const parsed: unknown = JSON.parse(Deno.env.get("SSUITE_KLAVIYO_ALLOWED_METRICS_JSON") ?? "");
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 50) return null;
    const names = parsed.map((value) => (typeof value === "string" ? value.trim() : ""));
    if (names.some((name) => !name || name.length > 120)) return null;
    return new Set(names);
  } catch {
    return null;
  }
}

/** Metrics approved in source rather than in configuration. The env allowlist above exists so a
 *  leaked relay key cannot fire arbitrary metrics into the Klaviyo account; an allowlist that
 *  lives in reviewed source serves that purpose at least as well, and does not require a
 *  dashboard session to extend. Anything added here must have a real, live S.Suite flow. */
const SOURCE_APPROVED_METRICS = ["S.Suite Finish Registration", "S.Suite Admin Sign In", "S.Suite Guest Registered Host Notice", "S.Suite Member Code Request", "S.Suite Invitation Approved", "S.Suite Admin Order Notice", "S.Suite Admin Request Notice", "SALUTE Event Response Confirmation"] as const;

function metricAllowlist(): Set<string> | null {
  const configured = allowedMetrics();
  if (!configured) return null;
  for (const name of SOURCE_APPROVED_METRICS) configured.add(name);
  return configured;
}

const ALLOWED_METRICS = metricAllowlist();

function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Event properties are recipient-facing template data. Reject anything that is not a flat,
 *  renderable value so no nested object or oversized blob is shipped to the provider. */
function safeProperties(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as JsonObject);
  if (entries.length > 60) return null;
  const result: JsonObject = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(key)) return null;
    if (item === null || typeof item === "number" || typeof item === "boolean") {
      result[key] = item;
      continue;
    }
    if (typeof item === "string") {
      if (item.length > 2000) return null;
      result[key] = item;
      continue;
    }
    if (Array.isArray(item) && item.length <= 40 && item.every((entry) => typeof entry === "string" && entry.length <= 500)) {
      result[key] = item;
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const nested = Object.entries(item as JsonObject);
      if (nested.length > 30 || nested.some(([, entry]) => entry !== null && typeof entry === "object")) return null;
      result[key] = item;
      continue;
    }
    return null;
  }
  return result;
}

type SendRequest = { idempotencyKey: string; metric: string; templateVersion: number; recipient: string; properties: JsonObject; name: RecipientName };

function parseSend(value: unknown): SendRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as JsonObject;
  const from = body.from as JsonObject | undefined;
  const to = body.to as JsonObject | undefined;

  if (!isUuid(body.idempotency_key)) return null;
  const metric = typeof body.template_id === "string" ? body.template_id.trim() : "";
  if (!metric || metric.length > 120) return null;
  const templateVersion = Number(body.template_version);
  if (!Number.isInteger(templateVersion) || templateVersion < 1 || templateVersion > 100000) return null;
  if (!to || !isEmail(to.email)) return null;

  // The approved sender is enforced here, not merely passed through. The relay will not send
  // as any other identity even if the caller asks it to.
  if (!from || from.name !== APPROVED_SENDER.name || from.email !== APPROVED_SENDER.email) return null;
  if (body.reply_to !== APPROVED_SENDER.replyTo) return null;

  const properties = safeProperties(body.data ?? {});
  if (!properties) return null;
  return {
    idempotencyKey: body.idempotency_key,
    metric,
    templateVersion,
    recipient: to.email,
    properties,
    name: { first: safeName(to.first_name), last: safeName(to.last_name) },
  };
}

/** Five of the nine approved templates exist only to carry one private link. If that
 *  link is absent the template falls through to a fallback that tells the recipient
 *  their link "could not be included" and to write in for another — an email whose
 *  only content is the promise of a further email. The relay refuses those sends
 *  outright instead: nothing is delivered, the outbox row records the refusal, and
 *  staff can see and fix it. Silence beats a message that wastes a reader's attention. */
const REQUIRED_LINK_BY_METRIC: Record<string, string> = {
  "S.Suite Admin Sign In": "sign_in_url",
  "S.Suite Payment Confirmation": "secure_registration_url",
  "S.Suite Table Lead Access": "table_management_url",
  "S.Suite Guest Invitation": "seat_specific_registration_url",
  "S.Suite Guest Registration Confirmation": "secure_registration_url",
  "S.Suite Incomplete Table Reminder": "table_management_url",
  "S.Suite Finish Registration": "completion_url",
};

/** The logistics template is the one message with no link and no purpose except
 *  telling people when and where to arrive. Without a confirmed arrival time it
 *  would say only that details are coming later, so it cannot be sent at all
 *  until the time exists. */
const REQUIRED_TEXT_BY_METRIC: Record<string, string[]> = {
  "S.Suite Event Logistics": ["doors_time", "venue_address", "logistics_note"],
  // A sign-in email without a code is an email that wastes the only person who reads it.
  "S.Suite Admin Sign In": ["code"],
  // The whole message is "this person registered". Without the name it says nothing a
  // host could act on, so it is refused rather than sent as a shrug. The table link is
  // deliberately not required here: the news stands on its own and the template tells
  // the host where to find their original link.
  "S.Suite Guest Registered Host Notice": ["guest_name"],
  // A donation receipt is a financial record a donor may rely on. Every one of these
  // fields renders through `|default:'—'`, so a missing value does not fail loudly: it
  // silently produces a receipt that states no amount, no date, and no receipt number.
  // That is worse than no receipt at all, so it is refused instead.
  "S.Suite Donation Receipt": ["receipt_number", "donation_amount", "donation_date"],
  // Same reasoning, lower stakes: an acknowledgment that cannot name the item it is
  // acknowledging, or the reference the submitter would quote back to us, is noise.
  "S.Suite Auction Submission Acknowledgment": ["item_name", "submission_reference"],
  // The staff order notice exists to answer "what was bought, and by whom". Without the
  // order it refers to, or what was actually bought, it is an alert with no content —
  // and a staff alert that says nothing trains its only reader to ignore the next one.
  "S.Suite Admin Order Notice": ["order_number", "headline", "buyer_name"],
  // The staff request notice exists to answer "who asked, for what, and is anything waiting
  // on me". Without the person or where the request stands it is an alert with no content,
  // and the reference is what staff quote back when they go looking for the row.
  "S.Suite Admin Request Notice": ["requester_name", "request_subject", "status_line", "reference"],
};

/** The thank-you is written in the past tense: it thanks a reader for an evening
 *  that has to have happened first. Sent before 20 November 2026 it is simply
 *  untrue, so the relay refuses it until the morning after the ceremony. Review
 *  copies are read in the rendered preview page instead of the inbox. */
const NOT_BEFORE_BY_METRIC: Record<string, string> = {
  "S.Suite Post-Event Thanks": "2026-11-21T05:00:00Z",
};

function tooEarly(metric: string): string | null {
  const notBefore = NOT_BEFORE_BY_METRIC[metric];
  if (!notBefore) return null;
  return Date.now() < Date.parse(notBefore) ? notBefore : null;
}

function requiredTextMissing(metric: string, properties: JsonObject): string | null {
  for (const key of REQUIRED_TEXT_BY_METRIC[metric] ?? []) {
    const value = properties[key];
    if (typeof value !== "string" || !value.trim()) return key;
  }
  return null;
}

function requiredLinkMissing(metric: string, properties: JsonObject): string | null {
  const key = REQUIRED_LINK_BY_METRIC[metric];
  if (!key) return null;
  const value = properties[key];
  if (typeof value !== "string" || !value.trim()) return key;
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { return key; }
  if (parsed.protocol !== "https:") return key;
  return null;
}

async function handleSend(request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get("authorization"), RELAY_API_KEY)) return json(401, { error: "Unauthorized" });
  if (!KLAVIYO_API_KEY || !/^pk_[A-Za-z0-9_-]{10,}$/.test(KLAVIYO_API_KEY)) return json(503, { error: "Relay is not configured" });
  if (!/^\d{4}-\d{2}-\d{2}(\.[A-Za-z0-9-]+)?$/.test(KLAVIYO_REVISION)) return json(503, { error: "Relay is not configured" });
  if (!ALLOWED_METRICS) return json(503, { error: "Relay is not configured" });

  const raw = await request.text();
  if (raw.length > 64 * 1024) return json(413, { error: "Payload too large" });
  let parsed: SendRequest | null;
  try { parsed = parseSend(JSON.parse(raw)); } catch { parsed = null; }
  if (!parsed) return json(400, { error: "Invalid relay request" });
  if (!ALLOWED_METRICS.has(parsed.metric)) return json(400, { error: "Unknown message type" });

  const missing = requiredLinkMissing(parsed.metric, parsed.properties) ?? requiredTextMissing(parsed.metric, parsed.properties);
  if (missing) return json(422, { error: "Required message content missing", field: missing, sent: false });

  const early = tooEarly(parsed.metric);
  if (early) return json(422, { error: "This message cannot be sent before the event", not_before: early, sent: false });

  // ssuite_message_id travels into the flow so the flow's webhook action can report back and
  // prove the email action actually ran for this specific outbox row.
  //
  // Every approved template reads its recipient-facing values as {{ event.extra.* }}.
  // Flat properties alone leave those tags unresolved, so a live email would render
  // its placeholder default instead of the real amount, name, or secure link. The
  // same values are therefore mirrored under `extra` as well as sent flat, so a
  // template resolves whichever namespace the provider exposes.
  return await sendEvent(parsed.idempotencyKey, parsed.metric, parsed.recipient, {
    ...parsed.properties,
    extra: { ...parsed.properties },
    ssuite_message_id: parsed.idempotencyKey,
    ssuite_template_version: parsed.templateVersion,
  }, parsed.name);
}

/** Recipient display names are the only profile attributes this relay will set.
 *  Templates greet with {{ person.first_name|default:'there' }}, which resolves
 *  against the provider profile and not against event properties, so a name sent
 *  only as event data can never personalise the greeting. Values are bounded and
 *  stripped of control characters; anything else is dropped rather than sent. */
function safeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return trimmed && trimmed.length <= 100 ? trimmed : null;
}

type RecipientName = { first: string | null; last: string | null };

async function sendEvent(
  uniqueId: string,
  metric: string,
  recipient: string,
  properties: JsonObject,
  name?: RecipientName,
): Promise<Response> {
  const profileAttributes: JsonObject = { email: recipient };
  if (name?.first) profileAttributes.first_name = name.first;
  if (name?.last) profileAttributes.last_name = name.last;

  const event = {
    data: {
      type: "event",
      attributes: {
        properties,
        metric: { data: { type: "metric", attributes: { name: metric } } },
        profile: { data: { type: "profile", attributes: profileAttributes } },
        unique_id: uniqueId,
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(KLAVIYO_EVENTS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        "accept": "application/vnd.api+json",
        "content-type": "application/vnd.api+json",
        "revision": KLAVIYO_REVISION,
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch {
    return json(504, { error: "Provider did not respond" });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After") ?? "";
    return json(429, { error: "Provider rate limited", retry_after_seconds: Number(retryAfter) || null });
  }
  if (response.status !== 202) {
    // Provider error text is not echoed; it can contain account detail.
    return json(502, { error: `Provider rejected the message (HTTP ${response.status})` });
  }

  // 202 means accepted for asynchronous processing. See the truthfulness note at the top.
  return json(200, { accepted: true, provider_message_id: `${MESSAGE_ID_PREFIX}${uniqueId}` });
}

/** Legacy guest-invitation route.
 *
 *  `mail-dispatch` predates the outbox and posts a slightly different body: `to` is a bare
 *  string and there is no `from`, `reply_to`, or `template_version`. It was written expecting a
 *  provider with a direct "send this template to this address" API. Klaviyo has no such API, so
 *  that function could never have worked against Klaviyo as configured. Rather than change a
 *  tested invitation path on launch day, the relay accepts its shape here and normalises it.
 *  Point SSUITE_KLAVIYO_SEND_URL at this route. */
async function handleLegacyInvitation(request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get("authorization"), RELAY_API_KEY)) return json(401, { error: "Unauthorized" });
  if (!KLAVIYO_API_KEY || !ALLOWED_METRICS) return json(503, { error: "Relay is not configured" });

  const raw = await request.text();
  if (raw.length > 16 * 1024) return json(413, { error: "Payload too large" });
  let body: JsonObject | null;
  try {
    const parsed: unknown = JSON.parse(raw);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch { body = null; }
  if (!body || !isUuid(body.idempotency_key) || !isEmail(body.to)) return json(400, { error: "Invalid relay request" });

  const metric = typeof body.template_id === "string" ? body.template_id.trim() : "";
  if (!metric || !ALLOWED_METRICS.has(metric)) return json(400, { error: "Unknown message type" });
  const properties = safeProperties(body.data ?? {});
  if (!properties) return json(400, { error: "Invalid relay request" });

  const missingLink = requiredLinkMissing(metric, properties) ?? requiredTextMissing(metric, properties);
  if (missingLink) return json(422, { error: "Required message content missing", field: missingLink, sent: false });

  // This route previously sent properties flat only. Every approved template
  // reads {{ event.extra.* }}, so each tag fell through to its default — and the
  // invitation template's default for its button was the literal draft anchor
  // "#DRAFT_PRIVATE_SEAT_URL". The invitation therefore shipped a dead button
  // even once the secure link was generated correctly. Mirror into `extra`
  // exactly as handleSend does so both namespaces resolve.
  return await sendEvent(
    body.idempotency_key,
    metric,
    body.to,
    { ...properties, extra: { ...properties }, ssuite_message_id: body.idempotency_key },
    { first: safeName(properties.recipient_first_name), last: safeName(properties.recipient_last_name) },
  );
}

type FlowCallback = { messageId: string; eventType: string; occurredAt: string; detail: string | null };

function parseFlowCallback(value: unknown): FlowCallback | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as JsonObject;
  if (!isUuid(body.ssuite_message_id)) return null;
  const eventType = typeof body.event_type === "string" ? body.event_type.trim() : "";
  if (!CALLBACK_EVENT_TYPES.has(eventType)) return null;
  const occurred = typeof body.occurred_at === "string" && body.occurred_at.trim() ? new Date(body.occurred_at.trim()) : new Date();
  if (Number.isNaN(occurred.valueOf())) return null;
  const detail = typeof body.detail === "string" ? body.detail.trim().slice(0, 1000) || null : null;
  return { messageId: body.ssuite_message_id, eventType, occurredAt: occurred.toISOString(), detail };
}

async function handleFlowCallback(request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get("authorization"), FLOW_CALLBACK_KEY)) return json(401, { error: "Unauthorized" });
  if (!CALLBACK_URL.startsWith("https://") || !CALLBACK_SECRET) return json(503, { error: "Callback forwarding is not configured" });

  const raw = await request.text();
  if (raw.length > 16 * 1024) return json(413, { error: "Payload too large" });
  let parsed: FlowCallback | null;
  try { parsed = parseFlowCallback(JSON.parse(raw)); } catch { parsed = null; }
  if (!parsed) return json(400, { error: "Invalid callback" });

  // provider_event_id is deterministic per (message, outcome) so Klaviyo's documented webhook
  // retries -- up to 17 attempts over 24 hours -- collapse into one recorded event.
  const forwarded = JSON.stringify({
    provider_event_id: `klaviyo-flow:${parsed.eventType}:${parsed.messageId}`,
    provider_message_id: `${MESSAGE_ID_PREFIX}${parsed.messageId}`,
    event_type: parsed.eventType,
    occurred_at: parsed.occurredAt,
    detail: parsed.detail ?? "flow email action executed",
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await hmacHex(CALLBACK_SECRET, `${timestamp}.${forwarded}`);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-ssuite-relay-signature": `t=${timestamp},v1=${signature}`,
  };
  if (CALLBACK_AUTH) {
    headers["Authorization"] = `Bearer ${CALLBACK_AUTH}`;
    headers["apikey"] = CALLBACK_AUTH;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(CALLBACK_URL, { method: "POST", headers, body: forwarded, signal: controller.signal });
  } catch {
    // 503 is on Klaviyo's documented retryable list, so a transient failure is retried.
    return json(503, { error: "Callback receiver did not respond" });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) return json(200, { received: true, unknown_message: true });
  if (!response.ok) return json(response.status === 401 ? 500 : 503, { error: "Callback was not recorded" });
  return json(200, { received: true });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!RELAY_API_KEY) return json(503, { error: "Relay is not configured" });
  const route = new URL(request.url).pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  if (route === "flow-callback") return await handleFlowCallback(request);
  if (route === "legacy-invitation") return await handleLegacyInvitation(request);
  if (route === "send" || route === "ssuite-email-relay") return await handleSend(request);
  return json(404, { error: "Not found" });
});
