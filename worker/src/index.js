import { adminGate, holdPage, landingPage, reviewPage, signupPage } from "./site.js";
import { encode, renderSVG } from "../vendor/uqr.mjs";
import { adminCookie, can, clearCookie, openToken, readAdminSession, readSession, sessionCookie, signSession } from "./auth.js";
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
  accessPage,
  attendancePage,
  billingPage,
  credentialCardPage,
  employeePage,
  employeesPage,
  facePage,
  leavePage,
  loginPage,
  overviewPage,
  pendingPage,
  reportsPage,
  settingsPage,
  shiftsPage,
  stationPreview,
  stationsPage,
  verifyPage,
} from "./manage.js";
import { sendAdminLink, sendSignupAlert, sendVerificationEmail } from "./mail.js";
import { kioskPage, phoneConfirmPage, phonePage } from "./page.js";
import { reportCsv, reportPdf } from "./payroll.js";
import {
  authenticate,
  board,
  confirmCredential,
  consentRows,
  createEmployee,
  createLeave,
  createStation,
  currentUser,
  businessDocument,
  deleteFace,
  finalisePayroll,
  hasFeature,
  monthlyReport,
  employeeAttendance,
  employeeHasFace,
  employeeInCompany,
  inviteUser,
  issueCredential,
  issuePin,
  issueVerification,
  listCredentials,
  listEmployees,
  listLeave,
  markEmailVerified,
  pendingOwner,
  listApplications,
  listBusinessDocuments,
  listIncidents,
  recordIncident,
  listStations,
  listTeam,
  recordConsent,
  registerCompany,
  reviewCompany,
  saveBusinessDocument,
  revokeCredential,
  saveCompany,
  saveDocument,
  saveEmployeePay,
  saveFaceTemplate,
  savePayPolicy,
  savePhoto,
  stationDirectory,
  subscriptionFor,
  updateStation,
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
      if (status >= 500) {
        try { await recordIncident(env.DB, { path: url.pathname, status, code: error.code, message: error.message || message }); } catch { /* the original failure still has to be shown */ }
      }
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v/") || url.pathname.endsWith("/face")) {
        return timed(json({ error: message, code: error.code || "error" }, status), started);
      }
      return timed(html(`<p>${escapeText(message)}</p> <p><a href="/">Back</a></p>`, status), started);
    }
  },
};

async function route(request, env, url) {
  if (url.pathname === "/") return html(landingPage(), 200, "public, max-age=300");
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return platformReview(request, env, url);
  if (url.pathname === "/signup") return signup(request, env, url);
  if (url.pathname === "/signup/resend" && request.method === "POST") return resendVerification(request, env, url);
  if (url.pathname.startsWith("/verify/")) return verifyEmail(request, env, url);
  if (url.pathname === "/login") return login(request, env);
  if (url.pathname === "/logout" && request.method === "POST") return redirect("/", clearCookie());
  if (url.pathname === "/app" || url.pathname.startsWith("/app/")) return dashboard(request, env, url);
  if (url.pathname.startsWith("/t/")) return html(credentialCardPage(decodeURIComponent(url.pathname.slice(3))));
  if (url.pathname.startsWith("/s/")) {
    const code = decodeURIComponent(url.pathname.slice(3));
    return html(kioskPage(code));
  }
  if (url.pathname === "/api/kiosk") return json(await kioskPayload(env, url));
  if (url.pathname === "/api/kiosk/people") {
    const directory = await stationDirectory(env.DB, url.searchParams.get("code") ?? "");
    if (!directory) throw httpError("This clocking station is not registered.", 404, "station_missing");
    return json(directory);
  }
  if (url.pathname === "/api/qr" && request.method === "POST") return json(await createQr(request, env, url));
  if (url.pathname.startsWith("/api/qr/") && request.method === "GET") {
    return json(await qrStatus(decodeURIComponent(url.pathname.slice("/api/qr/".length)), env));
  }
  if (url.pathname === "/api/identify" && request.method === "POST") return json(await identify(request, env));
  if (url.pathname === "/api/clock" && request.method === "POST") return json(await clock(request, env));
  if (url.pathname.startsWith("/v/")) return phone(request, env, url);
  return json({ error: "Not found." }, 404);
}

function hasFile(file) {
  return file && typeof file !== "string" && file.size > 0;
}

async function signup(request, env, url) {
  if (request.method !== "POST") return html(signupPage());
  const form = await request.formData();
  const values = Object.fromEntries([...form].filter(([, value]) => typeof value === "string"));
  try {
    if (!hasFile(form.get("registration"))) throw httpError("Upload the business document.", 400, "file_missing");
    const account = await registerCompany(env.DB, values);
    const kind = values.businessType === "sole" ? "sole-proof" : "cipc";
    await saveBusinessDocument(env.DB, env.FILES, account.companyId, kind, form.get("registration"));
    if (hasFile(form.get("addressProof"))) await saveBusinessDocument(env.DB, env.FILES, account.companyId, "address", form.get("addressProof"));
    if (hasFile(form.get("authority"))) await saveBusinessDocument(env.DB, env.FILES, account.companyId, "authority", form.get("authority"));
    const token = await issueVerification(env.DB, account.uid, account.companyId);
    const link = `${url.origin}/verify/${token}`;
    let warning = "";
    try {
      await sendVerificationEmail(env, { to: String(values.email), companyName: String(values.companyName), link });
    } catch (error) {
      warning = error.message || "The account was created, but the verification email could not be sent.";
    }
    try {
      await sendSignupAlert(env, {
        companyName: String(values.companyName),
        ownerName: String(values.ownerName),
        email: String(values.email),
        businessType: values.businessType,
        reviewLink: `${url.origin}/admin`,
      });
    } catch (error) {
      warning = warning || error.message || "The application was saved, but the admin email could not be sent.";
    }
    return html(pendingPage({ email: String(values.email), warning }));
  } catch (error) {
    if (!error.status) throw error;
    return html(signupPage({ error: error.message, values }), error.status);
  }
}

async function resendVerification(request, env, url) {
  const email = String((await request.formData()).get("email") ?? "");
  const owner = await pendingOwner(env.DB, email);
  if (owner && !owner.activated_at) {
    const company = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(owner.company_id).first();
    const token = await issueVerification(env.DB, owner.id, owner.company_id);
    try {
      await sendVerificationEmail(env, { to: email, companyName: company?.name ?? "your company", link: `${url.origin}/verify/${token}` });
    } catch (error) {
      return html(pendingPage({ email, warning: error.message || "The email could not be sent." }));
    }
  }
  return html(pendingPage({ email }));
}

async function verifyEmail(request, env, url) {
  const token = decodeURIComponent(url.pathname.slice("/verify/".length));
  try {
    const row = await markEmailVerified(env.DB, token);
    return html(verifyPage({ companyName: row.company_name, token, verified: true }));
  } catch (error) {
    if (!error.status) throw error;
    return html(verifyPage({ companyName: "This workspace", token, error: error.message }), error.status);
  }
}

function isPlatformAdmin(env, email) {
  const configured = String(env.PLATFORM_ADMINS || "info@redface.co.za");
  return configured.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean).includes(String(email || "").toLowerCase());
}

async function documentsFor(env, applications) {
  const documentsByCompany = {};
  for (const item of applications) {
    if (item.status === "active") continue;
    documentsByCompany[item.id] = await listBusinessDocuments(env.DB, item.id);
  }
  return documentsByCompany;
}

async function platformReview(request, env, url) {
  if (url.pathname === "/admin/login" && request.method === "POST") {
    const token = await signSession(env.SESSION_SECRET, {
      uid: "platform-admin",
      companyId: "platform",
      role: "platform",
      email: "info@redface.co.za",
      exp: Date.now() + 30 * 60 * 1000,
    });
    try {
      await sendAdminLink(env, { link: `${url.origin}/admin/enter?token=${encodeURIComponent(token)}` });
      return html(adminGate({ sent: true }));
    } catch (error) {
      return html(adminGate({ error: error.message || "The sign-in email could not be sent." }), 503);
    }
  }
  if (url.pathname === "/admin/enter") {
    const session = await openToken(env.SESSION_SECRET, url.searchParams.get("token"));
    if (session?.role !== "platform" || session.email !== "info@redface.co.za") return html(adminGate({ error: "That sign-in link has expired. Request another." }), 401);
    const cookieToken = await signSession(env.SESSION_SECRET, {
      uid: "platform-admin",
      companyId: "platform",
      role: "platform",
      email: "info@redface.co.za",
      exp: Date.now() + 12 * 60 * 60 * 1000,
    });
    return redirect("/admin", adminCookie(cookieToken));
  }
  const admin = await platformOwner(request, env);
  if (!admin) return html(adminGate());
  const documentMatch = url.pathname.match(/^\/admin\/documents\/([^/]+)$/);
  if (documentMatch) {
    const document = await businessDocument(env.DB, documentMatch[1]);
    if (!document) return new Response("Not found.", { status: 404 });
    const object = await env.FILES.get(document.object_key);
    if (!object) return new Response("Not found.", { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": document.content_type,
        "content-disposition": `attachment; filename="${String(document.filename).replaceAll('"', "")}"`,
        "cache-control": "private, no-store",
      },
    });
  }
  const reviewMatch = url.pathname.match(/^\/admin\/companies\/([^/]+)$/);
  if (reviewMatch && request.method === "POST") {
    const form = await request.formData();
    try {
      await reviewCompany(env.DB, reviewMatch[1], String(form.get("action") ?? ""), "info@redface.co.za", form.get("note"));
      return redirect("/admin");
    } catch (error) {
      const applications = await listApplications(env.DB);
      return html(reviewPage({ applications, documentsByCompany: await documentsFor(env, applications), error: error.message || "The review could not be saved." }), error.status || 400);
    }
  }
  const applications = await listApplications(env.DB);
  return html(reviewPage({ applications, documentsByCompany: await documentsFor(env, applications), incidents: await listIncidents(env.DB) }));
}

async function platformOwner(request, env) {
  const admin = await readAdminSession(request, env.SESSION_SECRET);
  if (admin) return admin;
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session?.uid) return null;
  const user = await env.DB.prepare("SELECT email FROM company_users WHERE id = ? AND status = 'active'").bind(session.uid).first();
  if (!isPlatformAdmin(env, user?.email)) return null;
  return { ...session, email: user.email, role: "platform" };
}

async function login(request, env) {
  if (request.method !== "POST") return html(loginPage());
  const form = await request.formData();
  try {
    const email = form.get("email");
    const account = await authenticate(env.DB, email, form.get("password"));
    const cookies = [await sessionCookieFor(env, account)];
    if (isPlatformAdmin(env, email)) {
      cookies.push(adminCookie(await signSession(env.SESSION_SECRET, {
        uid: account.uid,
        companyId: account.companyId,
        role: "platform",
        email: "info@redface.co.za",
        exp: Date.now() + 12 * 60 * 60 * 1000,
      })));
      return redirect("/admin", cookies);
    }
    return redirect("/app", cookies);
  } catch (error) {
    if (!error.status) throw error;
    return html(loginPage({ error: error.message }), error.status);
  }
}

async function dashboard(request, env, url) {
  const user = await currentUser(env.DB, await readSession(request, env.SESSION_SECRET));
  if (!user) return redirect("/login");
  const path = url.pathname;
  if (user.company_status !== "active") {
    if (path === "/app/verification-documents" && request.method === "POST") {
      await saveBusinessDocument(env.DB, env.FILES, user.company_id, "extra", (await request.formData()).get("extra"));
      return redirect("/app");
    }
    return html(holdPage({ user, documents: await listBusinessDocuments(env.DB, user.company_id) }));
  }

  const local = zonedNow(new Date(), user.timezone);
  const guard = (action) => {
    if (!can(user.role, action)) throw httpError("You cannot open that section.", 403, "forbidden");
  };
  const todayBoard = () => board(env.DB, user.company_id, local.workDate, user.timezone, user.default_start || "08:00");

  if (path === "/app") {
    guard("overview");
    return html(overviewPage({ user, board: await todayBoard(), workDate: local.dateLabel }));
  }

  if (path === "/app/employees") {
    if (!can(user.role, "employees")) throw httpError("You cannot manage employees.", 403, "forbidden");
    if (request.method === "POST") {
      const form = await request.formData();
      try {
        const createdId = await createEmployee(env.DB, user.company_id, Object.fromEntries(form));
        return redirect(`/app/employees/${createdId}?added=1`);
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

  const credentialAction = path.match(/^\/app\/employees\/([^/]+)\/(nfc|qr|pin|consent)$/);
  if (credentialAction && request.method === "POST") {
    guard("credentials");
    const employeeId = credentialAction[1];
    const action = credentialAction[2];
    if (action === "consent") {
      guard("face");
      await recordConsent(env.DB, user.company_id, employeeId);
      return redirect("/app/face");
    }
    if (action === "pin") {
      const form = await request.formData();
      await issuePin(env.DB, user.company_id, employeeId, form.get("pin"));
      return redirect(`/app/employees/${employeeId}`);
    }
    const issued = await issueCredential(env.DB, user.company_id, employeeId, action);
    const link = `${url.origin}/t/${issued.token}`;
    const employee = await employeeInCompany(env.DB, user.company_id, employeeId);
    return employeeView(env, user, employee, {
      issued: { id: issued.id, method: action, url: link, png: action === "qr" ? await qrPng(link) : "" },
    });
  }

  const faceDelete = path.match(/^\/app\/employees\/([^/]+)\/face\/delete$/);
  if (faceDelete && request.method === "POST") {
    guard("face");
    await deleteFace(env.DB, user.company_id, faceDelete[1]);
    return redirect(`/app/employees/${faceDelete[1]}`);
  }
  const payMatch = path.match(/^\/app\/employees\/([^/]+)\/pay$/);
  if (payMatch && request.method === "POST") {
    guard("settings");
    if (!hasFeature(await subscriptionFor(env.DB, user.company_id), "payroll")) throw httpError("Payroll is not included on this subscription.", 402, "plan_feature");
    await saveEmployeePay(env.DB, user.company_id, payMatch[1], Object.fromEntries(await request.formData()));
    return redirect(`/app/employees/${payMatch[1]}`);
  }

  const faceMatch = path.match(/^\/app\/employees\/([^/]+)\/face$/);
  if (faceMatch && request.method === "POST") {
    guard("face");
    const body = await request.json();
    await saveFaceTemplate(env.DB, user.company_id, faceMatch[1], body.samples);
    return json({ ok: true });
  }

  const photoMatch = path.match(/^\/app\/employees\/([^/]+)\/photo$/);
  if (photoMatch && request.method === "POST") {
    guard("employees");
    await savePhoto(env.DB, env.FILES, user.company_id, photoMatch[1], (await request.formData()).get("photo"));
    return redirect(`/app/employees/${photoMatch[1]}`);
  }
  if (photoMatch) {
    const employee = await employeeInCompany(env.DB, user.company_id, photoMatch[1]);
    if (!employee?.photo_key) throw httpError("No photograph is saved.", 404, "photo_missing");
    const object = await env.FILES.get(employee.photo_key);
    if (!object) throw httpError("No photograph is saved.", 404, "photo_missing");
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "image/jpeg", "cache-control": "private, max-age=60" } });
  }

  const employeeMatch = path.match(/^\/app\/employees\/([^/]+)$/);
  if (employeeMatch) {
    const employee = await employeeInCompany(env.DB, user.company_id, employeeMatch[1]);
    if (!employee) throw httpError("That employee is not in this company.", 404, "employee_missing");
    return employeeView(env, user, employee, { added: url.searchParams.get("added") === "1" });
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
        await createStation(env.DB, user.company_id, form.get("name"), form.get("location"));
        return redirect("/app/stations");
      } catch (error) {
        if (!error.status) throw error;
        return html(stationsPage({ user, stations: await listStations(env.DB, user.company_id), origin: url.origin, error: error.message }), error.status);
      }
    }
    return html(stationsPage({ user, stations: await listStations(env.DB, user.company_id), origin: url.origin }));
  }

  const stationMatch = path.match(/^\/app\/stations\/([^/]+)$/);
  if (stationMatch) {
    guard("stations");
    const station = (await listStations(env.DB, user.company_id)).find((item) => item.id === stationMatch[1]);
    if (!station) throw httpError("That station is not in this company.", 404, "station_missing");
    if (request.method === "POST") {
      await updateStation(env.DB, user.company_id, station.id, Object.fromEntries(await request.formData()));
      return redirect(`/app/stations/${station.id}`);
    }
    return html(stationPreview({ user, station, origin: url.origin }));
  }

  if (path === "/app/access") {
    guard("credentials");
    return html(accessPage({ user, credentials: await listCredentials(env.DB, user.company_id) }));
  }
  const revoke = path.match(/^\/app\/credentials\/([^/]+)\/revoke$/);
  if (revoke && request.method === "POST") {
    guard("credentials");
    await revokeCredential(env.DB, user.company_id, revoke[1]);
    return redirect("/app/access");
  }
  const confirm = path.match(/^\/app\/credentials\/([^/]+)\/confirm$/);
  if (confirm && request.method === "POST") {
    guard("credentials");
    await confirmCredential(env.DB, user.company_id, confirm[1]);
    return redirect("/app/access");
  }
  if (path === "/app/face") {
    guard("face");
    return html(facePage({ user, people: await consentRows(env.DB, user.company_id) }));
  }
  if (path === "/app/attendance") {
    guard("attendance");
    return html(attendancePage({ user, board: await todayBoard() }));
  }
  if (path === "/app/shifts") {
    guard("shifts");
    if (request.method === "POST") {
      await saveCompany(env.DB, user.company_id, { companyName: user.company_name, defaultStart: (await request.formData()).get("defaultStart"), timezone: user.timezone, address: user.address, phone: user.contact_phone });
      return redirect("/app/shifts");
    }
    return html(shiftsPage({ user, start: user.default_start || "08:00" }));
  }
  if (path === "/app/leave") {
    guard("leave");
    if (request.method === "POST") {
      try {
        await createLeave(env.DB, user.company_id, Object.fromEntries(await request.formData()));
        return redirect("/app/leave");
      } catch (error) {
        if (!error.status) throw error;
        const listed = await listEmployees(env.DB, user.company_id, 0);
        return html(leavePage({ user, leave: await listLeave(env.DB, user.company_id), employees: listed.employees, error: error.message }), error.status);
      }
    }
    const listed = await listEmployees(env.DB, user.company_id, 0);
    return html(leavePage({ user, leave: await listLeave(env.DB, user.company_id), employees: listed.employees }));
  }
  if (path === "/app/reports" || path.startsWith("/app/reports/")) {
    guard("reports");
    const subscription = await subscriptionFor(env.DB, user.company_id);
    const requested = url.searchParams.get("month") || local.workDate.slice(0, 7);
    if (!hasFeature(subscription, "reports")) return html(reportsPage({ user, locked: true, month: requested, report: { rows: [], policy: {}, status: "estimated" } }));
    if (path === "/app/reports/policy" && request.method === "POST") {
      guard("settings");
      if (!hasFeature(subscription, "payroll")) throw httpError("Payroll is not included on this subscription.", 402, "plan_feature");
      const form = Object.fromEntries(await request.formData());
      await savePayPolicy(env.DB, user.company_id, form);
      return redirect("/app/reports");
    }
    if (path === "/app/reports/finalise" && request.method === "POST") {
      guard("settings");
      const form = await request.formData();
      await finalisePayroll(env.DB, user.company_id, String(form.get("month") || requested), user.timezone);
      return redirect(`/app/reports?month=${encodeURIComponent(String(form.get("month") || requested))}`);
    }
    const report = await monthlyReport(env.DB, user.company_id, requested, user.timezone);
    if (path === "/app/reports/export.csv") {
      return new Response(reportCsv(report), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="attendance-${requested}.csv"` } });
    }
    if (path === "/app/reports/export.pdf") {
      return new Response(reportPdf(report), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="attendance-${requested}.pdf"` } });
    }
    return html(reportsPage({ user, report, month: requested }));
  }
  if (path === "/app/billing" || path === "/app/subscription") {
    guard("billing");
    const listed = await listEmployees(env.DB, user.company_id, 0);
    return html(billingPage({ user, subscription: await subscriptionFor(env.DB, user.company_id), used: listed.total }));
  }
  if (path === "/app/settings" || path === "/app/team") {
    guard("settings");
    if (request.method === "POST" && path === "/app/settings") {
      await saveCompany(env.DB, user.company_id, Object.fromEntries(await request.formData()));
      return redirect("/app/settings");
    }
    return html(settingsPage({ user: await currentUser(env.DB, await readSession(request, env.SESSION_SECRET)), team: await listTeam(env.DB, user.company_id) }));
  }
  if (path === "/app/settings/team" && request.method === "POST") {
    guard("settings");
    const form = await request.formData();
    try {
      await inviteUser(env.DB, user, Object.fromEntries(form));
      return redirect("/app/settings");
    } catch (error) {
      if (!error.status) throw error;
      return html(settingsPage({ user, team: await listTeam(env.DB, user.company_id), error: error.message }), error.status);
    }
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
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
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
  if (body.method === "qr") {
    if (!body.pin) throw httpError("Enter the employee PIN. A QR pass does not record attendance by itself.", 401, "pin_required");
    const pinCheck = await resolveEmployee(env.DB, {
      method: "pin",
      stationId: body.stationId,
      employeeId: resolved.employee.id,
      pin: body.pin,
    });
    if (pinCheck.employee.id !== resolved.employee.id) throw httpError("That PIN does not match this pass.", 401, "pin_rejected");
  }
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
  const challenge = await challengeStatus(env.DB, token);
  if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.now()) {
    return html(phonePage({ title: "Code expired", body: "Choose your name on the station and scan a new code." }), 410);
  }
  const employee = await env.DB.prepare("SELECT first_name, employee_number FROM employees WHERE id = ? AND company_id = ?").bind(challenge.employee_id, challenge.company_id).first();
  const station = await env.DB.prepare("SELECT companies.timezone FROM stations JOIN companies ON companies.id = stations.company_id WHERE stations.id = ?").bind(challenge.station_id).first();
  const latest = await latestEvent(env.DB, challenge.employee_id, challenge.company_id);
  const action = latest?.event_type === "CLOCK_IN" ? "CLOCK_OUT" : "CLOCK_IN";
  if (request.method === "POST") {
    const form = await request.formData();
    try {
      const resolved = await resolveEmployee(env.DB, {
        method: "pin",
        stationId: challenge.station_id,
        employeeNumber: employee?.employee_number,
        pin: form.get("pin"),
      });
      const now = zonedNow(new Date(), station?.timezone || "Africa/Johannesburg");
      await recordAttendance(env.DB, {
        employee: resolved.employee,
        station: resolved.station,
        method: "qr",
        action,
        token,
        now: { iso: new Date().toISOString(), workDate: now.workDate },
      });
      const verb = action === "CLOCK_OUT" ? "Clock-out recorded" : "Clock-in recorded";
      return html(phonePage({ title: verb, body: `${resolved.employee.first_name}, your attendance is recorded. You can put the phone away.` }));
    } catch (error) {
      if (!error.status) throw error;
      return html(phoneConfirmPage({ name: employee?.first_name ?? "there", action, token, error: error.message }), error.status);
    }
  }
  return html(phoneConfirmPage({ name: employee?.first_name ?? "there", action, token }));
}

async function employeeView(env, user, employee, extra = {}) {
  const history = (await employeeAttendance(env.DB, user.company_id, employee.id)).map((event) => ({
    ...event,
    timeLabel: zonedNow(new Date(event.occurred_at), user.timezone).timeLabel,
  }));
  return html(employeePage({
    user,
    employee,
    credentials: await listCredentials(env.DB, user.company_id, employee.id),
    history,
    faceReady: await employeeHasFace(env.DB, user.company_id, employee.id),
    ...extra,
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

async function qrPng(text) {
  const result = encode(text, { ecc: "M" });
  const scale = 10;
  const quiet = 4;
  const modules = result.size + quiet * 2;
  const size = modules * scale;
  const raw = new Uint8Array((size + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = Math.floor(y / scale) - quiet;
    raw[y * (size + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const col = Math.floor(x / scale) - quiet;
      const dark = row >= 0 && col >= 0 && row < result.size && col < result.size && result.data[row][col];
      raw[y * (size + 1) + 1 + x] = dark ? 0 : 255;
    }
  }
  const zipped = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8;
  const png = concatBytes([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", zipped), pngChunk("IEND", new Uint8Array())]);
  let binary = "";
  for (const byte of png) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

function pngChunk(type, data) {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(body, 4);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(body));
  return out;
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function redirect(location, cookie) {
  const headers = new Headers({ location });
  for (const item of [].concat(cookie || [])) headers.append("set-cookie", item);
  return new Response(null, { status: 303, headers });
}

function timed(response, started) {
  response.headers.set("server-timing", `app;dur=${Math.round(performance.now() - started)}`);
  return response;
}

function escapeText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
