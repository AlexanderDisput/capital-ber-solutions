// Capital BER Solutions — lead intake worker.
//
// Public routes:
//   POST /submit            quote form submission
//   GET  /admin/login        login page
//   POST /admin/login        login handler (rate-limited)
//   POST /admin/logout       clears the session
//
// Admin routes (require a valid session cookie):
//   GET   /admin              leads dashboard
//   GET   /api/leads          list all leads
//   PATCH /api/leads/:id      update status / difficulty / notes
//   GET   /api/leads/export   CSV download of all leads
//   GET   /api/stats          area / property-type breakdown
//   POST  /api/admin/backup-now   manually trigger the monthly R2 backup (once R2 is wired in)
//
// WhatsApp sending is not wired in yet — it gets added to /submit once the
// Meta WhatsApp Business Platform setup is complete.

const ALLOWED_ORIGIN = "https://capitalbersolutions.ie";
const STATUSES = ["New", "Contacted", "Quoted", "Booked", "Lost"];
const DIFFICULTIES = ["Easy", "Medium", "Hard"];
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return corsResponse(new Response(null, { status: 204 }));
    }

    // --- public ---
    if (request.method === "POST" && path === "/submit") {
      return handleSubmit(request, env);
    }
    if (request.method === "GET" && path === "/admin/login") {
      return htmlResponse(loginPageHtml());
    }
    if (request.method === "POST" && path === "/admin/login") {
      return handleLogin(request, env);
    }
    if (request.method === "POST" && path === "/admin/logout") {
      return new Response(null, { status: 303, headers: { Location: "/admin/login", "Set-Cookie": clearSessionCookie() } });
    }

    // --- admin (session required) ---
    const isAdminPage = path === "/admin";
    const isAdminApi = path.startsWith("/api/");
    if (isAdminPage || isAdminApi) {
      const authed = await isValidSession(request, env);
      if (!authed) {
        return isAdminPage
          ? new Response(null, { status: 303, headers: { Location: "/admin/login" } })
          : corsResponse(json({ error: "Unauthorized" }, 401));
      }
    }

    if (request.method === "GET" && path === "/admin") {
      return htmlResponse(adminPageHtml());
    }
    if (request.method === "GET" && path === "/api/leads") {
      return handleListLeads(env);
    }
    if (request.method === "GET" && path === "/api/leads/export") {
      return handleExportCsv(env);
    }
    if (request.method === "GET" && path === "/api/stats") {
      return handleStats(env);
    }
    const patchMatch = path.match(/^\/api\/leads\/(\d+)$/);
    if (request.method === "PATCH" && patchMatch) {
      return handleUpdateLead(request, env, Number(patchMatch[1]));
    }
    if (request.method === "POST" && path === "/api/admin/backup-now") {
      return handleBackupNow(env);
    }

    return corsResponse(json({ error: "Not found" }, 404));
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBackup(env));
  },
};

// ---------- form submission ----------

async function handleSubmit(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return corsResponse(json({ error: "Invalid submission" }, 400));
  }

  const turnstileToken = str(form.get("cf-turnstile-response"));
  const verified = await verifyTurnstile(
    turnstileToken,
    request.headers.get("CF-Connecting-IP"),
    env.TURNSTILE_SECRET_KEY
  );
  if (!verified) {
    return corsResponse(json({ error: "Verification failed" }, 403));
  }

  const firstName = str(form.get("first_name")).trim();
  const lastName = str(form.get("last_name")).trim();
  const email = str(form.get("email")).trim();
  const phone = str(form.get("phone")).trim();
  const eircode = str(form.get("eircode")).trim();
  const propertyType = str(form.get("property_type")).trim();
  const whatsappConsent = form.get("whatsapp_consent") === "on";

  if (!firstName || !email) {
    return corsResponse(json({ error: "Missing required fields" }, 400));
  }

  const name = [firstName, lastName].filter(Boolean).join(" ");
  const submittedAt = new Date().toISOString();

  let leadId = null;
  try {
    let duplicateOfId = null;
    const dup = await env.DB.prepare(
      `SELECT id FROM leads WHERE email = ?1 OR (?2 != '' AND phone = ?2) ORDER BY submitted_at DESC LIMIT 1`
    ).bind(email, phone).all();
    if (dup.results && dup.results[0]) duplicateOfId = dup.results[0].id;

    const insertResult = await env.DB.prepare(
      `INSERT INTO leads
        (submitted_at, name, first_name, last_name, email, phone, eircode, property_type, whatsapp_consent, duplicate_of_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(submittedAt, name, firstName, lastName, email, phone, eircode, propertyType, whatsappConsent ? 1 : 0, duplicateOfId)
      .run();
    leadId = insertResult.meta ? insertResult.meta.last_row_id : null;
  } catch (err) {
    console.error("D1 insert failed:", err);
  }

  let emailSent = false;
  try {
    await sendAutoresponder(env.RESEND_API_KEY, { firstName, email, eircode });
    emailSent = true;
  } catch (err) {
    console.error("Resend send failed:", err);
  }

  let whatsappSent = false;
  if (whatsappConsent && phone) {
    try {
      whatsappSent = await sendWhatsAppTemplate(env, { phone, firstName, eircode });
      if (whatsappSent && leadId) {
        await env.DB.prepare(`UPDATE leads SET whatsapp_sent = 1 WHERE id = ?`).bind(leadId).run();
      }
    } catch (err) {
      console.error("WhatsApp send failed:", err);
    }
  }

  return corsResponse(json({ ok: true, emailSent, whatsappSent }));
}

// ---------- admin auth ----------

async function handleLogin(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (await isRateLimited(env, ip)) {
    return htmlResponse(loginPageHtml("Too many attempts. Try again in 15 minutes."), 429);
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return htmlResponse(loginPageHtml("Something went wrong. Try again."), 400);
  }

  const username = str(form.get("username")).trim();
  const password = str(form.get("password"));
  const ok = username === "admin" && !!env.ADMIN_PASSWORD && timingSafeEqual(password, env.ADMIN_PASSWORD);

  await recordAttempt(env, ip, ok);

  if (!ok) {
    return htmlResponse(loginPageHtml("Incorrect username or password."), 401);
  }

  const cookie = await createSessionCookie(env);
  return new Response(null, { status: 303, headers: { Location: "/admin", "Set-Cookie": cookie } });
}

async function isRateLimited(env, ip) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM login_attempts WHERE ip = ? AND success = 0 AND attempted_at > ?`
  ).bind(ip, since).all();
  return (results[0] && results[0].c ? results[0].c : 0) >= RATE_LIMIT_MAX_ATTEMPTS;
}

async function recordAttempt(env, ip, success) {
  try {
    await env.DB.prepare(`INSERT INTO login_attempts (ip, attempted_at, success) VALUES (?, ?, ?)`)
      .bind(ip, new Date().toISOString(), success ? 1 : 0)
      .run();
  } catch (err) {
    console.error("Failed to record login attempt:", err);
  }
}

function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createSessionCookie(env) {
  const expires = String(Date.now() + SESSION_MAX_AGE * 1000);
  const sig = await hmac(env.SESSION_SECRET, expires);
  return `session=${expires}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

function clearSessionCookie() {
  return `session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

async function isValidSession(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return false;

  const [expires, sig] = match[1].split(".");
  if (!expires || !sig) return false;
  if (Number(expires) < Date.now()) return false;

  const expected = await hmac(env.SESSION_SECRET, expires);
  return timingSafeEqual(sig, expected);
}

// ---------- leads API ----------

async function handleListLeads(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, submitted_at, name, first_name, last_name, email, phone, eircode,
              property_type, whatsapp_consent, whatsapp_sent, status, difficulty, notes, duplicate_of_id
       FROM leads ORDER BY submitted_at DESC`
    ).all();
    return corsResponse(json({ leads: results }));
  } catch (err) {
    console.error("D1 list failed:", err);
    return corsResponse(json({ error: "Failed to load leads" }, 500));
  }
}

async function handleUpdateLead(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return corsResponse(json({ error: "Invalid body" }, 400));
  }

  const fields = [];
  const values = [];

  if (typeof body.status === "string" && STATUSES.includes(body.status)) {
    fields.push("status = ?");
    values.push(body.status);
  }
  if (typeof body.difficulty === "string" && (body.difficulty === "" || DIFFICULTIES.includes(body.difficulty))) {
    fields.push("difficulty = ?");
    values.push(body.difficulty || null);
  }
  if (typeof body.notes === "string") {
    fields.push("notes = ?");
    values.push(body.notes);
  }

  if (fields.length === 0) {
    return corsResponse(json({ error: "Nothing to update" }, 400));
  }

  values.push(id);

  try {
    await env.DB.prepare(`UPDATE leads SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
    return corsResponse(json({ ok: true }));
  } catch (err) {
    console.error("D1 update failed:", err);
    return corsResponse(json({ error: "Update failed" }, 500));
  }
}

async function handleExportCsv(env) {
  try {
    const { results } = await env.DB.prepare(`SELECT * FROM leads ORDER BY submitted_at DESC`).all();
    const csv = leadsToCsv(results);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error("CSV export failed:", err);
    return corsResponse(json({ error: "Export failed" }, 500));
  }
}

async function handleStats(env) {
  try {
    const propertyTypes = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(property_type,''),'Unknown') as label, COUNT(*) as count
       FROM leads GROUP BY label ORDER BY count DESC`
    ).all();
    const areas = await env.DB.prepare(
      `SELECT SUBSTR(UPPER(REPLACE(eircode,' ','')),1,3) as label, COUNT(*) as count
       FROM leads WHERE eircode IS NOT NULL AND eircode != ''
       GROUP BY label ORDER BY count DESC`
    ).all();
    return corsResponse(json({ propertyTypes: propertyTypes.results, areas: areas.results }));
  } catch (err) {
    console.error("Stats query failed:", err);
    return corsResponse(json({ error: "Failed to load stats" }, 500));
  }
}

async function handleBackupNow(env) {
  try {
    const key = await runBackup(env);
    return corsResponse(json({ ok: true, key: key || null, note: key ? undefined : "R2 not configured yet" }));
  } catch (err) {
    console.error("Manual backup failed:", err);
    return corsResponse(json({ error: "Backup failed" }, 500));
  }
}

async function runBackup(env) {
  if (!env.STORAGE) {
    console.warn("Backup skipped: R2 binding (STORAGE) not configured yet.");
    return null;
  }
  const { results } = await env.DB.prepare(`SELECT * FROM leads ORDER BY submitted_at DESC`).all();
  const csv = leadsToCsv(results);
  const key = `backups/leads-${new Date().toISOString().slice(0, 10)}.csv`;
  await env.STORAGE.put(key, csv, { httpMetadata: { contentType: "text/csv" } });
  return key;
}

function leadsToCsv(rows) {
  const headers = [
    "id", "submitted_at", "name", "first_name", "last_name", "email", "phone", "eircode",
    "property_type", "whatsapp_consent", "whatsapp_sent", "status", "difficulty", "notes", "duplicate_of_id",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n");
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ---------- Turnstile / Resend (quote form) ----------

async function verifyTurnstile(token, ip, secret) {
  if (!token || !secret) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const outcome = await res.json();
  return outcome.success === true;
}

async function sendAutoresponder(apiKey, { firstName, email, eircode }) {
  if (!apiKey) throw new Error("RESEND_API_KEY not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Capital BER Solutions <quotes@capitalbersolutions.ie>",
      to: [email],
      subject: "Thanks for your BER enquiry — a couple of quick details",
      html: emailTemplate({ firstName, eircode }),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

// WhatsApp send is a no-op until WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID
// are set (once the "ber_quote_followup" template is approved by Meta).
async function sendWhatsAppTemplate(env, { phone, firstName, eircode }) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return false;

  const to = normalizePhone(phone);
  if (!to) return false;

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: "ber_quote_followup",
          language: { code: "en_GB" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: firstName || "there" },
                { type: "text", text: eircode || "your property" },
              ],
            },
          ],
        },
      }),
    }
  );

  if (!res.ok) {
    console.error("WhatsApp API error:", res.status, await res.text());
    return false;
  }
  return true;
}

// Best-effort normalization of Irish numbers to E.164 (+353...).
// Returns null rather than guessing when the input isn't confidently parseable.
function normalizePhone(raw) {
  let digits = str(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    // already has a country code
  } else if (digits.startsWith("00")) {
    digits = "+" + digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = "+353" + digits.slice(1);
  } else if (digits.startsWith("353")) {
    digits = "+" + digits;
  } else {
    return null;
  }
  return /^\+\d{8,15}$/.test(digits) ? digits : null;
}

function emailTemplate({ firstName, eircode }) {
  const greeting = escapeHtml(firstName || "there");
  const forProperty = eircode ? ` for ${escapeHtml(eircode)}` : "";
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#16201B;line-height:1.5;">
  <p>Hi ${greeting},</p>
  <p>Thanks for your BER enquiry${forProperty}! To get you an accurate quote as quickly as possible, could you let us know a little more:</p>
  <ul>
    <li>Approximate property size / number of bedrooms</li>
    <li>Any extensions or major energy upgrades (insulation, windows, heating, solar, etc.)</li>
    <li>Is this BER for a <strong>sale</strong>, <strong>mortgage</strong>, <strong>rental</strong>, or an <strong>SEAI grant</strong>?</li>
  </ul>
  <p>If you have a previous BER certificate, feel free to send that along too — useful, but not essential.</p>
  <p>We'll be in touch shortly. If anything's urgent in the meantime, just reply to this email.</p>
  <p>Thanks,<br>Capital BER Solutions</p>
</div>`.trim();
}

// ---------- small utils ----------

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function str(value) {
  return value == null ? "" : String(value);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function corsResponse(response) {
  response.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

// ---------- pages ----------

function loginPageHtml(error) {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Capital BER Solutions</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@700;800&family=Public+Sans:wght@400;500;600&display=swap">
<style>
  :root{ --bg:#F7F8F7; --surface:#FFFFFF; --border:#DEE3DF; --text:#16201B; --text-muted:#57635C; --accent:#0E6E55; --accent-soft:#E3F1EA; --error-bg:#F5E7E7; --error-fg:#A33D3D; }
  @media (prefers-color-scheme: dark){
    :root{ --bg:#121613; --surface:#191F1B; --border:#2B332D; --text:#ECF1EC; --text-muted:#A3AEA6; --accent:#4FD3A6; --accent-soft:#1B3A2E; --error-bg:#3A2323; --error-fg:#E39A9A; }
  }
  *{ box-sizing:border-box; }
  body{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--text); font-family:'Public Sans',sans-serif; }
  .card{ width:100%; max-width:340px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:28px 26px; margin:20px; }
  h1{ font-family:'Libre Franklin',sans-serif; font-size:1.2rem; margin:0 0 18px; }
  label{ display:block; font-weight:600; font-size:0.85rem; margin-bottom:5px; }
  input{ width:100%; padding:9px 11px; border:1.5px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); font-size:0.95rem; margin-bottom:14px; }
  input:focus{ outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
  button{ width:100%; padding:10px; border:none; border-radius:8px; background:var(--accent); color:#fff; font-weight:600; font-size:0.95rem; cursor:pointer; }
  .error{ background:var(--error-bg); color:var(--error-fg); font-size:0.85rem; padding:8px 11px; border-radius:8px; margin-bottom:14px; }
</style>
</head>
<body>
  <form class="card" method="POST" action="/admin/login">
    <h1>Capital BER Solutions</h1>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <label for="username">Username</label>
    <input type="text" id="username" name="username" autocomplete="username" required>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

function adminPageHtml() {
  return ADMIN_HTML;
}

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leads — Capital BER Solutions</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@600;700;800&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root{
    --bg:#F7F8F7; --surface:#FFFFFF; --surface-2:#EFF2EF; --border:#DEE3DF;
    --text:#16201B; --text-muted:#57635C;
    --accent:#0E6E55; --accent-soft:#E3F1EA;
    --new-bg:#E6EEFC; --new-fg:#2455C7;
    --contacted-bg:#FBF0DD; --contacted-fg:#9C6B0C;
    --quoted-bg:#F1E7FA; --quoted-fg:#7A3FC4;
    --booked-bg:#E3F3E8; --booked-fg:#1B7A45;
    --lost-bg:#F5E7E7; --lost-fg:#A33D3D;
    --warn-bg:#FBF0DD; --warn-fg:#9C6B0C;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#121613; --surface:#191F1B; --surface-2:#1F2621; --border:#2B332D;
      --text:#ECF1EC; --text-muted:#A3AEA6;
      --accent:#4FD3A6; --accent-soft:#1B3A2E;
      --new-bg:#1B2A4A; --new-fg:#86A8FF;
      --contacted-bg:#3A2E12; --contacted-fg:#E8B65B;
      --quoted-bg:#2E2242; --quoted-fg:#C9A4F2;
      --booked-bg:#17301F; --booked-fg:#6FE39D;
      --lost-bg:#3A2323; --lost-fg:#E39A9A;
      --warn-bg:#3A2E12; --warn-fg:#E8B65B;
    }
  }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--bg); color:var(--text); font-family:'Public Sans',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  h1{ font-family:'Libre Franklin',sans-serif; }
  code, .mono{ font-family:'IBM Plex Mono',ui-monospace,monospace; }

  .wrap{ max-width:1180px; margin:0 auto; padding:28px 20px 60px; }

  header.top{ display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:22px; }
  header.top h1{ font-size:1.5rem; font-weight:800; margin:0; }
  .top-actions{ display:flex; align-items:center; gap:14px; }
  .stat-line{ font-family:'IBM Plex Mono',monospace; font-size:0.8rem; color:var(--text-muted); }
  .logout-link{ font-size:0.8rem; color:var(--text-muted); text-decoration:none; }
  .logout-link:hover{ color:var(--accent); }

  .stats-grid{ display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:20px; }
  @media (max-width:640px){ .stats-grid{ grid-template-columns:1fr; } }
  .stats-card{ background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px 18px; }
  .stats-card h2{ font-family:'Public Sans',sans-serif; font-size:0.72rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted); margin:0 0 12px; }
  .bar-row{ display:flex; align-items:center; gap:10px; margin-bottom:7px; font-size:0.83rem; }
  .bar-label{ width:70px; flex-shrink:0; color:var(--text-muted); text-transform:capitalize; }
  .bar-track{ flex:1; height:7px; border-radius:99px; background:var(--surface-2); overflow:hidden; }
  .bar-fill{ height:100%; background:var(--accent); border-radius:99px; }
  .bar-count{ width:22px; text-align:right; font-family:'IBM Plex Mono',monospace; color:var(--text-muted); flex-shrink:0; }

  .toolbar{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:18px; }
  .toolbar input[type=search]{
    flex:1; min-width:200px; padding:9px 12px; border-radius:8px; border:1.5px solid var(--border);
    background:var(--surface); color:var(--text); font-family:'Public Sans',sans-serif; font-size:0.92rem;
  }
  .toolbar select{
    padding:9px 12px; border-radius:8px; border:1.5px solid var(--border);
    background:var(--surface); color:var(--text); font-family:'Public Sans',sans-serif; font-size:0.88rem;
  }
  .toolbar input:focus, .toolbar select:focus{ outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
  .csv-link{
    margin-left:auto; font-size:0.83rem; font-weight:600; color:var(--accent); text-decoration:none;
    border:1.5px solid var(--accent); padding:8px 14px; border-radius:8px;
  }
  .csv-link:hover{ background:var(--accent-soft); }

  .table-card{ background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
  table{ width:100%; border-collapse:collapse; font-size:0.87rem; }
  thead th{
    text-align:left; font-weight:600; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.05em;
    color:var(--text-muted); padding:11px 14px; border-bottom:1px solid var(--border); white-space:nowrap;
  }
  tbody td{ padding:12px 14px; border-bottom:1px solid var(--border); vertical-align:top; }
  tbody tr:last-child td{ border-bottom:none; }
  tbody tr:hover{ background:var(--surface-2); }

  .name-cell strong{ display:block; font-weight:600; }
  .name-cell .sub{ color:var(--text-muted); font-size:0.8rem; }
  .dup-chip{
    display:inline-flex; align-items:center; gap:4px; font-size:0.72rem; font-weight:600;
    color:var(--warn-fg); background:var(--warn-bg); padding:2px 7px; border-radius:99px; margin-top:4px;
  }
  .contact-cell a{ color:var(--text); text-decoration:none; display:block; }
  .contact-cell a:hover{ color:var(--accent); }
  .wa-chip{
    display:inline-flex; align-items:center; gap:4px; font-size:0.72rem; font-weight:600;
    color:var(--booked-fg); background:var(--booked-bg); padding:2px 7px; border-radius:99px; margin-top:4px;
  }

  select.status-select, select.difficulty-select{
    font-family:'Public Sans',sans-serif; font-weight:600; font-size:0.78rem; border:none; border-radius:99px;
    padding:5px 10px; cursor:pointer; appearance:none; -webkit-appearance:none;
  }
  select.status-select[data-s="New"]{ background:var(--new-bg); color:var(--new-fg); }
  select.status-select[data-s="Contacted"]{ background:var(--contacted-bg); color:var(--contacted-fg); }
  select.status-select[data-s="Quoted"]{ background:var(--quoted-bg); color:var(--quoted-fg); }
  select.status-select[data-s="Booked"]{ background:var(--booked-bg); color:var(--booked-fg); }
  select.status-select[data-s="Lost"]{ background:var(--lost-bg); color:var(--lost-fg); }
  select.difficulty-select{ background:var(--surface-2); color:var(--text-muted); }

  .notes-input{
    width:100%; min-width:160px; border:1px solid transparent; background:transparent; color:var(--text);
    font-family:'Public Sans',sans-serif; font-size:0.85rem; padding:5px 6px; border-radius:6px;
  }
  .notes-input:hover{ border-color:var(--border); }
  .notes-input:focus{ outline:none; border-color:var(--accent); background:var(--surface); box-shadow:0 0 0 3px var(--accent-soft); }

  .date-cell{ font-family:'IBM Plex Mono',monospace; font-size:0.78rem; color:var(--text-muted); white-space:nowrap; }

  .empty-state{ padding:50px 20px; text-align:center; color:var(--text-muted); }

  @media (max-width: 760px){
    .table-card{ border:none; background:transparent; }
    thead{ display:none; }
    table, tbody, tr, td{ display:block; width:100%; }
    tbody tr{ background:var(--surface); border:1px solid var(--border); border-radius:10px; margin-bottom:10px; padding:6px 4px; }
    tbody td{ border-bottom:none; padding:6px 12px; }
    tbody td::before{ content:attr(data-label); display:block; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:2px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>Leads</h1>
    <div class="top-actions">
      <span class="stat-line" id="stat-line">Loading…</span>
      <a class="logout-link" href="/admin/logout" id="logout-link">Sign out</a>
    </div>
  </header>

  <div class="stats-grid">
    <div class="stats-card">
      <h2>Property type</h2>
      <div id="stats-property"></div>
    </div>
    <div class="stats-card">
      <h2>Area (Eircode routing key)</h2>
      <div id="stats-area"></div>
    </div>
  </div>

  <div class="toolbar">
    <input type="search" id="search" placeholder="Search name, email, Eircode…">
    <select id="status-filter">
      <option value="">All statuses</option>
      <option>New</option>
      <option>Contacted</option>
      <option>Quoted</option>
      <option>Booked</option>
      <option>Lost</option>
    </select>
    <a class="csv-link" href="/api/leads/export">Download CSV</a>
  </div>

  <div class="table-card">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Contact</th>
          <th>Property</th>
          <th>Status</th>
          <th>Difficulty</th>
          <th>Notes</th>
          <th>Submitted</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty-state" id="empty" hidden>No leads match your filters.</div>
  </div>
</div>

<script>
(function(){
  var STATUSES = ["New","Contacted","Quoted","Booked","Lost"];
  var DIFFICULTIES = ["","Easy","Medium","Hard"];
  var allLeads = [];
  var leadsById = {};

  var rowsEl = document.getElementById('rows');
  var emptyEl = document.getElementById('empty');
  var statLine = document.getElementById('stat-line');
  var searchEl = document.getElementById('search');
  var statusFilterEl = document.getElementById('status-filter');

  document.getElementById('logout-link').addEventListener('click', function(e){
    e.preventDefault();
    fetch('/admin/logout', { method: 'POST' }).finally(function(){ window.location.href = '/admin/login'; });
  });

  function fmtDate(iso){
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('en-IE', { day:'2-digit', month:'short' }) + ' ' +
             d.toLocaleTimeString('en-IE', { hour:'2-digit', minute:'2-digit' });
    } catch(e){ return iso; }
  }

  function optionsHtml(list, current){
    return list.map(function(v){
      var label = v === "" ? "—" : v;
      return '<option value="' + v + '"' + (v === current ? ' selected' : '') + '>' + label + '</option>';
    }).join('');
  }

  function renderBars(containerId, items){
    var el = document.getElementById(containerId);
    if (!items || items.length === 0) { el.innerHTML = '<div style="color:var(--text-muted);font-size:0.83rem;">No data yet</div>'; return; }
    var max = Math.max.apply(null, items.map(function(i){ return i.count; }));
    el.innerHTML = items.map(function(i){
      var pct = max ? Math.round((i.count / max) * 100) : 0;
      return '<div class="bar-row"><span class="bar-label">' + escapeHtml(i.label) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="bar-count">' + i.count + '</span></div>';
    }).join('');
  }

  function render(){
    var q = searchEl.value.trim().toLowerCase();
    var statusFilter = statusFilterEl.value;

    var filtered = allLeads.filter(function(lead){
      if (statusFilter && lead.status !== statusFilter) return false;
      if (!q) return true;
      var haystack = [lead.name, lead.email, lead.eircode, lead.phone].join(' ').toLowerCase();
      return haystack.indexOf(q) !== -1;
    });

    statLine.textContent = allLeads.length + ' leads · ' +
      allLeads.filter(function(l){ return l.status === 'New'; }).length + ' new';

    rowsEl.innerHTML = '';
    emptyEl.hidden = filtered.length > 0;

    filtered.forEach(function(lead){
      var tr = document.createElement('tr');

      var waChip = lead.whatsapp_consent ? '<span class="wa-chip">WhatsApp OK</span>' : '';
      var dupChip = '';
      if (lead.duplicate_of_id && leadsById[lead.duplicate_of_id]) {
        dupChip = '<span class="dup-chip">⚠ Duplicate of ' + escapeHtml(leadsById[lead.duplicate_of_id].name) + '</span>';
      } else if (lead.duplicate_of_id) {
        dupChip = '<span class="dup-chip">⚠ Possible duplicate (#' + lead.duplicate_of_id + ')</span>';
      }

      tr.innerHTML =
        '<td data-label="Name" class="name-cell"><strong>' + escapeHtml(lead.name) + '</strong>' +
          '<span class="sub">' + escapeHtml(lead.property_type || '') + '</span>' + dupChip + '</td>' +
        '<td data-label="Contact" class="contact-cell">' +
          '<a href="mailto:' + escapeHtml(lead.email) + '">' + escapeHtml(lead.email) + '</a>' +
          (lead.phone ? '<a href="tel:' + escapeHtml(lead.phone) + '">' + escapeHtml(lead.phone) + '</a>' : '') +
          waChip +
        '</td>' +
        '<td data-label="Property">' + escapeHtml(lead.eircode || '—') + '</td>' +
        '<td data-label="Status"></td>' +
        '<td data-label="Difficulty"></td>' +
        '<td data-label="Notes"></td>' +
        '<td data-label="Submitted" class="date-cell">' + fmtDate(lead.submitted_at) + '</td>';

      var statusSelect = document.createElement('select');
      statusSelect.className = 'status-select';
      statusSelect.dataset.s = lead.status;
      statusSelect.innerHTML = optionsHtml(STATUSES, lead.status);
      statusSelect.addEventListener('change', function(){
        statusSelect.dataset.s = statusSelect.value;
        lead.status = statusSelect.value;
        patchLead(lead.id, { status: statusSelect.value });
      });
      tr.children[3].appendChild(statusSelect);

      var diffSelect = document.createElement('select');
      diffSelect.className = 'difficulty-select';
      diffSelect.innerHTML = optionsHtml(DIFFICULTIES, lead.difficulty || "");
      diffSelect.addEventListener('change', function(){
        lead.difficulty = diffSelect.value;
        patchLead(lead.id, { difficulty: diffSelect.value });
      });
      tr.children[4].appendChild(diffSelect);

      var notesInput = document.createElement('input');
      notesInput.className = 'notes-input';
      notesInput.type = 'text';
      notesInput.placeholder = 'Add a note…';
      notesInput.value = lead.notes || '';
      notesInput.addEventListener('change', function(){
        lead.notes = notesInput.value;
        patchLead(lead.id, { notes: notesInput.value });
      });
      tr.children[5].appendChild(notesInput);

      rowsEl.appendChild(tr);
    });
  }

  function patchLead(id, patch){
    fetch('/api/leads/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    }).catch(function(){});
  }

  function escapeHtml(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  searchEl.addEventListener('input', render);
  statusFilterEl.addEventListener('change', render);

  Promise.all([
    fetch('/api/leads').then(function(r){ return r.json(); }),
    fetch('/api/stats').then(function(r){ return r.json(); })
  ]).then(function(results){
    var leadsData = results[0], statsData = results[1];
    allLeads = leadsData.leads || [];
    allLeads.forEach(function(l){ leadsById[l.id] = l; });
    render();
    renderBars('stats-property', statsData.propertyTypes);
    renderBars('stats-area', statsData.areas);
  }).catch(function(){
    statLine.textContent = 'Failed to load leads';
  });
})();
</script>
</body>
</html>`;
