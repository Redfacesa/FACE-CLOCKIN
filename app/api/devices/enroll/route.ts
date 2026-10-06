import { NextResponse } from "next/server";
import { z } from "zod";
import { DomainError } from "@/lib/domain/model";
import { deviceContext, payStationPaused, unauthorized } from "@/lib/api/device";

const bodySchema = z.object({
  employeeId: z.string().uuid(),
  embedding: z.array(z.number()).length(512),
  qualityScore: z.number().min(0).max(1),
  modelVersion: z.string().min(1),
  antispoofScore: z.number().min(0).max(1),
});

export async function POST(request: Request) {
  const context = await deviceContext(request);
  if (context === "pay") return payStationPaused();
  if (!context) return unauthorized();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid enrollment payload." }, { status: 400 });
  try {
    return NextResponse.json(context.store.enroll(context.device, parsed.data));
  } catch (error) {
    const message = error instanceof DomainError ? error.message : "Enrollment failed.";
    const status = error instanceof DomainError ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
