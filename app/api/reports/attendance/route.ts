import { NextResponse } from "next/server";
import { currentActor, getStore } from "@/lib/auth/current";
import { formatClock } from "@/lib/format";

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "Use from and to dates." }, { status: 400 });
  }
  const store = await getStore();
  const location = (await store.listLocations(actor))[0];
  if (!location) return NextResponse.json({ error: "No location." }, { status: 404 });
  const rows = await store.listAttendance(actor, location.id, from, to);
  const header = [
    "employee_code",
    "employee",
    "date",
    "status",
    "scheduled_start",
    "scheduled_end",
    "actual_start",
    "actual_end",
    "late_minutes",
    "early_departure_minutes",
    "worked_minutes",
    "potential_overtime_minutes",
    "approved_overtime_minutes",
  ];
  const lines = rows.map((row) =>
    [
      row.employeeCode,
      row.employeeName,
      row.workDate,
      row.status,
      row.scheduledStart ? formatClock(new Date(row.scheduledStart), location.timezone) : "",
      row.scheduledEnd ? formatClock(new Date(row.scheduledEnd), location.timezone) : "",
      row.actualStart ? formatClock(new Date(row.actualStart), location.timezone) : "",
      row.actualEnd ? formatClock(new Date(row.actualEnd), location.timezone) : "",
      row.lateMinutes,
      row.earlyDepartureMinutes,
      row.workedMinutes,
      row.potentialOvertimeMinutes,
      row.approvedMinutes ?? "",
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(","),
  );
  return new NextResponse([header.join(","), ...lines].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="attendance-${from}-to-${to}.csv"`,
    },
  });
}
