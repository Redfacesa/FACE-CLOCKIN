import { shiftCovers } from "../attendance/schedule";
import type { DayStatus, Presence } from "../attendance/types";
import { formatClock } from "../format";

export type FloorPerson = {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  presence: Presence;
  status: DayStatus;
  lateMinutes: number;
  potentialOvertimeMinutes: number;
  scheduledLabel: string;
  actualLabel: string;
};

export type FloorSnapshot = {
  working: FloorPerson[];
  onBreak: FloorPerson[];
  missingClockOut: FloorPerson[];
  shouldBeWorking: FloorPerson[];
  late: FloorPerson[];
  absent: FloorPerson[];
  onLeave: FloorPerson[];
};

export function classifyFloor(
  people: Array<
    FloorPerson & {
      onLeave: boolean;
      dayOff: boolean;
      scheduledStart: Date | null;
      scheduledEnd: Date | null;
    }
  >,
  now: Date,
): FloorSnapshot {
  const snapshot: FloorSnapshot = {
    working: [],
    onBreak: [],
    missingClockOut: [],
    shouldBeWorking: [],
    late: [],
    absent: [],
    onLeave: [],
  };

  for (const person of people) {
    if (person.onLeave) {
      snapshot.onLeave.push(person);
      continue;
    }
    const pastEnd = person.scheduledEnd ? now > person.scheduledEnd : false;
    if ((person.presence === "in" || person.presence === "break") && pastEnd) {
      snapshot.missingClockOut.push(person);
    } else if (person.presence === "break") {
      snapshot.onBreak.push(person);
    } else if (person.presence === "in") {
      snapshot.working.push(person);
    } else if (
      shiftCovers(person.scheduledStart, person.scheduledEnd, now) &&
      !person.dayOff &&
      person.status !== "absent"
    ) {
      snapshot.shouldBeWorking.push(person);
    }
    if (person.status === "late") snapshot.late.push(person);
    if (person.status === "absent") snapshot.absent.push(person);
  }
  return snapshot;
}

export function scheduleLabel(
  start: Date | null,
  end: Date | null,
  timeZone: string,
): string {
  if (!start || !end) return "No shift";
  return `${formatClock(start, timeZone)}–${formatClock(end, timeZone)}`;
}
