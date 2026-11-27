import { matchFace, suggestedAction } from "./clock.js";
import { lookupKey, verifySecret } from "./crypto.js";

export async function kioskSnapshot(db, code) {
  const station = await db
    .prepare(
      `SELECT stations.id, stations.name AS station_name, stations.status, stations.public_code,
              stations.location, stations.methods,
              companies.id AS company_id, companies.name AS company_name, companies.timezone
       FROM stations
       JOIN companies ON companies.id = stations.company_id
       WHERE stations.public_code = ? AND stations.status = 'online' AND companies.status = 'active'`,
    )
    .bind(code)
    .first();
  if (!station) return null;
  return {
    station: {
      id: station.id,
      name: station.station_name,
      status: station.status,
      code: station.public_code,
      location: station.location,
      methods: String(station.methods ?? "nfc,qr,pin").split(","),
      companyId: station.company_id,
      businessName: station.company_name,
      timezone: station.timezone,
    },
  };
}

export async function latestEvent(db, employeeId, companyId) {
  return db
    .prepare(
      `SELECT event_type, occurred_at, method
       FROM attendance_events
       WHERE employee_id = ? AND company_id = ?
       ORDER BY occurred_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(employeeId, companyId)
    .first();
}

function presentedToken(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/\/t\/([A-Za-z0-9_-]+)/);
  return match?.[1] || text;
}

function stationAllows(station, method) {
  const allowed = String(station.methods ?? "nfc,qr,pin").split(",");
  if (!allowed.includes(method)) {
    throw httpError("This station does not accept that method.", 403, "method_disabled");
  }
}

export async function resolveEmployee(db, { method, stationId, employeeId, employeeNumber, pin, cardUid, token, descriptor }) {
  const station = await db
    .prepare(
      `SELECT stations.id, stations.company_id, stations.methods, companies.timezone, companies.name AS company_name
       FROM stations
       JOIN companies ON companies.id = stations.company_id
       WHERE stations.id = ? AND stations.status = 'online' AND companies.status = 'active'`,
    )
    .bind(stationId)
    .first();
  if (!station) {
    throw httpError("This clocking station is offline.", 404, "station_offline");
  }
  stationAllows(station, method);

  if (method === "pin") {
    const number = String(employeeNumber ?? "").trim().toUpperCase();
    const employee = number
      ? await db.prepare("SELECT * FROM employees WHERE company_id = ? AND upper(employee_number) = ? AND status = 'active'").bind(station.company_id, number).first()
      : await activeEmployee(db, employeeId, station.company_id);
    if (!employee) throw httpError("That employee number is not registered.", 404, "employee_missing");
    const pins = await db.prepare("SELECT secret_hash FROM credentials WHERE company_id = ? AND employee_id = ? AND method = 'pin' AND status = 'active'").bind(station.company_id, employee.id).all();
    let matched = false;
    for (const credential of pins.results ?? []) {
      if (await verifySecret(pin ?? "", credential.secret_hash)) matched = true;
    }
    if (!matched && !(await verifySecret(pin ?? "", employee.pin_hash))) {
      throw httpError("That PIN is not correct.", 401, "pin_rejected");
    }
    return { employee, station };
  }

  if (method === "nfc" || method === "qr") {
    const secret = presentedToken(token || cardUid);
    const credential = await db
      .prepare(
        `SELECT employees.*
         FROM credentials
         JOIN employees ON employees.id = credentials.employee_id AND employees.company_id = credentials.company_id
         WHERE credentials.company_id = ? AND credentials.method = ? AND credentials.lookup = ? AND credentials.status = 'active' AND employees.status = 'active'`,
      )
      .bind(station.company_id, method, await lookupKey(secret))
      .first();
    if (credential) return { employee: credential, station };
    if (method === "nfc") {
      const employee = await db
        .prepare("SELECT * FROM employees WHERE company_id = ? AND status = 'active' AND nfc_lookup = ?")
        .bind(station.company_id, await lookupKey(cardUid ?? secret))
        .first();
      if (employee && (await verifySecret(cardUid ?? secret, employee.nfc_hash))) return { employee, station };
    }
    throw httpError(method === "nfc" ? "This card is not registered." : "This QR code is not registered.", 401, "credential_rejected");
  }

  if (method === "face") {
    const rows = await db.prepare("SELECT employee_id, descriptor FROM face_templates WHERE company_id = ? AND status = 'active'").bind(station.company_id).all();
    const templates = (rows.results ?? []).map((row) => ({ employeeId: row.employee_id, descriptor: JSON.parse(row.descriptor) }));
    const matchedId = matchFace(descriptor, templates);
    if (!matchedId) throw httpError("That face is not registered at this company.", 401, "face_rejected");
    return { employee: await activeEmployee(db, matchedId, station.company_id), station };
  }

  throw httpError("Choose NFC, QR, face, or PIN.", 400, "method_rejected");
}

async function activeEmployee(db, employeeId, companyId) {
  const employee = await db
    .prepare("SELECT * FROM employees WHERE id = ? AND company_id = ?")
    .bind(employeeId, companyId)
    .first();
  if (!employee || employee.status !== "active") {
    throw httpError("Choose a registered employee.", 404, "employee_missing");
  }
  return employee;
}

export async function openChallenge(db, { token, employeeId, stationId, expiresAt }) {
  const station = await db.prepare("SELECT company_id FROM stations WHERE id = ?").bind(stationId).first();
  if (!station) throw httpError("This clocking station is not registered.", 404, "station_missing");
  await activeEmployee(db, employeeId, station.company_id);
  await db
    .prepare(
      `INSERT INTO qr_challenges (token, employee_id, station_id, company_id, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(token, employeeId, stationId, station.company_id, expiresAt)
    .run();
}

export async function challengeStatus(db, token) {
  return db.prepare("SELECT token, employee_id, station_id, company_id, expires_at, confirmed_at, consumed_at FROM qr_challenges WHERE token = ?").bind(token).first();
}

export async function confirmChallenge(db, token) {
  const challenge = await challengeStatus(db, token);
  if (!challenge) return { ok: false, reason: "missing" };
  if (challenge.consumed_at) return { ok: false, reason: "used" };
  if (Date.parse(challenge.expires_at) <= Date.now()) return { ok: false, reason: "expired" };
  if (!challenge.confirmed_at) {
    await db.prepare("UPDATE qr_challenges SET confirmed_at = ? WHERE token = ?").bind(new Date().toISOString(), token).run();
  }
  const employee = await db.prepare("SELECT first_name, last_name, role_title FROM employees WHERE id = ?").bind(challenge.employee_id).first();
  const station = await db
    .prepare(
      `SELECT companies.name AS business_name
       FROM stations JOIN companies ON companies.id = stations.company_id
       WHERE stations.id = ?`,
    )
    .bind(challenge.station_id)
    .first();
  return { ok: true, employee, businessName: station?.business_name ?? "" };
}

export async function recordAttendance(db, { employee, station, method, action, clientEventId, token, now }) {
  if (clientEventId) {
    const existing = await db
      .prepare("SELECT id, event_type, method, occurred_at, work_date FROM attendance_events WHERE client_event_id = ?")
      .bind(clientEventId)
      .first();
    if (existing) return existing;
  }

  const latest = await latestEvent(db, employee.id, station.company_id);
  const expected = suggestedAction(latest?.event_type ?? null);
  if (action !== expected) {
    throw httpError(
      expected === "CLOCK_OUT" ? "You are already clocked in." : "You are already clocked out.",
      409,
      "action_conflict",
    );
  }

  const id = crypto.randomUUID();
  const statements = [
    db
      .prepare(
        `INSERT INTO attendance_events
         (id, employee_id, business_id, company_id, station_id, event_type, method, occurred_at, work_date, client_event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        employee.id,
        station.company_id,
        station.company_id,
        station.id,
        action,
        method,
        now.iso,
        now.workDate,
        clientEventId ?? null,
      ),
  ];
  if (token) {
    statements.push(
      db.prepare("UPDATE qr_challenges SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL").bind(now.iso, token),
    );
  }
  await db.batch(statements);
  return { id, event_type: action, method, occurred_at: now.iso, work_date: now.workDate };
}

export function httpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
