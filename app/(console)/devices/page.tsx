import { cookies } from "next/headers";
import { createDevice, setDeviceStatus } from "@/app/actions";
import { Banner, Pill } from "@/components/banner";
import { workplace } from "@/lib/auth/current";
import { formatClock, METHOD_LABEL } from "@/lib/format";

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const { actor, store, location } = await workplace();
  if (!location) return <p>No restaurant is set up yet.</p>;
  if (actor.role === "employee") return <p>Devices are managed by an administrator.</p>;
  const devices = await store.listDevices(actor, location.id);
  const activityByDevice = new Map(
    await Promise.all(devices.map(async (device) => [device.id, await store.deviceActivity(actor, device.id)] as const)),
  );
  const jar = await cookies();
  const issued = jar.get("fc_issued_secret")?.value;

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Devices</h1>
          <p className="muted">Each station has its own credential, location, and match threshold. A disabled station cannot sync.</p>
        </div>
      </div>
      <Banner error={params.error} />
      {issued ? (
        <p className="banner good">Station credential, shown once: {issued}. Put the secret in the station environment as STATION_DEVICE_SECRET.</p>
      ) : null}
      <div className="layout">
        <div>
          {devices.map((device) => {
            const activity = activityByDevice.get(device.id) ?? [];
            return (
              <article className="panel" key={device.id} style={{ marginBottom: "0.75rem" }}>
                <div className="row">
                  <div>
                    <strong>
                      {device.name} · {device.deviceCode}
                    </strong>
                    <p>
                      Threshold {device.matchThreshold} · Last seen{" "}
                      {device.lastSeenAt ? formatClock(new Date(device.lastSeenAt), location.timezone) : "never"}
                    </p>
                  </div>
                  <div className="actions">
                    <span className={`pill ${device.online ? "active" : "absent"}`}>{device.online ? "Online" : "Offline"}</span>
                    <Pill value={device.status} />
                    {actor.role === "admin" ? (
                      <form action={setDeviceStatus}>
                        <input type="hidden" name="deviceId" value={device.id} />
                        <input type="hidden" name="status" value={device.status === "active" ? "disabled" : "active"} />
                        <button className="secondary small" type="submit">
                          {device.status === "active" ? "Disable" : "Enable"}
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
                {activity.length === 0 ? (
                  <p className="empty">No attendance events from this station yet.</p>
                ) : (
                  activity.map((event) => (
                    <p key={event.id} className="muted">
                      {formatClock(new Date(event.occurredAt), location.timezone)} · {event.employeeName} · {event.eventType} ·{" "}
                      {METHOD_LABEL[event.verificationMethod]}
                    </p>
                  ))
                )}
              </article>
            );
          })}
        </div>
        {actor.role === "admin" ? (
          <form className="panel" action={createDevice} style={{ display: "grid", gap: "0.7rem", alignSelf: "start" }}>
            <h2>Register station</h2>
            <input type="hidden" name="locationId" value={location.id} />
            <label>
              Name
              <input name="name" placeholder="Pass station" required />
            </label>
            <label>
              Device code
              <input name="deviceCode" placeholder="RESTAURANT-02" required />
            </label>
            <label>
              Match threshold
              <input name="matchThreshold" type="number" min={0.1} max={1} step={0.01} defaultValue={0.4} />
            </label>
            <button type="submit">Register</button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
