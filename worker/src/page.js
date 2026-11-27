export function kioskPage(code) {
  const stationCode = String(code).replace(/[^a-zA-Z0-9_-]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clocking station</title>
  <style>
    :root { color-scheme: light; --ink:#1c1915; --muted:#6d645b; --line:#e6dfd4; --paper:#f6f3ee; --card:#fffdf9; --accent:#0f6e56; --accent-ink:#fff; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; font-family: "Avenir Next", "Segoe UI", sans-serif; background: radial-gradient(1200px 500px at 10% -10%, #efe7d8, transparent), var(--paper); color: var(--ink); }
    main { max-width: 1100px; margin: 0 auto; padding: 28px 22px 40px; }
    .top { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; }
    .brand { font-size: 15px; letter-spacing:.04em; text-transform:uppercase; color: var(--muted); }
    .status { display:flex; align-items:center; gap:8px; color: var(--accent); font-weight: 650; }
    .status i { width:9px; height:9px; border-radius:99px; background: var(--accent); display:block; }
    h1 { font-size: clamp(40px, 6vw, 68px); line-height:.95; margin: 18px 0 8px; font-weight: 700; letter-spacing:-.04em; }
    .lead { margin:0 0 22px; color: var(--muted); font-size: 18px; }
    .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
    button.person, button.method, button.action { font: inherit; border:1px solid var(--line); background: var(--card); color: inherit; text-align:left; border-radius: 18px; cursor:pointer; }
    button.person { padding: 16px; display:flex; gap:12px; align-items:center; }
    button.person.selected { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(15,110,86,.15); }
    .avatar { width:52px; height:52px; border-radius:50%; display:grid; place-items:center; font-weight:750; color:#fff; flex:none; }
    .person strong { display:block; font-size:18px; }
    .person span { color: var(--muted); }
    .or { margin: 28px 0 12px; color: var(--muted); }
    .methods { display:grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    button.method { padding: 16px; min-height: 92px; }
    button.method b { display:block; font-size: 16px; margin-top: 6px; }
    button.method small { color: var(--muted); }
    .panel { margin-top: 18px; background: var(--card); border:1px solid var(--line); border-radius: 24px; padding: 22px; }
    .hidden { display:none; }
    .keys { display:grid; grid-template-columns: repeat(3, 72px); gap: 8px; margin-top: 14px; }
    .keys button, button.action { min-height: 56px; border-radius: 14px; font-size: 20px; font-weight: 700; }
    button.action { background: var(--accent); color: var(--accent-ink); border-color: transparent; padding: 0 18px; }
    button.ghost { background: transparent; }
    .dots { letter-spacing:.4em; font-size: 28px; min-height: 36px; }
    .qr { width: min(280px, 70vw); height: auto; background:#fff; border-radius: 12px; }
    .confirm h2 { font-size: clamp(36px, 5vw, 56px); margin: 0 0 4px; letter-spacing:-.04em; }
    .time { font-size: clamp(42px, 6vw, 72px); margin: 8px 0; letter-spacing:-.04em; }
    .meta { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 18px; }
    .meta div { background: var(--paper); border-radius: 14px; padding: 12px 14px; }
    .meta small { color: var(--muted); display:block; }
    .error { color:#8d2b2b; }
    input.card { width: min(320px, 100%); font: inherit; font-size: 18px; padding: 12px 14px; border-radius: 12px; border:1px solid var(--line); }
    @media (max-width: 800px) { .methods { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div class="brand" id="business">Clocking station</div>
      <div class="status"><i></i><span id="station-status">Station online</span></div>
    </div>
    <section id="home">
      <h1 id="greeting">Good morning!</h1>
      <p class="lead">Select your employee profile to continue.</p>
      <div class="grid" id="people"></div>
      <p class="or">Or authenticate directly</p>
      <div class="methods">
        <button class="method" data-method="nfc"><small>Card</small><b>Tap NFC card</b></button>
        <button class="method" data-method="face"><small>Camera</small><b>Face recognition</b></button>
        <button class="method" data-method="qr"><small>Phone</small><b>Scan QR code</b></button>
        <button class="method" data-method="pin"><small>Keypad</small><b>Enter PIN</b></button>
      </div>
      <p class="error" id="home-error"></p>
    </section>
    <section id="flow" class="panel hidden"></section>
  </main>
  <script>
    const stationCode = "${stationCode}";
    const state = { selected: null, snapshot: null, pin: "" };
    const home = document.querySelector("#home");
    const flow = document.querySelector("#flow");
    const colors = ["#0f6e56", "#2457c5", "#9a4d12", "#6d3fae", "#0e7490", "#9f1239"];

    function showHome() {
      flow.classList.add("hidden");
      home.classList.remove("hidden");
      state.pin = "";
    }

    function showFlow(html) {
      home.classList.add("hidden");
      flow.classList.remove("hidden");
      flow.innerHTML = html;
    }

    async function api(path, body) {
      const response = await fetch(path, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The station could not complete that.");
      return payload;
    }

    function selectedEmployee() {
      return state.snapshot.employees.find((person) => person.id === state.selected) || null;
    }

    async function finish(method, extra) {
      const identified = await api("/api/identify", { method, stationId: state.snapshot.station.id, ...extra });
      if (identified.suggestedAction === "CLOCK_IN") {
        const recorded = await api("/api/clock", { method, stationId: state.snapshot.station.id, action: "CLOCK_IN", ...extra });
        renderResult(recorded);
        return;
      }
      renderOffer(identified, method, extra);
    }

    function renderResult(recorded) {
      const person = recorded.employee;
      showFlow(
        '<div class="confirm"><p class="brand">Attendance confirmation</p><h2>Welcome, ' + person.firstName + '!</h2><p>' +
        (recorded.eventType === "CLOCK_IN" ? "Clock-in successful" : "Clock-out successful") +
        '</p><div class="time">' + recorded.timeLabel + '</div><div class="meta"><div><small>Workplace</small><strong>' +
        recorded.businessName + " · " + person.roleTitle + '</strong></div><div><small>Employee</small><strong>' +
        person.firstName + " " + person.lastName + '</strong></div><div><small>Verification</small><strong>' +
        recorded.methodLabel + '</strong></div><div><small>Date</small><strong>' + recorded.dateLabel +
        '</strong></div></div><p><button class="action" id="done" type="button">Done</button></p></div>'
      );
      document.querySelector("#done").onclick = showHome;
    }

    function renderOffer(identified, method, extra) {
      const person = identified.employee;
      showFlow(
        '<div class="confirm"><h2>' + person.firstName + ' is clocked in</h2><p>Since ' + identified.sinceLabel +
        '. Clock out now?</p><p><button class="action" id="out" type="button">Clock out</button> <button class="method ghost" id="back" type="button">Not now</button></p><p class="error" id="flow-error"></p></div>'
      );
      document.querySelector("#back").onclick = showHome;
      document.querySelector("#out").onclick = async () => {
        try {
          const recorded = await api("/api/clock", { method, stationId: state.snapshot.station.id, action: "CLOCK_OUT", ...extra });
          renderResult(recorded);
        } catch (error) {
          document.querySelector("#flow-error").textContent = error.message;
        }
      };
    }

    function startPin() {
      const person = selectedEmployee();
      if (!person) return needProfile();
      const draw = () => {
        showFlow(
          '<h2>' + person.firstName + '</h2><p>Enter your personal PIN.</p><div class="dots">' +
          "•".repeat(state.pin.length) + '</div><div class="keys" id="keys"></div><p><button class="method ghost" id="back" type="button">Back</button></p><p class="error" id="flow-error"></p>'
        );
        const keys = document.querySelector("#keys");
        ["1","2","3","4","5","6","7","8","9","Clear","0","OK"].forEach((label) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.className = label === "OK" ? "action" : "";
          button.onclick = async () => {
            if (label === "Clear") state.pin = "";
            else if (label === "OK") {
              try {
                await finish("pin", { employeeId: person.id, pin: state.pin });
              } catch (error) {
                state.pin = "";
                draw();
                document.querySelector("#flow-error").textContent = error.message;
              }
              return;
            } else if (state.pin.length < 6) state.pin += label;
            draw();
          };
          keys.appendChild(button);
        });
        document.querySelector("#back").onclick = showHome;
      };
      state.pin = "";
      draw();
    }

    async function startQr() {
      const person = selectedEmployee();
      if (!person) return needProfile();
      showFlow("<h2>" + person.firstName + "</h2><p>Scan this code with your registered phone. It expires in 60 seconds and works once.</p>");
      try {
        const challenge = await api("/api/qr", { stationId: state.snapshot.station.id, employeeId: person.id });
        flow.innerHTML += challenge.svg;
        flow.innerHTML += '<p class="error" id="flow-error"></p><p><button class="method ghost" id="back" type="button">Cancel</button></p>';
        document.querySelector("#back").onclick = () => { challenge.cancelled = true; showHome(); };
        const timer = setInterval(async () => {
          if (challenge.cancelled) return clearInterval(timer);
          try {
            const status = await api("/api/qr/" + challenge.token);
            if (status.status === "confirmed") {
              clearInterval(timer);
              await finish("qr", { token: challenge.token });
            } else if (status.status !== "pending") {
              clearInterval(timer);
              document.querySelector("#flow-error").textContent = "That code expired. Choose your profile again.";
            }
          } catch (error) {
            clearInterval(timer);
            document.querySelector("#flow-error").textContent = error.message;
          }
        }, 1000);
      } catch (error) {
        flow.innerHTML += '<p class="error">' + error.message + '</p>';
      }
    }

    function startNfc() {
      showFlow('<h2>Tap NFC card</h2><p>Hold the card against the tablet.</p><p id="nfc-state">Waiting for a card…</p><form id="card-form"><input class="card" name="uid" placeholder="Card number" autocomplete="off"><p><button class="action" type="submit">Verify card</button> <button class="method ghost" id="back" type="button">Back</button></p></form><p class="error" id="flow-error"></p>');
      document.querySelector("#back").onclick = showHome;
      document.querySelector("#card-form").onsubmit = async (event) => {
        event.preventDefault();
        try {
          await finish("nfc", { cardUid: new FormData(event.target).get("uid") });
        } catch (error) {
          document.querySelector("#flow-error").textContent = error.message;
        }
      };
      if ("NDEFReader" in window) {
        const reader = new NDEFReader();
        reader.scan().then(() => {
          document.querySelector("#nfc-state").textContent = "Reader ready.";
          reader.onreading = async (event) => {
            const cardUid = event.serialNumber || textRecord(event);
            if (!cardUid) return;
            try { await finish("nfc", { cardUid }); }
            catch (error) { document.querySelector("#flow-error").textContent = error.message; }
          };
        }).catch(() => {
          document.querySelector("#nfc-state").textContent = "This browser has no NFC reader. Enter the card number.";
        });
      } else {
        document.querySelector("#nfc-state").textContent = "This browser has no NFC reader. Enter the card number.";
      }
    }

    function textRecord(event) {
      for (const record of event.message.records || []) {
        if (record.recordType === "text") return new TextDecoder(record.encoding || "utf-8").decode(record.data);
      }
      return "";
    }

    function startFace() {
      showFlow('<h2>Face recognition</h2><p>Stand in front of the station camera. The match uses the same attendance record as a card, PIN, or QR code.</p><p class="error">No face is enrolled for this station yet, and the camera verifier is not connected.</p><p><button class="method ghost" id="back" type="button">Back</button></p>');
      document.querySelector("#back").onclick = showHome;
    }

    function needProfile() {
      document.querySelector("#home-error").textContent = "Select your employee profile first.";
    }

    async function boot() {
      const query = "?code=" + encodeURIComponent(stationCode);
      state.snapshot = await api("/api/kiosk" + query);
      document.querySelector("#business").textContent = state.snapshot.station.businessName;
      document.querySelector("#greeting").textContent = state.snapshot.greeting + "!";
      document.querySelector("#station-status").textContent = "Clocking station " + state.snapshot.station.status;
      const people = document.querySelector("#people");
      state.snapshot.employees.forEach((person, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "person";
        button.innerHTML = '<span class="avatar" style="background:' + colors[index % colors.length] + '">' + person.initials + '</span><span><strong>' + person.firstName + '</strong><span>' + person.roleTitle + '</span></span>';
        button.onclick = () => {
          state.selected = person.id;
          document.querySelectorAll(".person").forEach((item) => item.classList.remove("selected"));
          button.classList.add("selected");
          document.querySelector("#home-error").textContent = "";
        };
        people.appendChild(button);
      });
      document.querySelectorAll(".method").forEach((button) => {
        button.onclick = () => {
          const method = button.dataset.method;
          if (method === "pin") startPin();
          else if (method === "qr") startQr();
          else if (method === "nfc") startNfc();
          else startFace();
        };
      });
    }

    boot().catch((error) => {
      document.querySelector("#home-error").textContent = error.message;
    });
  </script>
</body>
</html>`;
}

export function phonePage({ title, body, token }) {
  const action = token
    ? `<form method="post" action="/v/${token}"><button type="submit">Confirm it is me</button></form>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin:0; font-family: "Avenir Next", "Segoe UI", sans-serif; background:#f6f3ee; color:#1c1915; }
    main { max-width: 420px; margin: 0 auto; padding: 48px 20px; }
    button { font: inherit; background:#0f6e56; color:white; border:0; border-radius:14px; padding:14px 18px; font-weight:700; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    ${action}
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
