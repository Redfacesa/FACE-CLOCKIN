import { renderSVG } from "../vendor/uqr.mjs";
import { can, clearCookie, readSession, sessionCookie, signSession } from "./auth.js";
import { METHODS, zonedNow, publicEmployee } from "./clock.js";
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
import {
  billingPage,
  employeePage,
  employeesPage,
  homePage,
  loginPage,
  signupPage,
  stationsPage,
  teamPage,
  todayPage,
} from "./manage.js";
import { kioskPage, phonePage } from "./page.js";
import {
  authenticate,
  companyHome,
  createEmployee,
  createStation,
  currentUser,
  employeeInCompany,
  inviteUser,
  listEmployees,
  listStations,
  listTeam,
  registerCompany,
  saveDocument,
  subscriptionFor,
} from "./platform.js";

export default {
  async fetch(request, env) {
    const started = performance.now();
    const url = new URL(request.url);
    try {
      const response = await route(request, env, url);
      response.headers.set("server-timing", `app;dur=${Math.round(performance.now() - started)}`);
      return response;
    } catch (error) {
      const status = error.status || 500;
      const message = status === 500 ? "The platform could not complete that." : error.message;
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v/")) {
        return timed(json({ error: message, code: error.code || "error" }, status), started);
      }
      return timed(html(`<p>${escapeText(message)}</p> <p><a href="/">Back</a></p>`, status), started);
    }
  },
};

async function route(request, env, url) {
  if (url.pathname === "/") return html(homePage(), 200, "public, max-age=300");
  if (url.pathname === "/signup") return signup(request, env);
  if (url.pathname === "/login") return login(request, env);
  if (url.pathname === "/logout" && request.method === "POST") return redirect("/", clearCookie());
  if (url.pathname === "/app" || url.pathname.startsWith("/app/")) return dashboard(request, env, url);
  if (url.pathname.startsWith("/s/")) {
    const code = decodeURIComponent(url.pathname.slice(3));
    return html(kioskPage(code));
  }
  if (url.pathname === "/api/kiosk") return json(await kioskPayload(env, url));
  if (url.pathname === "/api/qr" && request.method === "POST") return json(await createQr(request, env, url));
  if (url.pathname.startsWith("/api/qr/") && request.method === "GET") {
    return json(await qrStatus(decodeURIComponent(url.pathname.slice("/api/qr/".length)), env));
  }
  if (url.pathname === "/api/identify" && request.method === "POST") return json(await identify(request, env));
  if (url.pathname === "/api/clock" && request.method === "POST") return json(await clock(request, env));
  if (url.pathname.startsWith("/v/")) return phone(request, env, url);
  return json({ error: "Not found." }, 404);
}

async function signup(request, env) {
  if (request.method !== "POST") return html(signupPage());
  const form = await request.formData();
  const values = Object.fromEntries(form);
  try {
    const account = await registerCompany(env.DB, values);
    return redirect("/app", await sessionCookieFor(env, account));
  } catch (error) {
    if (!error.status) throw error;
    return html(signupPage({ error: error.message, values }), error.status);
  }
}

async function login(request, env) {
  if (request.method !== "POST") return html(loginPage());
  const form = await request.formData();
  try {
    const account = await authenticate(env.DB, form.get("email"), form.get("password"));
    return redirect("/app", await sessionCookieFor(env, account));
  } catch (error) {
    if (!error.status) throw error;
    return html(loginPage({ error: error.message }), error.status);
  }
}

async function dashboard(request, env, url) {
  const user = await currentUser(env.DB, await readSession(request, env.SESSION_SECRET));
  if (!user) return redirect("/login");
  const path = url.pathname;

  if (path === "/app") {
    const local = zonedNow(new Date(), user.timezone);
    const home = await companyHome(env.DB, user.company_id, local.workDate);
    home.events = home.events.map((event) => ({ ...event, timeLabel: zonedNow(new Date(event.occurred_at), user.timezone).timeLabel }));
    return html(todayPage({ user, home, workDate: local.dateLabel }));
  }

  if (path === "/app/employees") {
    if (!can(user.role, "employees")) throw httpError("You cannot manage employees.", 403, "forbidden");
    if (request.method === "POST") {
      const form = await request.formData();
      try {
        await createEmployee(env.DB, user.company_id, Object.fromEntries(form));
        return redirect("/app/employees");
      } catch (error) {
        if (!error.status) throw error;
        const listed = await listEmployees(env.DB, user.company_id, 0);
        return html(employeesPage({ user, ...listed, page: 0, error: error.message }), error.status);
      }
    }
    const page = Number(url.searchParams.get("page") || 0);
    const listed = await listEmployees(env.DB, user.company_id, Number.isFinite(page) ? page : 0);
    return html(employeesPage({ user, ...listed, page: Number.isFinite(page) ? page : 0 }));
  }

  const employeeMatch = path.match(/^\/app\/employees\/([^/]+)$/);
  if (employeeMatch) {
    const employee = await employeeInCompany(env.DB, user.company_id, employeeMatch[1]);
    if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
    return html(employeePage({ user, employee }));
  }

  const documentMatch = path.match(/^\/app\/employees\/([^/]+)\/documents$/);
  if (documentMatch && request.method === "POST") {
    if (!can(user.role, "employees")) throw httpError("You cannot manage employees.", 403, "forbidden");
    const form = await request.formData();
    try {
      await saveDocument(env.DB, env.FILES, user.company_id, documentMatch[1], form.get("file"));
      return redirect(`/app/employees/${documentMatch[1]}`);
    } catch (error) {
      if (!error.status) throw error;
      const employee = await employeeInCompany(env.DB, user.company_id, documentMatch[1]);
      return html(employeePage({ user, employee: employee ?? { first_name: "Employee", last_name: "", role_title: "" }, error: error.message }), error.status);
    }
  }

  if (path === "/app/stations") {
    if (!can(user.role, "stations")) throw httpError("You cannot manage stations.", 403, "forbidden");
    if (request.method === "POST") {
      const form = await request.formData();
      try {
        await createStation(env.DB, user.company_id, form.get("name"));
        return redirect("/app/stations");
      } catch (error) {
        if (!error.status) throw error;
        return html(stationsPage({ user, stations: await listStations(env.DB, user.company_id), origin: url.origin, error: error.message }), error.status);
      }
    }
    return html(stationsPage({ user, stations: await listStations(env.DB, user.company_id), origin: url.origin }));
  }

  if (path === "/app/team") {
    if (!can(user.role, "team")) throw httpError("You cannot manage users.", 403, "forbidden");
    if (request.method === "POST") {
      const form = await request.formData();
      try {
        await inviteUser(env.DB, user, Object.fromEntries(form));
        return redirect("/app/team");
      } catch (error) {
        if (!error.status) throw error;
        return html(teamPage({ user, team: await listTeam(env.DB, user.company_id), error: error.message }), error.status);
      }
    }
    return html(teamPage({ user, team: await listTeam(env.DB, user.company_id) }));
  }

  if (path === "/app/subscription") {
    if (!can(user.role, "billing")) throw httpError("Only the account owner can view the subscription.", 403, "forbidden");
    return html(billingPage({ user, subscription: await subscriptionFor(env.DB, user.company_id) }));
  }

  return json({ error: "Not found." }, 404);
}

async function kioskPayload(env, url) {
  const code = url.searchParams.get("code") ?? "";
  const snapshot = await kioskSnapshot(env.DB, code);
  if (!snapshot) throw httpError("This clocking station is not registered.", 404, "station_missing");
  const local = zonedNow(new Date(), snapshot.station.timezone);
  return { ...snapshot, greeting: local.greeting, dateLabel: local.dateLabel };
}

async function createQr(request, env, url) {
  const body = await request.json();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  await openChallenge(env.DB, { token, employeeId: body.employeeId, stationId: body.stationId, expiresAt });
  return { token, expiresAt, svg: renderSVG(`${url.origin}/v/${token}`, { pixelSize: 8, ecc: "M" }) };
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
  const resolved = await resolveEmployee(env.DB, body);
  const latest = await latestEvent(env.DB, resolved.employee.id, resolved.station.company_id);
  const local = latest ? zonedNow(new Date(latest.occurred_at), resolved.station.timezone) : null;
  return {
    employee: publicEmployee(resolved.employee),
    suggestedAction: latest?.event_type === "CLOCK_IN" ? "CLOCK_OUT" : "CLOCK_IN",
    sinceLabel: local ? local.timeLabel : null,
  };
}

async function clock(request, env) {
  const body = await request.json();
  const resolved = await resolveEmployee(env.DB, body);
  const now = zonedNow(new Date(), resolved.station.timezone);
  const recorded = await recordAttendance(env.DB, {
    employee: resolved.employee,
    station: resolved.station,
    method: body.method,
    action: body.action,
    clientEventId: body.clientEventId,
    token: resolved.token,
    now: { iso: new Date().toISOString(), workDate: now.workDate },
  });
  return {
    employee: publicEmployee(resolved.employee),
    businessName: resolved.station.company_name,
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
  const employee = await env.DB.prepare("SELECT first_name FROM employees WHERE id = ? AND company_id = ?").bind(challenge.employee_id, challenge.company_id).first();
  return html(phonePage({
    title: `Confirm ${employee?.first_name ?? "attendance"}`,
    body: "This code works once and only for the next minute.",
    token,
  }));
}

async function sessionCookieFor(env, account) {
  const token = await signSession(env.SESSION_SECRET, {
    uid: account.uid,
    companyId: account.companyId,
    role: account.role,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  });
  return sessionCookie(token);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function html(body, status = 200, cache = "no-store") {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache },
  });
}

function redirect(location, cookie) {
  const headers = { location };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(null, { status: 303, headers });
}

function timed(response, started) {
  response.headers.set("server-timing", `app;dur=${Math.round(performance.now() - started)}`);
  return response;
}

function escapeText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
