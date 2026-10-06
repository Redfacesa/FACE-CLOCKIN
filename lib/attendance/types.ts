export const EVENT_TYPES = [
  "CLOCK_IN",
  "CLOCK_OUT",
  "BREAK_START",
  "BREAK_END",
  "MANUAL_ADJUSTMENT",
] as const;

export const VERIFICATION_METHODS = ["FACIAL", "PIN", "CARD", "SUPERVISOR", "MANUAL"] as const;
export const VERIFICATION_STATUSES = ["SUCCESS", "FAILED", "OVERRIDDEN"] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export type DayStatus =
  | "leave"
  | "day_off"
  | "expected"
  | "absent"
  | "late"
  | "present"
  | "early_departure"
  | "open";

export type ManualAdjustment = {
  clockIn?: string;
  clockOut?: string;
  reason: string;
};

export type EngineEvent = {
  id: string;
  employeeId: string;
  eventType: EventType;
  occurredAt: Date;
  verificationStatus: VerificationStatus;
  adjustment?: ManualAdjustment | null;
};

export type DayInput = {
  employeeId: string;
  workDate: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  isDayOff: boolean;
  onLeave: boolean;
  events: EngineEvent[];
  now: Date;
  graceMinutes: number;
  absenceCutoffMinutes: number;
};

export type DayResult = {
  employeeId: string;
  workDate: string;
  status: DayStatus;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  scheduledMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  potentialOvertimeMinutes: number;
  exceptionNotes: string | null;
};

export type Presence = "out" | "in" | "break";
