import { addDays, weekday, zonedDateTime } from "./time";
import type { EngineEvent } from "./types";

export type WeeklyShift = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type ShiftException = {
  workDate: string;
  isDayOff: boolean;
  startTime: string | null;
  endTime: string | null;
};

export type ResolvedShift = {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  isDayOff: boolean;
};

export function resolveShift(
  workDate: string,
  timeZone: string,
  weekly: WeeklyShift[],
  exception: ShiftException | null,
): ResolvedShift {
  if (exception?.isDayOff) {
    return { scheduledStart: null, scheduledEnd: null, isDayOff: true };
  }
  if (exception?.startTime && exception.endTime) {
    return bounds(workDate, timeZone, exception.startTime, exception.endTime, false);
  }
  const day = weekday(workDate);
  const pattern = weekly.find(
    (shift) =>
      shift.dayOfWeek === day &&
      shift.effectiveFrom <= workDate &&
      (shift.effectiveTo === null || shift.effectiveTo >= workDate),
  );
  if (!pattern) return { scheduledStart: null, scheduledEnd: null, isDayOff: false };
  return bounds(workDate, timeZone, pattern.startTime, pattern.endTime, false);
}

function bounds(
  workDate: string,
  timeZone: string,
  startTime: string,
  endTime: string,
  isDayOff: boolean,
): ResolvedShift {
  const scheduledStart = zonedDateTime(workDate, startTime, timeZone);
  let scheduledEnd = zonedDateTime(workDate, endTime, timeZone);
  if (scheduledEnd <= scheduledStart) {
    scheduledEnd = zonedDateTime(addDays(workDate, 1), endTime, timeZone);
  }
  return { scheduledStart, scheduledEnd, isDayOff };
}

export function shiftCovers(start: Date | null, end: Date | null, now: Date): boolean {
  if (!start || !end) return false;
  return now >= start && now < end;
}

export function filterEmployeeEvents(events: EngineEvent[], employeeId: string): EngineEvent[] {
  return events.filter((event) => event.employeeId === employeeId);
}
