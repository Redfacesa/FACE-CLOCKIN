import { INDUSTRIES } from "./platform.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const publicStyle = `
  :root { color-scheme: light; --ink:#1c1c1c; --muted:#5c5854; --line:#e4e0db; --red:#9f1d2d; --paper:#f7f5f2; }
  * { box-sizing: border-box; }
  body { margin:0; color:var(--ink); background:#fff; font-family:"Avenir Next","Segoe UI",sans-serif; line-height:1.5; }
  a { color:inherit; }
  header.top { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:22px 7vw; border-bottom:1px solid var(--line); }
  .brand { letter-spacing:.18em; font-size:13px; text-decoration:none; }
  nav { display:flex; gap:18px; align-items:center; }
  nav a { text-decoration:none; color:var(--muted); }
  .btn { background:var(--red); color:#fff; text-decoration:none; border:0; border-radius:999px; padding:12px 18px; display:inline-block; font:inherit; }
  .btn.quiet { background:#fff; color:var(--ink); border:1px solid var(--line); }
  main { padding:0 7vw 72px; }
  .hero { display:grid; grid-template-columns:1.1fr .9fr; gap:48px; align-items:center; padding:72px 0 36px; }
  h1 { font-size:clamp(42px, 6vw, 68px); line-height:.95; letter-spacing:-.045em; margin:0 0 16px; font-weight:560; }
  h2 { font-size:clamp(28px, 3vw, 40px); letter-spacing:-.03em; margin:0 0 8px; font-weight:560; }
  .lead { font-size:18px; color:var(--muted); max-width:46ch; }
  .section { padding:48px 0; border-top:1px solid var(--line); }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  .card { background:var(--paper); border-radius:22px; padding:22px; }
  .phone { background:#1c1c1c; color:#fff; border-radius:28px; padding:28px; min-height:280px; }
  .phone strong { display:block; font-size:28px; margin:18px 0 8px; }
  .step { display:flex; gap:14px; padding:12px 0; border-bottom:1px solid var(--line); }
  .price { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  .price article { border:1px solid var(--line); border-radius:22px; padding:24px; }
  .price strong { font-size:36px; letter-spacing:-.04em; }
  form { display:grid; gap:12px; max-width:640px; }
  label { display:grid; gap:6px; }
  input, select, textarea { font:inherit; padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:#fff; }
  fieldset { border:1px solid var(--line); border-radius:16px; }
  .error { color:#9f1d2d; }
  .foot { color:var(--muted); font-size:13px; padding:24px 7vw 32px; }
  @media (max-width:800px) { .hero, .grid, .price { grid-template-columns:1fr; } header.top, nav { flex-wrap:wrap; } }
`;

export function landingPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Try Clock In</title><style>${publicStyle}</style></head><body>
    <header class="top"><a class="brand" href="/">TRY CLOCK IN</a><nav><a href="#how">How it works</a><a href="#pricing">Pricing</a><a href="/login">Business login</a><a class="btn" href="/signup">Register your business</a></nav></header>
    <main>
      <section class="hero">
        <div>
          <p class="brand">REDFACE</p>
          <h1>Your workforce. Your time. Under control.</h1>
          <p class="lead">Try Clock In helps businesses manage employee attendance, face recognition, NFC tags, shift schedules and working hours from one platform.</p>
          <p><a class="btn" href="/signup">Register your business</a></p>
          <p>Already registered? <a href="/login">Business login</a></p>
        </div>
        <div class="phone"><p>Clock in</p><strong>Face recognition</strong><p>Look at the camera. The station names the employee only after a match.</p><p>Tags are the other way in. A PIN is there when the camera cannot be used.</p></div>
      </section>
      <section class="section" id="how">
        <h2>How people clock in</h2>
        <div class="grid">
          <article class="card"><h3>Face clocking</h3><p>The employee looks at the station. The live face is matched to their company only. They see Clocked in or Clocked out.</p></article>
          <article class="card"><h3>Tag clocking</h3><p>An assigned NFC card identifies the same employee. The tag is a backup, not a second attendance record.</p></article>
          <article class="card"><h3>Management</h3><p>The owner adds people, registers a face, and sees who is in, out, late, or absent. Employees do not create the company.</p></article>
          <article class="card"><h3>Reports</h3><p>Hours, lunch, lateness and overtime are read from the clocking record. A schedule does not rewrite a punch.</p></article>
        </div>
      </section>
      <section class="section">
        <h2>A working day</h2>
        <div class="step"><strong>1</strong><span>The employee arrives and clocks in with a face or a tag.</span></div>
        <div class="step"><strong>2</strong><span>Lunch is a separate start and end, not paid time unless the company says so.</span></div>
        <div class="step"><strong>3</strong><span>They return and the day continues.</span></div>
        <div class="step"><strong>4</strong><span>Clocking out asks why they are leaving and closes the day.</span></div>
      </section>
      <section class="section" id="pricing">
        <h2>Pricing</h2>
        <div class="price">
          <article><p>Starter</p><strong>Free</strong><p>Up to 5 employees. Face, tags, and the daily attendance board.</p></article>
          <article><p>Business</p><strong>Paid</strong><p>6 or more employees. Shifts, reports and exports. The monthly amount is set before launch.</p></article>
        </div>
      </section>
      <section class="section">
        <h2>Questions</h2>
        <p><strong>Who can register?</strong> The business owner or a person with authority to represent the business. Employees cannot open a company.</p>
        <p><strong>Does a new company start immediately?</strong> No. The application is reviewed. Clocking stays off until it is approved.</p>
        <p><strong>What if there is no CIPC certificate?</strong> A sole proprietor can apply with other proof of the business and the owner's identity.</p>
        <p><strong>What about face data?</strong> A face template is stored only with consent, only for that company, and it can be deleted. A tag or PIN remains available.</p>
      </section>
      <section class="section">
        <h2>Register your business</h2>
        <p class="lead">Tell us who the business is. We review the documents before the workspace opens.</p>
        <p><a class="btn" href="/signup">Register your business</a></p>
      </section>
    </main>
    <p class="foot">© Red Face (Pty) Ltd. Licensed software.</p>
  </body></html>`;
}

export function signupPage({ error = "", values = {} } = {}) {
  const industries = INDUSTRIES.map((industry) => `<option ${values.industry === industry ? "selected" : ""}>${escapeHtml(industry)}</option>`).join("");
  const sole = values.businessType === "sole";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Register your business</title><style>${publicStyle}</style></head><body>
    <header class="top"><a class="brand" href="/">TRY CLOCK IN</a><nav><a href="/login">Business login</a></nav></header>
    <main>
      <h1>Register your business</h1>
      <p class="lead">This form is for the owner or an authorised representative. Employees are added after the business is approved.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/signup" enctype="multipart/form-data">
        <h2>Business</h2>
        <label>Registered or legal name<input name="companyName" required value="${escapeHtml(values.companyName ?? "")}"></label>
        <label>Trading name<input name="tradingName" value="${escapeHtml(values.tradingName ?? "")}"></label>
        <fieldset><legend>Business type</legend>
          <label><input type="radio" name="businessType" value="cipc" ${sole ? "" : "checked"}> CIPC-registered company</label>
          <label><input type="radio" name="businessType" value="sole" ${sole ? "checked" : ""}> Sole proprietor or informal business</label>
        </fieldset>
        <label>CIPC registration number<input name="registrationNumber" value="${escapeHtml(values.registrationNumber ?? "")}" placeholder="Required for a CIPC company"></label>
        <label>Industry<select name="industry">${industries}</select></label>
        <label>Physical address<textarea name="address" required>${escapeHtml(values.address ?? "")}</textarea></label>
        <label>Business phone<input name="phone" required value="${escapeHtml(values.phone ?? "")}"></label>
        <label>About how many employees?<input name="employeeEstimate" inputmode="numeric" value="${escapeHtml(values.employeeEstimate ?? "")}"></label>
        <h2>Owner</h2>
        <label>Full legal name<input name="ownerName" required value="${escapeHtml(values.ownerName ?? "")}"></label>
        <label>South African ID or passport<input name="ownerId" required value="${escapeHtml(values.ownerId ?? "")}"></label>
        <label>Email<input name="email" type="email" required value="${escapeHtml(values.email ?? "")}"></label>
        <label>Password<input name="password" type="password" required minlength="8"></label>
        <h2>Documents</h2>
        <p>PDF, JPG, or PNG. Stored privately and opened only for this review.</p>
        <label>CIPC certificate, or identity and proof of the business for a sole proprietor<input type="file" name="registration" accept="application/pdf,image/jpeg,image/png" required></label>
        <label>Proof of business address<input type="file" name="addressProof" accept="application/pdf,image/jpeg,image/png"></label>
        <label>Proof of authority, if you are not the owner<input type="file" name="authority" accept="application/pdf,image/jpeg,image/png"></label>
        <fieldset><legend>Plan</legend>
          <label><input type="radio" name="plan" value="free" ${values.plan === "business" ? "" : "checked"}> Free, up to 5 employees</label>
          <label><input type="radio" name="plan" value="business" ${values.plan === "business" ? "checked" : ""}> Paid, 6 or more employees. Amount set before launch.</label>
        </fieldset>
        <label><input type="checkbox" name="terms" value="on" required> I am the owner or I have authority to register this business. I accept that employee face templates are used only for attendance, with notice, and that a tag or PIN is available.</label>
        <button class="btn" type="submit">Submit for verification</button>
      </form>
    </main>
    <p class="foot">© Red Face (Pty) Ltd. Licensed software.</p>
  </body></html>`;
}

export function holdPage({ user, documents = [] }) {
  const status = user.company_status;
  const copy = {
    pending: "Try Clock In has the application. Clocking stays off until it is approved.",
    needs_documents: "More documents are needed before the workspace can open.",
    suspended: "This workspace is suspended. Clocking is off.",
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Application status</title><style>${publicStyle}</style></head><body>
    <header class="top"><a class="brand" href="/">TRY CLOCK IN</a></header>
    <main>
      <p>Application</p>
      <h1>${escapeHtml(user.company_name)}</h1>
      <p class="lead">${copy[status] || "This workspace is not open yet."}</p>
      <p>Status: ${escapeHtml(status)}</p>
      ${user.review_note ? `<p>${escapeHtml(user.review_note)}</p>` : ""}
      <h2>Documents received</h2>
      <ul>${documents.map((item) => `<li>${escapeHtml(item.kind)} · ${escapeHtml(item.filename)}</li>`).join("") || "<li>None yet.</li>"}</ul>
      <form method="post" action="/app/verification-documents" enctype="multipart/form-data">
        <label>Send another document<input type="file" name="extra" accept="application/pdf,image/jpeg,image/png" required></label>
        <button class="btn" type="submit">Upload</button>
      </form>
      <form method="post" action="/logout"><button class="btn quiet" type="submit">Sign out</button></form>
    </main>
  </body></html>`;
}

export function reviewPage({ applications, documentsByCompany, error = "" }) {
  const cards = applications.filter((item) => item.status !== "active").map((item) => {
    const docs = documentsByCompany[item.id] ?? [];
    return `<article class="card"><h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.business_type || "company")} · ${escapeHtml(item.status)} · ${escapeHtml(item.email)} · email ${item.email_verified_at ? "verified" : "not verified"}</p>
      <p>${escapeHtml(item.registration_number || "No CIPC number")} · ${escapeHtml(item.address || "")}</p>
      <p>Owner ${escapeHtml(item.full_name)} · ID ${escapeHtml(item.owner_id_number || "not supplied")} · about ${escapeHtml(item.employee_estimate || "—")} people</p>
      <ul>${docs.map((doc) => `<li><a href="/admin/documents/${doc.id}">${escapeHtml(doc.kind)} · ${escapeHtml(doc.filename)}</a></li>`).join("") || "<li>No documents</li>"}</ul>
      <form method="post" action="/admin/companies/${item.id}">
        <label>Note<textarea name="note"></textarea></label>
        <p><button class="btn" name="action" value="approve">Approve</button>
        <button class="btn quiet" name="action" value="request">Request documents</button>
        <button class="btn quiet" name="action" value="reject">Reject</button>
        ${item.status === "active" ? "" : `<button class="btn quiet" name="action" value="suspend">Suspend</button>`}</p>
      </form></article>`;
  }).join("");
  const live = applications.filter((item) => item.status === "active").map((item) => `<li>${escapeHtml(item.name)} <form style="display:inline" method="post" action="/admin/companies/${item.id}"><button name="action" value="suspend">Suspend</button></form></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Business review</title><style>${publicStyle}</style></head><body>
    <header class="top"><a class="brand" href="/admin">TRY CLOCK IN REVIEW</a></header>
    <main>
      <h1>Business applications</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <div class="grid">${cards || "<p>No applications waiting.</p>"}</div>
      <h2>Open workspaces</h2>
      <ul>${live || "<li>None.</li>"}</ul>
    </main>
  </body></html>`;
}
