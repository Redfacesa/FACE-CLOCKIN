import { can } from "./auth.js";
import { INDUSTRIES } from "./platform.js";

export function homePage() {
  return shell("Red Face Clocking", `
    <main class="narrow">
      <p class="brand">Red Face</p>
      <h1>Attendance for every company.</h1>
      <p>Each company registers its own account, manages its own workforce, and receives its own clocking station. Employees never create accounts.</p>
      <p class="row"><a class="button" href="/signup">Register a company</a><a class="button quiet" href="/login">Sign in</a></p>
    </main>`);
}

export function signupPage({ error = "", values = {} } = {}) {
  const industryOptions = INDUSTRIES.map((industry) => `<option ${values.industry === industry ? "selected" : ""}>${escapeHtml(industry)}</option>`).join("");
  return shell("Register a company", `
    <main class="narrow">
      <p class="brand">Red Face</p>
      <h1>Register your company</h1>
      <p>You become the primary account owner. Employees will only use the clocking station.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/signup">
        <label>Company name<input name="companyName" required value="${escapeHtml(values.companyName ?? "")}"></label>
        <label>Industry<select name="industry">${industryOptions}</select></label>
        <label>Registration number<input name="registrationNumber" value="${escapeHtml(values.registrationNumber ?? "")}"></label>
        <label>Address<input name="address" value="${escapeHtml(values.address ?? "")}"></label>
        <label>Phone<input name="phone" value="${escapeHtml(values.phone ?? "")}"></label>
        <label>Account owner<input name="ownerName" required value="${escapeHtml(values.ownerName ?? "")}"></label>
        <label>Email<input name="email" type="email" required value="${escapeHtml(values.email ?? "")}"></label>
        <label>Password<input name="password" type="password" required minlength="8"></label>
        <button class="button" type="submit">Create account</button>
      </form>
    </main>`);
}

export function loginPage({ error = "" } = {}) {
  return shell("Sign in", `
    <main class="narrow">
      <p class="brand">Red Face</p>
      <h1>Company sign in</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/login">
        <label>Email<input name="email" type="email" required></label>
        <label>Password<input name="password" type="password" required></label>
        <button class="button" type="submit">Sign in</button>
      </form>
    </main>`);
}

export function todayPage({ user, home, workDate }) {
  const rows = home.events.map((event) => `<tr><td>${escapeHtml(event.first_name)} ${escapeHtml(event.last_name)}</td><td>${escapeHtml(event.event_type)}</td><td>${escapeHtml(event.method)}</td><td>${escapeHtml(event.timeLabel)}</td></tr>`).join("");
  return appShell(user, "Today", `
    <h1>${escapeHtml(user.company_name)}</h1>
    <p class="muted">${escapeHtml(workDate)}</p>
    <div class="stats">
      <div><strong>${home.counts.employees}</strong><span>Employees</span></div>
      <div><strong>${home.counts.stations}</strong><span>Stations online</span></div>
      <div><strong>${home.counts.punches}</strong><span>Punches today</span></div>
    </div>
    <table>
      <thead><tr><th>Employee</th><th>Event</th><th>Method</th><th>Time</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4">No punches yet today.</td></tr>`}</tbody>
    </table>`);
}

export function employeesPage({ user, employees, total, page, pageSize, error = "" }) {
  const rows = employees.map((employee) => `<tr><td><a href="/app/employees/${employee.id}">${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</a></td><td>${escapeHtml(employee.role_title)}</td><td>${escapeHtml(employee.department_name ?? "")}</td><td>${escapeHtml(employee.status)}</td></tr>`).join("");
  const pages = Math.ceil(total / pageSize);
  return appShell(user, "Employees", `
    <h1>Employees</h1>
    <p class="muted">${total} people. They do not get dashboard logins.</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <table>
      <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Status</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4">No employees yet.</td></tr>`}</tbody>
    </table>
    <p class="row">${page > 0 ? `<a href="/app/employees?page=${page - 1}">Previous</a>` : ""}${page + 1 < pages ? `<a href="/app/employees?page=${page + 1}">Next</a>` : ""}</p>
    <h2>Add an employee</h2>
    <form method="post" action="/app/employees">
      <label>First name<input name="firstName" required></label>
      <label>Last name<input name="lastName" required></label>
      <label>Role<input name="roleTitle" required></label>
      <label>Department<input name="department"></label>
      <label>PIN<input name="pin" inputmode="numeric" required minlength="4" maxlength="6"></label>
      <label>NFC card number<input name="cardUid"></label>
      <button class="button" type="submit">Save employee</button>
    </form>`);
}

export function employeePage({ user, employee, error = "" }) {
  return appShell(user, employee.first_name, `
    <h1>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</h1>
    <p class="muted">${escapeHtml(employee.role_title)}</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <h2>Document</h2>
    <form method="post" action="/app/employees/${employee.id}/documents" enctype="multipart/form-data">
      <label>File<input name="file" type="file" required></label>
      <button class="button" type="submit">Upload to this company</button>
    </form>`);
}

export function stationsPage({ user, stations, origin, error = "" }) {
  const rows = stations.map((station) => `<tr><td>${escapeHtml(station.name)}</td><td>${escapeHtml(station.status)}</td><td><a href="${origin}/s/${escapeHtml(station.public_code)}">${origin}/s/${escapeHtml(station.public_code)}</a></td></tr>`).join("");
  return appShell(user, "Stations", `
    <h1>Clocking stations</h1>
    <p class="muted">Open a station link on the workplace tablet. It only shows this company's employees.</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <table>
      <thead><tr><th>Name</th><th>Status</th><th>Tablet link</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3">No stations yet.</td></tr>`}</tbody>
    </table>
    <h2>Add a station</h2>
    <form method="post" action="/app/stations">
      <label>Name<input name="name" required></label>
      <button class="button" type="submit">Create station</button>
    </form>`);
}

export function teamPage({ user, team, error = "" }) {
  const rows = team.map((member) => `<tr><td>${escapeHtml(member.full_name)}</td><td>${escapeHtml(member.email)}</td><td>${escapeHtml(member.role)}</td></tr>`).join("");
  const form = can(user.role, "team")
    ? `<h2>Add a manager</h2>
      <form method="post" action="/app/team">
        <label>Name<input name="fullName" required></label>
        <label>Email<input name="email" type="email" required></label>
        <label>Password<input name="password" type="password" required minlength="8"></label>
        ${user.role === "owner" ? `<label>Role<select name="role"><option value="manager">Manager</option><option value="admin">Admin</option></select></label>` : ""}
        <button class="button" type="submit">Add user</button>
      </form>`
    : "";
  return appShell(user, "Team", `
    <h1>Management users</h1>
    <p class="muted">These people can open the dashboard. Employees are not listed here.</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${rows}</tbody></table>
    ${form}`);
}

export function billingPage({ user, subscription }) {
  return appShell(user, "Subscription", `
    <h1>Subscription</h1>
    <p>${escapeHtml(subscription?.plan ?? "trial")} · ${escapeHtml(subscription?.status ?? "active")}</p>
    <p class="muted">Started ${escapeHtml(subscription?.started_at ?? "")}. Payment collection is not connected yet.</p>`);
}

function appShell(user, title, body) {
  const links = [
    ["Today", "/app", "attendance"],
    ["Employees", "/app/employees", "employees"],
    ["Stations", "/app/stations", "stations"],
    ["Team", "/app/team", "team"],
    ["Subscription", "/app/subscription", "billing"],
  ].filter(([, , action]) => can(user.role, action));
  return shell(`${title} · ${user.company_name}`, `
    <div class="app">
      <aside>
        <p class="brand">Red Face</p>
        <strong>${escapeHtml(user.company_name)}</strong>
        <nav>${links.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}</nav>
        <form method="post" action="/logout"><button class="quiet" type="submit">Sign out</button></form>
      </aside>
      <main>${body}</main>
    </div>`);
}

function shell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: "Avenir Next", "Segoe UI", sans-serif; background: #f4f6f8; color: #17202a; }
    a { color: #0b6b4f; }
    .narrow { max-width: 460px; margin: 0 auto; padding: 48px 20px; }
    .app { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
    aside { background: #10231c; color: white; padding: 22px; }
    aside a { color: white; display: block; padding: 8px 0; text-decoration: none; }
    main { padding: 28px; }
    h1 { margin: 0 0 8px; letter-spacing: -.03em; }
    .brand { text-transform: uppercase; letter-spacing: .08em; font-size: 13px; }
    .muted, .stats span { color: #5d6b76; }
    .error { color: #8d2b2b; }
    .row { display: flex; gap: 10px; align-items: center; }
    .button, button.button { background: #0b6b4f; color: white; border: 0; border-radius: 12px; padding: 12px 16px; text-decoration: none; font: inherit; font-weight: 700; display: inline-block; }
    .quiet, button.quiet { background: transparent; color: inherit; border: 1px solid #d5dde3; border-radius: 12px; padding: 12px 16px; font: inherit; }
    aside button.quiet { color: white; border-color: transparent; padding-left: 0; }
    form { display: grid; gap: 10px; max-width: 420px; margin-top: 16px; }
    label { display: grid; gap: 4px; font-size: 14px; }
    input, select { font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid #d5dde3; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e6ebef; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
    .stats div { background: white; border-radius: 12px; padding: 14px; }
    .stats strong { display: block; font-size: 28px; }
    @media (max-width: 800px) { .app { grid-template-columns: 1fr; } .stats { grid-template-columns: 1fr; } }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
