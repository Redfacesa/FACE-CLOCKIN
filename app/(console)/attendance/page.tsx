import { Banner, Pill } from "@/components/banner";
import { workplace } from "@/lib/auth/current";
import { addDays, localDate } from "@/lib/attendance/time";
import { formatClock, formatMinutes } from "@/lib/format";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; department?: string }>;
}) {
  const params = await searchParams;
  const { actor, store, location } = await workplace();
  if (!location) return <p>No restaurant is set up yet.</p>;
  const today = localDate(new Date(), location.timezone);
  const from = params.from ?? addDays(today, -6);
  const to = params.to ?? today;
  const rows = await store.listAttendance(actor, location.id, from, to, params.department || undefined);
  const departments = await store.listDepartments(location.id);

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Attendance</h1>
          <p className="muted">Calculated from clock events. Hours exclude breaks. Potential overtime is time after the scheduled end.</p>
        </div>
      </div>
      <form className="filters" method="get">
        <label>
          From
          <input name="from" type="date" defaultValue={from} />
        </label>
        <label>
          To
          <input name="to" type="date" defaultValue={to} />
        </label>
        <label>
          Department
          <select name="department" defaultValue={params.department ?? ""}>
            <option value="">All</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" type="submit">
          Show
        </button>
      </form>
      <div className="panel table-wrap" style={{ marginTop: "0.8rem" }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Status</th>
              <th>Scheduled</th>
              <th>Actual</th>
              <th>Late</th>
              <th>Early</th>
              <th>Worked</th>
              <th>Potential OT</th>
              <th>Approved OT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.employeeId}-${row.workDate}`}>
                <td>{row.workDate}</td>
                <td>
                  {row.employeeName}
                  <p className="muted">{row.employeeCode}</p>
                </td>
                <td>
                  <Pill value={row.status} />
                </td>
                <td>
                  {formatClock(row.scheduledStart ? new Date(row.scheduledStart) : null, location.timezone)}–
                  {formatClock(row.scheduledEnd ? new Date(row.scheduledEnd) : null, location.timezone)}
                </td>
                <td>
                  {formatClock(row.actualStart ? new Date(row.actualStart) : null, location.timezone)}–
                  {formatClock(row.actualEnd ? new Date(row.actualEnd) : null, location.timezone)}
                </td>
                <td>{formatMinutes(row.lateMinutes)}</td>
                <td>{formatMinutes(row.earlyDepartureMinutes)}</td>
                <td>{formatMinutes(row.workedMinutes)}</td>
                <td>{formatMinutes(row.potentialOvertimeMinutes)}</td>
                <td>{row.approvedMinutes == null ? "—" : formatMinutes(row.approvedMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
