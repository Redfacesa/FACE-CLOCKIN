import { deactivateEmployee, deleteTemplates, manualAdjustment, recordConsent, setPin } from "@/app/actions";
import { Banner, Pill } from "@/components/banner";
import { workplace } from "@/lib/auth/current";
import { formatClock, formatMinutes, METHOD_LABEL } from "@/lib/format";
import { notFound } from "next/navigation";

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; note?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { actor, store, location } = await workplace();
  if (!location) return <p>No restaurant is set up yet.</p>;
  let profile;
  try {
    profile = await store.getEmployee(actor, id);
  } catch {
    notFound();
  }
  const manage = actor.role !== "employee";
  const zone = location.timezone;

  return (
    <main>
      <div className="page-title">
        <div>
          <p className="product">{profile.employeeCode}</p>
          <h1>{profile.name}</h1>
          <p className="muted">
            {profile.position} · {profile.department} · Manager {profile.manager}
          </p>
        </div>
        <Pill value={profile.status} />
      </div>
      <Banner error={query.error} note={query.note} />
      <section className="grid">
        <article className="card">
          <span>Today</span>
          <strong>{profile.today ? formatMinutes(profile.today.lateMinutes) : "—"}</strong>
          <span>late</span>
        </article>
        <article className="card">
          <span>Worked</span>
          <strong>{profile.today ? formatMinutes(profile.today.workedMinutes) : "—"}</strong>
        </article>
        <article className="card">
          <span>Potential overtime</span>
          <strong>{profile.today ? formatMinutes(profile.today.potentialOvertimeMinutes) : "—"}</strong>
        </article>
        <article className="card">
          <span>Face template</span>
          <strong style={{ fontSize: "1.3rem" }}>{profile.template ? "Enrolled" : "None"}</strong>
        </article>
      </section>
      <section className="layout" style={{ marginTop: "0.8rem" }}>
        <div className="panel">
          <h2>Attendance events</h2>
          <p className="muted">These rows are the record. A correction adds a new adjustment. It does not edit the original event.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Method</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {profile.events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatClock(new Date(event.occurredAt), zone)}</td>
                    <td>
                      {event.eventType}
                      {event.adjustment?.reason ? <p className="muted">{event.adjustment.reason}</p> : null}
                    </td>
                    <td>
                      {METHOD_LABEL[event.verificationMethod]}
                      {event.confidenceScore != null ? <p className="muted">{Math.round(event.confidenceScore * 100)}%</p> : null}
                    </td>
                    <td>
                      <Pill value={event.verificationStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {manage ? (
          <div className="panel" style={{ display: "grid", gap: "1rem" }}>
            <div>
              <h2>Biometric consent</h2>
              <p className="muted">
                Purpose: attendance verification. Notice {profile.notices}. Enrollment stores an encrypted embedding, not a photograph.
              </p>
              {profile.consent ? (
                <p>Consent recorded {new Date(profile.consent.consentedAt).toLocaleString("en-ZA", { timeZone: zone })}.</p>
              ) : (
                <form action={recordConsent}>
                  <input type="hidden" name="employeeId" value={profile.id} />
                  <button type="submit">Record consent</button>
                </form>
              )}
              {profile.template ? (
                <p className="muted">
                  Template {profile.template.modelVersion}, quality {profile.template.qualityScore ?? "—"}. Open Camera to replace it.
                </p>
              ) : (
                <p className="muted">No face saved yet. Open Camera, choose this employee, and press Save this face.</p>
              )}
            </div>
            <form action={setPin} style={{ display: "grid", gap: "0.5rem" }}>
              <h2>Fallback PIN</h2>
              <input type="hidden" name="employeeId" value={profile.id} />
              <label>
                New PIN
                <input name="pin" inputMode="numeric" minLength={4} maxLength={8} required />
              </label>
              <button className="secondary" type="submit">
                {profile.pinSet ? "Replace PIN" : "Set PIN"}
              </button>
            </form>
            <form action={manualAdjustment} style={{ display: "grid", gap: "0.5rem" }}>
              <h2>Manual adjustment</h2>
              <input type="hidden" name="employeeId" value={profile.id} />
              <label>
                Work date
                <input name="workDate" type="date" required />
              </label>
              <label>
                Clock in
                <input name="clockIn" type="time" />
              </label>
              <label>
                Clock out
                <input name="clockOut" type="time" />
              </label>
              <label>
                Reason
                <input name="reason" required minLength={3} />
              </label>
              <button className="secondary" type="submit">
                Add adjustment
              </button>
            </form>
            {profile.status === "active" ? (
              <form action={deactivateEmployee}>
                <input type="hidden" name="employeeId" value={profile.id} />
                <button className="danger" type="submit">
                  Deactivate employee
                </button>
              </form>
            ) : null}
            {actor.role === "admin" ? (
              <form action={deleteTemplates}>
                <input type="hidden" name="employeeId" value={profile.id} />
                <button className="secondary" type="submit">
                  Delete biometric templates
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
