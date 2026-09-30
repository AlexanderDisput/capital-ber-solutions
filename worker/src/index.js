// Capital BER Solutions — lead intake worker.
//
// Routes:
//   POST /submit      quote form submission (Turnstile verify -> D1 insert -> Resend autoresponder)
//   GET  /admin        the leads dashboard page
//   GET  /api/leads     list all leads (JSON)
//   PATCH /api/leads/:id  update status / difficulty / notes for one lead
//
// NOTE — /admin and /api/leads have NO login gate yet. This is intentional
// for now (design/preview pass with seed data only, no real customer PII
// in the database) but MUST be fixed — add the admin username/password +
// session-cookie auth discussed in the plan — before any real lead data
// flows through here.
//
// WhatsApp sending is not wired in yet either — it gets added to /submit
// once the Meta WhatsApp Business Platform setup is complete.

const ALLOWED_ORIGIN = "https://capitalbersolutions.ie";
const STATUSES = ["New", "Contacted", "Quoted", "Booked", "Lost"];
const DIFFICULTIES = ["Easy", "Medium", "Hard"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return corsResponse(new Response(null, { status: 204 }));
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      return handleSubmit(request, env);
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      return new Response(adminPageHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "GET" && url.pathname === "/api/leads") {
      return handleListLeads(env);
    }

    var patchMatch = url.pathname.match(/^\/api\/leads\/(\d+)$/);
    if (request.method === "PATCH" && patchMatch) {
      return handleUpdateLead(request, env, Number(patchMatch[1]));
    }

    return corsResponse(json({ error: "Not found" }, 404));
  },
};

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

  try {
    await env.DB.prepare(
      `INSERT INTO leads
        (submitted_at, name, first_name, last_name, email, phone, eircode, property_type, whatsapp_consent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(submittedAt, name, firstName, lastName, email, phone, eircode, propertyType, whatsappConsent ? 1 : 0)
      .run();
  } catch (err) {
    console.error("D1 insert failed:", err);
  }

  try {
    await sendAutoresponder(env.RESEND_API_KEY, { firstName, email, eircode });
  } catch (err) {
    console.error("Resend send failed:", err);
    return corsResponse(json({ ok: true, emailSent: false }));
  }

  return corsResponse(json({ ok: true, emailSent: true }));
}

async function handleListLeads(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, submitted_at, name, first_name, last_name, email, phone, eircode,
              property_type, whatsapp_consent, whatsapp_sent, status, difficulty, notes
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

function corsResponse(response) {
  response.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
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
    }
  }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--bg); color:var(--text); font-family:'Public Sans',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  h1{ font-family:'Libre Franklin',sans-serif; }
  code, .mono{ font-family:'IBM Plex Mono',ui-monospace,monospace; }

  .wrap{ max-width:1180px; margin:0 auto; padding:28px 20px 60px; }

  header.top{ display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:22px; }
  header.top h1{ font-size:1.5rem; font-weight:800; margin:0; }
  .stat-line{ font-family:'IBM Plex Mono',monospace; font-size:0.8rem; color:var(--text-muted); }

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

  .banner{
    background:var(--contacted-bg); color:var(--contacted-fg); font-size:0.82rem; font-weight:600;
    padding:9px 14px; border-radius:8px; margin-bottom:16px;
  }

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
    <span class="stat-line" id="stat-line">Loading…</span>
  </header>

  <div class="banner">Preview build — seeded with example data, no login gate yet. Don't point this URL at anyone until auth is added.</div>

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

  var rowsEl = document.getElementById('rows');
  var emptyEl = document.getElementById('empty');
  var statLine = document.getElementById('stat-line');
  var searchEl = document.getElementById('search');
  var statusFilterEl = document.getElementById('status-filter');

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

      tr.innerHTML =
        '<td data-label="Name" class="name-cell"><strong>' + escapeHtml(lead.name) + '</strong>' +
          '<span class="sub">' + escapeHtml(lead.property_type || '') + '</span></td>' +
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

  fetch('/api/leads')
    .then(function(r){ return r.json(); })
    .then(function(data){
      allLeads = data.leads || [];
      render();
    })
    .catch(function(){
      statLine.textContent = 'Failed to load leads';
    });
})();
</script>
</body>
</html>`;
