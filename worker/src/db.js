import { verifySecret } from "./crypto.js";
import { publicEmployee, suggestedAction } from "./clock.js";

export async function kioskSnapshot(db, stationId) {
  const station = await db
    .prepare(
      `SELECT stations.id, stations.name AS station_name, stations.status,
              businesses.id AS business_id, businesses.name AS business_name, businesses.timezone
       FROM stations
       JOIN businesses ON businesses.id = stations.business_id
       WHERE stations.id = ?`,
    )
    .bind(stationId)
    .first();
  if (!station) return null;
  const employees = await db
    .prepare(
      `SELECT id, first_name, last_name, role_title, status, pin_hash, nfc_hash, face_object_key
       FROM employees
       WHERE business_id = ? AND status = 'active'
       ORDER BY first_name, last_name`,
    )
    .bind(station.business_id)
    .all();
  return {
    station: {
      id: station.id,
      name: station.station_name,
      status: station.status,
      businessId: station.business_id,
      businessName: station.business_name,
      timezone: station.timezone,
    },
    employees: (employees.results ?? []).map(publicEmployee),
  };
}

export async function latestEvent(db, employeeId) {
  return db
    .prepare(
      `SELECT event_type, occurred_at, method
       FROM attendance_events
       WHERE employee_id = ?
       ORDER BY occurred_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(employeeId)
    .first();
}

export async function resolveEmployee(db, { method, stationId, employeeId, pin, cardUid, token }) {
  const station = await db
    .prepare("SELECT id, business_id FROM stations WHERE id = ? AND status = 'online'")
    .bind(stationId)
    .first();
  if (!station) {
    throw httpError("This clocking station is offline.", 404, "station_offline");
  }

  if (method === "pin") {
    const employee = await activeEmployee(db, employeeId, station.business_id);
    if (!(await verifySecret(pin ?? "", employee.pin_hash))) {
      throw httpError("That PIN is not correct.", 401, "pin_rejected");
    }
    return { employee, station };
  }

  if (method === "nfc") {
    const rows = await db
      .prepare(
        `SELECT * FROM employees
         WHERE business_id = ? AND status = 'active' AND nfc_hash IS NOT NULL`,
      )
      .bind(station.business_id)
      .all();
    for (const employee of rows.results ?? []) {
      if (await verifySecret(cardUid ?? "", employee.nfc_hash)) return { employee, station };
    }
    throw httpError("This card is not registered.", 401, "card_rejected");
  }

  if (method === "qr") {
    const challenge = await db
      .prepare(
        `SELECT qr_challenges.token, qr_challenges.expires_at, qr_challenges.confirmed_at, qr_challenges.consumed_at,
                employees.*
         FROM qr_challenges
         JOIN employees ON employees.id = qr_challenges.employee_id
         WHERE qr_challenges.token = ? AND qr_challenges.station_id = ?`,
      )
      .bind(token, stationId)
      .first();
    if (!challenge) throw httpError("This QR code is not valid.", 401, "qr_rejected");
    if (challenge.consumed_at) throw httpError("This QR code has already been used.", 401, "qr_used");
    if (Date.parse(challenge.expires_at) <= Date.now()) {
      throw httpError("This QR code has expired. Choose your profile again.", 401, "qr_expired");
    }
    if (!challenge.confirmed_at) throw httpError("Scan the code with your phone and confirm it.", 401, "qr_pending");
    if (challenge.status !== "active" || challenge.business_id !== station.business_id) {
      throw httpError("This employee cannot clock at this station.", 403, "employee_inactive");
    }
    return { employee: challenge, station, token };
  }

  if (method === "face") {
    const employee = employeeId ? await activeEmployee(db, employeeId, station.business_id) : null;
    if (!employee?.face_object_key) {
      throw httpError("No face is enrolled for this station yet.", 409, "face_not_enrolled");
    }
    throw httpError("The camera verifier is not connected on this station yet.", 409, "face_verifier_unavailable");
  }

  throw httpError("Choose NFC, QR, face, or PIN.", 400, "method_rejected");
}

async function activeEmployee(db, employeeId, businessId) {
  const employee = await db
    .prepare("SELECT * FROM employees WHERE id = ? AND business_id = ?")
    .bind(employeeId, businessId)
    .first();
  if (!employee || employee.status !== "active") {
    throw httpError("Choose a registered employee.", 404, "employee_missing");
  }
  return employee;
}

export async function openChallenge(db, { token, employeeId, stationId, expiresAt }) {
  const station = await db.prepare("SELECT business_id FROM stations WHERE id = ?").bind(stationId).first();
  if (!station) throw httpError("This clocking station is not registered.", 404, "station_missing");
  await activeEmployee(db, employeeId, station.business_id);
  await db
    .prepare(
      `INSERT INTO qr_challenges (token, employee_id, station_id, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(token, employeeId, stationId, expiresAt)
    .run();
}

export async function challengeStatus(db, token) {
  return db.prepare("SELECT token, employee_id, station_id, expires_at, confirmed_at, consumed_at FROM qr_challenges WHERE token = ?").bind(token).first();
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
      `SELECT businesses.name AS business_name
       FROM stations JOIN businesses ON businesses.id = stations.business_id
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

  const latest = await latestEvent(db, employee.id);
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
         (id, employee_id, business_id, station_id, event_type, method, occurred_at, work_date, client_event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        employee.id,
        station.business_id,
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
