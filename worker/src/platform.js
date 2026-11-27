import { can } from "./auth.js";
import { hashSecret, lookupKey, randomToken, verifySecret } from "./crypto.js";
import { httpError } from "./db.js";

export const INDUSTRIES = ["Restaurant", "Hotel", "Construction", "Retail", "Security", "Factory", "Office", "Cleaning", "Other"];
const PAGE_SIZE = 24;

export async function currentUser(db, session) {
  if (!session) return null;
  return db
    .prepare(
      `SELECT company_users.id, company_users.company_id, company_users.full_name, company_users.role, company_users.email,
              companies.name AS company_name, companies.timezone
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
      `INSERT INTO stations (id, business_id, company_id, name, status, public_code)
       VALUES (?, ?, ?, 'Front tablet', 'online', ?)`,
    ).bind(stationId, companyId, companyId, code),
    db.prepare(
      `INSERT INTO subscriptions (id, company_id, plan, status, started_at)
       VALUES (?, ?, 'trial', 'active', ?)`,
    ).bind(subscriptionId, companyId, now),
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
      `SELECT employees.id, employees.first_name, employees.last_name, employees.role_title, employees.status,
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
  const pin = (input.pin ?? "").trim();
  if (!/^[0-9]{4,6}$/.test(pin)) throw httpError("PIN must be 4 to 6 digits.", 400, "pin_invalid");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const departmentId = input.department ? await ensureNamed(db, "departments", companyId, input.department) : null;
  const roleId = await ensureNamed(db, "roles", companyId, roleTitle);
  const card = input.cardUid?.trim() ?? "";
  await db.prepare(
    `INSERT INTO employees
     (id, business_id, company_id, department_id, role_id, first_name, last_name, role_title, status, pin_hash, nfc_hash, nfc_lookup, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).bind(
    id,
    companyId,
    companyId,
    departmentId,
    roleId,
    firstName,
    lastName,
    roleTitle,
    await hashSecret(pin, id),
    card ? await hashSecret(card, `${id}:nfc`) : null,
    card ? await lookupKey(card) : null,
    now,
  ).run();
  return id;
}

export async function listStations(db, companyId) {
  const rows = await db
    .prepare("SELECT id, name, status, public_code FROM stations WHERE company_id = ? ORDER BY name")
    .bind(companyId)
    .all();
  return rows.results ?? [];
}

export async function createStation(db, companyId, name) {
  const stationName = required(name, "Enter a station name.");
  const id = crypto.randomUUID();
  const code = randomToken().slice(0, 12);
  await db.prepare(
    `INSERT INTO stations (id, business_id, company_id, name, status, public_code)
     VALUES (?, ?, ?, ?, 'online', ?)`,
  ).bind(id, companyId, companyId, stationName, code).run();
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
  if (!can(actor.role, "team")) throw httpError("You cannot add management users.", 403, "forbidden");
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
    .prepare("SELECT plan, status, started_at FROM subscriptions WHERE company_id = ? ORDER BY started_at DESC LIMIT 1")
    .bind(companyId)
    .first();
}

export async function employeeInCompany(db, companyId, employeeId) {
  return db
    .prepare("SELECT id, first_name, last_name, role_title FROM employees WHERE id = ? AND company_id = ?")
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
