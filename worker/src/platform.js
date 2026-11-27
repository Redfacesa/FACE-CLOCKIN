import { can } from "./auth.js";
import { minutesInZone, zonedNow } from "./clock.js";
import { DEFAULT_POLICY, estimateMonth, monthDates } from "./payroll.js";
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
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
       VALUES (?, ?, ?, 'Station 01 – Main Entrance', 'online', ?, 'Main entrance', 'nfc,qr,pin,face')`,
    ).bind(stationId, companyId, companyId, code),
    db.prepare(
      `INSERT INTO subscriptions (id, company_id, plan, status, started_at, employee_limit, features)
       VALUES (?, ?, ?, 'active', ?, ?, 'reports,payroll')`,
    ).bind(subscriptionId, companyId, plan, now, PLANS[plan].limit),
  ]);
  return { uid: userId, companyId, role: "owner", name: ownerName, code };
}

export async function authenticate(db, email, password) {
  const user = await db
    .prepare(
      `SELECT company_users.id, company_users.company_id, company_users.password_hash, company_users.full_name, company_users.role,
              company_users.status, company_users.email_verified_at, company_users.activated_at, companies.status AS company_status
       FROM company_users
       JOIN companies ON companies.id = company_users.company_id
       WHERE company_users.email = ?`,
    )
    .bind(cleanEmail(email))
    .first();
  if (!user || user.status !== "active" || !(await verifySecret(password ?? "", user.password_hash))) {
    throw httpError("That email or password is not correct.", 401, "login_rejected");
  }
  if (!user.email_verified_at) throw httpError("Confirm the email we sent before signing in.", 403, "email_unverified");
  if (!user.activated_at || user.company_status !== "active") throw httpError("Activate the workspace before signing in. Verification and activation are separate.", 403, "not_activated");
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
     (id, business_id, company_id, department_id, role_id, employee_number, first_name, last_name, role_title, phone, email, status, pin_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).bind(id, companyId, companyId, departmentId, roleId, employeeNumber, firstName, lastName, roleTitle, blank(input.phone), blank(input.email), pin ? await hashSecret(pin, id) : null, now).run();
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
     VALUES (?, ?, ?, ?, 'online', ?, ?, 'nfc,qr,pin,face')`,
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
  const now = new Date().toISOString();
  await db.prepare("UPDATE company_users SET email_verified_at = ?, activated_at = ? WHERE id = ?").bind(now, now, id).run();
}

export async function subscriptionFor(db, companyId) {
  return db
    .prepare("SELECT plan, status, started_at, employee_limit, features FROM subscriptions WHERE company_id = ? ORDER BY started_at DESC LIMIT 1")
    .bind(companyId)
    .first();
}

export async function issueVerification(db, userId, companyId) {
  const token = randomToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(
    "INSERT INTO email_verifications (lookup, user_id, company_id, purpose, expires_at) VALUES (?, ?, ?, 'signup', ?)",
  ).bind(await lookupKey(token), userId, companyId, expires).run();
  return token;
}

export async function verificationFor(db, token) {
  const row = await db.prepare(
    `SELECT email_verifications.lookup, email_verifications.user_id, email_verifications.company_id, email_verifications.expires_at, email_verifications.used_at,
            company_users.email, company_users.email_verified_at, company_users.full_name, companies.name AS company_name, companies.status AS company_status
     FROM email_verifications
     JOIN company_users ON company_users.id = email_verifications.user_id
     JOIN companies ON companies.id = email_verifications.company_id
     WHERE email_verifications.lookup = ?`,
  ).bind(await lookupKey(String(token ?? ""))).first();
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return null;
  return row;
}

export async function markEmailVerified(db, token) {
  const row = await verificationFor(db, token);
  if (!row) throw httpError("This verification link has expired. Request another email.", 410, "verify_expired");
  if (!row.email_verified_at) {
    await db.prepare("UPDATE company_users SET email_verified_at = ? WHERE id = ?").bind(new Date().toISOString(), row.user_id).run();
    row.email_verified_at = new Date().toISOString();
  }
  return row;
}

export async function activateWorkspace(db, token) {
  const row = await verificationFor(db, token);
  if (!row) throw httpError("This activation link has expired. Request another email.", 410, "verify_expired");
  if (!row.email_verified_at) throw httpError("Verify the email before activating the workspace.", 409, "email_unverified");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE companies SET status = 'active' WHERE id = ?").bind(row.company_id),
    db.prepare("UPDATE company_users SET activated_at = ? WHERE id = ? AND activated_at IS NULL").bind(now, row.user_id),
    db.prepare("UPDATE email_verifications SET used_at = ? WHERE lookup = ?").bind(now, row.lookup),
  ]);
  return row;
}

export async function employeeInCompany(db, companyId, employeeId) {
  return db
    .prepare("SELECT id, employee_number, first_name, last_name, role_title, phone, email, photo_key, status, CASE WHEN pin_hash IS NOT NULL THEN 1 ELSE 0 END AS has_pin FROM employees WHERE id = ? AND company_id = ?")
    .bind(employeeId, companyId)
    .first();
}

export async function pendingOwner(db, email) {
  return db.prepare(
    "SELECT id, company_id, email_verified_at, activated_at FROM company_users WHERE email = ? AND role = 'owner'",
  ).bind(cleanEmail(email)).first();
}

function descriptorDistance(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += (left[index] - right[index]) ** 2;
  return Math.sqrt(sum);
}

function descriptorOrThrow(descriptor) {
  if (!Array.isArray(descriptor) || descriptor.length !== 128 || descriptor.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw httpError("The face scan was not usable. Hold each angle until it is captured.", 400, "face_invalid");
  }
  return descriptor;
}

export async function saveFaceTemplate(db, companyId, employeeId, samples) {
  const requiredPoses = ["center", "left", "right", "up", "down"];
  const captured = requiredPoses.map((pose) => {
    const sample = Array.isArray(samples) ? samples.find((item) => item?.pose === pose) : null;
    return { pose, descriptor: descriptorOrThrow(sample?.descriptor) };
  });
  const center = captured.find((sample) => sample.pose === "center").descriptor;
  for (const sample of captured) {
    if (sample.pose === "center") continue;
    const gap = descriptorDistance(center, sample.descriptor);
    if (gap < 0.02) throw httpError("Each step needs a different angle. Turn your head and register again.", 400, "face_inconsistent");
    if (gap > 0.72) throw httpError("Those angles do not look like the same person. Use better light and register again.", 400, "face_inconsistent");
  }
  const employee = await employeeInCompany(db, companyId, employeeId);
  if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
  const now = new Date().toISOString();
  const statements = [
    db.prepare(
      `INSERT INTO consents (id, company_id, employee_id, purpose, notice_version, consented_at)
       VALUES (?, ?, ?, 'attendance-face', ?, ?)`,
    ).bind(crypto.randomUUID(), companyId, employeeId, NOTICE_VERSION, now),
    db.prepare("UPDATE face_templates SET status = 'replaced' WHERE company_id = ? AND employee_id = ? AND status = 'active'").bind(companyId, employeeId),
  ];
  for (const sample of captured) {
    statements.push(db.prepare(
      "INSERT INTO face_templates (id, company_id, employee_id, descriptor, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
    ).bind(crypto.randomUUID(), companyId, employeeId, JSON.stringify(sample.descriptor), now));
  }
  await db.batch(statements);
}

export async function deleteFace(db, companyId, employeeId) {
  const employee = await employeeInCompany(db, companyId, employeeId);
  if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE face_templates SET status = 'deleted' WHERE company_id = ? AND employee_id = ? AND status = 'active'").bind(companyId, employeeId),
    db.prepare("UPDATE consents SET withdrawn_at = ? WHERE company_id = ? AND employee_id = ? AND purpose = 'attendance-face' AND withdrawn_at IS NULL").bind(now, companyId, employeeId),
  ]);
}

export async function employeeHasFace(db, companyId, employeeId) {
  const row = await db.prepare("SELECT id FROM face_templates WHERE company_id = ? AND employee_id = ? AND status = 'active'").bind(companyId, employeeId).first();
  return Boolean(row);
}

export async function employeeAttendance(db, companyId, employeeId) {
  const rows = await db.prepare(
    "SELECT event_type, method, occurred_at, work_date FROM attendance_events WHERE company_id = ? AND employee_id = ? ORDER BY occurred_at DESC LIMIT 20",
  ).bind(companyId, employeeId).all();
  return rows.results ?? [];
}

export async function stationDirectory(db, code) {
  const station = await db.prepare(
    `SELECT stations.id, stations.company_id
     FROM stations JOIN companies ON companies.id = stations.company_id
     WHERE stations.public_code = ? AND stations.status = 'online' AND companies.status = 'active'`,
  ).bind(code).first();
  if (!station) return null;
  const rows = await db.prepare(
    "SELECT id, first_name, last_name, employee_number FROM employees WHERE company_id = ? AND status = 'active' ORDER BY first_name, last_name",
  ).bind(station.company_id).all();
  return {
    stationId: station.id,
    people: (rows.results ?? []).map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      employeeNumber: row.employee_number,
    })),
  };
}

export function hasFeature(subscription, feature) {
  return String(subscription?.features || "reports,payroll").split(",").map((item) => item.trim()).includes(feature);
}

export async function payPolicy(db, companyId) {
  const row = await db.prepare("SELECT * FROM pay_policies WHERE company_id = ?").bind(companyId).first();
  if (!row) return { ...DEFAULT_POLICY };
  return {
    workDays: String(row.work_days).split(",").map(Number),
    dayStart: row.day_start,
    dayEnd: row.day_end,
    weeklyMinutes: row.weekly_minutes,
    lunchAllowanceMinutes: row.lunch_allowance_minutes,
    lateGraceMinutes: row.late_grace_minutes,
    overtimeMultiplier: row.overtime_multiplier,
    deductLate: Boolean(row.deduct_late),
    deductExtraBreak: Boolean(row.deduct_extra_break),
    deductAbsence: Boolean(row.deduct_absence),
  };
}

export async function savePayPolicy(db, companyId, input) {
  const days = [0, 1, 2, 3, 4, 5, 6].filter((day) => input[`day${day}`] === "on");
  if (!days.length) throw httpError("Choose at least one working day.", 400, "days_missing");
  const multiplier = Number(input.overtimeMultiplier);
  if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 3) throw httpError("Overtime multiplier must be between 1 and 3.", 400, "multiplier_invalid");
  const weeklyHours = Number(input.weeklyHours);
  if (!Number.isFinite(weeklyHours) || weeklyHours < 1 || weeklyHours > 60) throw httpError("Enter expected weekly hours.", 400, "hours_invalid");
  await db.prepare(
    `INSERT INTO pay_policies
      (company_id, day_start, day_end, work_days, weekly_minutes, lunch_allowance_minutes, late_grace_minutes, overtime_multiplier, deduct_late, deduct_extra_break, deduct_absence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET
      day_start = excluded.day_start, day_end = excluded.day_end, work_days = excluded.work_days, weekly_minutes = excluded.weekly_minutes,
      lunch_allowance_minutes = excluded.lunch_allowance_minutes, late_grace_minutes = excluded.late_grace_minutes, overtime_multiplier = excluded.overtime_multiplier,
      deduct_late = excluded.deduct_late, deduct_extra_break = excluded.deduct_extra_break, deduct_absence = excluded.deduct_absence`,
  ).bind(
    companyId,
    required(input.dayStart, "Enter the start time."),
    required(input.dayEnd, "Enter the end time."),
    days.join(","),
    Math.round(weeklyHours * 60),
    Number(input.lunchAllowanceMinutes) || 0,
    Number(input.lateGraceMinutes) || 0,
    multiplier,
    input.deductLate === "on" ? 1 : 0,
    input.deductExtraBreak === "on" ? 1 : 0,
    input.deductAbsence === "on" ? 1 : 0,
  ).run();
}

export async function saveEmployeePay(db, companyId, employeeId, input) {
  const employee = await employeeInCompany(db, companyId, employeeId);
  if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
  const payType = input.payType === "hourly" ? "hourly" : "monthly";
  const amount = Math.round(Number(input.amount) * 100);
  if (!Number.isFinite(amount) || amount < 0) throw httpError("Enter the salary or hourly rate in rands.", 400, "pay_invalid");
  await db.prepare(
    `INSERT INTO employee_pay (employee_id, company_id, pay_type, amount_cents) VALUES (?, ?, ?, ?)
     ON CONFLICT(employee_id) DO UPDATE SET pay_type = excluded.pay_type, amount_cents = excluded.amount_cents, company_id = excluded.company_id`,
  ).bind(employeeId, companyId, payType, amount).run();
}

export async function monthlyReport(db, companyId, month, timeZone) {
  const locked = await db.prepare("SELECT snapshot FROM payroll_runs WHERE company_id = ? AND month = ? AND status = 'finalised'").bind(companyId, month).first();
  if (locked) return { ...JSON.parse(locked.snapshot), status: "finalised" };
  const dates = monthDates(month);
  if (!dates.length) throw httpError("Choose a month.", 400, "month_invalid");
  const [people, events, leave, pays] = await db.batch([
    db.prepare("SELECT id, first_name, last_name, employee_number FROM employees WHERE company_id = ? AND status = 'active' ORDER BY first_name").bind(companyId),
    db.prepare("SELECT employee_id, event_type, occurred_at, work_date FROM attendance_events WHERE company_id = ? AND work_date >= ? AND work_date <= ?").bind(companyId, dates[0], dates.at(-1)),
    db.prepare("SELECT employee_id, starts_on, ends_on FROM leave_requests WHERE company_id = ? AND status = 'approved' AND ends_on >= ? AND starts_on <= ?").bind(companyId, dates[0], dates.at(-1)),
    db.prepare("SELECT employee_id, pay_type, amount_cents FROM employee_pay WHERE company_id = ?").bind(companyId),
  ]);
  const policy = await payPolicy(db, companyId);
  const payByEmployee = new Map((pays.results ?? []).map((row) => [row.employee_id, row]));
  const eventsByEmployee = new Map();
  for (const event of events.results ?? []) {
    const list = eventsByEmployee.get(event.employee_id) ?? [];
    list.push(event);
    eventsByEmployee.set(event.employee_id, list);
  }
  const today = zonedNow(new Date(), timeZone).workDate;
  const rows = (people.results ?? []).map((employee) => {
    const away = new Set();
    for (const item of leave.results ?? []) {
      if (item.employee_id !== employee.id) continue;
      for (const date of dates) if (date >= item.starts_on && date <= item.ends_on) away.add(date);
    }
    return estimateMonth({
      employee,
      dates,
      events: eventsByEmployee.get(employee.id) ?? [],
      leaveDates: away,
      policy,
      pay: payByEmployee.get(employee.id),
      timeZone,
      today,
    });
  });
  return { month, status: "estimated", rows, policy };
}

export async function finalisePayroll(db, companyId, month, timeZone) {
  const report = await monthlyReport(db, companyId, month, timeZone);
  if (report.status === "finalised") return report;
  const snapshot = { ...report, status: "finalised" };
  await db.prepare(
    "INSERT INTO payroll_runs (id, company_id, month, status, snapshot, created_at) VALUES (?, ?, ?, 'finalised', ?, ?)",
  ).bind(crypto.randomUUID(), companyId, month, JSON.stringify(snapshot), new Date().toISOString()).run();
  return snapshot;
}

export async function savePhoto(db, bucket, companyId, employeeId, file) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) throw httpError("Choose a photograph.", 400, "file_missing");
  if (file.size > 2_000_000) throw httpError("Photographs must be 2 MB or smaller.", 400, "file_too_large");
  if (!String(file.type || "").startsWith("image/")) throw httpError("Choose an image.", 400, "file_type");
  const employee = await employeeInCompany(db, companyId, employeeId);
  if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
  const key = `companies/${companyId}/employees/${employeeId}/photo`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await db.prepare("UPDATE employees SET photo_key = ? WHERE id = ? AND company_id = ?").bind(key, employeeId, companyId).run();
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
