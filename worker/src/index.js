import { renderSVG } from "../vendor/uqr.mjs";
import { METHODS, johannesburg, publicEmployee } from "./clock.js";
import { randomToken } from "./crypto.js";
import {
  challengeStatus,
  confirmChallenge,
  httpError,
  kioskSnapshot,
  latestEvent,
  openChallenge,
  recordAttendance,
  resolveEmployee,
} from "./db.js";
import { kioskPage, phonePage } from "./page.js";

const DEFAULT_STATION = "8f0c1a2e-7b34-4c1a-9d11-abc000000002";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      await ensureFiles(env);
      if (url.pathname === "/") return html(kioskPage());
      if (url.pathname === "/api/kiosk") return json(await kioskPayload(env, url));
      if (url.pathname === "/api/qr" && request.method === "POST") return json(await createQr(request, env, url));
      if (url.pathname.startsWith("/api/qr/") && request.method === "GET") {
        return json(await qrStatus(decodeURIComponent(url.pathname.slice("/api/qr/".length)), env));
      }
      if (url.pathname === "/api/identify" && request.method === "POST") return json(await identify(request, env));
      if (url.pathname === "/api/clock" && request.method === "POST") return json(await clock(request, env));
      if (url.pathname.startsWith("/v/")) return phone(request, env, url);
      return json({ error: "Not found." }, 404);
    } catch (error) {
      const status = error.status || 500;
      return json({ error: status === 500 ? "The station could not complete that." : error.message, code: error.code || "error" }, status);
    }
  },
};

async function kioskPayload(env, url) {
  const stationId = url.searchParams.get("station") || DEFAULT_STATION;
  const snapshot = await kioskSnapshot(env.DB, stationId);
  if (!snapshot) throw httpError("This clocking station is not registered.", 404, "station_missing");
  const local = johannesburg();
  return { ...snapshot, greeting: local.greeting, dateLabel: local.dateLabel };
}

async function createQr(request, env, url) {
  const body = await request.json();
  const stationId = body.stationId || DEFAULT_STATION;
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  await openChallenge(env.DB, { token, employeeId: body.employeeId, stationId, expiresAt });
  const link = `${url.origin}/v/${token}`;
  return { token, expiresAt, svg: renderSVG(link, { pixelSize: 8, ecc: "M" }) };
}

async function qrStatus(token, env) {
  const challenge = await challengeStatus(env.DB, token);
  if (!challenge) return { status: "missing" };
  if (challenge.consumed_at) return { status: "used" };
  if (Date.parse(challenge.expires_at) <= Date.now()) return { status: "expired" };
  if (challenge.confirmed_at) return { status: "confirmed" };
  return { status: "pending" };
}

async function identify(request, env) {
  const body = await request.json();
  const resolved = await resolveEmployee(env.DB, { ...body, stationId: body.stationId || DEFAULT_STATION });
  const latest = await latestEvent(env.DB, resolved.employee.id);
  const local = latest ? johannesburg(new Date(latest.occurred_at)) : null;
  return {
    employee: publicEmployee(resolved.employee),
    suggestedAction: latest?.event_type === "CLOCK_IN" ? "CLOCK_OUT" : "CLOCK_IN",
    sinceLabel: local ? `${local.timeLabel}` : null,
  };
}

async function clock(request, env) {
  const body = await request.json();
  const stationId = body.stationId || DEFAULT_STATION;
  const resolved = await resolveEmployee(env.DB, { ...body, stationId });
  const now = johannesburg();
  const recorded = await recordAttendance(env.DB, {
    employee: resolved.employee,
    station: resolved.station,
    method: body.method,
    action: body.action,
    clientEventId: body.clientEventId,
    token: resolved.token,
    now: { iso: new Date().toISOString(), workDate: now.workDate },
  });
  const business = await env.DB.prepare("SELECT name FROM businesses WHERE id = ?").bind(resolved.station.business_id).first();
  return {
    employee: publicEmployee(resolved.employee),
    businessName: business?.name ?? "",
    eventType: recorded.event_type,
    method: recorded.method,
    methodLabel: METHODS[recorded.method] ?? recorded.method,
    timeLabel: now.timeLabel,
    dateLabel: now.dateLabel,
    workDate: recorded.work_date,
  };
}

async function phone(request, env, url) {
  const token = decodeURIComponent(url.pathname.slice(3));
  if (request.method === "POST") {
    const result = await confirmChallenge(env.DB, token);
    if (!result.ok) return html(phonePage({ title: "Code expired", body: "Ask the station for a new code." }), 410);
    return html(phonePage({ title: "Confirmed", body: `${result.employee.first_name}, you can look back at the station.` }));
  }
  const challenge = await challengeStatus(env.DB, token);
  if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.now()) {
    return html(phonePage({ title: "Code expired", body: "Ask the station for a new code." }), 410);
  }
  const employee = await env.DB.prepare("SELECT first_name FROM employees WHERE id = ?").bind(challenge.employee_id).first();
  return html(
    phonePage({
      title: `Confirm ${employee?.first_name ?? "attendance"}`,
      body: "This code works once and only for the next minute.",
      token,
    }),
  );
}

async function ensureFiles(env) {
  if (!env.FILES) return;
  const key = "system/readme.txt";
  if (await env.FILES.head(key)) return;
  await env.FILES.put(key, "Employee documents for the tryclockin clocking station.\n", {
    httpMetadata: { contentType: "text/plain" },
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
