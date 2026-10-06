import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { eventsForWorkDate } from "../attendance/bucket";
import { calculateAttendanceDay, presenceState } from "../attendance/engine";
import { filterEmployeeEvents, resolveShift } from "../attendance/schedule";
import { addDays, localDate, localMinutes, zonedDateTime } from "../attendance/time";
import type { EngineEvent, EventType, ManualAdjustment } from "../attendance/types";
import {
  decryptEmbedding,
  deviceSecretsMatch,
  encryptEmbedding,
  hashDeviceSecret,
  hashPassword,
  loadBiometricKey,
  newBiometricKey,
  newDeviceSecret,
  verifyPassword,
} from "../crypto/embedding";
import { classifyFloor, scheduleLabel, type FloorSnapshot } from "../domain/floor";
import {
  activeConsent,
  assertManage,
  DomainError,
  employeeName,
  NOTICE_VERSION,
  type Actor,
  type AuditLog,
  type Consent,
  type Department,
  type Device,
  type Employee,
  type LeaveRequest,
  type Location,
  type OvertimeApproval,
  type ScheduleException,
  type Shape,
  type StoredDay,
  type StoredEvent,
  type Template,
  type UserAccount,
} from "../domain/model";

export const DEMO = {
  locationId: "11111111-1111-4111-8111-111111111111",
  floorId: "22222222-2222-4222-8222-222222222221",
  kitchenId: "22222222-2222-4222-8222-222222222222",
  serverId: "33333333-3333-4333-8333-333333333331",
  chefId: "33333333-3333-4333-8333-333333333332",
  managerPositionId: "33333333-3333-4333-8333-333333333333",
  johnId: "44444444-4444-4444-8444-444444444441",
  ayeshaId: "44444444-4444-4444-8444-444444444442",
  lindiweId: "44444444-4444-4444-8444-444444444443",
  samId: "44444444-4444-4444-8444-444444444444",
  deviceId: "55555555-5555-4555-8555-555555555551",
  adminId: "66666666-6666-4666-8666-666666666661",
  managerId: "66666666-6666-4666-8666-666666666662",
  johnUserId: "66666666-6666-4666-8666-666666666663",
};

const globalStore = globalThis as typeof globalThis & { __faceClockStore?: DevStore };

export function getDevStore(): DevStore {
  if (!globalStore.__faceClockStore) {
    const dir = path.join(process.cwd(), ".data");
    globalStore.__faceClockStore = openStore(dir);
  }
  return globalStore.__faceClockStore;
}

export function openStore(dir: string, now = new Date()): DevStore {
  mkdirSync(dir, { recursive: true });
  return new DevStore(dir, now);
}

export class DevStore {
  private shape: Shape;
  private key: Buffer;
  private readonly file: string;

  constructor(dir: string, now = new Date()) {
    this.file = path.join(dir, "store.json");
    const keyFile = path.join(dir, "biometric.key");
    if (!existsSync(keyFile)) writeFileSync(keyFile, newBiometricKey(), { mode: 0o600 });
    this.key = loadBiometricKey(readFileSync(keyFile, "utf8").trim());
    if (existsSync(this.file)) {
      this.shape = JSON.parse(readFileSync(this.file, "utf8")) as Shape;
      this.shape.exceptions ??= [];
    } else {
      const secret = newDeviceSecret();
      this.shape = seedShape(now, this.key, secret);
      this.persist();
      writeFileSync(
        path.join(dir, "station.env"),
        [
          "STATION_API_BASE=http://127.0.0.1:3000",
          `STATION_DEVICE_SECRET=${secret}`,
          `BIOMETRIC_KEY=${readFileSync(keyFile, "utf8").trim()}`,
          "STATION_CAMERA=0",
          "ANTISPOOF_MODEL=device/models/antispoof.onnx",
          "# Demo fallback PIN for EMP-001 John Dlamini: 2468",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
    }
  }

  login(email: string, password: string): Actor | null {
    const user = this.shape.users.find((account) => account.email.toLowerCase() === email.toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    return toActor(user);
  }

  listLocations(actor: Actor): Location[] {
    if (actor.role === "admin") return this.shape.locations;
    return this.shape.locations.filter((location) => actor.locationIds.includes(location.id));
  }

  listDepartments(locationId: string): Department[] {
    return this.shape.departments.filter((department) => department.locationId === locationId);
  }

  listPositions() {
    return this.shape.positions;
  }

  listEmployees(actor: Actor, locationId: string) {
    this.assertViewLocation(actor, locationId);
    return this.shape.employees
      .filter((employee) => employee.locationId === locationId)
      .filter((employee) => actor.role !== "employee" || employee.id === actor.employeeId)
      .map((employee) => this.employeeRow(employee));
  }

  getEmployee(actor: Actor, employeeId: string) {
    const employee = this.mustEmployee(employeeId);
    this.assertViewEmployee(actor, employee);
    const today = localDate(new Date(), this.location(employee.locationId).timezone);
    const template = this.activeTemplate(employee.id);
    return {
      ...this.employeeRow(employee),
      pinSet: Boolean(employee.pinHash),
      consent: activeConsent(this.shape, employee.id),
      template: template
        ? {
            status: template.status,
            enrolledAt: template.enrolledAt,
            modelVersion: template.modelVersion,
            qualityScore: template.qualityScore,
          }
        : null,
      today: this.shape.days.find((day) => day.employeeId === employee.id && day.workDate === today) ?? null,
      events: this.shape.events
        .filter((event) => event.employeeId === employee.id)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 20),
      notices: NOTICE_VERSION,
    };
  }

  createEmployee(
    actor: Actor,
    input: {
      firstName: string;
      lastName: string;
      locationId: string;
      departmentId: string;
      positionId: string;
      managerId: string | null;
    },
  ) {
    assertManage(actor, input.locationId);
    const employee: Employee = {
      id: randomUUID(),
      employeeCode: this.nextCode(),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      locationId: input.locationId,
      departmentId: input.departmentId,
      positionId: input.positionId,
      managerId: input.managerId,
      status: "active",
      pinHash: null,
      cardHash: null,
      hiredOn: localDate(new Date(), this.location(input.locationId).timezone),
      deactivatedAt: null,
    };
    if (!employee.firstName || !employee.lastName) throw new DomainError("Name is required.");
    this.shape.employees.push(employee);
    this.audit(actor, "employee.create", "employee", employee.id, { employeeCode: employee.employeeCode });
    this.persist();
    return employee;
  }

  recordConsent(actor: Actor, employeeId: string) {
    const employee = this.mustEmployee(employeeId);
    assertManage(actor, employee.locationId);
    const existing = activeConsent(this.shape, employeeId);
    if (existing) return existing;
    const consent: Consent = {
      id: randomUUID(),
      employeeId,
      purpose: "attendance_verification",
      noticeVersion: NOTICE_VERSION,
      consentedAt: new Date().toISOString(),
      withdrawnAt: null,
      recordedBy: actor.id,
    };
    this.shape.consents.push(consent);
    this.audit(actor, "biometric.consent", "employee", employeeId, { noticeVersion: NOTICE_VERSION });
    this.persist();
    return consent;
  }

  setPin(actor: Actor, employeeId: string, pin: string) {
    const employee = this.mustEmployee(employeeId);
    assertManage(actor, employee.locationId);
    if (!/^\d{4,8}$/.test(pin)) throw new DomainError("PIN must be 4 to 8 digits.");
    employee.pinHash = hashPassword(pin);
    this.audit(actor, "employee.pin_set", "employee", employeeId, {});
    this.persist();
  }

  deactivateEmployee(actor: Actor, employeeId: string) {
    const employee = this.mustEmployee(employeeId);
    assertManage(actor, employee.locationId);
    employee.status = "terminated";
    employee.deactivatedAt = new Date().toISOString();
    this.revokeTemplates(employeeId);
    const consent = activeConsent(this.shape, employeeId);
    if (consent) consent.withdrawnAt = new Date().toISOString();
    this.audit(actor, "employee.deactivate", "employee", employeeId, { templatesRevoked: true });
    this.persist();
  }

  deleteTemplates(actor: Actor, employeeId: string) {
    const employee = this.mustEmployee(employeeId);
    if (actor.role !== "admin") throw new DomainError("Only an administrator can delete biometric templates.", 403);
    this.assertViewEmployee(actor, employee);
    const before = this.shape.templates.length;
    this.shape.templates = this.shape.templates.filter((template) => template.employeeId !== employeeId);
    this.audit(actor, "biometric.delete", "employee", employeeId, { deleted: before - this.shape.templates.length });
    this.persist();
  }

  deleteRevokedTemplates(actor: Actor) {
    if (actor.role !== "admin") throw new DomainError("Only an administrator can purge templates.", 403);
    const before = this.shape.templates.length;
    this.shape.templates = this.shape.templates.filter((template) => template.status !== "revoked");
    this.audit(actor, "biometric.retention", "template", null, { deleted: before - this.shape.templates.length });
    this.persist();
  }

  saveSchedule(
    actor: Actor,
    employeeId: string,
    days: Array<{ dayOfWeek: number; off: boolean; startTime: string; endTime: string }>,
  ) {
    const employee = this.mustEmployee(employeeId);
    assertManage(actor, employee.locationId);
    this.shape.schedules = this.shape.schedules.filter((row) => row.employeeId !== employeeId);
    for (const day of days) {
      if (day.off) continue;
      if (!/^\d{2}:\d{2}$/.test(day.startTime) || !/^\d{2}:\d{2}$/.test(day.endTime)) {
        throw new DomainError("Shift times must be HH:MM.");
      }
      this.shape.schedules.push({
        id: randomUUID(),
        employeeId,
        locationId: employee.locationId,
        dayOfWeek: day.dayOfWeek,
        startTime: day.startTime,
        endTime: day.endTime,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      });
    }
    this.audit(actor, "schedule.save", "employee", employeeId, {});
    this.recomputeRange(employee, addDays(localDate(new Date(), this.location(employee.locationId).timezone), -14), 16);
    this.persist();
  }

  setShiftException(
    actor: Actor,
    input: { employeeId: string; workDate: string; isDayOff: boolean; startTime: string; endTime: string; reason: string },
  ) {
    const employee = this.mustEmployee(input.employeeId);
    assertManage(actor, employee.locationId);
    if (!input.reason.trim()) throw new DomainError("A shift change needs a reason.");
    this.shape.exceptions = this.shape.exceptions.filter(
      (row) => !(row.employeeId === input.employeeId && row.workDate === input.workDate),
    );
    const exception: ScheduleException = {
      id: randomUUID(),
      employeeId: input.employeeId,
      workDate: input.workDate,
      isDayOff: input.isDayOff,
      startTime: input.isDayOff ? null : input.startTime,
      endTime: input.isDayOff ? null : input.endTime,
      reason: input.reason.trim(),
    };
    this.shape.exceptions.push(exception);
    this.audit(actor, "schedule.exception", "employee", input.employeeId, { workDate: input.workDate });
    this.recomputeEmployee(employee, input.workDate, new Date());
    this.persist();
  }

  scheduleFor(actor: Actor, employeeId: string) {
    const employee = this.mustEmployee(employeeId);
    this.assertViewEmployee(actor, employee);
    return {
      weekly: this.shape.schedules.filter((row) => row.employeeId === employeeId),
      exceptions: this.shape.exceptions.filter((row) => row.employeeId === employeeId),
    };
  }

  listLeave(actor: Actor, locationId: string) {
    this.assertViewLocation(actor, locationId);
    return this.shape.leave
      .filter((request) => request.locationId === locationId)
      .filter((request) => actor.role !== "employee" || request.employeeId === actor.employeeId)
      .map((request) => ({
        ...request,
        employeeName: employeeName(this.mustEmployee(request.employeeId)),
        employeeCode: this.mustEmployee(request.employeeId).employeeCode,
      }))
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  }

  createLeave(
    actor: Actor,
    input: { employeeId: string; leaveType: string; startsOn: string; endsOn: string },
  ) {
    const employee = this.mustEmployee(input.employeeId);
    if (actor.role === "employee" && actor.employeeId !== employee.id) {
      throw new DomainError("You can only request your own leave.", 403);
    }
    if (actor.role !== "employee") assertManage(actor, employee.locationId);
    if (input.endsOn < input.startsOn) throw new DomainError("Leave end is before the start.");
    const request: LeaveRequest = {
      id: randomUUID(),
      employeeId: employee.id,
      locationId: employee.locationId,
      leaveType: input.leaveType,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: "pending",
      decidedBy: null,
      decidedAt: null,
    };
    this.shape.leave.push(request);
    this.audit(actor, "leave.request", "leave", request.id, {});
    this.persist();
    return request;
  }

  decideLeave(actor: Actor, leaveId: string, status: "approved" | "denied") {
    const request = this.shape.leave.find((row) => row.id === leaveId);
    if (!request) throw new DomainError("Leave request not found.", 404);
    assertManage(actor, request.locationId);
    request.status = status;
    request.decidedBy = actor.id;
    request.decidedAt = new Date().toISOString();
    this.audit(actor, `leave.${status}`, "leave", leaveId, {});
    const employee = this.mustEmployee(request.employeeId);
    this.recomputeRange(employee, request.startsOn, daysInclusive(request.startsOn, request.endsOn));
    this.persist();
  }

  listDevices(actor: Actor, locationId: string) {
    this.assertViewLocation(actor, locationId);
    const now = Date.now();
    return this.shape.devices
      .filter((device) => device.locationId === locationId)
      .map((device) => {
        const { secretHash: _secret, ...safe } = device;
        return {
          ...safe,
          online: Boolean(device.lastSeenAt && now - Date.parse(device.lastSeenAt) < 60_000),
        };
      });
  }

  createDevice(actor: Actor, input: { locationId: string; name: string; deviceCode: string; matchThreshold: number }) {
    if (actor.role !== "admin") throw new DomainError("Only an administrator can register a device.", 403);
    assertManage(actor, input.locationId);
    const deviceCode = input.deviceCode.trim().toUpperCase();
    if (!deviceCode) throw new DomainError("Device code is required.");
    if (this.shape.devices.some((device) => device.deviceCode === deviceCode)) {
      throw new DomainError("That device code is already registered.");
    }
    const secret = newDeviceSecret();
    const device: Device = {
      id: randomUUID(),
      deviceCode,
      locationId: input.locationId,
      name: input.name.trim() || deviceCode,
      status: "active",
      secretHash: hashDeviceSecret(secret),
      matchThreshold: input.matchThreshold,
      cameraConfig: { cameraIndex: 0 },
      lastSeenAt: null,
    };
    this.shape.devices.push(device);
    this.audit(actor, "device.create", "device", device.id, { deviceCode });
    this.persist();
    return { device, secret };
  }

  setDeviceStatus(actor: Actor, deviceId: string, status: "active" | "disabled") {
    if (actor.role !== "admin") throw new DomainError("Only an administrator can change a device.", 403);
    const device = this.mustDevice(deviceId);
    device.status = status;
    this.audit(actor, status === "disabled" ? "device.disable" : "device.enable", "device", deviceId, {});
    this.persist();
  }

  deviceActivity(actor: Actor, deviceId: string) {
    const device = this.mustDevice(deviceId);
    this.assertViewLocation(actor, device.locationId);
    return this.shape.events
      .filter((event) => event.deviceId === deviceId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 12)
      .map((event) => ({ ...event, employeeName: employeeName(this.mustEmployee(event.employeeId)) }));
  }

  floor(actor: Actor, locationId: string, now = new Date(), departmentId?: string): FloorSnapshot {
    this.assertViewLocation(actor, locationId);
    const location = this.location(locationId);
    const workDate = localDate(now, location.timezone);
    const people = this.shape.employees
      .filter((employee) => employee.locationId === locationId && employee.status === "active")
      .filter((employee) => actor.role !== "employee" || employee.id === actor.employeeId)
      .filter((employee) => !departmentId || employee.departmentId === departmentId)
      .map((employee) => {
        const day = this.recomputeEmployee(employee, workDate, now);
        const events = this.engineEvents(employee.id, workDate, location.timezone);
        const presence = presenceState(events);
        return {
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          name: employeeName(employee),
          department: this.departmentName(employee.departmentId),
          presence,
          status: day.status,
          lateMinutes: day.lateMinutes,
          potentialOvertimeMinutes: day.potentialOvertimeMinutes,
          scheduledLabel: scheduleLabel(
            day.scheduledStart ? new Date(day.scheduledStart) : null,
            day.scheduledEnd ? new Date(day.scheduledEnd) : null,
            location.timezone,
          ),
          actualLabel: day.actualStart
            ? formatActual(day.actualStart, day.actualEnd, location.timezone)
            : "Not in",
          onLeave: day.status === "leave",
          dayOff: day.status === "day_off",
          scheduledStart: day.scheduledStart ? new Date(day.scheduledStart) : null,
          scheduledEnd: day.scheduledEnd ? new Date(day.scheduledEnd) : null,
        };
      });
    this.persist();
    return classifyFloor(people, now);
  }

  listAttendance(actor: Actor, locationId: string, from: string, to: string, departmentId?: string) {
    this.assertViewLocation(actor, locationId);
    const rows = [];
    for (const employee of this.employeesIn(actor, locationId, departmentId)) {
      for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
        const day = this.recomputeEmployee(employee, cursor, new Date());
        const approval = this.shape.overtime.find((row) => row.attendanceDayId === day.id) ?? null;
        rows.push({
          ...day,
          employeeName: employeeName(employee),
          employeeCode: employee.employeeCode,
          department: this.departmentName(employee.departmentId),
          approvedMinutes: approval?.status === "approved" ? approval.approvedMinutes : null,
          overtimeStatus: approval?.status ?? null,
        });
      }
    }
    this.persist();
    return rows.sort((a, b) => b.workDate.localeCompare(a.workDate) || a.employeeName.localeCompare(b.employeeName));
  }

  listOvertime(actor: Actor, locationId: string) {
    this.assertViewLocation(actor, locationId);
    return this.shape.overtime
      .filter((row) => this.mustEmployee(row.employeeId).locationId === locationId)
      .filter((row) => actor.role !== "employee" || row.employeeId === actor.employeeId)
      .map((row) => {
        const employee = this.mustEmployee(row.employeeId);
        const day = this.shape.days.find((item) => item.id === row.attendanceDayId);
        return {
          ...row,
          employeeName: employeeName(employee),
          employeeCode: employee.employeeCode,
          calculatedPotential: day?.potentialOvertimeMinutes ?? row.potentialMinutes,
        };
      })
      .sort((a, b) => b.workDate.localeCompare(a.workDate));
  }

  decideOvertime(actor: Actor, overtimeId: string, decision: { status: "approved" | "rejected"; approvedMinutes?: number }) {
    const row = this.shape.overtime.find((item) => item.id === overtimeId);
    if (!row) throw new DomainError("Overtime record not found.", 404);
    const employee = this.mustEmployee(row.employeeId);
    assertManage(actor, employee.locationId);
    if (decision.status === "approved") {
      const minutes = decision.approvedMinutes ?? row.potentialMinutes;
      if (minutes < 0 || minutes > row.potentialMinutes) {
        throw new DomainError("Approved overtime cannot exceed the potential overtime.");
      }
      row.approvedMinutes = minutes;
      row.status = "approved";
    } else {
      row.approvedMinutes = 0;
      row.status = "rejected";
    }
    row.decidedBy = actor.id;
    row.decidedAt = new Date().toISOString();
    this.audit(actor, `overtime.${row.status}`, "overtime", row.id, {
      approvedMinutes: row.approvedMinutes,
      potentialMinutes: row.potentialMinutes,
    });
    this.persist();
  }

  supervisorEvent(actor: Actor, input: { employeeId: string; eventType: EventType; occurredAt?: string }) {
    const employee = this.mustEmployee(input.employeeId);
    assertManage(actor, employee.locationId);
    if (employee.status !== "active") throw new DomainError("This employee is not active.");
    if (input.eventType === "MANUAL_ADJUSTMENT") throw new DomainError("Use the adjustment form.");
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    this.appendEvent({
      employee,
      eventType: input.eventType,
      occurredAt,
      verificationMethod: "SUPERVISOR",
      verificationStatus: "SUCCESS",
      deviceId: null,
      confidenceScore: null,
      livenessPassed: null,
      clientEventId: randomUUID(),
      adjustment: null,
      createdBy: actor.id,
    });
    this.audit(actor, "attendance.supervisor", "employee", employee.id, { eventType: input.eventType });
    this.persist();
  }

  manualAdjustment(
    actor: Actor,
    input: { employeeId: string; workDate: string; clockIn: string; clockOut: string; reason: string },
  ) {
    const employee = this.mustEmployee(input.employeeId);
    assertManage(actor, employee.locationId);
    if (input.reason.trim().length < 3) throw new DomainError("An adjustment needs a reason.");
    const zone = this.location(employee.locationId).timezone;
    const adjustment: ManualAdjustment = { reason: input.reason.trim() };
    if (input.clockIn) adjustment.clockIn = zonedDateTime(input.workDate, input.clockIn, zone).toISOString();
    if (input.clockOut) {
      const endDate = input.clockOut <= input.clockIn ? addDays(input.workDate, 1) : input.workDate;
      adjustment.clockOut = zonedDateTime(endDate, input.clockOut, zone).toISOString();
    }
    if (!adjustment.clockIn && !adjustment.clockOut) throw new DomainError("Enter a clock-in or clock-out time.");
    this.appendEvent({
      employee,
      eventType: "MANUAL_ADJUSTMENT",
      occurredAt: new Date().toISOString(),
      verificationMethod: "SUPERVISOR",
      verificationStatus: "OVERRIDDEN",
      deviceId: null,
      confidenceScore: null,
      livenessPassed: null,
      clientEventId: randomUUID(),
      adjustment,
      createdBy: actor.id,
    });
    this.audit(actor, "attendance.adjust", "employee", employee.id, { workDate: input.workDate, reason: adjustment.reason });
    this.persist();
  }

  listAudit(actor: Actor) {
    if (actor.role === "employee") throw new DomainError("Audit logs are for managers.", 403);
    return this.shape.audit
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200);
  }

  authenticateDevice(secret: string): Device | null {
    const device = this.shape.devices.find((item) => deviceSecretsMatch(secret, item.secretHash));
    if (!device || device.status !== "active") return null;
    return device;
  }

  heartbeat(device: Device) {
    device.lastSeenAt = new Date().toISOString();
    this.persist();
    return {
      ok: true,
      serverTime: device.lastSeenAt,
      matchThreshold: device.matchThreshold,
      camera: device.cameraConfig,
      deviceCode: device.deviceCode,
    };
  }

  cacheForDevice(device: Device) {
    const employees = this.shape.employees.filter(
      (employee) => employee.locationId === device.locationId && employee.status === "active",
    );
    return {
      templates: this.shape.templates
        .filter((template) => template.status === "active" && employees.some((employee) => employee.id === template.employeeId))
        .filter((template) => activeConsent(this.shape, template.employeeId))
        .map((template) => ({
          templateId: template.id,
          employeeId: template.employeeId,
          employeeCode: this.mustEmployee(template.employeeId).employeeCode,
          modelVersion: template.modelVersion,
          blob: template.blob,
        })),
      pins: employees
        .filter((employee) => employee.pinHash)
        .map((employee) => ({ employeeId: employee.id, employeeCode: employee.employeeCode, pinHash: employee.pinHash })),
    };
  }

  enroll(
    device: Device,
    input: { employeeId: string; embedding: number[]; qualityScore: number; modelVersion: string; antispoofScore: number },
  ) {
    const employee = this.mustEmployee(input.employeeId);
    if (employee.locationId !== device.locationId) throw new DomainError("Employee is not at this device.", 403);
    if (employee.status !== "active") throw new DomainError("Employee is not active.");
    if (!activeConsent(this.shape, employee.id)) throw new DomainError("Biometric consent is required before enrollment.");
    if (input.antispoofScore < 0.8) throw new DomainError("Liveness check did not pass.");
    this.revokeTemplates(employee.id);
    const template: Template = {
      id: randomUUID(),
      employeeId: employee.id,
      blob: encryptEmbedding(input.embedding, this.key).toString("base64"),
      modelVersion: input.modelVersion,
      qualityScore: input.qualityScore,
      status: "active",
      enrolledAt: new Date().toISOString(),
      deviceId: device.id,
      revokedAt: null,
    };
    this.shape.templates.push(template);
    device.lastSeenAt = template.enrolledAt;
    this.audit(null, "biometric.enroll", "template", template.id, {
      employeeId: employee.id,
      deviceCode: device.deviceCode,
      actorLabel: device.deviceCode,
    });
    this.persist();
    return { templateId: template.id };
  }

  ingestEvents(
    device: Device,
    incoming: Array<{
      clientEventId: string;
      employeeId: string;
      eventType: EventType;
      occurredAt: string;
      verificationMethod: "FACIAL" | "PIN" | "CARD";
      verificationStatus: "SUCCESS" | "FAILED";
      confidenceScore?: number | null;
      livenessPassed?: boolean;
    }>,
    now = new Date(),
  ) {
    const results = incoming.map((item) => {
      if (this.shape.events.some((event) => event.clientEventId === item.clientEventId)) {
        return { clientEventId: item.clientEventId, accepted: true, duplicate: true };
      }
      try {
        const employee = this.mustEmployee(item.employeeId);
        if (employee.locationId !== device.locationId) throw new DomainError("Employee is not at this device.");
        if (employee.status !== "active") throw new DomainError("Employee is not active.");
        if (!["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"].includes(item.eventType)) {
          throw new DomainError("This station cannot write adjustments.");
        }
        const occurred = new Date(item.occurredAt);
        if (Number.isNaN(occurred.getTime())) throw new DomainError("Invalid event time.");
        if (occurred.getTime() > now.getTime() + 5 * 60 * 1000) throw new DomainError("Event time is in the future.");
        if (now.getTime() - occurred.getTime() > 14 * 24 * 3600 * 1000) throw new DomainError("Event is too old to sync.");
        if (item.verificationMethod === "FACIAL" && item.verificationStatus === "SUCCESS") {
          if (!item.livenessPassed) throw new DomainError("Facial clock-in requires a passed liveness check.");
          if (item.confidenceScore == null || item.confidenceScore < device.matchThreshold) {
            throw new DomainError("Confidence is below the device threshold.");
          }
          if (!activeConsent(this.shape, employee.id)) throw new DomainError("Biometric consent is missing.");
          if (!this.activeTemplate(employee.id)) throw new DomainError("Employee has no active face template.");
        }
        this.appendEvent({
          employee,
          eventType: item.eventType,
          occurredAt: occurred.toISOString(),
          verificationMethod: item.verificationMethod,
          verificationStatus: item.verificationStatus,
          deviceId: device.id,
          confidenceScore: item.confidenceScore ?? null,
          livenessPassed: item.livenessPassed ?? null,
          clientEventId: item.clientEventId,
          adjustment: null,
          createdBy: null,
        });
        return { clientEventId: item.clientEventId, accepted: true, duplicate: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Rejected";
        return { clientEventId: item.clientEventId, accepted: false, reason: message };
      }
    });
    device.lastSeenAt = now.toISOString();
    this.persist();
    return results;
  }

  pinEvent(
    device: Device,
    input: { pin: string; eventType: EventType; occurredAt: string; clientEventId: string },
    now = new Date(),
  ) {
    const matches = this.shape.employees.filter(
      (employee) =>
        employee.locationId === device.locationId &&
        employee.status === "active" &&
        employee.pinHash &&
        verifyPassword(input.pin, employee.pinHash),
    );
    if (matches.length !== 1) throw new DomainError("PIN was not recognised.", 401);
    const [result] = this.ingestEvents(
      device,
      [
        {
          clientEventId: input.clientEventId,
          employeeId: matches[0].id,
          eventType: input.eventType,
          occurredAt: input.occurredAt,
          verificationMethod: "PIN",
          verificationStatus: "SUCCESS",
        },
      ],
      now,
    );
    if (!result?.accepted) throw new DomainError(result?.reason ?? "PIN event was rejected.");
    return { employeeCode: matches[0].employeeCode, duplicate: Boolean(result.duplicate) };
  }

  decryptTemplate(blob: string): number[] {
    return decryptEmbedding(Buffer.from(blob, "base64"), this.key);
  }

  appendEvent(input: {
    employee: Employee;
    eventType: EventType;
    occurredAt: string;
    verificationMethod: StoredEvent["verificationMethod"];
    verificationStatus: StoredEvent["verificationStatus"];
    deviceId: string | null;
    confidenceScore: number | null;
    livenessPassed: boolean | null;
    clientEventId: string;
    adjustment: ManualAdjustment | null;
    createdBy: string | null;
  }) {
    const event: StoredEvent = {
      id: randomUUID(),
      employeeId: input.employee.id,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      verificationMethod: input.verificationMethod,
      verificationStatus: input.verificationStatus,
      deviceId: input.deviceId,
      confidenceScore: input.confidenceScore,
      livenessPassed: input.livenessPassed,
      clientEventId: input.clientEventId,
      adjustment: input.adjustment,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    this.shape.events.push(event);
    const zone = this.location(input.employee.locationId).timezone;
    const workDate = localDate(new Date(input.occurredAt), zone);
    this.recomputeEmployee(input.employee, workDate, new Date());
    if (input.eventType === "CLOCK_OUT" || input.eventType === "MANUAL_ADJUSTMENT") {
      this.recomputeEmployee(input.employee, addDays(workDate, -1), new Date());
    }
  }

  private recomputeRange(employee: Employee, from: string, count: number) {
    let cursor = from;
    for (let index = 0; index < count; index += 1) {
      this.recomputeEmployee(employee, cursor, new Date());
      cursor = addDays(cursor, 1);
    }
  }

  recomputeEmployee(employee: Employee, workDate: string, now: Date): StoredDay {
    const location = this.location(employee.locationId);
    const weekly = this.shape.schedules.filter((row) => row.employeeId === employee.id);
    const exception = this.shape.exceptions.find((row) => row.employeeId === employee.id && row.workDate === workDate) ?? null;
    const shift = resolveShift(workDate, location.timezone, weekly, exception);
    const onLeave = this.shape.leave.some(
      (request) =>
        request.employeeId === employee.id &&
        request.status === "approved" &&
        request.startsOn <= workDate &&
        request.endsOn >= workDate,
    );
    const events = this.engineEvents(employee.id, workDate, location.timezone);
    const result = calculateAttendanceDay({
      employeeId: employee.id,
      workDate,
      scheduledStart: shift.scheduledStart,
      scheduledEnd: shift.scheduledEnd,
      isDayOff: shift.isDayOff,
      onLeave,
      events,
      now,
      graceMinutes: location.graceMinutes,
      absenceCutoffMinutes: location.absenceCutoffMinutes,
    });
    const existing = this.shape.days.find((day) => day.employeeId === employee.id && day.workDate === workDate);
    const day: StoredDay = {
      id: existing?.id ?? randomUUID(),
      employeeId: employee.id,
      locationId: employee.locationId,
      workDate,
      status: result.status,
      scheduledStart: result.scheduledStart?.toISOString() ?? null,
      scheduledEnd: result.scheduledEnd?.toISOString() ?? null,
      actualStart: result.actualStart?.toISOString() ?? null,
      actualEnd: result.actualEnd?.toISOString() ?? null,
      lateMinutes: result.lateMinutes,
      earlyDepartureMinutes: result.earlyDepartureMinutes,
      scheduledMinutes: result.scheduledMinutes,
      workedMinutes: result.workedMinutes,
      breakMinutes: result.breakMinutes,
      potentialOvertimeMinutes: result.potentialOvertimeMinutes,
      exceptionNotes: result.exceptionNotes,
      calculatedAt: now.toISOString(),
    };
    if (existing) Object.assign(existing, day);
    else this.shape.days.push(day);
    this.syncOvertime(day);
    return existing ?? day;
  }

  private syncOvertime(day: StoredDay) {
    const existing = this.shape.overtime.find((row) => row.attendanceDayId === day.id);
    if (day.potentialOvertimeMinutes > 0) {
      if (!existing) {
        const row: OvertimeApproval = {
          id: randomUUID(),
          attendanceDayId: day.id,
          employeeId: day.employeeId,
          workDate: day.workDate,
          potentialMinutes: day.potentialOvertimeMinutes,
          approvedMinutes: null,
          status: "pending",
          decidedBy: null,
          decidedAt: null,
        };
        this.shape.overtime.push(row);
      } else if (existing.status === "pending") {
        existing.potentialMinutes = day.potentialOvertimeMinutes;
      }
      return;
    }
    if (existing?.status === "pending") {
      this.shape.overtime = this.shape.overtime.filter((row) => row.id !== existing.id);
    }
  }

  private engineEvents(employeeId: string, workDate: string, timeZone: string): EngineEvent[] {
    const own = filterEmployeeEvents(
      this.shape.events.map((event) => ({
        id: event.id,
        employeeId: event.employeeId,
        eventType: event.eventType,
        occurredAt: new Date(event.occurredAt),
        verificationStatus: event.verificationStatus,
        adjustment: event.adjustment,
      })),
      employeeId,
    );
    return eventsForWorkDate(own, workDate, timeZone);
  }

  private revokeTemplates(employeeId: string) {
    const now = new Date().toISOString();
    for (const template of this.shape.templates) {
      if (template.employeeId === employeeId && template.status === "active") {
        template.status = "revoked";
        template.revokedAt = now;
      }
    }
  }

  private activeTemplate(employeeId: string): Template | null {
    return this.shape.templates.find((template) => template.employeeId === employeeId && template.status === "active") ?? null;
  }

  private employeeRow(employee: Employee) {
    const { pinHash: _pin, cardHash: _card, ...safe } = employee;
    return {
      ...safe,
      name: employeeName(employee),
      department: this.departmentName(employee.departmentId),
      position: this.shape.positions.find((position) => position.id === employee.positionId)?.name ?? "—",
      manager: employee.managerId ? employeeName(this.mustEmployee(employee.managerId)) : "—",
      enrolled: Boolean(this.activeTemplate(employee.id)),
      consented: Boolean(activeConsent(this.shape, employee.id)),
    };
  }

  private employeesIn(actor: Actor, locationId: string, departmentId?: string) {
    return this.shape.employees.filter((employee) => {
      if (employee.locationId !== locationId) return false;
      if (departmentId && employee.departmentId !== departmentId) return false;
      if (actor.role === "employee") return employee.id === actor.employeeId;
      return true;
    });
  }

  private nextCode() {
    const numbers = this.shape.employees.map((employee) => Number(employee.employeeCode.replace("EMP-", "")));
    const next = Math.max(0, ...numbers) + 1;
    return `EMP-${String(next).padStart(3, "0")}`;
  }

  private assertViewLocation(actor: Actor, locationId: string) {
    if (actor.role === "admin") return;
    if (!actor.locationIds.includes(locationId) && actor.role === "manager") {
      throw new DomainError("You cannot view this location.", 403);
    }
    if (actor.role === "employee") {
      const employee = this.shape.employees.find((item) => item.id === actor.employeeId);
      if (employee?.locationId !== locationId) throw new DomainError("You cannot view this location.", 403);
      return;
    }
    if (actor.role !== "manager") throw new DomainError("You cannot view this location.", 403);
  }

  private assertViewEmployee(actor: Actor, employee: Employee) {
    if (actor.role === "employee" && actor.employeeId !== employee.id) {
      throw new DomainError("You cannot view this employee.", 403);
    }
    this.assertViewLocation(actor, employee.locationId);
  }

  private mustEmployee(id: string) {
    const employee = this.shape.employees.find((item) => item.id === id);
    if (!employee) throw new DomainError("Employee not found.", 404);
    return employee;
  }

  private mustDevice(id: string) {
    const device = this.shape.devices.find((item) => item.id === id);
    if (!device) throw new DomainError("Device not found.", 404);
    return device;
  }

  private location(id: string) {
    const location = this.shape.locations.find((item) => item.id === id);
    if (!location) throw new DomainError("Location not found.", 404);
    return location;
  }

  private departmentName(id: string | null) {
    return this.shape.departments.find((department) => department.id === id)?.name ?? "—";
  }

  private audit(
    actor: Actor | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: Record<string, unknown>,
  ) {
    const row: AuditLog = {
      id: randomUUID(),
      actorId: actor?.id ?? null,
      actorLabel: actor?.fullName ?? String(metadata.actorLabel ?? "System"),
      action,
      entityType,
      entityId,
      metadata,
      createdAt: new Date().toISOString(),
    };
    this.shape.audit.push(row);
  }

  private persist() {
    writeFileSync(this.file, JSON.stringify(this.shape), { mode: 0o600 });
  }
}

function toActor(user: UserAccount): Actor {
  return {
    id: user.id,
    role: user.role,
    fullName: user.fullName,
    email: user.email,
    employeeId: user.employeeId,
    locationIds: user.locationIds,
  };
}

function daysInclusive(from: string, to: string) {
  let count = 1;
  let cursor = from;
  while (cursor < to) {
    cursor = addDays(cursor, 1);
    count += 1;
  }
  return count;
}

function formatActual(start: string, end: string | null, timeZone: string) {
  const startLabel = scheduleLabel(new Date(start), new Date(start), timeZone).slice(0, 5);
  if (!end) return `In ${startLabel}`;
  const endLabel = scheduleLabel(new Date(end), new Date(end), timeZone).slice(0, 5);
  return `${startLabel}–${endLabel}`;
}

function seedShape(now: Date, key: Buffer, deviceSecret: string): Shape {
  const zone = "Africa/Johannesburg";
  const today = localDate(now, zone);
  const yesterday = addDays(today, -1);
  const embedding = Array.from({ length: 512 }, (_, index) => Math.sin(index) * 0.5);
  const blob = encryptEmbedding(embedding, key).toString("base64");
  const weekly = (employeeId: string) =>
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      id: randomUUID(),
      employeeId,
      locationId: DEMO.locationId,
      dayOfWeek,
      startTime: "09:00",
      endTime: "17:00",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    }));

  const shape: Shape = {
    locations: [
      {
        id: DEMO.locationId,
        name: "Harbour House",
        timezone: zone,
        address: "12 Bree Street, Cape Town",
        graceMinutes: 5,
        absenceCutoffMinutes: 60,
      },
    ],
    departments: [
      { id: DEMO.floorId, locationId: DEMO.locationId, name: "Floor" },
      { id: DEMO.kitchenId, locationId: DEMO.locationId, name: "Kitchen" },
    ],
    positions: [
      { id: DEMO.serverId, name: "Server" },
      { id: DEMO.chefId, name: "Chef" },
      { id: DEMO.managerPositionId, name: "Shift manager" },
    ],
    employees: [
      employee(DEMO.johnId, "EMP-001", "John", "Dlamini", DEMO.floorId, DEMO.serverId, DEMO.lindiweId, "2468"),
      employee(DEMO.ayeshaId, "EMP-002", "Ayesha", "Khan", DEMO.kitchenId, DEMO.chefId, DEMO.lindiweId, null),
      employee(DEMO.lindiweId, "EMP-003", "Lindiwe", "Nkosi", DEMO.floorId, DEMO.managerPositionId, null, null),
      employee(DEMO.samId, "EMP-004", "Sam", "Patel", DEMO.floorId, DEMO.serverId, DEMO.lindiweId, null),
    ],
    consents: [DEMO.johnId, DEMO.ayeshaId, DEMO.lindiweId, DEMO.samId].map((employeeId) => ({
      id: randomUUID(),
      employeeId,
      purpose: "attendance_verification",
      noticeVersion: NOTICE_VERSION,
      consentedAt: zonedDateTime(yesterday, "08:00", zone).toISOString(),
      withdrawnAt: null,
      recordedBy: DEMO.adminId,
    })),
    templates: [DEMO.johnId, DEMO.lindiweId].map((employeeId) => ({
      id: randomUUID(),
      employeeId,
      blob,
      modelVersion: "insightface-buffalo_l",
      qualityScore: 0.93,
      status: "active" as const,
      enrolledAt: zonedDateTime(yesterday, "08:05", zone).toISOString(),
      deviceId: DEMO.deviceId,
      revokedAt: null,
    })),
    devices: [
      {
        id: DEMO.deviceId,
        deviceCode: "RESTAURANT-01",
        locationId: DEMO.locationId,
        name: "Pass station",
        status: "active",
        secretHash: hashDeviceSecret(deviceSecret),
        matchThreshold: 0.4,
        cameraConfig: { cameraIndex: 0 },
        lastSeenAt: now.toISOString(),
      },
    ],
    users: [
      account(DEMO.adminId, "admin@facelock.local", "dev-admin-pass", "admin", "Harbour Admin", null, [DEMO.locationId]),
      account(DEMO.managerId, "manager@facelock.local", "dev-manager-pass", "manager", "Lindiwe Nkosi", DEMO.lindiweId, [DEMO.locationId]),
      account(DEMO.johnUserId, "john@facelock.local", "dev-employee-pass", "employee", "John Dlamini", DEMO.johnId, [DEMO.locationId]),
    ],
    schedules: [DEMO.johnId, DEMO.ayeshaId, DEMO.lindiweId, DEMO.samId].flatMap(weekly),
    exceptions: [],
    leave: [
      {
        id: randomUUID(),
        employeeId: DEMO.samId,
        locationId: DEMO.locationId,
        leaveType: "Annual",
        startsOn: today,
        endsOn: today,
        status: "approved",
        decidedBy: DEMO.managerId,
        decidedAt: zonedDateTime(yesterday, "16:00", zone).toISOString(),
      },
    ],
    events: [],
    days: [],
    overtime: [],
    audit: [],
  };

  const store = Object.create(DevStore.prototype) as DevStore;
  Object.assign(store, { shape, key, file: "" });
  const clock = (employeeId: string, type: EventType, date: string, time: string, status: StoredEvent["verificationStatus"] = "SUCCESS") => {
    const person = shape.employees.find((item) => item.id === employeeId)!;
    store.appendEvent({
      employee: person,
      eventType: type,
      occurredAt: zonedDateTime(date, time, zone).toISOString(),
      verificationMethod: "FACIAL",
      verificationStatus: status,
      deviceId: DEMO.deviceId,
      confidenceScore: status === "SUCCESS" ? 0.86 : 0.22,
      livenessPassed: status === "SUCCESS",
      clientEventId: randomUUID(),
      adjustment: null,
      createdBy: null,
    });
  };

  clock(DEMO.johnId, "CLOCK_IN", yesterday, "09:10");
  clock(DEMO.johnId, "CLOCK_OUT", yesterday, "17:40");
  clock(DEMO.lindiweId, "CLOCK_IN", yesterday, "08:55");
  clock(DEMO.lindiweId, "CLOCK_OUT", yesterday, "17:00");
  const minutes = localMinutes(now, zone);
  if (minutes >= 8 * 60 + 55) clock(DEMO.lindiweId, "CLOCK_IN", today, "08:55");
  if (minutes >= 9 * 60 + 24) {
    clock(DEMO.johnId, "CLOCK_IN", today, "09:23", "FAILED");
    clock(DEMO.johnId, "CLOCK_IN", today, "09:24");
  }
  for (const person of shape.employees) {
    store.recomputeEmployee(person, yesterday, now);
    store.recomputeEmployee(person, today, now);
  }
  shape.audit.unshift({
    id: randomUUID(),
    actorId: DEMO.adminId,
    actorLabel: "Harbour Admin",
    action: "biometric.enroll",
    entityType: "template",
    entityId: shape.templates[0]?.id ?? null,
    metadata: { employeeCode: "EMP-001", deviceCode: "RESTAURANT-01" },
    createdAt: zonedDateTime(yesterday, "08:05", zone).toISOString(),
  });
  return shape;
}

function employee(
  id: string,
  employeeCode: string,
  firstName: string,
  lastName: string,
  departmentId: string,
  positionId: string,
  managerId: string | null,
  pin: string | null,
): Employee {
  return {
    id,
    employeeCode,
    firstName,
    lastName,
    locationId: DEMO.locationId,
    departmentId,
    positionId,
    managerId,
    status: "active",
    pinHash: pin ? hashPassword(pin) : null,
    cardHash: null,
    hiredOn: "2025-11-01",
    deactivatedAt: null,
  };
}

function account(
  id: string,
  email: string,
  password: string,
  role: UserAccount["role"],
  fullName: string,
  employeeId: string | null,
  locationIds: string[],
): UserAccount {
  return { id, email, passwordHash: hashPassword(password), role, fullName, employeeId, locationIds };
}
