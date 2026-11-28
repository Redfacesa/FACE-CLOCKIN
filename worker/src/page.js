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
    :root { color-scheme: dark; --red:#ff2a3a; --muted:#b7b1ab; --line:rgba(255,255,255,.12); }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; color:#f6f4f2; font-family:"Avenir Next","Segoe UI",sans-serif; background:
      radial-gradient(520px 180px at 0 0, rgba(255,42,58,.45), transparent 70%),
      radial-gradient(520px 180px at 100% 0, rgba(255,42,58,.28), transparent 72%),
      #070709; }
    main { max-width:1180px; margin:0 auto; padding:22px 22px 48px; }
    .term-bar { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:22px; }
    .brand { display:flex; gap:12px; align-items:center; }
    .r { width:42px; height:42px; display:grid; place-items:center; border-radius:12px; background:#ff2a3a; color:#fff; font-weight:700; box-shadow:0 0 18px rgba(255,42,58,.65); }
    .brand strong { display:block; letter-spacing:.14em; font-size:14px; }
    .brand em { color:#ff2a3a; font-style:normal; }
    .brand small, .foot { color:var(--muted); letter-spacing:.04em; }
    .term-meta { display:flex; align-items:center; gap:16px; }
    .ready { display:inline-flex; align-items:center; gap:8px; border:1px solid rgba(61,220,132,.45); border-radius:999px; padding:8px 12px; color:#d7ffea; font-size:13px; }
    .pulse { width:8px; height:8px; border-radius:50%; background:#3ddc84; box-shadow:0 0 12px #3ddc84; }
    .term-meta strong { display:block; font-size:18px; }
    .term-meta span { color:var(--muted); font-size:12px; }
    h1 { font-size:clamp(40px, 6vw, 72px); line-height:.92; margin:8px 0; font-weight:560; letter-spacing:-.045em; }
    .time { font-size:clamp(56px, 8vw, 84px); margin:0; letter-spacing:-.05em; }
    .muted { color:var(--muted); }
    .actions { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:22px; }
    button { font:inherit; color:inherit; background:rgba(255,255,255,.04); border:1px solid var(--line); border-radius:18px; padding:18px; text-align:left; min-height:84px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.03); }
    button span { color:var(--muted); display:block; margin-top:4px; }
    button strong { display:block; font-size:20px; }
    button.primary { background:linear-gradient(180deg,#ff3144,#9f1224); border-color:transparent; box-shadow:0 0 24px rgba(255,42,58,.4); }
    button.primary span { color:rgba(255,255,255,.82); }
    button.text, #face-back { background:transparent; border:1px solid rgba(255,42,58,.4); min-height:0; width:auto; border-radius:16px; padding:12px 16px; color:#fff; box-shadow:0 0 16px rgba(255,42,58,.2); }
    .panel { margin-top:8px; } .hidden { display:none; }
    video.qr-cam { width:100%; max-height:360px; border-radius:22px; background:#111; object-fit:cover; box-shadow:inset 0 0 0 2px #ff2a3a; }
    .foot { margin-top:28px; font-size:13px; }
    input { width:100%; font:inherit; padding:14px; border-radius:14px; border:1px solid var(--line); background:rgba(0,0,0,.35); color:white; }
    .error { color:#f0c2c6; }
    @media (max-width:800px) { main { padding:16px 12px 36px; } .term-bar, .term-meta { align-items:flex-start; } .term-bar { flex-direction:column; } .actions { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main>
    <header class="term-bar">
      <div class="brand"><span class="r">R</span><div><strong>TRY <em>CLOCK IN</em></strong><small>Powered by RedFace</small></div></div>
      <div class="term-meta"><p class="ready"><span class="pulse"></span> System ready</p><div><strong id="clock">--:--</strong><span id="date">—</span></div></div>
    </header>
    <section id="home">
      <p class="muted" id="online">Station online</p>
      <p>Look at the camera, tap a card, or scan your QR pass.</p>
      <div class="actions">
        <button class="primary" id="face" type="button"><strong>Face</strong><span>Look here</span></button>
        <button id="nfc" type="button"><strong>NFC</strong><span>Tap your card</span></button>
        <button id="qr" type="button"><strong>QR pass</strong><span>Scan, then PIN</span></button>
      </div>
      <p><button class="text" id="pin" type="button">Employee number and PIN</button></p>
      <p class="error" id="home-error"></p>
    </section>
    <section id="flow" class="panel hidden"></section>
    <section id="face-panel" class="panel hidden">${faceCapture({
      heading: "Scan your face",
      detail: "Look at the camera. Your face stays on screen while the landmarks follow your eyes, nose, mouth and jaw.",
      mode: "identify",
      postUrl: "/api/identify",
    })}<p><button id="face-back" type="button">Cancel</button></p></section>
    <p class="foot">RedFace · Secure, smart, seamless · © Red Face (Pty) Ltd</p>
  </main>
  <script>
    const stationCode = "${stationCode}";
    const state = { station: null, zone: "Africa/Johannesburg" };
    const home = document.querySelector("#home");
    const flow = document.querySelector("#flow");

    const facePanel = document.querySelector("#face-panel");
    function resetRecognition() { flow.innerHTML = ""; flow.classList.add("hidden"); }
    function showHome() { resetRecognition(); facePanel.classList.add("hidden"); home.classList.remove("hidden"); }
    function showFlow(html) { home.classList.add("hidden"); facePanel.classList.add("hidden"); flow.classList.remove("hidden"); flow.innerHTML = html; }
    function showFaceFailure(message) {
      const text = String(message || "Face not recognised.").replace(/[<>]/g, "");
      showFlow('<p class="muted">Recognition failed</p><h1>' + text + '</h1><p>Please try again or use another clocking method.</p><div class="actions"><button type="button" id="fail-nfc"><strong>NFC</strong><span>Tap a registered card</span></button><button type="button" id="fail-qr"><strong>QR pass</strong><span>Scan, then PIN</span></button><button type="button" id="fail-pin"><strong>PIN</strong><span>Number and personal PIN</span></button></div><p><button class="primary" type="button" id="fail-face">Try face again</button></p>');
      document.querySelector("#fail-qr").onclick = startQr;
      document.querySelector("#fail-nfc").onclick = startNfc;
      document.querySelector("#fail-pin").onclick = startPin;
      document.querySelector("#fail-face").onclick = startFace;
    }

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
      const leaving = result.eventType === "CLOCK_OUT";
      const verb = leaving ? "Clock-out successful" : "Clock-in successful";
      const greeting = leaving ? "See you soon, " : "Welcome back, ";
      const name = String(result.employee.firstName || "").replace(/[<>]/g, "");
      showFlow('<p class="muted">' + verb + '</p><div class="time">' + result.timeLabel + '</div><h1>' + greeting + name + '.</h1><p>Attendance recorded</p><p><button class="primary" id="done" type="button">Done</button></p>');
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

    function askQrPin(token, name) {
      const safe = String(name || "there").replace(/[<>]/g, "");
      showFlow('<p class="muted">QR identified</p><h1>' + safe + '</h1><p>The pass only identifies them. Enter their PIN to record attendance.</p><form id="qr-pin"><label>PIN<input name="pin" inputmode="numeric" required minlength="4" maxlength="6"></label><p><button class="primary" type="submit">Confirm punch</button> <button id="back" type="button">Back</button></p><p class="error" id="err"></p></form>');
      document.querySelector("#back").onclick = () => { stopQr(); showHome(); };
      document.querySelector("#qr-pin").onsubmit = async (event) => {
        event.preventDefault();
        const pin = new FormData(event.target).get("pin");
        try {
          const identified = await api("/api/identify", { method: "qr", stationId: state.station.id, token });
          render(await api("/api/clock", { method: "qr", stationId: state.station.id, token, pin, action: identified.suggestedAction }));
        } catch (error) { document.querySelector("#err").textContent = error.message; }
      };
    }

    let qrStream = null;
    function stopQr() {
      if (qrStream) qrStream.getTracks().forEach((track) => track.stop());
      qrStream = null;
    }

    async function startQr() {
      stopQr();
      showFlow('<p class="muted">QR pass</p><h1>Scan the employee pass</h1><p>Hold the personal QR in front of this camera. A screenshot still needs that employee’s PIN.</p><video class="qr-cam" id="qr-cam" autoplay muted playsinline></video><p id="qr-state"></p><p class="error" id="err"></p><p><button id="back" type="button">Back</button></p>');
      document.querySelector("#back").onclick = () => { stopQr(); showHome(); };
      const stateNode = document.querySelector("#qr-state");
      if (!("BarcodeDetector" in window)) {
        stateNode.textContent = "This browser cannot scan a QR code. Use Face, NFC, or PIN on this device.";
        return;
      }
      try {
        qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = document.querySelector("#qr-cam");
        video.srcObject = qrStream;
        const detector = new BarcodeDetector({ formats: ["qr_code"] });
        let busy = false;
        const loop = async () => {
          if (!qrStream || busy) return;
          busy = true;
          try {
            const codes = await detector.detect(video);
            const raw = codes[0]?.rawValue || "";
            if (raw) {
              stopQr();
              const identified = await api("/api/identify", { method: "qr", stationId: state.station.id, token: raw });
              askQrPin(raw, identified.employee.firstName);
              return;
            }
          } catch (error) {
            if (document.querySelector("#err")) document.querySelector("#err").textContent = error.message;
          }
          busy = false;
          if (qrStream) requestAnimationFrame(loop);
        };
        video.onloadedmetadata = () => loop();
      } catch (error) {
        stateNode.textContent = error.message;
      }
    }

    function startFace() {
      resetRecognition();
      home.classList.add("hidden");
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
      window.onFaceAttemptStart = () => { resetRecognition(); home.classList.add("hidden"); facePanel.classList.remove("hidden"); };
      window.onFaceRejected = (message) => { showFaceFailure(message); };
      window.onFaceIdentified = async (payload, descriptor) => {
        if (!payload?.employee?.firstName) { showFaceFailure("Face not recognised."); return; }
        try { render(await api("/api/clock", { method: "face", stationId: state.station.id, descriptor, action: payload.suggestedAction })); }
        catch (error) { showFaceFailure(error.message); }
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
