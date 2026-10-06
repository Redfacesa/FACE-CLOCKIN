import { saveSchedule, setShiftException } from "@/app/actions";
import { Banner } from "@/components/banner";
import { workplace } from "@/lib/auth/current";

const DAYS = [
  { dayOfWeek: 1, label: "Monday" },
  { dayOfWeek: 2, label: "Tuesday" },
  { dayOfWeek: 3, label: "Wednesday" },
  { dayOfWeek: 4, label: "Thursday" },
  { dayOfWeek: 5, label: "Friday" },
  { dayOfWeek: 6, label: "Saturday" },
  { dayOfWeek: 0, label: "Sunday" },
];

export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; error?: string; note?: string }>;
}) {
  const params = await searchParams;
  const { actor, store, location } = await workplace();
  if (!location) return <p>No restaurant is set up yet.</p>;
  const employees = (await store.listEmployees(actor, location.id)).filter((employee) => employee.status === "active");
  const selected = actor.role === "employee" ? actor.employeeId : params.employee ?? employees[0]?.id;
  const schedule = selected ? await store.scheduleFor(actor, selected) : { weekly: [], exceptions: [] };
  const manage = actor.role !== "employee";

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Schedules</h1>
          <p className="muted">Weekly shifts, days off, and one-off changes. Leave is approved separately.</p>
        </div>
      </div>
      <Banner error={params.error} note={params.note} />
      <form className="filters" method="get">
        <label>
          Employee
          <select name="employee" defaultValue={selected ?? undefined}>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" type="submit">
          Show
        </button>
      </form>
      {selected && manage ? (
        <form className="panel" action={saveSchedule} style={{ marginTop: "0.8rem" }}>
          <input type="hidden" name="employeeId" value={selected} />
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Start</th>
                <th>End</th>
                <th>Off</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day) => {
                const row = schedule.weekly.find((shift) => shift.dayOfWeek === day.dayOfWeek);
                return (
                  <tr key={day.dayOfWeek}>
                    <td>{day.label}</td>
                    <td>
                      <input name={`start_${day.dayOfWeek}`} type="time" defaultValue={row?.startTime ?? "09:00"} />
                    </td>
                    <td>
                      <input name={`end_${day.dayOfWeek}`} type="time" defaultValue={row?.endTime ?? "17:00"} />
                    </td>
                    <td>
                      <label className="check">
                        <input name={`off_${day.dayOfWeek}`} type="checkbox" defaultChecked={!row} />
                        Off
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="submit" style={{ marginTop: "0.8rem" }}>
            Save weekly schedule
          </button>
        </form>
      ) : (
        <div className="panel" style={{ marginTop: "0.8rem" }}>
          {DAYS.map((day) => {
            const row = schedule.weekly.find((shift) => shift.dayOfWeek === day.dayOfWeek);
            return (
              <p key={day.dayOfWeek}>
                {day.label}: {row ? `${row.startTime}–${row.endTime}` : "Off"}
              </p>
            );
          })}
        </div>
      )}
      {manage && selected ? (
        <form className="panel form-grid" action={setShiftException} style={{ marginTop: "0.8rem" }}>
          <h2 style={{ gridColumn: "1 / -1" }}>Shift change</h2>
          <input type="hidden" name="employeeId" value={selected} />
          <label>
            Date
            <input name="workDate" type="date" required />
          </label>
          <label>
            Start
            <input name="startTime" type="time" defaultValue="09:00" />
          </label>
          <label>
            End
            <input name="endTime" type="time" defaultValue="17:00" />
          </label>
          <label>
            Reason
            <input name="reason" required />
          </label>
          <label className="check">
            <input name="isDayOff" type="checkbox" />
            Day off
          </label>
          <button type="submit">Save change</button>
        </form>
      ) : null}
    </main>
  );
}
