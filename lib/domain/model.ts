import type { DayStatus, EventType, ManualAdjustment, VerificationMethod, VerificationStatus } from "../attendance/types";

export type Role = "admin" | "manager" | "employee";
export type EmploymentStatus = "active" | "inactive" | "terminated";

export type Actor = {
  id: string;
  role: Role;
  fullName: string;
  email: string;
  employeeId: string | null;
  locationIds: string[];
};

export type Location = {
  id: string;
  name: string;
  timezone: string;
  address: string;
  graceMinutes: number;
  absenceCutoffMinutes: number;
};

export type Department = { id: string; locationId: string; name: string };
export type Position = { id: string; name: string };

export type Employee = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  locationId: string;
  departmentId: string | null;
  positionId: string | null;
  managerId: string | null;
  status: EmploymentStatus;
  pinHash: string | null;
  cardHash: string | null;
  hiredOn: string | null;
  deactivatedAt: string | null;
};

export type Consent = {
  id: string;
  employeeId: string;
  purpose: string;
  noticeVersion: string;
  consentedAt: string;
  withdrawnAt: string | null;
  recordedBy: string | null;
};

export type Template = {
  id: string;
  employeeId: string;
  blob: string;
  modelVersion: string;
  qualityScore: number | null;
  status: "active" | "revoked";
  enrolledAt: string;
  deviceId: string | null;
  revokedAt: string | null;
};

export type Device = {
  id: string;
  deviceCode: string;
  locationId: string;
  name: string;
  status: "active" | "disabled";
  secretHash: string;
  matchThreshold: number;
  cameraConfig: Record<string, unknown>;
  lastSeenAt: string | null;
};

export type UserAccount = {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  fullName: string;
  employeeId: string | null;
  locationIds: string[];
};

export type ScheduleRow = {
  id: string;
  employeeId: string;
  locationId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type ScheduleException = {
  id: string;
  employeeId: string;
  workDate: string;
  isDayOff: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string;
};

export type LeaveRequest = {
  id: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  status: "pending" | "approved" | "denied";
  decidedBy: string | null;
  decidedAt: string | null;
};

export type StoredEvent = {
  id: string;
  employeeId: string;
  eventType: EventType;
  occurredAt: string;
  verificationMethod: VerificationMethod;
  verificationStatus: VerificationStatus;
  deviceId: string | null;
  confidenceScore: number | null;
  livenessPassed: boolean | null;
  clientEventId: string;
  adjustment: ManualAdjustment | null;
  createdAt: string;
  createdBy: string | null;
};

export type StoredDay = {
  id: string;
  employeeId: string;
  locationId: string;
  workDate: string;
  status: DayStatus;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  scheduledMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  potentialOvertimeMinutes: number;
  exceptionNotes: string | null;
  calculatedAt: string;
};

export type OvertimeApproval = {
  id: string;
  attendanceDayId: string;
  employeeId: string;
  workDate: string;
  potentialMinutes: number;
  approvedMinutes: number | null;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
};

export type AuditLog = {
  id: string;
  actorId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type Shape = {
  locations: Location[];
  departments: Department[];
  positions: Position[];
  employees: Employee[];
  consents: Consent[];
  templates: Template[];
  devices: Device[];
  users: UserAccount[];
  schedules: ScheduleRow[];
  exceptions: ScheduleException[];
  leave: LeaveRequest[];
  events: StoredEvent[];
  days: StoredDay[];
  overtime: OvertimeApproval[];
  audit: AuditLog[];
};

export const NOTICE_VERSION = "2026-10-attendance-v1";

export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function employeeName(employee: Pick<Employee, "firstName" | "lastName">): string {
  return `${employee.firstName} ${employee.lastName}`;
}

export function canManageLocation(actor: Actor, locationId: string): boolean {
  if (actor.role === "admin") return true;
  return actor.role === "manager" && actor.locationIds.includes(locationId);
}

export function assertManage(actor: Actor, locationId: string) {
  if (!canManageLocation(actor, locationId)) throw new DomainError("You cannot change this location.", 403);
}

export function activeConsent(shape: Shape, employeeId: string): Consent | null {
  return (
    shape.consents.find((consent) => consent.employeeId === employeeId && consent.withdrawnAt === null) ??
    null
  );
}
