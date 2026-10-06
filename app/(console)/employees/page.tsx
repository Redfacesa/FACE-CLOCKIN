import Link from "next/link";
import { createEmployee } from "@/app/actions";
import { Banner, Pill } from "@/components/banner";
import { workplace } from "@/lib/auth/current";
import { payConfig } from "@/lib/supabase/pay";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const { actor, store, location } = await workplace();
  if (!location) return <p>No restaurant is set up yet.</p>;
  const employees = await store.listEmployees(actor, location.id);
  const departments = await store.listDepartments(location.id);
  const positions = await store.listPositions();
  const managers = employees.filter((employee) => employee.status === "active");

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Employees</h1>
          <p className="muted">Profiles, consent, and whether a face template is enrolled. Photographs are not stored.</p>
        </div>
      </div>
      <Banner error={params.error} />
      <div className="layout">
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Status</th>
                <th>Biometrics</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <Link href={`/employees/${employee.id}`}>
                      <strong>
                        {employee.name}
                      </strong>
                    </Link>
                    <p className="muted">{employee.employeeCode}</p>
                  </td>
                  <td>
                    {employee.position}
                    <p className="muted">{employee.department}</p>
                  </td>
                  <td>
                    <Pill value={employee.status} />
                  </td>
                  <td>{employee.consented ? (employee.enrolled ? "Enrolled" : "Consent only") : "No consent"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {actor.role === "employee" ? null : (
          <form className="panel" action={createEmployee} style={{ display: "grid", gap: "0.7rem" }}>
            <h2>Add employee</h2>
            <input type="hidden" name="locationId" value={location.id} />
            <label>
              First name
              <input name="firstName" required />
            </label>
            <label>
              Last name
              <input name="lastName" required />
            </label>
            <label>
              Department
              {payConfig().enabled ? (
                <input name="departmentId" placeholder="Floor" />
              ) : (
                <select name="departmentId">
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              Position
              {payConfig().enabled ? (
                <input name="positionId" placeholder="Server" />
              ) : (
                <select name="positionId">
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              Manager
              <select name="managerId" defaultValue="">
                <option value="">None</option>
                {managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Save employee</button>
          </form>
        )}
      </div>
    </main>
  );
}
