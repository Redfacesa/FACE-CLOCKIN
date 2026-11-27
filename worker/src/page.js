import { faceCapture } from "./faceui.js";

export function kioskPage(code) {
  const stationCode = String(code).replace(/[^a-zA-Z0-9_-]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clock in</title>
  <style>
    :root { color-scheme: dark; --red:#9f1d2d; --muted:#a3a3a3; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:#101010; color:#f5f5f5; font-family:"Avenir Next","Segoe UI",sans-serif; }
    main { max-width:720px; margin:0 auto; padding:36px 22px 48px; }
    .mark { letter-spacing:.22em; font-size:13px; margin:0; }
    .sub { letter-spacing:.28em; color:var(--red); font-size:12px; }
    h1 { font-size:clamp(48px, 8vw, 84px); line-height:.9; margin:18px 0 0; font-weight:560; letter-spacing:-.04em; }
    .time { font-size:clamp(56px, 10vw, 96px); margin:12px 0; letter-spacing:-.05em; }
    .muted { color:var(--muted); }
    .actions { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:28px; }
    .people { display:grid; gap:8px; } .people button span { color:#a3a3a3; }
    button { font:inherit; color:inherit; background:#1c1c1c; border:1px solid #2c2c2c; border-radius:18px; padding:22px; text-align:left; }
    button strong { display:block; font-size:22px; }
    button.primary { background:var(--red); border-color:transparent; }
    .panel { margin-top:18px; } .hidden { display:none; }
    .foot { margin-top:36px; color:var(--muted); letter-spacing:.08em; font-size:13px; }
    input { width:100%; font:inherit; padding:12px; border-radius:12px; border:1px solid #2c2c2c; background:#111; color:white; }
    .error { color:#f0c2c6; }
  </style>
</head>
<body>
  <main>
    <p class="mark">REDFACE</p>
    <p class="sub">WORKFORCE</p>
    <section id="home">
      <p class="muted" id="mode">CLOCK IN</p>
      <p class="muted" id="online">Station online</p>
      <div class="time" id="clock">--:--</div>
      <p id="date">—</p>
      <p>Scan your face or tap your NFC card.</p>
      <div class="actions">
        <button class="primary" id="nfc" type="button"><strong>NFC card</strong><span>Tap a card or an NFC phone</span></button>
        <button id="qr" type="button"><strong>QR code</strong><span>Choose your name, then scan</span></button>
        <button id="face" type="button"><strong>Face</strong><span>Blink once at the camera</span></button>
        <button id="pin" type="button"><strong>Employee number</strong><span>Number and personal PIN</span></button>
      </div>
      <p class="error" id="home-error"></p>
    </section>
    <section id="flow" class="panel hidden"></section>
    <section id="face-panel" class="panel hidden">${faceCapture({
      heading: "Face",
      detail: "Blink once. The station matches the live face to a registered employee, then asks you to confirm.",
      mode: "identify",
      postUrl: "/api/identify",
    })}<p><button id="face-back" type="button">Back</button></p></section>
    <p class="foot">Powered by Red Face Workforce · © Red Face (Pty) Ltd</p>
  </main>
  <script>
    const stationCode = "${stationCode}";
    const state = { station: null, zone: "Africa/Johannesburg" };
    const home = document.querySelector("#home");
    const flow = document.querySelector("#flow");

    const facePanel = document.querySelector("#face-panel");
    function showHome() { flow.classList.add("hidden"); facePanel.classList.add("hidden"); home.classList.remove("hidden"); }
    function showFlow(html) { home.classList.add("hidden"); facePanel.classList.add("hidden"); flow.classList.remove("hidden"); flow.innerHTML = html; }

    async function api(path, body) {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The station could not verify that.");
      return payload;
    }

    function tick() {
      const now = new Date();
      document.querySelector("#clock").textContent = new Intl.DateTimeFormat("en-ZA", { timeZone: state.zone, hour: "2-digit", minute: "2-digit" }).format(now);
      document.querySelector("#date").textContent = new Intl.DateTimeFormat("en-ZA", { timeZone: state.zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now).toUpperCase();
    }

    function present(proof) {
      return async function finish() {
        const identified = await api("/api/identify", proofBody(proof));
        const leaving = identified.suggestedAction === "CLOCK_OUT";
        const verb = leaving ? "clocking out" : "clocking in";
        showFlow('<h1>Are you ' + verb + ', ' + identified.employee.firstName + '?</h1><p><button class="primary" id="yes" type="button">Confirm</button> <button id="back" type="button">Not now</button></p><p class="error" id="err"></p>');
        document.querySelector("#back").onclick = showHome;
        document.querySelector("#yes").onclick = async () => {
          try { render(await api("/api/clock", { ...proofBody(proof), action: identified.suggestedAction })); }
          catch (error) { document.querySelector("#err").textContent = error.message; }
        };
      };
    }

    function proofBody(proof) {
      return { method: proof.method, stationId: state.station.id, token: proof.token, cardUid: proof.cardUid, employeeNumber: proof.employeeNumber, pin: proof.pin, descriptor: proof.descriptor };
    }

    function render(result) {
      const verb = result.eventType === "CLOCK_IN" ? "Clock-in successful" : "Clock-out successful";
      showFlow('<p class="muted">' + verb + '</p><div class="time">' + result.timeLabel + '</div><h1>Welcome back, ' + result.employee.firstName + '.</h1><p>Attendance recorded</p><p><button class="primary" id="done" type="button">Done</button></p>');
      document.querySelector("#done").onclick = showHome;
    }

    async function startNfc() {
      showFlow('<h1>Tap NFC card</h1><p id="nfc-state">Hold the card on the reader.</p><p class="error" id="err"></p><p><button id="back" type="button">Back</button></p>');
      document.querySelector("#back").onclick = showHome;
      if (!("NDEFReader" in window)) { document.querySelector("#nfc-state").textContent = "This station has no NFC reader."; return; }
      try {
        const reader = new NDEFReader();
        await reader.scan();
        reader.onreading = async (event) => {
          const record = [...event.message.records].find((item) => item.recordType === "url" || item.recordType === "text");
          let token = "";
          if (record && record.recordType === "url") token = new TextDecoder().decode(record.data);
          if (record && record.recordType === "text") token = new TextDecoder(record.encoding || "utf-8").decode(record.data);
          token = token || event.serialNumber || "";
          try { await present({ method: "nfc", token, cardUid: token })(); }
          catch (error) { document.querySelector("#err").textContent = error.message; }
        };
      } catch (error) { document.querySelector("#err").textContent = error.message; }
    }

    async function startQr() {
      const response = await fetch("/api/kiosk/people?code=" + encodeURIComponent(stationCode));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The employee list is unavailable.");
      const esc = (value) => String(value ?? "").replace(/[&<>]/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;");
      const buttons = payload.people.map((person) => '<button type="button" data-id="' + esc(person.id) + '"><strong>' + esc(person.firstName) + " " + esc(person.lastName) + "</strong><span>" + esc(person.employeeNumber) + "</span></button>").join("");
      showFlow('<h1>QR code</h1><p>Choose your name. Scan the code with your phone and enter your PIN there.</p><div class="people">' + buttons + '</div><p><button id="back" type="button">Back</button></p><p class="error" id="err"></p>');
      document.querySelector("#back").onclick = showHome;
      document.querySelectorAll("[data-id]").forEach((button) => {
        button.onclick = async () => {
          try {
            const issued = await api("/api/qr", { employeeId: button.dataset.id, stationId: state.station.id });
            showFlow('<h1>Scan this code</h1>' + issued.svg + '<p>On your phone, confirm clock-in and enter your PIN.</p><p><button id="back" type="button">Back</button></p>');
            document.querySelector("#back").onclick = showHome;
          } catch (error) { document.querySelector("#err").textContent = error.message; }
        };
      });
    }

    function startFace() {
      home.classList.add("hidden");
      flow.classList.add("hidden");
      facePanel.classList.remove("hidden");
    }

    function startPin() {
      showFlow('<h1>PIN</h1><form id="pin-form"><label>Employee number<input name="employeeNumber" required></label><label>PIN<input name="pin" inputmode="numeric" required></label><p><button class="primary" type="submit">Verify</button> <button id="back" type="button">Back</button></p><p class="error" id="err"></p></form>');
      document.querySelector("#back").onclick = showHome;
      document.querySelector("#pin-form").onsubmit = async (event) => {
        event.preventDefault();
        const data = new FormData(event.target);
        try { await present({ method: "pin", employeeNumber: data.get("employeeNumber"), pin: data.get("pin") })(); }
        catch (error) { document.querySelector("#err").textContent = error.message; }
      };
    }

    async function boot() {
      const response = await fetch("/api/kiosk?code=" + encodeURIComponent(stationCode));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Station unavailable");
      state.station = payload.station;
      state.zone = payload.station.timezone || state.zone;
      document.querySelector("#online").textContent = "Station online · " + payload.station.name;
      tick();
      setInterval(tick, 1000);
      window.faceRequest = () => ({ stationId: state.station.id });
      window.onFaceIdentified = (payload, descriptor) => {
        facePanel.classList.add("hidden");
        const leaving = payload.suggestedAction === "CLOCK_OUT";
        showFlow('<h1>Are you ' + (leaving ? "clocking out" : "clocking in") + ', ' + payload.employee.firstName + '?</h1><p><button class="primary" id="yes" type="button">Confirm</button> <button id="back" type="button">Not now</button></p><p class="error" id="err"></p>');
        document.querySelector("#back").onclick = showHome;
        document.querySelector("#yes").onclick = async () => {
          try { render(await api("/api/clock", { method: "face", stationId: state.station.id, descriptor, action: payload.suggestedAction })); }
          catch (error) { document.querySelector("#err").textContent = error.message; }
        };
      };
      document.querySelector("#face-back").onclick = showHome;
      document.querySelector("#nfc").onclick = startNfc;
      document.querySelector("#qr").onclick = () => startQr().catch((error) => { document.querySelector("#home-error").textContent = error.message; });
      document.querySelector("#face").onclick = startFace;
      document.querySelector("#pin").onclick = startPin;
    }
    boot().catch((error) => { document.querySelector("#home-error").textContent = error.message; });
  </script>
</body>
</html>`;
}

export function phoneConfirmPage({ name, action, token, error = "" }) {
  const verb = action === "CLOCK_OUT" ? "clocking out" : "clocking in";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirm attendance</title></head><body style="font-family:sans-serif;background:#141414;color:white"><main style="max-width:420px;margin:40px auto;padding:0 16px"><p style="letter-spacing:.2em">REDFACE</p><h1>Are you ${verb}, ${escapeHtml(name)}?</h1><p>Enter your PIN. This confirms the clocking is yours.</p>${error ? `<p style="color:#f0c2c6">${escapeHtml(error)}</p>` : ""}<form method="post"><input type="hidden" name="action" value="${escapeHtml(action)}"><label>PIN<br><input name="pin" inputmode="numeric" required minlength="4" maxlength="6" style="font:inherit;padding:12px;width:100%;margin:8px 0"></label><p><button type="submit" style="background:#9f1d2d;color:white;border:0;border-radius:999px;padding:12px 16px;font:inherit">Confirm</button></p></form><p style="color:#a3a3a3">© Red Face (Pty) Ltd</p></main></body></html>`;
}

export function phonePage({ title, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:sans-serif;background:#141414;color:white"><main style="max-width:420px;margin:40px auto"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
