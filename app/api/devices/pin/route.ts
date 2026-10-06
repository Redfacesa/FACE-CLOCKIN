import { NextResponse } from "next/server";
import { z } from "zod";
import { DomainError } from "@/lib/domain/model";
import { deviceContext, payStationPaused, unauthorized } from "@/lib/api/device";

const bodySchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/),
  eventType: z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]),
  occurredAt: z.string().min(16),
  clientEventId: z.string().min(8).max(80),
});

export async function POST(request: Request) {
  const context = await deviceContext(request);
  if (context === "pay") return payStationPaused();
  if (!context) return unauthorized();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid PIN payload." }, { status: 400 });
  try {
    return NextResponse.json(context.store.pinEvent(context.device, parsed.data));
  } catch (error) {
    const message = error instanceof DomainError ? error.message : "PIN was rejected.";
    const status = error instanceof DomainError ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
