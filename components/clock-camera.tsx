"use client";

import { useEffect, useRef, useState } from "react";
import type { FacePerson } from "@/lib/face/memory";

export function ClockCamera({ people }: { people: FacePerson[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [roster, setRoster] = useState(people);
  const [employeeId, setEmployeeId] = useState(people.find((person) => person.consented)?.id ?? "");
  const [message, setMessage] = useState("Save each employee's face once. Clock in stays off until that face is stored.");
  const [busy, setBusy] = useState(false);
  const consented = roster.filter((person) => person.consented);
  const savedCount = roster.filter((person) => person.enrolled).length;

  useEffect(() => {
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
    setBusy(true);
    setMessage("Reading the live face. The photo is not stored.");
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
        <h2>Save a face</h2>
        <p className="muted">Do this once per employee. Consent is already recorded. The saved face is an encrypted template on their Redface Pay record, not a photo.</p>
        <label>
          Employee
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            {consented.length === 0 ? <option value="">No consented employees</option> : null}
            {consented.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name} · {person.enrolled ? "face saved" : "consent only"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy || !employeeId} onClick={() => submit("/api/face/enroll", { employeeId })}>
          Save this face
        </button>
        <h2>Clock with the camera</h2>
        <p className="muted">
          {savedCount === 0
            ? "No faces are saved yet. Clock in and clock out stay off until you press Save this face."
            : `${savedCount} saved ${savedCount === 1 ? "face" : "faces"}. The camera matches whoever is in front of it.`}
        </p>
        <div className="actions">
          <button type="button" disabled={busy || savedCount === 0} onClick={() => submit("/api/face/clock", { eventType: "CLOCK_IN" })}>
            Clock in
          </button>
          <button className="secondary" type="button" disabled={busy || savedCount === 0} onClick={() => submit("/api/face/clock", { eventType: "CLOCK_OUT" })}>
            Clock out
          </button>
        </div>
      </div>
    </div>
  );
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
