import { workplace } from "@/lib/auth/current";
import { addDays, localDate } from "@/lib/attendance/time";
import { formatMinutes } from "@/lib/format";
import { Pill } from "@/components/banner";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const { actor, store, location } = await workplace();
  if (!location) return <p>No restaurant is set up yet.</p>;
  const today = localDate(new Date(), location.timezone);
  const from = params.from ?? addDays(today, -6);
  const to = params.to ?? today;
  const rows = await store.listAttendance(actor, location.id, from, to);
  const csv = `/api/reports/attendance?from=${from}&to=${to}`;

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Reports</h1>
          <p className="muted">Hours, lateness, absence, and the split between potential and approved overtime.</p>
        </div>
        <a className="button" href={csv}>
          Download CSV
        </a>
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
        <button className="secondary" type="submit">
          Update
        </button>
      </form>
      <div className="panel table-wrap" style={{ marginTop: "0.8rem" }}>
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Days</th>
              <th>Late</th>
              <th>Absent</th>
              <th>Worked</th>
              <th>Potential OT</th>
              <th>Approved OT</th>
            </tr>
          </thead>
          <tbody>
            {summarise(rows).map((row) => (
              <tr key={row.employeeId}>
                <td>
                  {row.employeeName}
                  <p className="muted">{row.employeeCode}</p>
                </td>
                <td>{row.days}</td>
                <td>
                  {row.lateDays} <Pill value="late" />
                </td>
                <td>{row.absentDays}</td>
                <td>{formatMinutes(row.worked)}</td>
                <td>{formatMinutes(row.potential)}</td>
                <td>{formatMinutes(row.approved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function summarise(
  rows: Array<{
    employeeId: string;
    employeeName: string;
    employeeCode: string;
    status: string;
    lateMinutes: number;
    workedMinutes: number;
    potentialOvertimeMinutes: number;
    approvedMinutes: number | null;
  }>,
) {
  const map = new Map<string, {
    employeeId: string;
    employeeName: string;
    employeeCode: string;
    days: number;
    lateDays: number;
    absentDays: number;
    worked: number;
    potential: number;
    approved: number;
  }>();
  for (const row of rows) {
    const current = map.get(row.employeeId) ?? {
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      employeeCode: row.employeeCode,
      days: 0,
      lateDays: 0,
      absentDays: 0,
      worked: 0,
      potential: 0,
      approved: 0,
    };
    current.days += 1;
    if (row.status === "late" || row.lateMinutes > 0) current.lateDays += 1;
    if (row.status === "absent") current.absentDays += 1;
    current.worked += row.workedMinutes;
    current.potential += row.potentialOvertimeMinutes;
    current.approved += row.approvedMinutes ?? 0;
    map.set(row.employeeId, current);
  }
  return [...map.values()];
}
