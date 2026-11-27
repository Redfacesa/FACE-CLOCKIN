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
        <button class="primary" id="nfc" type="button"><strong>NFC card</strong><span>Tap the card on this station</span></button>
        <button id="qr" type="button"><strong>QR code</strong><span>Show the issued credential</span></button>
      </div>
      <p><button id="pin" type="button">Employee number and PIN</button></p>
      <p class="error" id="home-error"></p>
    </section>
    <section id="flow" class="panel hidden"></section>
    <p class="foot">Powered by Red Face Workforce</p>
  </main>
  <script>
    const stationCode = "${stationCode}";
    const state = { station: null, zone: "Africa/Johannesburg" };
    const home = document.querySelector("#home");
    const flow = document.querySelector("#flow");

    function showHome() { flow.classList.add("hidden"); home.classList.remove("hidden"); }
    function showFlow(html) { home.classList.add("hidden"); flow.classList.remove("hidden"); flow.innerHTML = html; }

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
      return async function finish(action) {
        const body = { ...proof, stationId: state.station.id, action };
        if (!action) {
          const identified = await api("/api/identify", proofBody(proof));
          if (identified.suggestedAction === "CLOCK_OUT") {
            showFlow('<h1>' + identified.employee.firstName + ' is clocked in</h1><p>Clock out now?</p><p><button class="primary" id="out" type="button">Clock out</button> <button id="back" type="button">Not now</button></p><p class="error" id="err"></p>');
            document.querySelector("#back").onclick = showHome;
            document.querySelector("#out").onclick = async () => { try { render(await api("/api/clock", { ...proofBody(proof), action: "CLOCK_OUT" })); } catch (error) { document.querySelector("#err").textContent = error.message; } };
            return;
          }
          render(await api("/api/clock", { ...proofBody(proof), action: "CLOCK_IN" }));
          return;
        }
        render(await api("/api/clock", body));
      };
    }

    function proofBody(proof) {
      return { method: proof.method, stationId: state.station.id, token: proof.token, cardUid: proof.cardUid, employeeNumber: proof.employeeNumber, pin: proof.pin };
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
      showFlow('<h1>Scan QR code</h1><video id="camera" autoplay playsinline style="width:100%;border-radius:16px"></video><p class="error" id="err"></p><p><button id="back" type="button">Back</button></p>');
      let stopped = false;
      let stream = null;
      const stop = () => { stopped = true; stream?.getTracks().forEach((track) => track.stop()); };
      document.querySelector("#back").onclick = () => { stop(); showHome(); };
      if (!("BarcodeDetector" in window)) { document.querySelector("#err").textContent = "This browser cannot scan a QR code."; return; }
      const video = document.querySelector("#camera");
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const loop = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) { stop(); await present({ method: "qr", token: codes[0].rawValue })(); return; }
        } catch (error) { document.querySelector("#err").textContent = error.message; }
        requestAnimationFrame(loop);
      };
      video.onloadeddata = loop;
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
      document.querySelector("#nfc").onclick = startNfc;
      document.querySelector("#qr").onclick = () => startQr().catch((error) => { document.querySelector("#home-error").textContent = error.message; });
      document.querySelector("#pin").onclick = startPin;
    }
    boot().catch((error) => { document.querySelector("#home-error").textContent = error.message; });
  </script>
</body>
</html>`;
}

export function phonePage({ title, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:sans-serif;background:#141414;color:white"><main style="max-width:420px;margin:40px auto"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
