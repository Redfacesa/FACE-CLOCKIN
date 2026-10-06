import { createLeave, decideLeave } from "@/app/actions";
import { Banner, Pill } from "@/components/banner";
import { workplace } from "@/lib/auth/current";

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; note?: string }>;
}) {
  const params = await searchParams;
  const { actor, store, location } = await workplace();
  if (!location) return <p>No restaurant is set up yet.</p>;
  const requests = await store.listLeave(actor, location.id);
  const employees = (await store.listEmployees(actor, location.id)).filter((employee) => employee.status === "active");
  const manage = actor.role !== "employee";

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Leave</h1>
          <p className="muted">Approved leave is not an absence.</p>
        </div>
      </div>
      <Banner error={params.error} note={params.note} />
      <div className="layout">
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>
                    {request.employeeName}
                    <p className="muted">{request.employeeCode}</p>
                  </td>
                  <td>{request.leaveType}</td>
                  <td>
                    {request.startsOn} – {request.endsOn}
                  </td>
                  <td>
                    <Pill value={request.status} />
                  </td>
                  <td>
                    {manage && request.status === "pending" ? (
                      <div className="actions">
                        <form action={decideLeave}>
                          <input type="hidden" name="leaveId" value={request.id} />
                          <input type="hidden" name="status" value="approved" />
                          <button className="small" type="submit">
                            Approve
                          </button>
                        </form>
                        <form action={decideLeave}>
                          <input type="hidden" name="leaveId" value={request.id} />
                          <input type="hidden" name="status" value="denied" />
                          <button className="secondary small" type="submit">
                            Deny
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="panel" action={createLeave} style={{ display: "grid", gap: "0.7rem" }}>
          <h2>Request leave</h2>
          <label>
            Employee
            <select name="employeeId" defaultValue={actor.employeeId ?? employees[0]?.id}>
              {employees
                .filter((employee) => manage || employee.id === actor.employeeId)
                .map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Type
            <select name="leaveType">
              <option>Annual</option>
              <option>Sick</option>
              <option>Unpaid</option>
            </select>
          </label>
          <label>
            From
            <input name="startsOn" type="date" required />
          </label>
          <label>
            To
            <input name="endsOn" type="date" required />
          </label>
          <button type="submit">Submit</button>
        </form>
      </div>
    </main>
  );
}
