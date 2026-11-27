import { can } from "./auth.js";
import { minutesInZone, zonedNow } from "./clock.js";
import { hashSecret, lookupKey, randomToken, verifySecret } from "./crypto.js";
import { httpError } from "./db.js";

export const INDUSTRIES = ["Restaurant", "Hotel", "Construction", "Retail", "Security", "Factory", "Office", "Cleaning", "Other"];
export const PLANS = {
  starter: { label: "Starter", limit: 25 },
  growth: { label: "Growth", limit: 100 },
  business: { label: "Business", limit: 500 },
};
export const NOTICE_VERSION = "2026-11-workforce-v1";
const PAGE_SIZE = 24;

export async function currentUser(db, session) {
  if (!session) return null;
  return db
    .prepare(
      `SELECT company_users.id, company_users.company_id, company_users.full_name, company_users.role, company_users.email,
              companies.name AS company_name, companies.timezone, companies.default_start, companies.address, companies.contact_phone
       FROM company_users
       JOIN companies ON companies.id = company_users.company_id
       WHERE company_users.id = ? AND company_users.company_id = ?
         AND company_users.status = 'active' AND companies.status = 'active'`,
    )
    .bind(session.uid, session.companyId)
    .first();
}

export async function registerCompany(db, input) {
  const email = cleanEmail(input.email);
  const companyName = required(input.companyName, "Enter the company name.");
  const ownerName = required(input.ownerName, "Enter the account owner's name.");
  if (!email.includes("@")) throw httpError("Enter a valid email address.", 400, "email_invalid");
  if ((input.password ?? "").length < 8) throw httpError("Use a password of at least 8 characters.", 400, "password_short");
  const industry = INDUSTRIES.includes(input.industry) ? input.industry : "Other";
  const timezone = input.timezone?.trim() || "Africa/Johannesburg";
  const taken = await db.prepare("SELECT id FROM company_users WHERE email = ?").bind(email).first();
  if (taken) throw httpError("That email is already registered.", 409, "email_taken");

  const plan = PLANS[input.plan] ? input.plan : "starter";
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const stationId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const code = randomToken().slice(0, 12);
  const passwordHash = await hashSecret(input.password, userId);
  await db.batch([
    db.prepare(
      `INSERT INTO companies
       (id, name, registration_number, industry, address, contact_email, contact_phone, timezone, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).bind(
      companyId,
      companyName,
      blank(input.registrationNumber),
      industry,
      blank(input.address),
      email,
      blank(input.phone),
      timezone,
      now,
    ),
    db.prepare("INSERT INTO businesses (id, name, timezone) VALUES (?, ?, ?)").bind(companyId, companyName, timezone),
    db.prepare(
      `INSERT INTO company_users (id, company_id, email, password_hash, full_name, role, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?)`,
    ).bind(userId, companyId, email, passwordHash, ownerName, now),
    db.prepare(
      `INSERT INTO stations (id, business_id, company_id, name, status, public_code, location, methods)
       VALUES (?, ?, ?, 'Station 01 – Main Entrance', 'online', ?, 'Main entrance', 'nfc,qr,pin')`,
    ).bind(stationId, companyId, companyId, code),
    db.prepare(
      `INSERT INTO subscriptions (id, company_id, plan, status, started_at, employee_limit)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    ).bind(subscriptionId, companyId, plan, now, PLANS[plan].limit),
  ]);
  return { uid: userId, companyId, role: "owner", name: ownerName, code };
}

export async function authenticate(db, email, password) {
  const user = await db
    .prepare(
      `SELECT company_users.id, company_users.company_id, company_users.password_hash, company_users.full_name, company_users.role,
              company_users.status, companies.status AS company_status
       FROM company_users
       JOIN companies ON companies.id = company_users.company_id
       WHERE company_users.email = ?`,
    )
    .bind(cleanEmail(email))
    .first();
  if (!user || user.status !== "active" || user.company_status !== "active" || !(await verifySecret(password ?? "", user.password_hash))) {
    throw httpError("That email or password is not correct.", 401, "login_rejected");
  }
  return { uid: user.id, companyId: user.company_id, role: user.role, name: user.full_name };
}

export async function companyHome(db, companyId, workDate) {
  const [counts, events] = await db.batch([
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM employees WHERE company_id = ? AND status = 'active') AS employees,
         (SELECT COUNT(*) FROM stations WHERE company_id = ? AND status = 'online') AS stations,
         (SELECT COUNT(*) FROM attendance_events WHERE company_id = ? AND work_date = ?) AS punches`,
    ).bind(companyId, companyId, companyId, workDate),
    db.prepare(
      `SELECT attendance_events.occurred_at, attendance_events.event_type, attendance_events.method,
              employees.first_name, employees.last_name
       FROM attendance_events
       JOIN employees ON employees.id = attendance_events.employee_id AND employees.company_id = attendance_events.company_id
       WHERE attendance_events.company_id = ? AND attendance_events.work_date = ?
       ORDER BY attendance_events.occurred_at DESC
       LIMIT 20`,
    ).bind(companyId, workDate),
  ]);
  return {
    counts: counts.results?.[0] ?? { employees: 0, stations: 0, punches: 0 },
    events: events.results ?? [],
  };
}

export async function listEmployees(db, companyId, page) {
  const offset = Math.max(0, page) * PAGE_SIZE;
  const [rows, total] = await db.batch([
    db.prepare(
      `SELECT employees.id, employees.employee_number, employees.first_name, employees.last_name, employees.role_title, employees.status,
              departments.name AS department_name
       FROM employees
       LEFT JOIN departments ON departments.id = employees.department_id AND departments.company_id = employees.company_id
       WHERE employees.company_id = ?
       ORDER BY employees.first_name, employees.last_name
       LIMIT ? OFFSET ?`,
    ).bind(companyId, PAGE_SIZE, offset),
    db.prepare("SELECT COUNT(*) AS total FROM employees WHERE company_id = ?").bind(companyId),
  ]);
  return { employees: rows.results ?? [], total: total.results?.[0]?.total ?? 0, pageSize: PAGE_SIZE };
}

export async function createEmployee(db, companyId, input) {
  const firstName = required(input.firstName, "Enter a first name.");
  const lastName = required(input.lastName, "Enter a last name.");
  const roleTitle = required(input.roleTitle, "Enter a role.");
  const employeeNumber = required(input.employeeNumber, "Enter an employee number.").toUpperCase();
  const subscription = await subscriptionFor(db, companyId);
  const total = await db.prepare("SELECT COUNT(*) AS total FROM employees WHERE company_id = ? AND status = 'active'").bind(companyId).first();
  if ((total?.total ?? 0) >= (subscription?.employee_limit ?? 25)) {
    throw httpError(`The ${subscription?.plan ?? "starter"} plan allows ${subscription?.employee_limit ?? 25} active employees.`, 402, "plan_limit");
  }
  const existingNumber = await db.prepare("SELECT id FROM employees WHERE company_id = ? AND upper(employee_number) = ?").bind(companyId, employeeNumber).first();
  if (existingNumber) throw httpError("That employee number is already used.", 409, "number_taken");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const departmentId = input.department ? await ensureNamed(db, "departments", companyId, input.department) : null;
  const roleId = await ensureNamed(db, "roles", companyId, roleTitle);
  const pin = String(input.pin ?? "").trim();
  if (pin && !/^[0-9]{4,6}$/.test(pin)) throw httpError("PIN must be 4 to 6 digits.", 400, "pin_invalid");
  await db.prepare(
    `INSERT INTO employees
     (id, business_id, company_id, department_id, role_id, employee_number, first_name, last_name, role_title, status, pin_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).bind(id, companyId, companyId, departmentId, roleId, employeeNumber, firstName, lastName, roleTitle, pin ? await hashSecret(pin, id) : null, now).run();
  if (pin) await issuePin(db, companyId, id, pin);
  return id;
}

export async function listStations(db, companyId) {
  const rows = await db
    .prepare("SELECT id, name, status, public_code, location, methods FROM stations WHERE company_id = ? ORDER BY name")
    .bind(companyId)
    .all();
  return rows.results ?? [];
}

export async function createStation(db, companyId, name, location) {
  const stationName = required(name, "Enter a station name.");
  const id = crypto.randomUUID();
  const code = randomToken().slice(0, 12);
  await db.prepare(
    `INSERT INTO stations (id, business_id, company_id, name, status, public_code, location, methods)
     VALUES (?, ?, ?, ?, 'online', ?, ?, 'nfc,qr,pin')`,
  ).bind(id, companyId, companyId, stationName, code, blank(location) ?? "Workplace").run();
  return { id, code };
}

export async function listTeam(db, companyId) {
  const rows = await db
    .prepare("SELECT id, full_name, email, role, status FROM company_users WHERE company_id = ? ORDER BY full_name")
    .bind(companyId)
    .all();
  return rows.results ?? [];
}

export async function inviteUser(db, actor, input) {
  if (!can(actor.role, "settings")) throw httpError("You cannot add management users.", 403, "forbidden");
  const role = input.role === "admin" && actor.role === "owner" ? "admin" : "manager";
  const email = cleanEmail(input.email);
  const fullName = required(input.fullName, "Enter a name.");
  if (!email.includes("@")) throw httpError("Enter a valid email address.", 400, "email_invalid");
  if ((input.password ?? "").length < 8) throw httpError("Use a password of at least 8 characters.", 400, "password_short");
  const taken = await db.prepare("SELECT id FROM company_users WHERE email = ?").bind(email).first();
  if (taken) throw httpError("That email is already registered.", 409, "email_taken");
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO company_users (id, company_id, email, password_hash, full_name, role, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).bind(id, actor.company_id, email, await hashSecret(input.password, id), fullName, role, new Date().toISOString()).run();
}

export async function subscriptionFor(db, companyId) {
  return db
    .prepare("SELECT plan, status, started_at, employee_limit FROM subscriptions WHERE company_id = ? ORDER BY started_at DESC LIMIT 1")
    .bind(companyId)
    .first();
}

export async function employeeInCompany(db, companyId, employeeId) {
  return db
    .prepare("SELECT id, employee_number, first_name, last_name, role_title, status FROM employees WHERE id = ? AND company_id = ?")
    .bind(employeeId, companyId)
    .first();
}

export async function saveDocument(db, bucket, companyId, employeeId, file) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) {
    throw httpError("Choose a file to upload.", 400, "file_missing");
  }
  if (file.size > 5_000_000) throw httpError("Files must be 5 MB or smaller.", 400, "file_too_large");
  const employee = await employeeInCompany(db, companyId, employeeId);
  if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
  const filename = (file.name || "document").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) || "document";
  const id = crypto.randomUUID();
  const objectKey = `companies/${companyId}/employees/${employeeId}/${id}-${filename}`;
  await bucket.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  await db.prepare(
    `INSERT INTO employee_documents (id, company_id, employee_id, object_key, filename, content_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, companyId, employeeId, objectKey, filename, file.type || "application/octet-stream", new Date().toISOString()).run();
  return employee;
}

export async function issueCredential(db, companyId, employeeId, method) {
  const employee = await employeeInCompany(db, companyId, employeeId);
  if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
  if (method !== "nfc" && method !== "qr") throw httpError("Choose NFC or QR.", 400, "method_rejected");
  const now = new Date().toISOString();
  await db.prepare("UPDATE credentials SET status = 'revoked', revoked_at = ? WHERE company_id = ? AND employee_id = ? AND method = ? AND status = 'active'").bind(now, companyId, employeeId, method).run();
  const token = randomToken();
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO credentials (id, company_id, employee_id, method, lookup, status, issued_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
  ).bind(id, companyId, employeeId, method, await lookupKey(token), now).run();
  return { id, token, employee };
}

export async function issuePin(db, companyId, employeeId, pin) {
  if (!/^[0-9]{4,6}$/.test(pin ?? "")) throw httpError("PIN must be 4 to 6 digits.", 400, "pin_invalid");
  const employee = await employeeInCompany(db, companyId, employeeId);
  if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const secret = await hashSecret(pin, id);
  await db.batch([
    db.prepare("UPDATE credentials SET status = 'revoked', revoked_at = ? WHERE company_id = ? AND employee_id = ? AND method = 'pin' AND status = 'active'").bind(now, companyId, employeeId),
    db.prepare("INSERT INTO credentials (id, company_id, employee_id, method, secret_hash, status, issued_at, confirmed_at) VALUES (?, ?, ?, 'pin', ?, 'active', ?, ?)").bind(id, companyId, employeeId, secret, now, now),
    db.prepare("UPDATE employees SET pin_hash = ? WHERE id = ? AND company_id = ?").bind(secret, employeeId, companyId),
  ]);
  return employee;
}

export async function confirmCredential(db, companyId, credentialId) {
  const now = new Date().toISOString();
  const result = await db.prepare("UPDATE credentials SET confirmed_at = ? WHERE id = ? AND company_id = ? AND status = 'active'").bind(now, credentialId, companyId).run();
  if (!result.meta?.changes) throw httpError("That credential is not active.", 404, "credential_missing");
}

export async function revokeCredential(db, companyId, credentialId) {
  const credential = await db.prepare("SELECT id, employee_id, method FROM credentials WHERE id = ? AND company_id = ? AND status = 'active'").bind(credentialId, companyId).first();
  if (!credential) throw httpError("That credential is not active.", 404, "credential_missing");
  const now = new Date().toISOString();
  await db.prepare("UPDATE credentials SET status = 'revoked', revoked_at = ? WHERE id = ? AND company_id = ?").bind(now, credentialId, companyId).run();
  if (credential.method === "pin") {
    await db.prepare("UPDATE employees SET pin_hash = NULL WHERE id = ? AND company_id = ?").bind(credential.employee_id, companyId).run();
  }
}

export async function listCredentials(db, companyId, employeeId = null) {
  const query = employeeId
    ? "SELECT id, employee_id, method, status, issued_at, confirmed_at, revoked_at FROM credentials WHERE company_id = ? AND employee_id = ? ORDER BY issued_at DESC"
    : "SELECT credentials.id, credentials.employee_id, credentials.method, credentials.status, credentials.issued_at, credentials.confirmed_at, employees.first_name, employees.last_name, employees.employee_number FROM credentials JOIN employees ON employees.id = credentials.employee_id AND employees.company_id = credentials.company_id WHERE credentials.company_id = ? AND credentials.status = 'active' ORDER BY credentials.issued_at DESC";
  const statement = db.prepare(query);
  const rows = employeeId ? await statement.bind(companyId, employeeId).all() : await statement.bind(companyId).all();
  return rows.results ?? [];
}

export async function recordConsent(db, companyId, employeeId) {
  const employee = await employeeInCompany(db, companyId, employeeId);
  if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO consents (id, company_id, employee_id, purpose, notice_version, consented_at)
     VALUES (?, ?, ?, 'attendance-face', ?, ?)`,
  ).bind(crypto.randomUUID(), companyId, employeeId, NOTICE_VERSION, now).run();
  return employee;
}

export async function consentRows(db, companyId) {
  const rows = await db.prepare(
    `SELECT employees.id, employees.first_name, employees.last_name, employees.employee_number,
            consents.consented_at, consents.withdrawn_at
     FROM employees
     LEFT JOIN consents ON consents.employee_id = employees.id AND consents.company_id = employees.company_id AND consents.withdrawn_at IS NULL
     WHERE employees.company_id = ? AND employees.status = 'active'
     ORDER BY employees.first_name`,
  ).bind(companyId).all();
  return rows.results ?? [];
}

export async function board(db, companyId, workDate, timeZone, defaultStart = "08:00") {
  const [people, events, leave] = await db.batch([
    db.prepare("SELECT id, first_name, last_name, employee_number, role_title FROM employees WHERE company_id = ? AND status = 'active' ORDER BY first_name").bind(companyId),
    db.prepare("SELECT employee_id, event_type, occurred_at, method FROM attendance_events WHERE company_id = ? AND work_date = ? ORDER BY occurred_at").bind(companyId, workDate),
    db.prepare("SELECT employee_id FROM leave_requests WHERE company_id = ? AND status = 'approved' AND starts_on <= ? AND ends_on >= ?").bind(companyId, workDate, workDate),
  ]);
  const onLeave = new Set((leave.results ?? []).map((row) => row.employee_id));
  const byEmployee = new Map();
  for (const event of events.results ?? []) {
    const list = byEmployee.get(event.employee_id) ?? [];
    list.push(event);
    byEmployee.set(event.employee_id, list);
  }
  const startMinutes = Number(defaultStart.slice(0, 2)) * 60 + Number(defaultStart.slice(3, 5));
  const rows = (people.results ?? []).map((employee) => {
    const list = byEmployee.get(employee.id) ?? [];
    const last = list.at(-1) ?? null;
    const firstIn = list.find((event) => event.event_type === "CLOCK_IN") ?? null;
    const lastOut = [...list].reverse().find((event) => event.event_type === "CLOCK_OUT") ?? null;
    const state = onLeave.has(employee.id) ? "leave" : last?.event_type === "CLOCK_IN" ? "in" : last?.event_type === "CLOCK_OUT" ? "out" : "absent";
    const late = firstIn ? Math.max(0, minutesInZone(new Date(firstIn.occurred_at), timeZone) - startMinutes) : 0;
    let minutes = 0;
    if (firstIn && lastOut) minutes = Math.max(0, Math.round((Date.parse(lastOut.occurred_at) - Date.parse(firstIn.occurred_at)) / 60000));
    else if (firstIn && state === "in") minutes = Math.max(0, Math.round((Date.now() - Date.parse(firstIn.occurred_at)) / 60000));
    return {
      ...employee,
      state,
      late,
      minutes,
      firstLabel: firstIn ? zonedNow(new Date(firstIn.occurred_at), timeZone).timeLabel : "—",
      lastLabel: last ? zonedNow(new Date(last.occurred_at), timeZone).timeLabel : "—",
      method: last?.method ?? "",
    };
  });
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const week = await db.prepare("SELECT work_date, COUNT(*) AS punches FROM attendance_events WHERE company_id = ? AND work_date >= ? GROUP BY work_date ORDER BY work_date").bind(companyId, weekStart.toISOString().slice(0, 10)).all();
  return {
    rows,
    clockedIn: rows.filter((row) => row.state === "in").length,
    clockedOut: rows.filter((row) => row.state === "out").length,
    absent: rows.filter((row) => row.state === "absent").length,
    late: rows.filter((row) => row.late > 0).length,
    hours: Math.round(rows.reduce((sum, row) => sum + row.minutes, 0) / 60),
    activity: (events.results ?? []).slice(-12).reverse().map((event) => {
      const person = (people.results ?? []).find((employee) => employee.id === event.employee_id);
      return { ...event, name: person ? `${person.first_name} ${person.last_name}` : "Employee", timeLabel: zonedNow(new Date(event.occurred_at), timeZone).timeLabel };
    }),
    week: week.results ?? [],
  };
}

export async function listLeave(db, companyId) {
  const rows = await db.prepare(
    `SELECT leave_requests.id, leave_requests.leave_type, leave_requests.starts_on, leave_requests.ends_on, leave_requests.status,
            employees.first_name, employees.last_name
     FROM leave_requests
     JOIN employees ON employees.id = leave_requests.employee_id AND employees.company_id = leave_requests.company_id
     WHERE leave_requests.company_id = ?
     ORDER BY leave_requests.starts_on DESC
     LIMIT 50`,
  ).bind(companyId).all();
  return rows.results ?? [];
}

export async function createLeave(db, companyId, input) {
  const employee = await employeeInCompany(db, companyId, input.employeeId);
  if (!employee) throw httpError("Choose an employee in this company.", 404, "employee_missing");
  const startsOn = required(input.startsOn, "Enter a start date.");
  const endsOn = required(input.endsOn, "Enter an end date.");
  await db.prepare(
    `INSERT INTO leave_requests (id, company_id, employee_id, leave_type, starts_on, ends_on, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'approved', ?)`,
  ).bind(crypto.randomUUID(), companyId, employee.id, required(input.leaveType, "Enter a leave type."), startsOn, endsOn, new Date().toISOString()).run();
}

export async function saveCompany(db, companyId, input) {
  const name = required(input.companyName, "Enter the company name.");
  const start = String(input.defaultStart ?? "08:00");
  if (!/^\d{2}:\d{2}$/.test(start)) throw httpError("Enter the start time as HH:MM.", 400, "time_invalid");
  const timezone = input.timezone?.trim() || "Africa/Johannesburg";
  await db.prepare("UPDATE companies SET name = ?, address = ?, contact_phone = ?, timezone = ?, default_start = ? WHERE id = ?").bind(name, blank(input.address), blank(input.phone), timezone, start, companyId).run();
}

export async function updateStation(db, companyId, stationId, input) {
  const methods = ["nfc", "qr", "pin", "face"].filter((method) => input[method] === "on").join(",") || "nfc,qr,pin";
  await db.prepare("UPDATE stations SET name = ?, location = ?, methods = ? WHERE id = ? AND company_id = ?").bind(required(input.name, "Enter a station name."), blank(input.location) ?? "Workplace", methods, stationId, companyId).run();
}

async function ensureNamed(db, table, companyId, name) {
  if (table !== "departments" && table !== "roles") throw httpError("Unknown list.", 400, "bad_table");
  const clean = required(name, "Enter a name.").slice(0, 80);
  const existing = await db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND name = ?`).bind(companyId, clean).first();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO ${table} (id, company_id, name) VALUES (?, ?, ?)`).bind(id, companyId, clean).run();
  return id;
}

function cleanEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function required(value, message) {
  const clean = String(value ?? "").trim();
  if (!clean) throw httpError(message, 400, "missing_field");
  return clean.slice(0, 160);
}

function blank(value) {
  const clean = String(value ?? "").trim();
  return clean ? clean.slice(0, 200) : null;
}
