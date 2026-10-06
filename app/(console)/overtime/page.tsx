import { decideOvertime } from "@/app/actions";
import { Banner, Pill } from "@/components/banner";
import { workplace } from "@/lib/auth/current";
import { formatMinutes } from "@/lib/format";

export default async function OvertimePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const { actor, store, location } = await workplace();
  if (!location) return <p>No restaurant is set up yet.</p>;
  const rows = await store.listOvertime(actor, location.id);
  const manage = actor.role !== "employee";

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Overtime</h1>
          <p className="muted">Actual time after the shift becomes potential overtime. It is not approved, and it is not payroll, until a manager decides.</p>
        </div>
      </div>
      <Banner error={params.error} />
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Potential</th>
              <th>Decision</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.workDate}</td>
                <td>
                  {row.employeeName}
                  <p className="muted">{row.employeeCode}</p>
                </td>
                <td>{formatMinutes(row.potentialMinutes)}</td>
                <td>
                  <Pill value={row.status} />
                  {row.status === "approved" ? <p className="muted">{formatMinutes(row.approvedMinutes ?? 0)} approved</p> : null}
                </td>
                <td>
                  {manage && row.status === "pending" ? (
                    <form action={decideOvertime} className="actions">
                      <input type="hidden" name="overtimeId" value={row.id} />
                      <input name="approvedMinutes" type="number" min={0} max={row.potentialMinutes} defaultValue={row.potentialMinutes} style={{ width: "5rem" }} />
                      <button className="small" name="status" value="approved" type="submit">
                        Approve
                      </button>
                      <button className="secondary small" name="status" value="rejected" type="submit">
                        Reject
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="empty">No overtime has been calculated.</p> : null}
      </div>
    </main>
  );
}
