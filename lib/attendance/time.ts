export type LocalParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

export function localDate(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localMinutes(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function weekday(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Convert a location-local wall time to a UTC instant. */
export function zonedDateTime(isoDate: string, time: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = localParts(new Date(guess), timeZone);
  const zonedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess - (zonedAsUtc - guess));
}

export function formatLocalTime(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function minutesBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 60000);
}
