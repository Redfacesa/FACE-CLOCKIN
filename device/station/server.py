"""Local face station: detect, anti-spoof, match, and queue attendance events."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import request as urlrequest
from urllib.error import URLError

from station.crypto import cosine, decrypt_embedding, load_key
from station.pipeline import FacePipeline

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / ".station"
DB_PATH = DATA / "queue.sqlite"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Station:
    def __init__(self) -> None:
        DATA.mkdir(parents=True, exist_ok=True)
        self.api = os.environ.get("STATION_API_BASE", "http://127.0.0.1:3000").rstrip("/")
        self.secret = os.environ.get("STATION_DEVICE_SECRET", "")
        key = os.environ.get("BIOMETRIC_KEY", "")
        self.key = load_key(key) if key else None
        self.pipeline = FacePipeline(os.environ.get("ANTISPOOF_MODEL", str(ROOT / "models" / "antispoof.onnx")))
        self.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.db.execute(
            "create table if not exists outbox (id text primary key, payload text not null, synced integer not null default 0)"
        )
        self.db.execute("create table if not exists cache (id integer primary key check (id = 1), payload text not null)")
        self.db.commit()
        self.lock = threading.Lock()
        self.message = "Look at the camera, then choose an action."
        self.threshold = 0.4
        self.templates: list[dict] = []
        self.pins: list[dict] = []
        self._load_cache()

    def _load_cache(self) -> None:
        row = self.db.execute("select payload from cache where id = 1").fetchone()
        if not row or not self.key:
            return
        payload = json.loads(row[0])
        self.templates = payload.get("templates", [])
        self.pins = payload.get("pins", [])

    def _save_cache(self, payload: dict) -> None:
        self.db.execute(
            "insert into cache (id, payload) values (1, ?) on conflict(id) do update set payload = excluded.payload",
            (json.dumps(payload),),
        )
        self.db.commit()
        self.templates = payload.get("templates", [])
        self.pins = payload.get("pins", [])

    def headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self.secret}", "content-type": "application/json"}

    def sync_once(self) -> None:
        if not self.secret:
            self.message = "Set STATION_DEVICE_SECRET before this station can sync."
            return
        try:
            heartbeat = self._post("/api/devices/heartbeat", {})
            if "matchThreshold" in heartbeat:
                self.threshold = float(heartbeat["matchThreshold"])
            with urlrequest.urlopen(urlrequest.Request(self.api + "/api/devices/templates", headers=self.headers())) as response:
                payload = json.loads(response.read().decode())
            self._save_cache(payload)
            pending = self.db.execute("select id, payload from outbox where synced = 0").fetchall()
            if pending:
                events = [json.loads(row[1]) for row in pending]
                result = self._post("/api/devices/events", {"events": events})
                accepted = {item["clientEventId"] for item in result.get("results", []) if item.get("accepted")}
                for row in pending:
                    if row[0] in accepted:
                        self.db.execute("update outbox set synced = 1 where id = ?", (row[0],))
                self.db.commit()
            self.message = "Station online."
        except URLError:
            self.message = "Offline. Events stay on this station until the connection returns."
        except Exception as error:  # noqa: BLE001 - surface station faults on the kiosk
            self.message = str(error)

    def _post(self, path: str, payload: dict) -> dict:
        req = urlrequest.Request(
            self.api + path,
            data=json.dumps(payload).encode(),
            headers=self.headers(),
            method="POST",
        )
        with urlrequest.urlopen(req, timeout=8) as response:
            return json.loads(response.read().decode() or "{}")

    def match(self, embedding: list[float]) -> tuple[str, float] | None:
        if not self.key:
            raise RuntimeError("BIOMETRIC_KEY is not set on this station.")
        best_id = None
        best_score = 0.0
        for template in self.templates:
            known = decrypt_embedding(base64_blob(template["blob"]), self.key)
            score = cosine(embedding, known)
            if score > best_score:
                best_id = template["employeeId"]
                best_score = score
        if best_id and best_score >= self.threshold:
            return best_id, best_score
        return None

    def queue_event(self, employee_id: str, event_type: str, method: str, confidence: float | None, liveness: bool) -> str:
        client_id = str(uuid.uuid4())
        payload = {
            "clientEventId": client_id,
            "employeeId": employee_id,
            "eventType": event_type,
            "occurredAt": utcnow(),
            "verificationMethod": method,
            "verificationStatus": "SUCCESS",
            "confidenceScore": confidence,
            "livenessPassed": liveness,
        }
        self.db.execute("insert into outbox (id, payload, synced) values (?, ?, 0)", (client_id, json.dumps(payload)))
        self.db.commit()
        return client_id

    def act(self, event_type: str) -> dict:
        with self.lock:
            return self._act(event_type)

    def _act(self, event_type: str) -> dict:
        if not self.pipeline.ready:
            return {"ok": False, "message": self.pipeline.reason}
        first = self.pipeline.capture()
        time.sleep(0.45)
        second = self.pipeline.capture()
        checked = self.pipeline.verify_pair(first, second)
        if not checked["ok"]:
            return checked
        found = self.match(checked["embedding"])
        if not found:
            return {"ok": False, "message": "No enrolled face matched."}
        employee_id, score = found
        self.queue_event(employee_id, event_type, "FACIAL", round(score, 4), True)
        self.sync_once()
        return {"ok": True, "message": f"{event_type.replace('_', ' ').title()} recorded ({score:.2f})."}

    def enroll(self, employee_id: str) -> dict:
        with self.lock:
            return self._enroll(employee_id)

    def _enroll(self, employee_id: str) -> dict:
        if not self.pipeline.ready:
            return {"ok": False, "message": self.pipeline.reason}
        first = self.pipeline.capture()
        time.sleep(0.45)
        second = self.pipeline.capture()
        checked = self.pipeline.verify_pair(first, second)
        if not checked["ok"]:
            return checked
        result = self._post(
            "/api/devices/enroll",
            {
                "employeeId": employee_id,
                "embedding": checked["embedding"],
                "qualityScore": checked["quality"],
                "modelVersion": "insightface-buffalo_l",
                "antispoofScore": checked["antispoof"],
            },
        )
        self.sync_once()
        return {"ok": True, "message": "Enrollment stored.", "templateId": result.get("templateId")}

    def pin(self, pin: str, event_type: str) -> dict:
        with self.lock:
            return self._pin(pin, event_type)

    def _pin(self, pin: str, event_type: str) -> dict:
        try:
            result = self._post(
                "/api/devices/pin",
                {"pin": pin, "eventType": event_type, "occurredAt": utcnow(), "clientEventId": str(uuid.uuid4())},
            )
        except URLError:
            return {"ok": False, "message": "PIN needs a connection so the hash can be checked."}
        return {"ok": True, "message": f"PIN {event_type.replace('_', ' ').lower()} for {result.get('employeeCode')}."}


def base64_blob(value: str) -> bytes:
    import base64

    return base64.b64decode(value)


HTML = """<!doctype html>
<meta charset="utf-8">
<title>Clock station</title>
<style>
  body { font-family: "Avenir Next", sans-serif; background: #1c1915; color: #fffaf3; margin: 0; min-height: 100vh; display: grid; place-items: center; }
  main { width: min(720px, 100%); padding: 2rem; }
  h1 { font-family: Palatino, Georgia, serif; font-weight: 500; font-size: 3rem; margin: 0 0 0.5rem; }
  p { color: #e2d5c3; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-top: 1.5rem; }
  button { font: inherit; font-size: 1.3rem; padding: 1.2rem; border: 0; border-radius: 18px; background: #0c6b4d; color: white; }
  button.secondary { background: transparent; border: 1px solid #e2d5c3; }
  input { font: inherit; padding: 0.8rem; border-radius: 12px; border: 0; width: 100%; }
</style>
<main>
  <p>RESTAURANT STATION</p>
  <h1>Clock in</h1>
  <p id="message">Loading…</p>
  <div class="actions">
    <button data-act="CLOCK_IN">Clock in</button>
    <button data-act="CLOCK_OUT">Clock out</button>
    <button class="secondary" data-act="BREAK_START">Start break</button>
    <button class="secondary" data-act="BREAK_END">End break</button>
  </div>
  <form id="pin" style="margin-top:1.2rem; display:grid; gap:0.6rem">
    <input name="pin" inputmode="numeric" placeholder="Fallback PIN" maxlength="8">
    <button class="secondary" type="submit">Use PIN to clock in</button>
  </form>
</main>
<script>
async function refresh() {
  const status = await fetch("/api/status").then((response) => response.json());
  document.querySelector("#message").textContent = status.message;
}
document.querySelectorAll("[data-act]").forEach((button) => {
  button.onclick = async () => {
    const result = await fetch("/api/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventType: button.dataset.act }) }).then((response) => response.json());
    document.querySelector("#message").textContent = result.message;
  };
});
document.querySelector("#pin").onsubmit = async (event) => {
  event.preventDefault();
  const pin = new FormData(event.target).get("pin");
  const result = await fetch("/api/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin, eventType: "CLOCK_IN" }) }).then((response) => response.json());
  document.querySelector("#message").textContent = result.message;
};
refresh();
setInterval(refresh, 4000);
</script>
"""


def make_handler(station: Station):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:
            return

        def _json(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/api/status":
                self._json(200, {"message": station.message, "ready": station.pipeline.ready})
                return
            if self.path in ("/", "/kiosk"):
                body = HTML.encode()
                self.send_response(200)
                self.send_header("content-type", "text/html; charset=utf-8")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self._json(404, {"error": "Not found"})

        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/act":
                self._json(200, station.act(payload.get("eventType", "CLOCK_IN")))
                return
            if self.path == "/api/pin":
                self._json(200, station.pin(str(payload.get("pin", "")), payload.get("eventType", "CLOCK_IN")))
                return
            if self.path == "/api/enroll":
                self._json(200, station.enroll(payload.get("employeeId", "")))
                return
            self._json(404, {"error": "Not found"})

    return Handler


def main() -> None:
    station = Station()
    port = int(os.environ.get("STATION_PORT", "8088"))

    def loop() -> None:
        while True:
            with station.lock:
                station.sync_once()
            time.sleep(5)

    threading.Thread(target=loop, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(station))
    print(f"Clock station on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
