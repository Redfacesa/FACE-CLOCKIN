"use client";

import { useEffect, useRef, useState } from "react";
import type { FacePerson } from "@/lib/face/memory";

export function ClockCamera({ people, mode = "enroll" }: { people: FacePerson[]; mode?: "enroll" | "kiosk" }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [roster, setRoster] = useState(people);
  const [employeeId, setEmployeeId] = useState(people.find((person) => person.consented)?.id ?? "");
  const [message, setMessage] = useState(
    mode === "kiosk"
      ? "Use this screen on the computer running Face Clock. A face is recognised only after an admin has captured it here."
      : "Capture each employee's face on this computer. The front camera cannot recognise anyone until that face is saved.",
  );
  const [busy, setBusy] = useState(false);
  const [localOnly, setLocalOnly] = useState(true);
  const consented = roster.filter((person) => person.consented);
  const savedCount = roster.filter((person) => person.enrolled).length;

  useEffect(() => {
    if (!localCameraHost(window.location.hostname)) {
      setLocalOnly(false);
      setMessage("Open http://localhost:3000 on this computer. A tablet camera cannot reach the face engine through localhost, and frames are not sent to another machine.");
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false })
      .then((next) => {
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
        if (videoRef.current) videoRef.current.srcObject = next;
      })
      .catch(() => setMessage("This browser could not open the camera. Allow camera access and reload."));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function frames(): Promise<[string, string]> {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) throw new Error("The camera is not ready yet.");
    const first = snap(video);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const second = snap(video);
    return [first, second];
  }

  async function submit(path: string, extra: Record<string, string>) {
    if (!localCameraHost(window.location.hostname)) return;
    setBusy(true);
    setMessage("Checking the face on this computer. The photo is not stored.");
    try {
      const captured = await frames();
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...extra, frames: captured }),
      });
      const body = (await response.json()) as { message?: string; error?: string };
      if (response.ok && path === "/api/face/enroll") {
        setRoster((current) => current.map((person) => (person.id === extra.employeeId ? { ...person, enrolled: true } : person)));
      }
      setMessage(body.message || body.error || "Something went wrong.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The camera could not capture a face.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="layout">
      <div className="panel">
        <video ref={videoRef} className="camera-frame" autoPlay muted playsInline />
        <p>{message}</p>
      </div>
      <div className="panel" style={{ display: "grid", gap: "0.8rem", alignContent: "start" }}>
        {mode === "kiosk" ? (
          <>
            <h2>Clock in</h2>
            <p className="muted">The match stays on this computer. Supabase receives the employee, the score, and the clock event. A slight movement is required. That is not a strong anti-spoof check.</p>
            <div className="actions">
              <button type="button" disabled={busy || !localOnly} onClick={() => submit("/api/face/clock", { eventType: "CLOCK_IN" })}>
                Clock in
              </button>
              <button className="secondary" type="button" disabled={busy || !localOnly} onClick={() => submit("/api/face/clock", { eventType: "CLOCK_OUT" })}>
                Clock out
              </button>
            </div>
            <a className="secondary button" href="/login">
              Admin
            </a>
          </>
        ) : (
          <>
            <h2>Capture a face</h2>
            <p className="muted">
              Do this once per employee, after consent. The front camera stays unable to recognise them until this capture is saved.
              {savedCount > 0 ? ` ${savedCount} ${savedCount === 1 ? "face is" : "faces are"} saved.` : ""}
            </p>
            <label>
              Employee
              <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                {consented.length === 0 ? <option value="">No consented employees</option> : null}
                {consented.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.enrolled ? "face saved" : "not captured"}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={busy || !localOnly || !employeeId} onClick={() => submit("/api/face/enroll", { employeeId })}>
              Save this face
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function localCameraHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function snap(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 640 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The camera frame could not be copied.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return url.split(",")[1] ?? "";
}
