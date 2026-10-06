import { logout } from "@/app/actions";
import { workplace } from "@/lib/auth/current";
import { Nav } from "@/components/nav";

export const dynamic = "force-dynamic";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { actor, location } = await workplace();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark" aria-hidden="true">F</span>
          <div>
            <strong>Face Clock</strong>
            <span>{location?.name ?? "Restaurant"}</span>
          </div>
        </div>
        <Nav role={actor.role} />
      </aside>
      <div className="workspace">
        <header className="topbar">
          <h1>{location?.name ?? "Face Clock"}</h1>
          <div className="who">
            <div>
              <p>{actor.fullName}</p>
              <p>{actor.role}</p>
            </div>
            <span className="avatar">{initials(actor.fullName)}</span>
            <form action={logout}>
              <button className="secondary small" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
