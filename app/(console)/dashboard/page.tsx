import { supervisorEvent } from "@/app/actions";
import { Banner, Pill } from "@/components/banner";
import { workplace } from "@/lib/auth/current";
import type { FloorPerson } from "@/lib/domain/floor";
import { formatMinutes } from "@/lib/format";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { actor, store, location } = await workplace();
  if (!location) return <p>No restaurant is set up yet.</p>;
  const departments = await store.listDepartments(location.id);
  const floor = await store.floor(actor, location.id, new Date(), params.department || undefined);
  const manage = actor.role !== "employee";
  const nameSource = actor.fullName.includes("@") ? "" : actor.fullName;
  const firstName = nameSource.split(" ")[0];
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: location.timezone }).format(new Date());
  const greeting = Number(hour) < 12 ? "Good morning" : Number(hour) < 17 ? "Good afternoon" : "Good evening";
  const working = floor.working.length + floor.onBreak.length;
  const notYet = floor.shouldBeWorking.length;
  const lateOut = floor.late.filter((person) => person.presence === "out").length;
  const overtime = [...floor.working, ...floor.onBreak, ...floor.missingClockOut].filter((person) => person.potentialOvertimeMinutes > 0).length;
  const scheduled = new Set(
    [...floor.working, ...floor.onBreak, ...floor.missingClockOut, ...floor.shouldBeWorking, ...floor.late, ...floor.absent, ...floor.onLeave].map(
      (person) => person.employeeId,
    ),
  ).size;
  const present = working;
  const total = Math.max(scheduled, 1);
  const presentShare = (present / total) * 100;
  const lateShare = (floor.late.length / total) * 100;
  const leaveShare = (floor.onLeave.length / total) * 100;
  const absentShare = (floor.absent.length / total) * 100;
  const recent = [...floor.working, ...floor.onBreak, ...floor.missingClockOut, ...floor.shouldBeWorking, ...floor.absent].slice(0, 6);

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>
            {greeting}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="muted">Here is what is happening in {location.name} today.</p>
        </div>
      </div>
      <Banner error={params.error} />
      <form className="filters" method="get">
        <label>
          Department
          <select name="department" defaultValue={params.department ?? ""}>
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" type="submit">
          Filter
        </button>
      </form>
      <section className="grid" style={{ marginTop: "0.8rem" }}>
        <article className="card blue"><span>Scheduled</span><strong>{scheduled}</strong></article>
        <article className="card green"><span>Currently working</span><strong>{working}</strong></article>
        <article className="card"><span>Not yet arrived</span><strong>{notYet}</strong></article>
        <article className="card amber"><span>Late</span><strong>{lateOut}</strong></article>
        <article className="card purple"><span>On leave</span><strong>{floor.onLeave.length}</strong></article>
        <article className="card red"><span>In overtime</span><strong>{overtime}</strong></article>
      </section>
      <section className="layout">
        <div className="panel">
          <h2>Today&apos;s attendance</h2>
          <div className="donut-wrap">
            <div
              className="donut"
              style={{
                background: `conic-gradient(#3dd68c 0 ${presentShare}%, #f5b942 ${presentShare}% ${presentShare + lateShare}%, #ff2a2a ${presentShare + lateShare}% ${presentShare + lateShare + absentShare}%, #a78bfa ${presentShare + lateShare + absentShare}% ${presentShare + lateShare + absentShare + leaveShare}%, #243044 ${presentShare + lateShare + absentShare + leaveShare}% 100%)`,
              }}
            >
              <span>
                {present}/{scheduled || 0}
                <small style={{ display: "block", color: "var(--muted)", fontWeight: 500 }}>present</small>
              </span>
            </div>
            <div className="legend">
              <div>Present <b>{present}</b></div>
              <div>Late <b>{floor.late.length}</b></div>
              <div>Absent <b>{floor.absent.length}</b></div>
              <div>On leave <b>{floor.onLeave.length}</b></div>
            </div>
          </div>
        </div>
        <div className="panel">
          <h2>Recent activity</h2>
          <People people={recent} manage={manage} empty="No attendance activity yet." clockIn />
        </div>
      </section>
      <section className="layout">
        <div className="panel">
          <h2>On site</h2>
          <People people={[...floor.working, ...floor.onBreak, ...floor.missingClockOut]} manage={manage} empty="Nobody is clocked in." />
        </div>
        <div className="panel">
          <h2>Needs attention</h2>
          <People people={floor.absent} manage={manage} empty="No absences yet." clockIn />
          <h2>On leave</h2>
          <People people={floor.onLeave} manage={false} empty="No approved leave today." />
        </div>
      </section>
    </main>
  );
}

function People({
  people,
  manage,
  empty,
  clockIn = false,
}: {
  people: FloorPerson[];
  manage: boolean;
  empty: string;
  clockIn?: boolean;
}) {
  if (people.length === 0) return empty ? <p className="empty">{empty}</p> : null;
  return (
    <div>
      {people.map((person) => (
        <article className="person" key={`${person.employeeId}-${person.presence}-${person.status}`}>
          <div>
            <strong>
              {person.name} · {person.employeeCode}
            </strong>
            <p>
              {person.department} · {person.scheduledLabel} · {person.actualLabel}
              {person.lateMinutes > 0 ? ` · Late ${formatMinutes(person.lateMinutes)}` : ""}
            </p>
          </div>
          <div className="actions">
            <Pill value={person.presence === "out" ? person.status : person.presence} />
            {manage && clockIn && person.presence === "out" ? (
              <EventButton employeeId={person.employeeId} eventType="CLOCK_IN" label="Supervisor clock in" />
            ) : null}
            {manage && person.presence === "in" ? (
              <>
                <EventButton employeeId={person.employeeId} eventType="BREAK_START" label="Start break" />
                <EventButton employeeId={person.employeeId} eventType="CLOCK_OUT" label="Clock out" />
              </>
            ) : null}
            {manage && person.presence === "break" ? (
              <EventButton employeeId={person.employeeId} eventType="BREAK_END" label="End break" />
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function EventButton({ employeeId, eventType, label }: { employeeId: string; eventType: string; label: string }) {
  return (
    <form action={supervisorEvent}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="eventType" value={eventType} />
      <button className="secondary small" type="submit">
        {label}
      </button>
    </form>
  );
}
