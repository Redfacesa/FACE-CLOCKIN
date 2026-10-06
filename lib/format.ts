export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  if (hours === 0) return `${sign}${rest}m`;
  return `${sign}${hours}h ${String(rest).padStart(2, "0")}m`;
}

export function formatClock(date: Date | null, timeZone: string): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export const STATUS_LABEL: Record<string, string> = {
  leave: "Leave",
  day_off: "Day off",
  expected: "Expected",
  absent: "Absent",
  late: "Late",
  present: "On time",
  early_departure: "Left early",
  open: "Missing clock-out",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  denied: "Denied",
  active: "Active",
  inactive: "Inactive",
  terminated: "Deactivated",
  in: "Working",
  break: "On break",
  out: "Out",
};

export const METHOD_LABEL: Record<string, string> = {
  FACIAL: "Facial",
  PIN: "PIN",
  CARD: "Card",
  SUPERVISOR: "Supervisor",
  MANUAL: "Manual",
};
