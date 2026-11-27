import { INDUSTRIES } from "./platform.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const publicStyle = `
  :root { color-scheme: dark; --ink:#f6f4f2; --muted:#b7b1ab; --line:rgba(255,255,255,.12); --red:#9f1d2d; --panel:rgba(255,255,255,.045); }
  * { box-sizing: border-box; }
  body { margin:0; color:var(--ink); background:radial-gradient(900px 520px at 88% -8%, rgba(159,29,45,.42), transparent 52%), radial-gradient(640px 380px at -12% 18%, rgba(255,255,255,.05), transparent 46%), #0c0c0e; font-family:"Avenir Next","Segoe UI",sans-serif; line-height:1.5; }
  a { color:inherit; }
  header.top { position:sticky; top:0; z-index:4; display:flex; justify-content:space-between; gap:16px; align-items:center; padding:16px 5vw; background:rgba(12,12,14,.78); backdrop-filter:blur(18px); border-bottom:1px solid var(--line); }
  .brand { letter-spacing:.2em; font-size:13px; text-decoration:none; display:grid; }
  .brand small { letter-spacing:.22em; color:var(--red); font-size:10px; margin-top:3px; }
  nav { display:flex; gap:18px; align-items:center; }
  nav a { text-decoration:none; color:var(--muted); }
  .btn { background:var(--red); color:#fff; text-decoration:none; border:0; border-radius:999px; padding:12px 18px; display:inline-block; font:inherit; cursor:pointer; }
  .btn.quiet { background:transparent; color:var(--ink); border:1px solid var(--line); }
  .actions { display:flex; gap:12px; flex-wrap:wrap; margin:22px 0; }
  main { padding:0 5vw 80px; }
  .hero { display:grid; grid-template-columns:1.05fr .95fr; gap:48px; align-items:center; padding:64px 0 28px; }
  .kicker { letter-spacing:.18em; text-transform:uppercase; color:var(--red); font-size:12px; margin:0 0 12px; }
  .status { display:inline-flex; align-items:center; gap:8px; border:1px solid var(--line); border-radius:999px; padding:6px 12px; color:var(--muted); font-size:12px; letter-spacing:.12em; }
  .pulse { width:8px; height:8px; border-radius:50%; background:#3ddc84; box-shadow:0 0 12px #3ddc84; }
  h1 { font-size:clamp(40px, 5.4vw, 68px); line-height:.96; letter-spacing:-.045em; margin:14px 0 16px; font-weight:560; }
  h2 { font-size:clamp(28px, 3vw, 42px); letter-spacing:-.035em; margin:0 0 8px; font-weight:560; }
  .lead { font-size:18px; color:var(--muted); max-width:48ch; }
  .section { padding:56px 0; border-top:1px solid var(--line); }
  .grid, .price, .methods { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .methods { grid-template-columns:repeat(3, 1fr); margin-top:22px; }
  .card, .price article, .method { background:var(--panel); border:1px solid var(--line); border-radius:24px; padding:22px; backdrop-filter:blur(16px); }
  .method span, .tiles span, .demo-kicker { display:block; color:var(--muted); letter-spacing:.12em; text-transform:uppercase; font-size:12px; }
  .method strong { display:block; font-size:28px; margin:16px 0 6px; letter-spacing:-.03em; }
  .method:first-child { box-shadow:inset 0 0 0 1px rgba(159,29,45,.65); }
  .device { background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02)); border:1px solid var(--line); border-radius:36px; padding:16px; box-shadow:0 30px 80px rgba(0,0,0,.35); }
  .device-bar { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:12px; letter-spacing:.14em; color:var(--muted); padding:6px 8px 12px; }
  .visor { position:relative; height:280px; border-radius:28px; overflow:hidden; background:radial-gradient(circle at 50% 42%, rgba(159,29,45,.28), #141416 62%); }
  .mesh { width:100%; height:100%; }
  .scan { position:absolute; left:12%; right:12%; height:2px; background:linear-gradient(90deg, transparent, #fff, transparent); box-shadow:0 0 18px #fff; animation:scan 2.2s ease-in-out infinite alternate; }
  .demo-copy { padding:8px 8px 4px; }
  .demo-copy h3 { font-size:34px; letter-spacing:-.04em; margin:8px 0; }
  .chip { display:inline-block; margin-top:8px; border:1px solid var(--line); border-radius:999px; padding:8px 12px; }
  .demo-nav, .stage-nav { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-top:12px; }
  .demo-nav button, .stage-nav button { font:inherit; color:#fff; background:rgba(255,255,255,.04); border:1px solid var(--line); border-radius:16px; padding:12px 8px; }
  .demo-nav button.on, .stage-nav button.on { background:var(--red); border-color:transparent; }
  .stage { min-height:220px; border-radius:28px; padding:28px; background:#121214; border:1px solid var(--line); position:relative; overflow:hidden; }
  .stage .scan { top:30%; }
  .bars { display:flex; align-items:end; gap:8px; height:120px; margin-top:18px; }
  .bars span { flex:1; background:var(--red); border-radius:8px 8px 0 0; display:block; }
  .price strong { font-size:36px; letter-spacing:-.04em; }
  form { display:grid; gap:12px; max-width:680px; }
  label { display:grid; gap:6px; }
  input, select, textarea { font:inherit; padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:rgba(0,0,0,.35); color:var(--ink); }
  fieldset { border:1px solid var(--line); border-radius:16px; }
  .error { color:#f0c2c6; }
  .foot { color:var(--muted); font-size:13px; padding:8px 5vw 32px; }
  .review-actions { display:grid; gap:8px; }
  .review-actions .btn { text-align:center; }
  @keyframes scan { from { top:16%; } to { top:78%; } }
  @media (max-width:860px) {
    header.top, main { padding-left:16px; padding-right:16px; }
    nav a:not(.btn) { display:none; }
    nav { gap:8px; }
    .hero, .grid, .price, .methods { grid-template-columns:1fr; }
    .hero { padding-top:28px; }
    h1 { font-size:40px; }
    .actions .btn, .btn { width:100%; text-align:center; }
    .methods { grid-template-columns:1fr 1fr; }
  }
`;

export function landingPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Try Clock In</title><style>${publicStyle}</style></head><body>
    <header class="top"><a class="brand" href="/">TRY CLOCK IN<small>WORKFORCE TECHNOLOGY</small></a><nav><a href="#how">How it works</a><a href="#security">Security</a><a href="#pricing">Pricing</a><a href="/login">Business login</a><a class="btn" href="/signup">Register your business</a></nav></header>
    <main>
      <section class="hero">
        <div>
          <p class="status"><span class="pulse"></span> BIOMETRIC SYSTEM · SYSTEM READY</p>
          <h1>Your workforce. Accounted for. In real time.</h1>
          <p class="lead">A smarter way to manage employee attendance, biometric verification, NFC clock-ins, QR identity passes, working hours and workforce operations — from one platform.</p>
          <div class="actions"><a class="btn" href="/signup">Register your business</a><a class="btn quiet" href="#how">Explore how it works</a></div>
          <div class="methods">
            <article class="method"><span>Biometric</span><strong>Face</strong><p>Live match at the station.</p></article>
            <article class="method"><span>Tap</span><strong>NFC</strong><p>A card linked to the same person.</p></article>
            <article class="method"><span>Scan</span><strong>QR</strong><p>A pass that still needs a PIN.</p></article>
          </div>
        </div>
        <div class="device" id="demo">
          <div class="device-bar"><span class="status"><span class="pulse"></span> LIVE DEMO</span><strong id="hero-clock">--:--</strong></div>
          <div class="visor" aria-hidden="true">
            <svg class="mesh" viewBox="0 0 200 240">
              <ellipse cx="100" cy="108" rx="46" ry="62" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.4"/>
              <path d="M62 104 Q78 96 90 104" fill="none" stroke="#fff" stroke-width="1.2"/>
              <path d="M110 104 Q122 96 138 104" fill="none" stroke="#fff" stroke-width="1.2"/>
              <path d="M100 112 V138" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1.2"/>
              <path d="M84 156 Q100 168 116 156" fill="none" stroke="#fff" stroke-width="1.2"/>
              <path d="M70 78 Q100 58 130 78" fill="none" stroke="rgba(255,90,90,.9)" stroke-width="1.2"/>
              <circle cx="78" cy="108" r="2" fill="#fff"/><circle cx="122" cy="108" r="2" fill="#fff"/>
            </svg>
            <span class="scan" id="demo-scan"></span>
          </div>
          <div class="demo-copy">
            <p class="demo-kicker" id="demo-kicker">Demonstration</p>
            <h3 id="demo-title">Identity verification</h3>
            <p id="demo-body">A preview of the employee clocking experience. This is not a live attendance record.</p>
            <span class="chip" id="demo-chip">Face recognition</span>
          </div>
          <div class="demo-nav" id="demo-nav"></div>
        </div>
      </section>
      <section class="section" id="how">
        <p class="kicker">How the technology works</p>
        <h2>Four steps. One attendance record.</h2>
        <p class="lead">Tap a step. The panel is a demonstration of the product, not a clocking of a real employee.</p>
        <div class="stage" id="stage">
          <p class="demo-kicker" id="stage-kicker">01 — Biometric registration</p>
          <h3 id="stage-title">360° facial capture</h3>
          <p id="stage-body">The owner registers a face with consent. The camera stays visible. Landmarks follow the jaw, eyes, nose and mouth. Five angles build the template.</p>
          <div class="scan" id="stage-scan"></div>
        </div>
        <div class="stage-nav" id="stage-nav"></div>
      </section>
      <section class="section" id="security">
        <p class="kicker">Access control</p>
        <h2>A code identifies. It does not clock anyone in.</h2>
        <div class="grid">
          <article class="card"><h3>Face</h3><p>The live face is compared with that company’s templates. A failed match does not keep the previous person’s name.</p></article>
          <article class="card"><h3>NFC</h3><p>The card stores a random link, not a name or ID number. A lost card can be deactivated.</p></article>
          <article class="card"><h3>QR pass</h3><p>Each employee can hold a personal QR. It is a random, revocable token. The station still asks for that employee’s PIN before it records attendance.</p></article>
          <article class="card"><h3>One record</h3><p>Face, card and QR all write the same clock-in or clock-out. Hours, lateness and overtime are read from that record.</p></article>
        </div>
      </section>
      <section class="section" id="pricing">
        <p class="kicker">Onboarding</p>
        <h2>Only an authorised owner can register.</h2>
        <p class="lead">The application collects the business, the owner, and private documents. Clocking stays off until Try Clock In approves it.</p>
        <div class="price">
          <article><p>Free</p><strong>5 people</strong><p>Face, NFC, QR passes and the daily board. No card is charged.</p></article>
          <article><p>Business</p><strong>Paid</strong><p>Larger teams, reports and exports. The monthly amount is set before launch.</p></article>
        </div>
      </section>
      <section class="section">
        <h2>Time is valuable. Track it intelligently.</h2>
        <p class="lead">Register the business. Add the people. They clock in by face, card, or QR pass.</p>
        <p><a class="btn" href="/signup">Register your business</a></p>
      </section>
    </main>
    <p class="foot">© Red Face (Pty) Ltd. Licensed software.</p>
    <script>
      const frames = [
        ["Arrive", "08:02", "An employee stands at the station.", "Face recognition"],
        ["Scanning", "Face aligned", "The frame follows the live face. A stranger is not named.", "Tracking"],
        ["Clocked in", "Recorded", "The match is saved for this company only.", "Clocked in"],
        ["NFC", "Card read", "The same person can tap a registered card.", "NFC"],
        ["QR pass", "PIN next", "The pass identifies them. Their PIN confirms the punch.", "QR + PIN"],
        ["Clocked out", "17:06", "The day closes on the same attendance record.", "Clocked out"]
      ];
      const stages = [
        ["01 — Biometric registration", "360° facial capture", "The owner registers a face with consent. The camera stays visible. Landmarks follow the jaw, eyes, nose and mouth. Five angles build the template.", true],
        ["02 — NFC identification", "Tap a registered card", "The card carries a random link. The station reads it and asks the employee to confirm clock-in or clock-out.", false],
        ["03 — Clock in and out", "Attendance recorded", "The station shows the time and a clear success state. The punch is the record, whichever method they used.", false],
        ["04 — Workforce view", "Hours and activity", "The owner sees who is in, out, late or absent, then working hours and overtime from those punches.", false]
      ];
      const nav = document.querySelector("#demo-nav");
      const stageNav = document.querySelector("#stage-nav");
      let index = 0;
      let stageIndex = 0;
      frames.forEach((frame, frameIndex) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = frame[0];
        button.onclick = () => show(frameIndex);
        nav.appendChild(button);
      });
      stages.forEach((frame, frameIndex) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = frame[0].slice(0, 2);
        button.onclick = () => showStage(frameIndex);
        stageNav.appendChild(button);
      });
      function show(next) {
        index = next;
        const frame = frames[index];
        document.querySelector("#demo-kicker").textContent = frame[0];
        document.querySelector("#demo-title").textContent = frame[1];
        document.querySelector("#demo-body").textContent = frame[2];
        document.querySelector("#demo-chip").textContent = frame[3];
        [...nav.children].forEach((button, buttonIndex) => button.classList.toggle("on", buttonIndex === index));
      }
      function showStage(next) {
        stageIndex = next;
        const frame = stages[stageIndex];
        document.querySelector("#stage-kicker").textContent = frame[0];
        document.querySelector("#stage-title").textContent = frame[1];
        document.querySelector("#stage-body").textContent = frame[2];
        document.querySelector("#stage-scan").hidden = !frame[3];
        [...stageNav.children].forEach((button, buttonIndex) => button.classList.toggle("on", buttonIndex === stageIndex));
      }
      function paintClock() {
        document.querySelector("#hero-clock").textContent = new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit" }).format(new Date());
      }
      show(0);
      showStage(0);
      paintClock();
      setInterval(() => show((index + 1) % frames.length), 2600);
      setInterval(paintClock, 1000);
    </script>
  </body></html>`;
}

export function signupPage({ error = "", values = {} } = {}) {
  const industries = INDUSTRIES.map((industry) => `<option ${values.industry === industry ? "selected" : ""}>${escapeHtml(industry)}</option>`).join("");
  const sole = values.businessType === "sole";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Register your business</title><style>${publicStyle}</style></head><body>
    <header class="top"><a class="brand" href="/">TRY CLOCK IN</a><nav><a href="/login">Business login</a></nav></header>
    <main>
      <p class="kicker">Business verification</p>
      <h1>Register your business</h1>
      <p class="lead">Only the owner, or a person with authority to represent the business, can open a workspace. Employees are added after approval. Clocking stays off until the documents are reviewed.</p>
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

export function adminGate({ sent = false, error = "" } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin</title><style>${publicStyle}</style></head><body>
    <header class="top"><a class="brand" href="/">TRY CLOCK IN</a></header>
    <main>
      <h1>Admin</h1>
      <p class="lead">Approvals are sent to info@redface.co.za. Open the email on this phone and the review screen opens.</p>
      ${sent ? `<p>The sign-in link is on its way to info@redface.co.za.</p>` : ""}
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/admin/login"><button class="btn" type="submit">Email the admin link</button></form>
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
        <div class="review-actions"><button class="btn" name="action" value="approve">Approve</button>
        <button class="btn quiet" name="action" value="request">Request documents</button>
        <button class="btn quiet" name="action" value="reject">Reject</button>
        <button class="btn quiet" name="action" value="suspend">Suspend</button></div>
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
