"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/clock", label: "Face registry" },
  { href: "/schedules", label: "Schedules" },
  { href: "/leave", label: "Leave" },
  { href: "/attendance", label: "Attendance" },
  { href: "/overtime", label: "Overtime" },
  { href: "/reports", label: "Reports" },
  { href: "/devices", label: "Devices", roles: ["admin", "manager"] },
  { href: "/audit", label: "Settings", roles: ["admin", "manager"] },
];

export function Nav({ role }: { role: string }) {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.filter((link) => !link.roles || link.roles.includes(role)).map((link) => (
        <Link key={link.href} href={link.href} className={pathname.startsWith(link.href) ? "active" : ""}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
