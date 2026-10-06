import { purgeRevokedTemplates } from "@/app/actions";
import { Banner } from "@/components/banner";
import { workplace } from "@/lib/auth/current";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; note?: string }>;
}) {
  const params = await searchParams;
  const { actor, store } = await workplace();
  if (actor.role === "employee") return <p>Audit logs are for managers.</p>;
  const logs = await store.listAudit(actor);

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Face data is an encrypted template used only for attendance. Deactivation revokes it. Events stay as the work record.
          </p>
        </div>
      </div>
      <Banner error={params.error} note={params.note} />
      {actor.role === "admin" ? (
        <form action={purgeRevokedTemplates} style={{ marginBottom: "0.8rem" }}>
          <button className="secondary" type="submit">
            Delete revoked templates
          </button>
        </form>
      ) : null}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.createdAt).toLocaleString("en-ZA")}</td>
                <td>{log.actorLabel}</td>
                <td>{log.action}</td>
                <td className="muted">{JSON.stringify(log.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
