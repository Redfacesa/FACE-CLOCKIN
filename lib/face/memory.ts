import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DomainError, NOTICE_VERSION } from "@/lib/domain/model";
import { cosineSimilarity, decryptEmbedding, encryptEmbedding, loadBiometricKey } from "@/lib/crypto/embedding";
import { resolvePayMerchant } from "@/lib/repository/pay-store";
import { paySession } from "@/lib/supabase/pay";

const execFileAsync = promisify(execFile);
const MATCH_THRESHOLD = 0.4;

type Capture = {
  embedding: number[];
  quality: number;
  model: string;
};

export type FacePerson = {
  id: string;
  name: string;
  employeeCode: string;
  consented: boolean;
  enrolled: boolean;
};

function biometricKey() {
  const raw = process.env.BIOMETRIC_KEY ?? "";
  if (!raw) throw new DomainError("BIOMETRIC_KEY is not set on this computer, so a face template cannot be saved.");
  return loadBiometricKey(raw);
}

async function merchantContext(purpose: "admin" | "kiosk" = "admin") {
  const session = await paySession();
  if (!session?.user.email) {
    throw new DomainError(
      purpose === "kiosk"
        ? "Open Admin on this screen and sign in once. The camera only recognises faces an admin has already captured."
        : "Sign in from Admin before capturing a face.",
      401,
    );
  }
  const merchant = await resolvePayMerchant(session.supabase, session.user.email);
  if (!merchant) throw new DomainError("This Redface Pay account is not linked to a merchant.", 403);
  return { ...session, merchant };
}

export async function listFacePeople(): Promise<FacePerson[]> {
  const { supabase, merchant } = await merchantContext();
  const employees = await supabase
    .from("workforce_employees")
    .select("id, full_name, employee_code")
    .eq("merchant_id", merchant.id)
    .eq("employment_status", "active")
    .order("full_name");
  if (employees.error) throw new DomainError(employees.error.message);
  const ids = (employees.data ?? []).map((row) => row.id);
  const bios = await loadProfiles(supabase, ids);
  const byEmployee = new Map(bios.map((row) => [row.employee_id, row]));
  return (employees.data ?? []).map((row) => {
    const bio = byEmployee.get(row.id);
    return {
      id: row.id,
      name: row.full_name,
      employeeCode: row.employee_code ?? "",
      consented: Boolean(bio?.consent_given_at),
      enrolled: Boolean(bio?.consent_given_at && bio.status === "active" && hasTemplate(bio)),
    };
  });
}

export async function rememberFace(employeeId: string, frames: [string, string]) {
  const { supabase, merchant, user } = await merchantContext();
  const employee = await mustEmployee(supabase, merchant.id, employeeId);
  const profile = await mustConsent(supabase, employeeId);
  const capture = await embedFrames(frames);
  const blob = encryptEmbedding(capture.embedding, biometricKey()).toString("base64");
  const saved = await supabase
    .from("workforce_biometric_profiles")
    .update({
      embedding_ciphertext: blob,
      embedding_model: capture.model,
      status: "active",
      consent_version: profile.consent_version ?? NOTICE_VERSION,
    })
    .eq("id", profile.id)
    .eq("merchant_id", merchant.id);
  if (saved.error?.message.includes("embedding_ciphertext")) {
    throw new DomainError("Apply supabase/migrations/0002_redface_pay_clock_features.sql before saving a face.");
  }
  if (saved.error) throw new DomainError(saved.error.message);
  await supabase.from("workforce_audit_log").insert({
    merchant_id: merchant.id,
    actor_user_id: user.id,
    actor_email: user.email,
    action: "biometric.enroll",
    entity_type: "workforce_employees",
    entity_id: employee.id,
    detail: { model: capture.model, stored: "embedding_ciphertext" },
  });
  return { name: employee.full_name as string };
}

export async function clockByFace(eventType: "CLOCK_IN" | "CLOCK_OUT", frames: [string, string]) {
  const { supabase, merchant, user } = await merchantContext("kiosk");
  const capture = await embedFrames(frames);
  const profiles = await loadProfiles(
    supabase,
    [],
    merchant.id,
  );
  const key = biometricKey();
  const ranked = profiles
    .filter((row) => row.status === "active" && row.consent_given_at)
    .map((row) => {
      const stored = readEmbedding(row, key);
      return stored ? { employeeId: row.employee_id as string, score: cosineSimilarity(capture.embedding, stored) } : null;
    })
    .filter((row): row is { employeeId: string; score: number } => Boolean(row))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < MATCH_THRESHOLD) {
    throw new DomainError("This face is not recognised. An admin must capture it before the camera can match them.", 404);
  }
  if (second && best.score - second.score < 0.05) {
    throw new DomainError("Two saved faces were too similar. Ask the person to face the camera again.");
  }
  const employee = await mustEmployee(supabase, merchant.id, best.employeeId);
  const recorded = await supabase.rpc("workforce_record_attendance", {
    p_merchant_id: merchant.id,
    p_employee_id: employee.id,
    p_event_type: eventType === "CLOCK_IN" ? "clock_in" : "clock_out",
    p_method: "face",
    p_match_score: Number(best.score.toFixed(4)),
    p_device_label: "face-clockin-camera",
    p_notes: "Live face match. Template only, no photograph stored.",
  });
  if (recorded.error) throw new DomainError(recorded.error.message);
  await supabase.from("workforce_audit_log").insert({
    merchant_id: merchant.id,
    actor_user_id: user.id,
    actor_email: user.email,
    action: eventType === "CLOCK_IN" ? "attendance.face_clock_in" : "attendance.face_clock_out",
    entity_type: "workforce_employees",
    entity_id: employee.id,
    detail: { score: Number(best.score.toFixed(4)) },
  });
  return { name: employee.full_name as string, score: best.score };
}

async function mustEmployee(supabase: Awaited<ReturnType<typeof merchantContext>>["supabase"], merchantId: string, employeeId: string) {
  const row = await supabase
    .from("workforce_employees")
    .select("id, full_name, employment_status")
    .eq("id", employeeId)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (row.error) throw new DomainError(row.error.message);
  if (!row.data || row.data.employment_status !== "active") throw new DomainError("That employee is not active.", 404);
  return row.data;
}

async function mustConsent(supabase: Awaited<ReturnType<typeof merchantContext>>["supabase"], employeeId: string) {
  const row = await supabase
    .from("workforce_biometric_profiles")
    .select("id, consent_given_at, consent_version, status")
    .eq("employee_id", employeeId)
    .eq("modality", "face")
    .maybeSingle();
  if (row.error) throw new DomainError(row.error.message);
  if (!row.data?.consent_given_at || row.data.status === "deleted") {
    throw new DomainError("Record consent on the employee page before saving a face.");
  }
  return row.data;
}

type ProfileRow = {
  employee_id: string;
  status: string;
  consent_given_at: string | null;
  descriptor: unknown;
  embedding_ciphertext: string | null;
};

async function loadProfiles(
  supabase: Awaited<ReturnType<typeof merchantContext>>["supabase"],
  ids: string[],
  merchantId?: string,
): Promise<ProfileRow[]> {
  let query = supabase
    .from("workforce_biometric_profiles")
    .select("employee_id, status, consent_given_at, descriptor, embedding_ciphertext");
  if (merchantId) query = query.eq("merchant_id", merchantId).eq("modality", "face");
  if (ids.length > 0) query = query.in("employee_id", ids);
  if (!merchantId && ids.length === 0) return [];
  const selected = await query;
  if (selected.error?.message.includes("embedding_ciphertext")) {
    let legacy = supabase.from("workforce_biometric_profiles").select("employee_id, status, consent_given_at, descriptor");
    if (merchantId) legacy = legacy.eq("merchant_id", merchantId).eq("modality", "face");
    if (ids.length > 0) legacy = legacy.in("employee_id", ids);
    const fallback = await legacy;
    if (fallback.error) throw new DomainError(fallback.error.message);
    return (fallback.data ?? []).map((row) => ({ ...row, embedding_ciphertext: null }));
  }
  if (selected.error) throw new DomainError(selected.error.message);
  return (selected.data ?? []) as ProfileRow[];
}

function hasTemplate(profile: { descriptor: unknown; embedding_ciphertext: string | null }) {
  if (profile.embedding_ciphertext) return true;
  const descriptor = profile.descriptor;
  if (!descriptor) return false;
  if (Array.isArray(descriptor)) return descriptor.length === 512;
  if (typeof descriptor === "object" && "blob" in descriptor) return Boolean((descriptor as { blob?: string }).blob);
  return false;
}

function readEmbedding(profile: { descriptor: unknown; embedding_ciphertext: string | null }, key: ReturnType<typeof biometricKey>): number[] | null {
  if (profile.embedding_ciphertext) return decryptEmbedding(Buffer.from(profile.embedding_ciphertext, "base64"), key);
  const descriptor = profile.descriptor;
  if (Array.isArray(descriptor) && descriptor.length === 512 && descriptor.every((value) => typeof value === "number")) {
    return descriptor;
  }
  if (!descriptor || typeof descriptor !== "object" || !("blob" in descriptor)) return null;
  const blob = (descriptor as { blob?: string }).blob;
  if (!blob) return null;
  return decryptEmbedding(Buffer.from(blob, "base64"), key);
}

async function runFacePython(script: string, first: string, second: string) {
  const candidates = [process.env.FACE_PYTHON, "/usr/bin/python3", "/usr/local/bin/python3", "python3"].filter(
    (item): item is string => Boolean(item),
  );
  let missing = true;
  let detail = "Python could not be started.";
  for (const python of candidates) {
    try {
      const { stdout } = await execFileAsync(python, [script, first, second], {
        timeout: 120_000,
        maxBuffer: 2_000_000,
        env: { ...process.env, PATH: `/usr/bin:/bin:/usr/local/bin:${process.env.PATH ?? ""}` },
      });
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("ENOENT")) continue;
      missing = false;
      detail = message;
      break;
    }
  }
  throw new DomainError(missing ? "Python could not be started on this computer." : detail.slice(0, 240), 503);
}

async function embedFrames(frames: [string, string]): Promise<Capture> {
  const folder = await mkdtemp(path.join(tmpdir(), "fc-face-"));
  const first = path.join(folder, "first.jpg");
  const second = path.join(folder, "second.jpg");
  try {
    await writeFile(first, Buffer.from(frames[0], "base64"));
    await writeFile(second, Buffer.from(frames[1], "base64"));
    const script = path.join(process.cwd(), "device", "station", "embed_frames.py");
    const stdout = await runFacePython(script, first, second);
    const line = stdout
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => item.startsWith("{"))
      .at(-1);
    const parsed = JSON.parse(line ?? "{}") as { ok?: boolean; message?: string; embedding?: number[]; quality?: number; model?: string };
    if (!parsed.ok || !parsed.embedding || parsed.quality == null || !parsed.model) {
      throw new DomainError(parsed.message || "The camera could not read a face.");
    }
    return { embedding: parsed.embedding, quality: parsed.quality, model: parsed.model };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("The camera could not read a face. Face the camera and try again.");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
