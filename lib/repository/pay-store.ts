import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateAttendanceDay, presenceState } from "../attendance/engine";
import { eventsForWorkDate } from "../attendance/bucket";
import { addDays, localDate, weekday, zonedDateTime } from "../attendance/time";
import type { EngineEvent, EventType } from "../attendance/types";
import { hashDeviceSecret, hashPassword, newDeviceSecret } from "../crypto/embedding";
import { classifyFloor, scheduleLabel } from "../domain/floor";
import { formatClock } from "../format";
import { DomainError, NOTICE_VERSION, type Actor } from "../domain/model";

const TZ = "Africa/Johannesburg";

type EmployeeRow = {
  id: string;
  merchant_id: string;
  employee_code: string | null;
  full_name: string;
  email: string | null;
  job_title: string | null;
  department: string | null;
  employment_status: string;
  manager_employee_id: string | null;
  pin_hash: string | null;
};

function fail(error: { message: string } | null) {
  if (error) throw new DomainError(error.message);
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0] ?? fullName, lastName: parts.slice(1).join(" ") };
}

function eventTypeToDb(eventType: EventType) {
  return eventType.toLowerCase();
}

function eventTypeFromDb(value: string): EventType {
  const map: Record<string, EventType> = {
    clock_in: "CLOCK_IN",
    clock_out: "CLOCK_OUT",
    break_start: "BREAK_START",
    break_end: "BREAK_END",
    manual_adjustment: "MANUAL_ADJUSTMENT",
  };
  return map[value] ?? "CLOCK_IN";
}

function methodFromDb(value: string): "FACIAL" | "PIN" | "CARD" | "SUPERVISOR" | "MANUAL" {
  if (value === "face") return "FACIAL";
  if (value === "pin") return "PIN";
  if (value === "card") return "CARD";
  if (value === "manual") return "MANUAL";
  return "SUPERVISOR";
}

export class PayStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly merchantId: string,
    private readonly merchantName: string,
  ) {}

  async listLocations(actor: Actor) {
    if (!actor.locationIds.includes(this.merchantId) && actor.role !== "admin") return [];
    return [
      {
        id: this.merchantId,
        name: this.merchantName,
        timezone: TZ,
        address: "",
        graceMinutes: 5,
        absenceCutoffMinutes: 60,
      },
    ];
  }

  async listDepartments(locationId: string) {
    const employees = await this.employeeRows(locationId);
    const names = [...new Set(employees.map((employee) => employee.department).filter(Boolean))] as string[];
    return names.map((name) => ({ id: name, locationId, name }));
  }

  async listPositions() {
    const employees = await this.employeeRows(this.merchantId);
    const names = [...new Set(employees.map((employee) => employee.job_title).filter(Boolean))] as string[];
    if (names.length === 0) names.push("Staff");
    return names.map((name) => ({ id: name, name }));
  }

  async listEmployees(actor: Actor, locationId: string) {
    this.assertMerchant(actor, locationId);
    const rows = await this.employeeRows(locationId);
    const bios = await this.biometrics(rows.map((row) => row.id));
    return rows
      .filter((row) => actor.role !== "employee" || row.id === actor.employeeId)
      .map((row) => this.present(row, bios.get(row.id), rows));
  }

  async getEmployee(actor: Actor, employeeId: string) {
    const row = await this.mustEmployee(employeeId);
    this.assertMerchant(actor, row.merchant_id);
    if (actor.role === "employee" && actor.employeeId !== row.id) {
      throw new DomainError("You cannot view this employee.", 403);
    }
    const today = localDate(new Date(), TZ);
    const bios = await this.biometrics([row.id]);
    const bio = bios.get(row.id);
    const { data: events, error } = await this.supabase
      .from("workforce_attendance_events")
      .select("id, event_type, occurred_at, method, match_score, device_label, notes, metadata")
      .eq("employee_id", row.id)
      .order("occurred_at", { ascending: false })
      .limit(20);
    fail(error);
    const { data: day } = await this.supabase
      .from("workforce_attendance_days")
      .select("late_minutes, minutes_worked, overtime_minutes, status")
      .eq("employee_id", row.id)
      .eq("work_date", today)
      .maybeSingle();
    const people = await this.employeeRows(row.merchant_id);
    return {
      ...this.present(row, bio, people),
      pinSet: Boolean(row.pin_hash),
      consent: bio?.consent_given_at
        ? { consentedAt: bio.consent_given_at, withdrawnAt: null, noticeVersion: bio.consent_version }
        : null,
      template: bio?.embedding_ciphertext || bio?.descriptor
        ? {
            status: bio.status,
            enrolledAt: bio.updated_at,
            modelVersion: bio.embedding_model ?? "redface-face",
            qualityScore: null,
          }
        : null,
      today: day
        ? {
            lateMinutes: day.late_minutes ?? 0,
            workedMinutes: day.minutes_worked ?? 0,
            potentialOvertimeMinutes: day.overtime_minutes ?? 0,
            status: day.status,
          }
        : null,
      events: (events ?? []).map((event) => ({
        id: event.id,
        occurredAt: event.occurred_at,
        eventType: eventTypeFromDb(event.event_type),
        verificationMethod: methodFromDb(event.method),
        verificationStatus: "SUCCESS",
        confidenceScore: event.match_score,
        adjustment: event.notes ? { reason: event.notes } : null,
      })),
      notices: bio?.consent_version ?? NOTICE_VERSION,
    };
  }

  async createEmployee(
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
    this.assertMerchant(actor, input.locationId);
    const code = await this.nextCode();
    const { data, error } = await this.supabase
      .from("workforce_employees")
      .insert({
        merchant_id: this.merchantId,
        full_name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
        employee_code: code,
        department: input.departmentId || null,
        job_title: input.positionId || null,
        manager_employee_id: input.managerId,
        employment_status: "active",
      })
      .select("id")
      .single();
    fail(error);
    await this.audit(actor, "employee.create", "workforce_employees", data!.id, { employeeCode: code });
    return { id: data!.id };
  }

  async recordConsent(actor: Actor, employeeId: string) {
    const employee = await this.mustEmployee(employeeId);
    this.assertMerchant(actor, employee.merchant_id);
    const selected = await this.supabase
      .from("workforce_biometric_profiles")
      .select("status, descriptor, embedding_ciphertext")
      .eq("employee_id", employeeId)
      .eq("modality", "face")
      .maybeSingle();
    const existing = selected.error?.message?.includes("embedding_ciphertext")
      ? await this.supabase
          .from("workforce_biometric_profiles")
          .select("status, descriptor")
          .eq("employee_id", employeeId)
          .eq("modality", "face")
          .maybeSingle()
      : selected;
    fail(existing.error);
    const row = existing.data as { status?: string; descriptor?: unknown; embedding_ciphertext?: string | null } | null;
    const keepActive = Boolean(row?.embedding_ciphertext || row?.descriptor) && row?.status === "active";
    const { error } = await this.supabase.from("workforce_biometric_profiles").upsert(
      {
        merchant_id: this.merchantId,
        employee_id: employeeId,
        modality: "face",
        consent_given_at: new Date().toISOString(),
        consent_version: NOTICE_VERSION,
        consent_notice: "Attendance verification only. The stored template is an encrypted face embedding, not a photograph.",
        status: keepActive ? "active" : "pending",
      },
      { onConflict: "employee_id,modality" },
    );
    fail(error);
    await this.audit(actor, "biometric.consent", "workforce_employees", employeeId, {});
  }

  async setPin(actor: Actor, employeeId: string, pin: string) {
    const employee = await this.mustEmployee(employeeId);
    this.assertMerchant(actor, employee.merchant_id);
    if (!/^\d{4,8}$/.test(pin)) throw new DomainError("PIN must be 4 to 8 digits.");
    const { error } = await this.supabase
      .from("workforce_employees")
      .update({ pin_hash: hashPassword(pin) })
      .eq("id", employeeId);
    fail(error);
    await this.audit(actor, "employee.pin_set", "workforce_employees", employeeId, {});
  }

  async deactivateEmployee(actor: Actor, employeeId: string) {
    const employee = await this.mustEmployee(employeeId);
    this.assertMerchant(actor, employee.merchant_id);
    fail(
      (
        await this.supabase
          .from("workforce_employees")
          .update({ employment_status: "terminated" })
          .eq("id", employeeId)
      ).error,
    );
    await this.supabase
      .from("workforce_biometric_profiles")
      .update({ status: "disabled", deactivated_at: new Date().toISOString() })
      .eq("employee_id", employeeId);
    await this.audit(actor, "employee.deactivate", "workforce_employees", employeeId, {});
  }

  async deleteTemplates(actor: Actor, employeeId: string) {
    if (actor.role !== "admin") throw new DomainError("Only an administrator can delete biometric templates.", 403);
    const { error } = await this.supabase
      .from("workforce_biometric_profiles")
      .update({ descriptor: null, embedding_ciphertext: null, status: "deleted" })
      .eq("employee_id", employeeId)
      .eq("merchant_id", this.merchantId);
    if (error?.message.includes("embedding_ciphertext")) {
      fail(
        (
          await this.supabase
            .from("workforce_biometric_profiles")
            .update({ descriptor: null, status: "deleted" })
            .eq("employee_id", employeeId)
        ).error,
      );
    } else fail(error);
    await this.audit(actor, "biometric.delete", "workforce_employees", employeeId, {});
  }

  async deleteRevokedTemplates(actor: Actor) {
    if (actor.role !== "admin") throw new DomainError("Only an administrator can purge templates.", 403);
    const { error } = await this.supabase
      .from("workforce_biometric_profiles")
      .update({ descriptor: null, embedding_ciphertext: null })
      .eq("merchant_id", this.merchantId)
      .in("status", ["disabled", "deleted"]);
    if (error?.message.includes("embedding_ciphertext")) {
      fail(
        (
          await this.supabase
            .from("workforce_biometric_profiles")
            .update({ descriptor: null })
            .eq("merchant_id", this.merchantId)
            .in("status", ["disabled", "deleted"])
        ).error,
      );
      return;
    }
    fail(error);
  }

  async saveSchedule(
    actor: Actor,
    employeeId: string,
    days: Array<{ dayOfWeek: number; off: boolean; startTime: string; endTime: string }>,
  ) {
    const employee = await this.mustEmployee(employeeId);
    this.assertMerchant(actor, employee.merchant_id);
    const now = new Date().toISOString();
    fail(
      (
        await this.supabase
          .from("workforce_shifts")
          .delete()
          .eq("employee_id", employeeId)
          .eq("status", "scheduled")
          .gte("starts_at", now)
      ).error,
    );
    const today = localDate(new Date(), TZ);
    const rows = [];
    for (let offset = 0; offset < 14; offset += 1) {
      const date = addDays(today, offset);
      const pattern = days.find((day) => day.dayOfWeek === weekday(date));
      if (!pattern || pattern.off) continue;
      let end = zonedDateTime(date, pattern.endTime, TZ);
      const start = zonedDateTime(date, pattern.startTime, TZ);
      if (end <= start) end = zonedDateTime(addDays(date, 1), pattern.endTime, TZ);
      rows.push({
        merchant_id: this.merchantId,
        employee_id: employeeId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: "scheduled",
      });
    }
    if (rows.length > 0) fail((await this.supabase.from("workforce_shifts").insert(rows)).error);
    await this.audit(actor, "schedule.save", "workforce_employees", employeeId, {});
  }

  async scheduleFor(actor: Actor, employeeId: string) {
    const employee = await this.mustEmployee(employeeId);
    this.assertMerchant(actor, employee.merchant_id);
    const { data, error } = await this.supabase
      .from("workforce_shifts")
      .select("id, starts_at, ends_at, status, notes")
      .eq("employee_id", employeeId)
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(21);
    fail(error);
    const weekly = new Map<number, { dayOfWeek: number; startTime: string; endTime: string }>();
    for (const shift of data ?? []) {
      const date = localDate(new Date(shift.starts_at), TZ);
      const dayOfWeek = weekday(date);
      if (weekly.has(dayOfWeek)) continue;
      weekly.set(dayOfWeek, {
        dayOfWeek,
        startTime: new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(shift.starts_at)),
        endTime: new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(shift.ends_at)),
      });
    }
    return { weekly: [...weekly.values()], exceptions: [] };
  }

  async setShiftException(
    actor: Actor,
    input: { employeeId: string; workDate: string; isDayOff: boolean; startTime: string; endTime: string; reason: string },
  ) {
    const employee = await this.mustEmployee(input.employeeId);
    this.assertMerchant(actor, employee.merchant_id);
    if (!input.reason.trim()) throw new DomainError("A shift change needs a reason.");
    const start = zonedDateTime(input.workDate, "00:00", TZ);
    const end = zonedDateTime(addDays(input.workDate, 1), "00:00", TZ);
    fail(
      (
        await this.supabase
          .from("workforce_shifts")
          .delete()
          .eq("employee_id", input.employeeId)
          .gte("starts_at", start.toISOString())
          .lt("starts_at", end.toISOString())
      ).error,
    );
    if (!input.isDayOff) {
      fail(
        (
          await this.supabase.from("workforce_shifts").insert({
            merchant_id: this.merchantId,
            employee_id: input.employeeId,
            starts_at: zonedDateTime(input.workDate, input.startTime || "09:00", TZ).toISOString(),
            ends_at: zonedDateTime(input.workDate, input.endTime || "17:00", TZ).toISOString(),
            status: "scheduled",
            notes: input.reason.trim(),
          })
        ).error,
      );
    }
    await this.audit(actor, "schedule.exception", "workforce_employees", input.employeeId, { workDate: input.workDate });
  }

  async listLeave(actor: Actor, locationId: string) {
    this.assertMerchant(actor, locationId);
    const { data, error } = await this.supabase
      .from("workforce_leave_requests")
      .select("id, employee_id, leave_type, starts_on, ends_on, status")
      .eq("merchant_id", this.merchantId)
      .order("starts_on", { ascending: false });
    fail(error);
    const people = await this.employeeRows(this.merchantId);
    return (data ?? [])
      .filter((row) => actor.role !== "employee" || row.employee_id === actor.employeeId)
      .map((row) => {
        const employee = people.find((person) => person.id === row.employee_id);
        return {
          ...row,
          leaveType: row.leave_type,
          startsOn: row.starts_on,
          endsOn: row.ends_on,
          status: row.status === "rejected" ? "denied" : row.status,
          employeeName: employee?.full_name ?? "Employee",
          employeeCode: employee?.employee_code ?? "",
        };
      });
  }

  async createLeave(actor: Actor, input: { employeeId: string; leaveType: string; startsOn: string; endsOn: string }) {
    const employee = await this.mustEmployee(input.employeeId);
    this.assertMerchant(actor, employee.merchant_id);
    const leaveType = input.leaveType.toLowerCase();
    const { error } = await this.supabase.from("workforce_leave_requests").insert({
      merchant_id: this.merchantId,
      employee_id: input.employeeId,
      leave_type: ["annual", "sick", "unpaid", "family", "other"].includes(leaveType) ? leaveType : "other",
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      status: "pending",
    });
    fail(error);
  }

  async decideLeave(actor: Actor, leaveId: string, status: "approved" | "denied") {
    this.assertMerchant(actor, this.merchantId);
    const { error } = await this.supabase
      .from("workforce_leave_requests")
      .update({
        status: status === "denied" ? "rejected" : "approved",
        decided_at: new Date().toISOString(),
        decided_by: actor.id,
      })
      .eq("id", leaveId)
      .eq("merchant_id", this.merchantId);
    fail(error);
  }

  async listDevices(actor: Actor, locationId: string) {
    this.assertMerchant(actor, locationId);
    const { data, error } = await this.supabase
      .from("workforce_devices")
      .select("id, device_code, name, status, match_threshold, last_seen_at")
      .eq("merchant_id", this.merchantId);
    if (error?.message.match(/workforce_devices|schema cache/i)) return [];
    fail(error);
    const now = Date.now();
    return (data ?? []).map((device) => ({
      id: device.id,
      deviceCode: device.device_code,
      name: device.name,
      status: device.status,
      matchThreshold: device.match_threshold,
      lastSeenAt: device.last_seen_at,
      online: Boolean(device.last_seen_at && now - Date.parse(device.last_seen_at) < 60_000),
    }));
  }

  async createDevice(actor: Actor, input: { locationId: string; name: string; deviceCode: string; matchThreshold: number }) {
    if (actor.role !== "admin") throw new DomainError("Only an administrator can register a device.", 403);
    const secret = newDeviceSecret();
    const { data, error } = await this.supabase.rpc("workforce_register_device", {
      p_merchant_id: this.merchantId,
      p_device_code: input.deviceCode.trim().toUpperCase(),
      p_name: input.name.trim(),
      p_match_threshold: input.matchThreshold,
      p_secret_hash: hashDeviceSecret(secret),
    });
    if (error?.message.match(/workforce_register_device|workforce_devices|schema cache/i)) {
      throw new DomainError("Run Redface Pay migration 0477_workforce_clock_features.sql before registering stations.");
    }
    fail(error);
    const registered = data as { id: string; device_code: string } | null;
    if (!registered?.id) throw new DomainError("Device registration did not return a station.");
    return { device: { id: registered.id, deviceCode: registered.device_code }, secret };
  }

  async setDeviceStatus(actor: Actor, deviceId: string, status: "active" | "disabled") {
    if (actor.role !== "admin") throw new DomainError("Only an administrator can change a device.", 403);
    fail((await this.supabase.from("workforce_devices").update({ status }).eq("id", deviceId).eq("merchant_id", this.merchantId)).error);
  }

  async deviceActivity(actor: Actor, deviceId: string) {
    this.assertMerchant(actor, this.merchantId);
    const { data: device } = await this.supabase.from("workforce_devices").select("device_code").eq("id", deviceId).maybeSingle();
    if (!device) return [];
    const { data, error } = await this.supabase
      .from("workforce_attendance_events")
      .select("id, employee_id, event_type, occurred_at, method")
      .eq("merchant_id", this.merchantId)
      .eq("device_label", device.device_code)
      .order("occurred_at", { ascending: false })
      .limit(12);
    fail(error);
    const people = await this.employeeRows(this.merchantId);
    return (data ?? []).map((event) => ({
      id: event.id,
      occurredAt: event.occurred_at,
      eventType: eventTypeFromDb(event.event_type),
      verificationMethod: methodFromDb(event.method),
      employeeName: people.find((person) => person.id === event.employee_id)?.full_name ?? "Employee",
    }));
  }

  async floor(actor: Actor, locationId: string, now = new Date(), departmentId?: string) {
    this.assertMerchant(actor, locationId);
    const workDate = localDate(now, TZ);
    const [employeeRows, events, shifts, leave] = await Promise.all([
      this.employeeRows(locationId),
      this.eventsOn(workDate),
      this.shiftsOn(workDate),
      this.leaveOn(workDate),
    ]);
    const people = employeeRows.filter((employee) => employee.employment_status === "active");
    const cards = people
      .filter((employee) => !departmentId || employee.department === departmentId)
      .filter((employee) => actor.role !== "employee" || employee.id === actor.employeeId)
      .map((employee) => {
        const shift = shifts.find((item) => item.employee_id === employee.id);
        const own = events.filter((event) => event.employeeId === employee.id);
        const day = calculateAttendanceDay({
          employeeId: employee.id,
          workDate,
          scheduledStart: shift ? new Date(shift.starts_at) : null,
          scheduledEnd: shift ? new Date(shift.ends_at) : null,
          isDayOff: false,
          onLeave: leave.has(employee.id),
          events: own,
          now,
          graceMinutes: 5,
          absenceCutoffMinutes: 60,
        });
        return {
          employeeId: employee.id,
          employeeCode: employee.employee_code ?? "",
          name: employee.full_name,
          department: employee.department ?? "—",
          presence: presenceState(own),
          status: day.status,
          lateMinutes: day.lateMinutes,
          potentialOvertimeMinutes: day.potentialOvertimeMinutes,
          scheduledLabel: scheduleLabel(day.scheduledStart, day.scheduledEnd, TZ),
          actualLabel: day.actualStart ? `In ${formatClock(day.actualStart, TZ)}` : "Not in",
          onLeave: day.status === "leave",
          dayOff: false,
          scheduledStart: day.scheduledStart,
          scheduledEnd: day.scheduledEnd,
        };
      });
    return classifyFloor(cards, now);
  }

  async listAttendance(actor: Actor, locationId: string, from: string, to: string, departmentId?: string) {
    this.assertMerchant(actor, locationId);
    const { data, error } = await this.supabase
      .from("workforce_attendance_days")
      .select("id, employee_id, work_date, first_clock_in, last_clock_out, minutes_worked, late_minutes, early_departure_minutes, overtime_minutes, status")
      .eq("merchant_id", this.merchantId)
      .gte("work_date", from)
      .lte("work_date", to);
    fail(error);
    const people = await this.employeeRows(this.merchantId);
    const { data: approvals } = await this.supabase
      .from("workforce_overtime_approvals")
      .select("attendance_day_id, minutes, status")
      .eq("merchant_id", this.merchantId);
    return (data ?? [])
      .map((row) => {
        const employee = people.find((person) => person.id === row.employee_id);
        const approval = (approvals ?? []).find((item) => item.attendance_day_id === row.id);
        return {
          ...row,
          employeeId: row.employee_id,
          employeeName: employee?.full_name ?? "Employee",
          employeeCode: employee?.employee_code ?? "",
          department: employee?.department ?? "",
          workDate: row.work_date,
          scheduledStart: null,
          scheduledEnd: null,
          actualStart: row.first_clock_in,
          actualEnd: row.last_clock_out,
          lateMinutes: row.late_minutes,
          earlyDepartureMinutes: row.early_departure_minutes,
          workedMinutes: row.minutes_worked,
          potentialOvertimeMinutes: row.overtime_minutes,
          approvedMinutes: approval?.status === "approved" ? approval.minutes : null,
          status: row.status,
        };
      })
      .filter((row) => !departmentId || row.department === departmentId)
      .filter((row) => actor.role !== "employee" || row.employeeId === actor.employeeId);
  }

  async listOvertime(actor: Actor, locationId: string) {
    this.assertMerchant(actor, locationId);
    const selected = await this.supabase
      .from("workforce_overtime_approvals")
      .select("id, employee_id, work_date, minutes, approved_minutes, status")
      .eq("merchant_id", this.merchantId)
      .order("work_date", { ascending: false });
    const fallback =
      selected.error?.message.includes("approved_minutes")
        ? await this.supabase
            .from("workforce_overtime_approvals")
            .select("id, employee_id, work_date, minutes, status")
            .eq("merchant_id", this.merchantId)
            .order("work_date", { ascending: false })
        : selected;
    fail(fallback.error);
    const people = await this.employeeRows(this.merchantId);
    return (fallback.data ?? [])
      .filter((row) => actor.role !== "employee" || row.employee_id === actor.employeeId)
      .map((row) => {
        const approvedMinutes = "approved_minutes" in row ? (row.approved_minutes as number | null) : row.status === "approved" ? row.minutes : null;
        return {
          id: row.id,
          workDate: row.work_date,
          employeeName: people.find((person) => person.id === row.employee_id)?.full_name ?? "Employee",
          employeeCode: people.find((person) => person.id === row.employee_id)?.employee_code ?? "",
          potentialMinutes: row.minutes,
          approvedMinutes: row.status === "approved" ? approvedMinutes : null,
          status: row.status,
        };
      });
  }

  async decideOvertime(actor: Actor, overtimeId: string, decision: { status: "approved" | "rejected"; approvedMinutes?: number }) {
    this.assertMerchant(actor, this.merchantId);
    const { data: current, error: readError } = await this.supabase
      .from("workforce_overtime_approvals")
      .select("minutes")
      .eq("id", overtimeId)
      .single();
    fail(readError);
    const approved = decision.status === "approved" ? (decision.approvedMinutes ?? current!.minutes) : 0;
    if (decision.status === "approved" && (approved < 0 || approved > current!.minutes)) {
      throw new DomainError("Approved overtime cannot exceed the potential overtime.");
    }
    const decided = {
      status: decision.status,
      decided_at: new Date().toISOString(),
      decided_by: actor.id,
      approved_minutes: decision.status === "approved" ? approved : null,
    };
    const updated = await this.supabase
      .from("workforce_overtime_approvals")
      .update(decided)
      .eq("id", overtimeId)
      .eq("merchant_id", this.merchantId);
    if (updated.error?.message.includes("approved_minutes")) {
      if (decision.status === "approved" && approved !== current!.minutes) {
        throw new DomainError("Partial overtime approval needs Redface Pay migration 0477_workforce_clock_features.sql.");
      }
      fail(
        (
          await this.supabase
            .from("workforce_overtime_approvals")
            .update({ status: decision.status, decided_at: decided.decided_at, decided_by: actor.id })
            .eq("id", overtimeId)
            .eq("merchant_id", this.merchantId)
        ).error,
      );
    } else fail(updated.error);
    await this.audit(actor, `overtime.${decision.status}`, "workforce_overtime_approvals", overtimeId, { approved });
  }

  async supervisorEvent(actor: Actor, input: { employeeId: string; eventType: EventType }) {
    const employee = await this.mustEmployee(input.employeeId);
    this.assertMerchant(actor, employee.merchant_id);
    if (input.eventType === "CLOCK_IN" || input.eventType === "CLOCK_OUT") {
      const { error } = await this.supabase.rpc("workforce_record_attendance", {
        p_merchant_id: this.merchantId,
        p_employee_id: input.employeeId,
        p_event_type: eventTypeToDb(input.eventType),
        p_method: "supervisor",
        p_match_score: null,
        p_device_label: "face-clockin",
        p_notes: null,
      });
      fail(error);
      return;
    }
    const { error } = await this.supabase.from("workforce_attendance_events").insert({
      merchant_id: this.merchantId,
      employee_id: input.employeeId,
      event_type: eventTypeToDb(input.eventType),
      method: "supervisor",
      device_label: "face-clockin",
      occurred_at: new Date().toISOString(),
    });
    if (error?.message.includes("event_type")) {
      throw new DomainError("Breaks need Redface Pay migration 0477_workforce_clock_features.sql.");
    }
    fail(error);
  }

  async manualAdjustment(actor: Actor, input: { employeeId: string; workDate: string; clockIn: string; clockOut: string; reason: string }) {
    const employee = await this.mustEmployee(input.employeeId);
    this.assertMerchant(actor, employee.merchant_id);
    if (input.reason.trim().length < 3) throw new DomainError("An adjustment needs a reason.");
    const rows = [];
    if (input.clockIn) {
      rows.push({
        merchant_id: this.merchantId,
        employee_id: input.employeeId,
        event_type: "clock_in",
        method: "manual",
        occurred_at: zonedDateTime(input.workDate, input.clockIn, TZ).toISOString(),
        notes: input.reason.trim(),
        device_label: "face-clockin",
      });
    }
    if (input.clockOut) {
      rows.push({
        merchant_id: this.merchantId,
        employee_id: input.employeeId,
        event_type: "clock_out",
        method: "manual",
        occurred_at: zonedDateTime(input.workDate, input.clockOut, TZ).toISOString(),
        notes: input.reason.trim(),
        device_label: "face-clockin",
      });
    }
    if (rows.length === 0) throw new DomainError("Enter a clock-in or clock-out time.");
    fail((await this.supabase.from("workforce_attendance_events").insert(rows)).error);
    await this.audit(actor, "attendance.adjust", "workforce_employees", input.employeeId, { reason: input.reason.trim() });
  }

  async listAudit(actor: Actor) {
    if (actor.role === "employee") throw new DomainError("Audit logs are for managers.", 403);
    const { data, error } = await this.supabase
      .from("workforce_audit_log")
      .select("id, actor_email, action, entity_type, detail, created_at")
      .eq("merchant_id", this.merchantId)
      .order("created_at", { ascending: false })
      .limit(200);
    fail(error);
    return (data ?? []).map((row) => ({
      id: row.id,
      actorLabel: row.actor_email ?? "Redface Pay",
      action: row.action,
      entityType: row.entity_type,
      metadata: row.detail ?? {},
      createdAt: row.created_at,
    }));
  }

  private async employeeRows(merchantId: string) {
    const { data, error } = await this.supabase
      .from("workforce_employees")
      .select("id, merchant_id, employee_code, full_name, email, job_title, department, employment_status, manager_employee_id, pin_hash")
      .eq("merchant_id", merchantId)
      .order("full_name");
    fail(error);
    return (data ?? []) as EmployeeRow[];
  }

  private async biometrics(ids: string[]) {
    const map = new Map<string, { status: string; consent_given_at: string | null; consent_version: string | null; descriptor: unknown; embedding_ciphertext: string | null; embedding_model: string | null; updated_at: string }>();
    if (ids.length === 0) return map;
    const selected = await this.supabase
      .from("workforce_biometric_profiles")
      .select("employee_id, status, consent_given_at, consent_version, descriptor, embedding_ciphertext, embedding_model, updated_at")
      .in("employee_id", ids);
    const fallback = selected.error?.message.includes("embedding_ciphertext")
      ? await this.supabase
          .from("workforce_biometric_profiles")
          .select("employee_id, status, consent_given_at, consent_version, descriptor, updated_at")
          .in("employee_id", ids)
      : selected;
    fail(fallback.error);
    for (const row of fallback.data ?? []) {
      map.set(row.employee_id, {
        ...row,
        embedding_ciphertext: "embedding_ciphertext" in row ? (row.embedding_ciphertext as string | null) : null,
        embedding_model: "embedding_model" in row ? (row.embedding_model as string | null) : null,
      });
    }
    return map;
  }

  private present(row: EmployeeRow, bio: { status: string; consent_given_at: string | null; descriptor: unknown; embedding_ciphertext: string | null } | undefined, people: EmployeeRow[]) {
    const name = splitName(row.full_name);
    const manager = people.find((person) => person.id === row.manager_employee_id);
    return {
      id: row.id,
      employeeCode: row.employee_code ?? "",
      firstName: name.firstName,
      lastName: name.lastName,
      name: row.full_name,
      locationId: row.merchant_id,
      department: row.department ?? "—",
      position: row.job_title ?? "—",
      manager: manager?.full_name ?? "—",
      status: row.employment_status,
      enrolled: Boolean(bio && (bio.embedding_ciphertext || bio.descriptor) && bio.status === "active"),
      consented: Boolean(bio?.consent_given_at),
    };
  }

  private async mustEmployee(id: string) {
    const { data, error } = await this.supabase
      .from("workforce_employees")
      .select("id, merchant_id, employee_code, full_name, email, job_title, department, employment_status, manager_employee_id, pin_hash")
      .eq("id", id)
      .maybeSingle();
    fail(error);
    if (!data) throw new DomainError("Employee not found.", 404);
    return data as EmployeeRow;
  }

  private async nextCode() {
    const rows = await this.employeeRows(this.merchantId);
    const numbers = rows.map((row) => Number(String(row.employee_code ?? "").replace(/\D/g, ""))).filter((value) => Number.isFinite(value));
    return `EMP-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
  }

  private async eventsOn(workDate: string): Promise<EngineEvent[]> {
    const start = zonedDateTime(workDate, "00:00", TZ).toISOString();
    const end = zonedDateTime(addDays(workDate, 1), "05:00", TZ).toISOString();
    const { data, error } = await this.supabase
      .from("workforce_attendance_events")
      .select("id, employee_id, event_type, occurred_at, notes")
      .eq("merchant_id", this.merchantId)
      .gte("occurred_at", start)
      .lt("occurred_at", end);
    fail(error);
    const mapped: EngineEvent[] = (data ?? []).map((event) => ({
      id: event.id,
      employeeId: event.employee_id,
      eventType: eventTypeFromDb(event.event_type),
      occurredAt: new Date(event.occurred_at),
      verificationStatus: "SUCCESS",
      adjustment: null,
    }));
    return eventsForWorkDate(mapped, workDate, TZ);
  }

  private async shiftsOn(workDate: string) {
    const start = zonedDateTime(workDate, "00:00", TZ).toISOString();
    const end = zonedDateTime(addDays(workDate, 1), "12:00", TZ).toISOString();
    const { data, error } = await this.supabase
      .from("workforce_shifts")
      .select("employee_id, starts_at, ends_at")
      .eq("merchant_id", this.merchantId)
      .eq("status", "scheduled")
      .gte("starts_at", start)
      .lt("starts_at", end);
    fail(error);
    return data ?? [];
  }

  private async leaveOn(workDate: string) {
    const { data, error } = await this.supabase
      .from("workforce_leave_requests")
      .select("employee_id")
      .eq("merchant_id", this.merchantId)
      .eq("status", "approved")
      .lte("starts_on", workDate)
      .gte("ends_on", workDate);
    fail(error);
    return new Set((data ?? []).map((row) => row.employee_id));
  }

  private async audit(actor: Actor, action: string, entityType: string, entityId: string, detail: Record<string, unknown>) {
    await this.supabase.from("workforce_audit_log").insert({
      merchant_id: this.merchantId,
      actor_user_id: actor.id,
      actor_email: actor.email,
      action,
      entity_type: entityType,
      entity_id: entityId,
      detail,
    });
  }

  private assertMerchant(actor: Actor, locationId: string) {
    if (actor.role === "admin") return;
    if (!actor.locationIds.includes(locationId)) throw new DomainError("You cannot view this merchant.", 403);
  }
}

export async function resolvePayMerchant(supabase: SupabaseClient, email: string) {
  const normalised = email.toLowerCase();
  const owned = await supabase.from("merchants").select("id, business_name").eq("email", normalised).limit(1).maybeSingle();
  if (owned.error) throw new DomainError(owned.error.message);
  if (owned.data?.id) {
    const employee = await supabase
      .from("workforce_employees")
      .select("id")
      .eq("merchant_id", owned.data.id)
      .eq("email", normalised)
      .eq("employment_status", "active")
      .maybeSingle();
    return {
      id: owned.data.id as string,
      name: (owned.data.business_name as string) || "Merchant",
      role: "admin" as const,
      employeeId: (employee.data?.id as string | undefined) ?? null,
    };
  }
  const staff = await supabase
    .from("merchant_staff")
    .select("merchant_id, role")
    .eq("email", normalised)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (staff.error) throw new DomainError(staff.error.message);
  if (!staff.data?.merchant_id) return null;
  const merchant = await supabase.from("merchants").select("id, business_name").eq("id", staff.data.merchant_id).maybeSingle();
  if (!merchant.data?.id) return null;
  const employee = await supabase
    .from("workforce_employees")
    .select("id")
    .eq("merchant_id", merchant.data.id)
    .eq("email", normalised)
    .eq("employment_status", "active")
    .maybeSingle();
  return {
    id: merchant.data.id as string,
    name: (merchant.data.business_name as string) || "Merchant",
    role: "manager" as const,
    employeeId: (employee.data?.id as string | undefined) ?? null,
  };
}
