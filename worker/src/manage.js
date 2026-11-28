import { can } from "./auth.js";
import { faceCapture } from "./faceui.js";
import { rands } from "./payroll.js";
import { INDUSTRIES, PLANS } from "./platform.js";

const NAV = [
  ["Overview", "/app", "overview"],
  ["Employees", "/app/employees", "employees"],
  ["Clocking Stations", "/app/stations", "stations"],
  ["NFC & QR Access", "/app/access", "credentials"],
  ["Face Registration", "/app/face", "face"],
  ["Attendance", "/app/attendance", "attendance"],
  ["Shifts & Schedules", "/app/shifts", "shifts"],
  ["Leave Management", "/app/leave", "leave"],
  ["Reports", "/app/reports", "reports"],
  ["Billing", "/app/billing", "billing"],
  ["Settings", "/app/settings", "settings"],
];

export function homePage() {
  return shell("Redface Workforce", `
    <main class="gate">
      <p class="mark">REDFACE</p>
      <p class="sub">WORKFORCE</p>
      <h1>Attendance. Controlled.</h1>
      <p class="lead">A private workspace for each company. Employees clock in on their station. Administrators manage the workforce.</p>
      <p class="row"><a class="button" href="/signup">Register a company</a><a class="button quiet" href="/login">Sign in</a></p>
    </main>`);
}

export function signupPage({ error = "", values = {} } = {}) {
  const industries = INDUSTRIES.map((industry) => `<option ${values.industry === industry ? "selected" : ""}>${escapeHtml(industry)}</option>`).join("");
  const plans = Object.entries(PLANS).map(([id, plan]) => `<label class="choice"><input type="radio" name="plan" value="${id}" ${(!values.plan && id === "starter") || values.plan === id ? "checked" : ""}><span><strong>${plan.label}</strong><small>${plan.limit} employees</small></span></label>`).join("");
  return shell("Register", `
    <main class="gate">
      <p class="mark">REDFACE</p>
      <h1>Open a company workspace</h1>
      <p class="lead">You become the primary owner. We email a verification link first. Verifying the email and activating the workspace are separate steps, and sign-in opens only after both.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/signup">
        <label>Company name<input name="companyName" required value="${escapeHtml(values.companyName ?? "")}"></label>
        <label>Industry<select name="industry">${industries}</select></label>
        <label>Registration number<input name="registrationNumber" value="${escapeHtml(values.registrationNumber ?? "")}"></label>
        <label>Address<input name="address" value="${escapeHtml(values.address ?? "")}"></label>
        <label>Phone<input name="phone" value="${escapeHtml(values.phone ?? "")}"></label>
        <label>Primary administrator<input name="ownerName" required value="${escapeHtml(values.ownerName ?? "")}"></label>
        <label>Email<input name="email" type="email" required value="${escapeHtml(values.email ?? "")}"></label>
        <label>Password<input name="password" type="password" required minlength="8"></label>
        <fieldset><legend>Subscription</legend><div class="plans">${plans}</div></fieldset>
        <button class="button" type="submit">Create workspace</button>
      </form>
    </main>`);
}

export function loginPage({ error = "" } = {}) {
  return shell("Sign in", `
    <main class="gate">
      <p class="mark">REDFACE</p>
      <h1>Company sign in</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/login">
        <label>Email<input name="email" type="email" required></label>
        <label>Password<input name="password" type="password" required></label>
        <button class="button" type="submit">Enter workspace</button>
      </form>
    </main>`);
}

export function pendingPage({ email, warning = "" }) {
  return shell("Check your email", `
    <main class="gate">
      <p class="mark">REDFACE</p>
      <h1>Check your email</h1>
      <p class="lead">We sent a verification link to ${escapeHtml(email)}. Confirm the address, then sign in. You will see the application status. Employee clocking stays off until Try Clock In approves the business.</p>
      ${warning ? `<p class="error">${escapeHtml(warning)}</p>` : ""}
      <form method="post" action="/signup/resend"><input type="hidden" name="email" value="${escapeHtml(email)}"><button class="button quiet" type="submit">Send the email again</button></form>
    </main>`);
}

export function verifyPage({ companyName, token, verified = false, error = "" }) {
  return shell("Verify email", `
    <main class="gate">
      <p class="mark">REDFACE</p>
      <h1>${verified ? "Email verified" : "Verify email"}</h1>
      <p class="lead">${verified ? `${escapeHtml(companyName)} email is confirmed. Sign in to see the application. Clocking opens only after Try Clock In approves the business.` : `Confirm this address for ${escapeHtml(companyName)}. Approval is a separate review.`}</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      ${verified ? `<p><a class="button" href="/login">Business login</a></p>` : `<p><a class="button" href="/verify/${encodeURIComponent(token)}">Verify email</a></p>`}
    </main>`);
}

export function activatedPage() {
  return shell("Workspace active", `
    <main class="gate">
      <p class="mark">REDFACE</p>
      <h1>Workspace active</h1>
      <p class="lead">The email is verified and the company workspace is active. You can sign in.</p>
      <p><a class="button" href="/login">Sign in</a></p>
    </main>`);
}

export function overviewPage({ user, board, workDate }) {
  const max = Math.max(1, ...board.week.map((day) => day.punches));
  return app(user, "Overview", `
    <header class="head"><div><p class="eyebrow">Live attendance</p><h1>${escapeHtml(user.company_name)}</h1><p class="muted">${escapeHtml(workDate)}</p></div></header>
    <section class="stats">
      ${stat("Employees", board.rows.length)}
      ${stat("Clocked in", board.clockedIn)}
      ${stat("Clocked out", board.clockedOut)}
      ${stat("Absent", board.absent)}
      ${stat("Late", board.late)}
    </section>
    <section class="split">
      <div class="card">
        <h2>Live attendance</h2>
        <table>${board.rows.slice(0, 8).map((row) => `<tr><td>${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</td><td>${escapeHtml(row.lastLabel)}</td><td>${escapeHtml(labelState(row.state))}</td></tr>`).join("") || "<tr><td>No employees yet.</td></tr>"}</table>
      </div>
      <div class="card">
        <h2>Recent activity</h2>
        <table>${board.activity.slice(0, 8).map((event) => `<tr><td>${escapeHtml(event.name)}</td><td>${escapeHtml(event.timeLabel)}</td><td>${escapeHtml(event.event_type === "CLOCK_IN" ? "Clocked in" : "Clocked out")}</td></tr>`).join("") || "<tr><td>No clock activity yet.</td></tr>"}</table>
        <h2>This week</h2>
        <div class="bars">${board.week.map((day) => `<div><span style="height:${Math.round((day.punches / max) * 100)}%"></span><small>${escapeHtml(day.work_date.slice(5))}</small></div>`).join("") || "<p class='muted'>No punches this week.</p>"}</div>
      </div>
    </section>`);
}

export function employeesPage({ user, employees, total, page, pageSize, error = "" }) {
  return app(user, "Employees", `
    <header class="head"><div><h1>Employees</h1><p class="muted">${total} ${total === 1 ? "person" : "people"} on this workspace.</p></div></header>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <table class="card">
      <thead><tr><th>Number</th><th>Name</th><th>Job</th><th>Department</th><th>Status</th></tr></thead>
      <tbody>${employees.map((employee) => `<tr><td><a href="/app/employees/${employee.id}">${escapeHtml(employee.employee_number)}</a></td><td><a href="/app/employees/${employee.id}">${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</a></td><td>${escapeHtml(employee.role_title)}</td><td>${escapeHtml(employee.department_name ?? "")}</td><td>${escapeHtml(employee.status)}</td></tr>`).join("") || `<tr><td colspan="5">No one yet. Add the first person below.</td></tr>`}</tbody>
    </table>
    <p class="row">${page > 0 ? `<a href="/app/employees?page=${page - 1}">Previous</a>` : ""}${page + 1 < Math.ceil(total / pageSize) ? `<a href="/app/employees?page=${page + 1}">Next</a>` : ""}</p>
    <section class="card"><h2>Add someone</h2>
    <p class="muted">Name and job are enough. The next number is chosen for you. Face, tag, and PIN come on the next screen.</p>
    <form method="post" action="/app/employees">
      <label>First name<input name="firstName" required autocomplete="given-name"></label>
      <label>Surname<input name="lastName" required autocomplete="family-name"></label>
      <label>What do they do?<input name="roleTitle" placeholder="Waiter, cook, manager"></label>
      <button class="button" type="submit">Add employee</button>
    </form></section>`);
}

export function employeePage({ user, employee, credentials = [], history = [], faceReady = false, error = "", issued = null, added = false }) {
  const active = (method) => credentials.some((item) => item.method === method && item.status === "active");
  const writeScript = issued?.method === "nfc"
    ? `<p><button class="button" type="button" id="write">Write NFC card</button> <span id="write-state"></span></p>
      <form method="post" action="/app/credentials/${issued.id}/confirm"><button class="button quiet" type="submit">Card read back matches</button></form>
      <script>
        const url = ${JSON.stringify(issued.url)};
        document.querySelector("#write").onclick = async () => {
          const state = document.querySelector("#write-state");
          if (!("NDEFReader" in window)) { state.textContent = "This browser cannot write NFC. Use an NFC-enabled Android device."; return; }
          try {
            const writer = new NDEFReader();
            await writer.write({ records: [{ recordType: "url", data: url }] });
            state.textContent = "Written. Read the card to confirm.";
          } catch (error) { state.textContent = error.message; }
        };
      </script>`
    : "";
  const qrCredential = credentials.find((item) => item.method === "qr" && item.status === "active");
  const pass = issued?.method === "qr"
    ? `<div class="pass" id="employee-pass"><p class="eyebrow">TRY CLOCK IN</p><p class="live">ACTIVE</p><h2>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</h2><p>EMPLOYEE ID ${escapeHtml(employee.employee_number)}</p><p>${escapeHtml(user.company_name)}</p>      <div class="qr"><img alt="Employee QR pass" width="240" height="240" src="${issued.png}"></div><p class="muted">Personal employee QR. Linked to this profile. It contains a random token, not their ID number. Save it as a PNG.</p></div>
      <p class="row"><button class="button" type="button" id="save-pass">Save PNG</button><button class="button quiet" type="button" id="print-pass">Print ID</button></p>
      <script>
        document.querySelector("#save-pass").onclick = () => {
          const link = document.createElement("a");
          link.href = document.querySelector("#employee-pass img").src;
          link.download = "employee-pass.png";
          link.click();
        };
        document.querySelector("#print-pass").onclick = () => {
          const card = document.querySelector("#employee-pass").outerHTML;
          const page = window.open("", "_blank");
          page.document.write('<!doctype html><title>Employee pass</title><body style="font-family:sans-serif;background:#111;color:#fff;padding:32px">' + card + '<script>print()<' + '/script></body>');
          page.document.close();
        };
      </script>`
    : `<p>${qrCredential ? "A QR pass is active. The picture is not stored again. Regenerating replaces it, and the old picture stops working." : "No QR pass yet. Issuing one creates a random code for this employee."}</p>`;
  const issuedBlock = issued?.method === "nfc"
    ? `<section class="card"><h2>Write NFC card</h2><p>This card is shown once. It contains no personal details.</p><p class="mono">${escapeHtml(issued.url)}</p>${writeScript}</section>`
    : "";
  return app(user, employee.first_name, `
    <header class="head"><div><p class="eyebrow"><a href="/app/employees/${employee.id}">${escapeHtml(employee.employee_number ?? "")}</a></p><h1>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</h1><p class="muted">${escapeHtml(employee.role_title)} · ${escapeHtml(employee.phone || "No phone")} · ${escapeHtml(employee.email || "No email")}</p></div></header>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    ${issuedBlock}
    <section class="card">
      <p class="eyebrow">${added ? "Just added" : "How they clock in"}</p>
      <h2>${added ? `${escapeHtml(employee.first_name)} is on the list` : faceReady ? "Face is registered" : "Register their face"}</h2>
      <p>${added ? `${escapeHtml(employee.first_name)} is ${escapeHtml(employee.employee_number)}. The next step is their face. Tick consent, press start, and let them follow the words beside the camera.` : faceReady ? "They can clock in at the station by looking at the camera. A tag or PIN below is the backup." : "Tick consent, press start, and let them follow the words beside the camera. A tag or PIN below works when there is no camera."}</p>
    </section>
    <section class="card"><h2>Profile</h2>
      <p>Facial recognition: ${faceReady ? "Registered" : "Not registered"} · PIN ${active("pin") || employee.has_pin ? "set" : "not set"} · NFC ${active("nfc") ? "linked" : "not issued"} · QR pass ${active("qr") || issued?.method === "qr" ? "active" : "not issued"}</p>
      ${faceReady ? `<form method="post" action="/app/employees/${employee.id}/face/delete"><button class="button quiet" type="submit">Delete facial template</button></form>` : ""}
    </section>
    ${faceCapture({
      heading: "Register employee face",
      detail: "Position your face inside the scanning area. Keep looking at the camera. The wireframe follows the live landmarks and the picture stays visible.",
      mode: "enroll",
      postUrl: `/app/employees/${employee.id}/face`,
    })}
    ${can(user.role, "settings") ? `<section class="card"><p class="eyebrow">Employment details</p><h2>Payment</h2><p class="muted">Salary sits with the employee record. It is separate from face registration.</p><form method="post" action="/app/employees/${employee.id}/pay"><label>Pay<select name="payType"><option value="monthly">Monthly salary</option><option value="hourly">Hourly rate</option></select></label><label>Amount in rands<input name="amount" inputmode="decimal" required></label><button class="button quiet" type="submit">Save pay</button></form></section>` : ""}
    <section class="card"><h2>Attendance</h2>
      <table>${history.map((event) => `<tr><td>${escapeHtml(event.work_date)}</td><td>${escapeHtml(event.timeLabel)}</td><td>${escapeHtml(event.event_type === "CLOCK_IN" ? "In" : "Out")}</td><td>${escapeHtml(event.method)}</td></tr>`).join("") || "<tr><td>No attendance yet.</td></tr>"}</table>
    </section>
    <section class="card"><p class="eyebrow">Employee digital ID</p><h2>QR identity pass</h2>
      ${pass}
      <p class="muted">The pass identifies ${escapeHtml(employee.first_name)}. The station still asks for their PIN before it records clock-in or clock-out. A shared screenshot cannot punch by itself.</p>
      <form method="post" action="/app/employees/${employee.id}/qr"><button class="button" type="submit">${qrCredential || issued?.method === "qr" ? "Regenerate QR pass" : "Issue QR pass"}</button></form>
      ${qrCredential ? `<form method="post" action="/app/credentials/${qrCredential.id}/revoke"><button class="button quiet" type="submit">Revoke QR pass</button></form>` : ""}
    </section>
    <section class="card"><h2>Tag or PIN</h2>
      <p>Use these when the camera is not available. Tag: ${active("nfc") ? "ready" : "not written yet"}. PIN: ${active("pin") || employee.has_pin ? "set" : "not set yet"}. A QR pass needs this PIN.</p>
      <form method="post" action="/app/employees/${employee.id}/nfc"><button class="button" type="submit">Issue NFC card</button></form>
      <form method="post" action="/app/employees/${employee.id}/pin"><label>New PIN<input name="pin" required minlength="4" maxlength="6" inputmode="numeric"></label><button class="button" type="submit">Save PIN</button></form>
      <form method="post" action="/app/employees/${employee.id}/documents" enctype="multipart/form-data"><label>Document<input type="file" name="file" required></label><button class="button quiet" type="submit">Upload</button></form>
    </section>`);
}

export function accessPage({ user, credentials, error = "" }) {
  return app(user, "NFC & QR Access", `
    <header class="head"><div><h1>NFC & QR access</h1><p class="muted">Cards and codes are opaque credentials. Deactivate a lost card here.</p></div></header>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <table class="card"><thead><tr><th>Employee</th><th>Number</th><th>Method</th><th>Issued</th><th></th></tr></thead>
    <tbody>${credentials.map((item) => `<tr><td>${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)}</td><td>${escapeHtml(item.employee_number)}</td><td>${escapeHtml(item.method)}</td><td>${escapeHtml(item.issued_at.slice(0, 10))}</td><td><form method="post" action="/app/credentials/${item.id}/revoke"><button class="button quiet" type="submit">Deactivate</button></form></td></tr>`).join("") || `<tr><td colspan="5">No active cards or QR codes.</td></tr>`}</tbody></table>`);
}

export function facePage({ user, people }) {
  return app(user, "Face Registration", `
    <header class="head"><div><h1>Face registration</h1><p class="muted">Open an employee profile and register the face there. The station compares a live blink against that template. PIN, NFC and QR remain available if the camera cannot be used.</p></div></header>
    <table class="card"><thead><tr><th>Employee</th><th>Consent</th><th></th></tr></thead>
    <tbody>${people.map((person) => `<tr><td>${escapeHtml(person.first_name)} ${escapeHtml(person.last_name)}</td><td>${person.consented_at ? "Given" : "Not given"}</td><td><a href="/app/employees/${person.id}">Register face</a></td></tr>`).join("")}</tbody></table>`);
}

export function attendancePage({ user, board }) {
  return app(user, "Attendance", `
    <header class="head"><div><h1>Attendance</h1><p class="muted">One record per employee, whichever credential they used.</p></div></header>
    <table class="card"><thead><tr><th>Employee</th><th>State</th><th>First in</th><th>Last mark</th><th>Method</th></tr></thead>
    <tbody>${board.rows.map((row) => `<tr><td>${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</td><td>${escapeHtml(labelState(row.state))}</td><td>${escapeHtml(row.firstLabel)}</td><td>${escapeHtml(row.lastLabel)}</td><td>${escapeHtml(row.method)}</td></tr>`).join("")}</tbody></table>
    <h2>Latest activity</h2>
    <table class="card">${board.activity.map((event) => `<tr><td>${escapeHtml(event.timeLabel)}</td><td>${escapeHtml(event.name)}</td><td>${escapeHtml(event.event_type)}</td><td>${escapeHtml(event.method)}</td></tr>`).join("")}</table>`);
}

export function stationsPage({ user, stations, origin, error = "" }) {
  return app(user, "Clocking Stations", `
    <header class="head"><div><h1>Clocking stations</h1><p class="muted">Preview the employee screen, or open it on the workplace tablet.</p></div></header>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <div class="stations">${stations.map((station) => `<article class="card"><h2>${escapeHtml(station.name)}</h2><p class="muted">${escapeHtml(station.location ?? "")} · ${escapeHtml(station.methods ?? "")}</p><p class="row"><a class="button" href="/app/stations/${station.id}">Preview</a><a class="button quiet" href="${origin}/s/${escapeHtml(station.public_code)}" target="_blank" rel="noopener">Open live station</a></p></article>`).join("")}</div>
    <h2>Register a station</h2>
    <form method="post" action="/app/stations"><label>Name<input name="name" required placeholder="Station 02 – Warehouse"></label><label>Location<input name="location"></label><button class="button" type="submit">Create station</button></form>`);
}

export function stationPreview({ user, station, origin }) {
  const methods = new Set(String(station.methods ?? "").split(","));
  return app(user, station.name, `
    <header class="head"><div><h1>${escapeHtml(station.name)}</h1><p class="muted">${escapeHtml(station.location ?? "")}</p></div><a class="button" href="${origin}/s/${escapeHtml(station.public_code)}" target="_blank" rel="noopener">Open live station</a></header>
    <iframe class="preview" title="Clocking station preview" src="${origin}/s/${escapeHtml(station.public_code)}"></iframe>
    <h2>Station settings</h2>
    <form method="post" action="/app/stations/${station.id}">
      <label>Name<input name="name" value="${escapeHtml(station.name)}" required></label>
      <label>Location<input name="location" value="${escapeHtml(station.location ?? "")}"></label>
      <fieldset><legend>Authentication methods</legend>
        ${["nfc", "qr", "pin", "face"].map((method) => `<label class="check"><input type="checkbox" name="${method}" ${methods.has(method) ? "checked" : ""}>${method.toUpperCase()}</label>`).join("")}
      </fieldset>
      <button class="button" type="submit">Save station</button>
    </form>`);
}

export function shiftsPage({ user, start }) {
  return app(user, "Shifts", `
    <header class="head"><div><h1>Shifts & schedules</h1><p class="muted">The company start time marks a clock-in as late. Per-person rosters build on this.</p></div></header>
    <form method="post" action="/app/shifts"><label>Default start<input name="defaultStart" value="${escapeHtml(start)}" required pattern="[0-9]{2}:[0-9]{2}"></label><button class="button" type="submit">Save start time</button></form>`);
}

export function leavePage({ user, leave, employees, error = "" }) {
  return app(user, "Leave", `
    <header class="head"><div><h1>Leave</h1><p class="muted">Approved leave keeps the employee off the absent list.</p></div></header>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <table class="card"><thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Status</th></tr></thead>
    <tbody>${leave.map((item) => `<tr><td>${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)}</td><td>${escapeHtml(item.leave_type)}</td><td>${escapeHtml(item.starts_on)}</td><td>${escapeHtml(item.ends_on)}</td><td>${escapeHtml(item.status)}</td></tr>`).join("") || `<tr><td colspan="5">No leave recorded.</td></tr>`}</tbody></table>
    <h2>Record leave</h2>
    <form method="post" action="/app/leave">
      <label>Employee<select name="employeeId">${employees.map((employee) => `<option value="${employee.id}">${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</option>`).join("")}</select></label>
      <label>Type<input name="leaveType" required placeholder="Annual"></label>
      <label>From<input name="startsOn" type="date" required></label>
      <label>To<input name="endsOn" type="date" required></label>
      <button class="button" type="submit">Approve leave</button>
    </form>`);
}

export function reportsPage({ user, report, month, locked = false }) {
  if (locked) {
    return app(user, "Reports", `<header class="head"><div><h1>Monthly reports</h1><p class="muted">Monthly attendance and payroll reports are a subscription feature. This workspace does not include them.</p></div></header>`);
  }
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const policy = report.policy;
  return app(user, "Reports", `
    <header class="head"><div><h1>${escapeHtml(month)}</h1><p class="muted">${report.status === "finalised" ? "Finalised estimate. This snapshot is locked and is still not a wage payment." : "Estimated from attendance. It is not legally finalised payroll and no money is transferred."}</p></div>
      <p class="row"><a class="button" href="/app/reports/export.csv?month=${encodeURIComponent(month)}">Excel</a><a class="button quiet" href="/app/reports/export.pdf?month=${encodeURIComponent(month)}">PDF</a></p></header>
    <form method="get" action="/app/reports"><label>Month<input type="month" name="month" value="${escapeHtml(month)}"></label><button class="button quiet" type="submit">Open month</button></form>
    <table class="card"><thead><tr><th>Employee</th><th>Hours</th><th>Overtime</th><th>Late</th><th>Absent</th><th>Lunch</th><th>Early</th><th>Estimated net</th></tr></thead>
    <tbody>${report.rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${(row.workedMinutes / 60).toFixed(1)}</td><td>${(row.overtimeMinutes / 60).toFixed(1)}</td><td>${row.lateMinutes}m</td><td>${row.absences}</td><td>${row.lunchMinutes}m</td><td>${row.earlyMinutes}m</td><td>${row.configured ? escapeHtml(rands(row.net)) : "Rate not set"}</td></tr>`).join("") || "<tr><td>No employees.</td></tr>"}</tbody></table>
    <p class="muted">Hours are clocked pairs. A clock-out followed by another clock-in counts as lunch or a break. Extra break time is the portion beyond the company allowance. Overtime is time beyond the expected day. The default overtime multiplier is 1.5, in line with ordinary BCEA overtime, and this company can change it. Deductions run only when enabled here. They are estimates, not an authority to deduct from wages.</p>
    ${report.status === "estimated" && can(user.role, "settings") ? `<form method="post" action="/app/reports/finalise"><input type="hidden" name="month" value="${escapeHtml(month)}"><button class="button" type="submit">Finalise this estimate</button></form>` : ""}
    ${can(user.role, "settings") ? `<h2>Payroll rules</h2><form method="post" action="/app/reports/policy">
      <label>Day start<input name="dayStart" value="${escapeHtml(policy.dayStart)}" required></label>
      <label>Day end<input name="dayEnd" value="${escapeHtml(policy.dayEnd)}" required></label>
      <label>Expected hours per week<input name="weeklyHours" value="${policy.weeklyMinutes / 60}" required></label>
      <label>Lunch allowance minutes<input name="lunchAllowanceMinutes" value="${policy.lunchAllowanceMinutes}"></label>
      <label>Late grace minutes<input name="lateGraceMinutes" value="${policy.lateGraceMinutes}"></label>
      <label>Overtime multiplier<input name="overtimeMultiplier" value="${policy.overtimeMultiplier}"></label>
      <fieldset><legend>Working days</legend>${days.map((label, index) => `<label class="check"><input type="checkbox" name="day${index}" ${policy.workDays.includes(index) ? "checked" : ""}> ${label}</label>`).join("")}</fieldset>
      <label class="check"><input type="checkbox" name="deductLate" ${policy.deductLate ? "checked" : ""}> Deduct late time at the hourly rate</label>
      <label class="check"><input type="checkbox" name="deductExtraBreak" ${policy.deductExtraBreak ? "checked" : ""}> Deduct break time beyond the allowance</label>
      <label class="check"><input type="checkbox" name="deductAbsence" ${policy.deductAbsence ? "checked" : ""}> Deduct a missed shift</label>
      <button class="button" type="submit">Save payroll rules</button>
    </form>` : ""}`);
}

export function billingPage({ user, subscription, used }) {
  const plan = PLANS[subscription?.plan] ?? { label: subscription?.plan ?? "Starter", limit: subscription?.employee_limit ?? 25 };
  return app(user, "Billing", `
    <header class="head"><div><h1>Billing</h1><p class="muted">Red Face (Pty) Ltd licenses this workspace. Launch access is free. Monthly reports and payroll estimates are subscription features and are included for now. Card collection is not connected, and the platform does not pay salaries.</p></div></header>
    <section class="stats">${stat("Plan", plan.label)}${stat("Employee limit", subscription?.employee_limit ?? plan.limit)}${stat("Active employees", used)}${stat("Access", "Free launch")}</section>
    <section class="card"><h2>Included on this workspace</h2><p>Monthly attendance reports, Excel and PDF export, overtime estimates, late and absence adjustments, and payroll summaries. These can be limited to a paid plan later without rebuilding the product.</p></section>`);
}

export function settingsPage({ user, team, error = "" }) {
  return app(user, "Settings", `
    <header class="head"><div><h1>Settings</h1></div></header>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <form method="post" action="/app/settings">
      <label>Company name<input name="companyName" value="${escapeHtml(user.company_name)}" required></label>
      <label>Address<input name="address" value="${escapeHtml(user.address ?? "")}"></label>
      <label>Phone<input name="phone" value="${escapeHtml(user.contact_phone ?? "")}"></label>
      <label>Timezone<input name="timezone" value="${escapeHtml(user.timezone)}"></label>
      <label>Default start<input name="defaultStart" value="${escapeHtml(user.default_start ?? "08:00")}"></label>
      <button class="button" type="submit">Save company</button>
    </form>
    <h2>Management users</h2>
    <table class="card"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${team.map((member) => `<tr><td>${escapeHtml(member.full_name)}</td><td>${escapeHtml(member.email)}</td><td>${escapeHtml(member.role)}</td></tr>`).join("")}</tbody></table>
    ${can(user.role, "settings") ? `<form method="post" action="/app/settings/team"><label>Name<input name="fullName" required></label><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="8" required></label>${user.role === "owner" ? `<label>Role<select name="role"><option value="manager">Manager</option><option value="admin">Admin</option></select></label>` : ""}<button class="button" type="submit">Add manager</button></form>` : ""}`);
}

export function credentialCardPage(token) {
  return shell("Credential", `<main class="gate"><p class="mark">REDFACE</p><h1>Workforce credential</h1><p class="lead">This card identifies an employee only when it is tapped on their company's clocking station.</p><p class="mono">${escapeHtml(token.slice(0, 4))}…</p></main>`);
}

function stat(label, value) {
  return `<article class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function labelState(state) {
  if (state === "in") return "Clocked in";
  if (state === "out") return "Clocked out";
  if (state === "leave") return "On leave";
  return "Absent";
}

function app(user, title, body) {
  const links = NAV.filter(([, , action]) => can(user.role, action));
  return shell(`${title} · ${user.company_name}`, `<div class="app"><aside><p class="mark">TRY <em>CLOCK IN</em></p><p class="sub">MISSION CONTROL</p><strong>${escapeHtml(user.company_name)}</strong><nav>${links.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}</nav><form method="post" action="/logout"><button class="text" type="submit">Sign out</button></form></aside><main>${body}</main></div>`);
}

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>
    :root { color-scheme: dark; --bg:#070709; --panel:rgba(255,255,255,.045); --ink:#f6f4f2; --muted:#b7b1ab; --line:rgba(255,255,255,.12); --red:#ff2a3a; --good:#3ddc84; }
    * { box-sizing: border-box; } body { margin:0; color:var(--ink); font-family: "Avenir Next", "Segoe UI", sans-serif; line-height:1.45; background:radial-gradient(700px 240px at 0 0, rgba(255,42,58,.35), transparent 60%), radial-gradient(640px 220px at 100% 0, rgba(255,42,58,.18), transparent 62%), var(--bg); }
    a { color: white; } .mark { letter-spacing:.16em; font-size:14px; margin:0; } .mark em { color:var(--red); font-style:normal; } .sub { letter-spacing:.22em; color:var(--muted); font-size:11px; margin:4px 0 18px; }
    .app { display:grid; grid-template-columns:250px 1fr; min-height:100vh; } aside { background:rgba(255,255,255,.03); border-right:1px solid rgba(255,42,58,.28); padding:28px 22px; }
    aside a { display:block; color:var(--muted); text-decoration:none; padding:10px 12px; border-radius:14px; } aside a:hover { color:white; background:rgba(255,42,58,.12); } main { padding:36px 32px 72px; }
    h1 { font-weight:560; letter-spacing:-.04em; margin:0; font-size:clamp(32px, 4vw, 48px); } h2 { font-weight:560; letter-spacing:-.03em; margin:0 0 8px; } .muted, .eyebrow { color:var(--muted); } .eyebrow { text-transform:uppercase; letter-spacing:.16em; font-size:12px; margin:0 0 8px; color:var(--red); }
    .head { display:flex; justify-content:space-between; gap:18px; align-items:end; margin-bottom:28px; }
    .stats { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:14px; } .stat, .card { background:var(--panel); border:1px solid var(--line); border-radius:22px; box-shadow:0 0 0 1px rgba(255,42,58,.08), 0 18px 40px rgba(0,0,0,.28); }
    .stat { padding:18px; border-top:2px solid var(--red); } .stat span { color:var(--muted); font-size:13px; } .stat strong { display:block; font-size:34px; margin-top:10px; letter-spacing:-.04em; }
    .split, .stations { display:grid; grid-template-columns:1.2fr .8fr; gap:16px; margin-top:16px; } .stations { grid-template-columns:1fr 1fr; }
    .card { padding:28px; margin-top:16px; } table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:12px 8px; border-bottom:1px solid var(--line); }
    .bars { display:flex; align-items:end; gap:8px; height:140px; } .bars div { flex:1; display:flex; flex-direction:column; justify-content:end; align-items:center; height:100%; } .bars span { display:block; width:100%; background:linear-gradient(180deg,#ff3144,#9f1224); border-radius:8px 8px 0 0; min-height:4px; }
    form { display:grid; gap:12px; max-width:480px; margin-top:18px; } label, .check { display:grid; gap:6px; } input, select { background:rgba(0,0,0,.35); color:white; border:1px solid var(--line); border-radius:12px; padding:12px 14px; font:inherit; }
    .button, button.button { background:linear-gradient(180deg,#ff3144,#9f1224); color:white; border:0; border-radius:16px; padding:12px 18px; font:inherit; text-decoration:none; display:inline-block; box-shadow:0 0 18px rgba(255,42,58,.35); }
    .quiet { background:transparent; border:1px solid rgba(255,42,58,.4); box-shadow:none; } button.text { background:none; border:0; color:var(--muted); padding:16px 0; font:inherit; box-shadow:none; }
    .gate { max-width:560px; margin:0 auto; padding:72px 22px; } .lead { color:var(--muted); } .error { color:#f0c2c6; } .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
    .plans { display:grid; gap:8px; } .choice { display:flex; gap:10px; align-items:center; } .mono { font-family: ui-monospace, monospace; word-break:break-all; }
    .preview { width:100%; height:640px; border:1px solid var(--line); border-radius:22px; background:#0d0d0d; }
    fieldset { border:1px solid var(--line); border-radius:16px; padding:16px; } .legal { color:var(--muted); font-size:12px; padding:8px 28px 28px; }
    .pass { border:1px solid var(--line); border-radius:28px; padding:22px; background:linear-gradient(180deg, rgba(159,29,45,.28), rgba(255,255,255,.03)); }
    .pass .live { letter-spacing:.18em; color:#3ddc84; font-size:12px; }
    .pass .qr img { background:#fff; border-radius:16px; padding:8px; }
    @media (max-width:900px) {
      .app, .stats, .split, .stations { grid-template-columns:1fr; }
      main { padding:20px 14px 48px; }
      .card { padding:18px; border-radius:24px; }
      aside { border-right:0; border-bottom:1px solid var(--line); }
      aside nav { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      aside a { background:rgba(255,255,255,.04); border:1px solid var(--line); border-radius:18px; padding:16px 12px; min-height:72px; }
      .stats { grid-template-columns:1fr 1fr; }
    }
  </style></head><body>${body}<p class="legal">© Red Face (Pty) Ltd. Licensed software.</p></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
