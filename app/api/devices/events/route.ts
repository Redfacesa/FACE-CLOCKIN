import { NextResponse } from "next/server";
import { z } from "zod";
import { deviceContext, payStationPaused, unauthorized } from "@/lib/api/device";

const bodySchema = z.object({
  events: z.array(
    z.object({
      clientEventId: z.string().min(8).max(80),
      employeeId: z.string().uuid(),
      eventType: z.enum(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"]),
      occurredAt: z.string().min(16),
      verificationMethod: z.enum(["FACIAL", "PIN", "CARD"]),
      verificationStatus: z.enum(["SUCCESS", "FAILED"]),
      confidenceScore: z.number().min(0).max(1).nullable().optional(),
      livenessPassed: z.boolean().optional(),
    }),
  ),
});

export async function POST(request: Request) {
  const context = await deviceContext(request);
  if (context === "pay") return payStationPaused();
  if (!context) return unauthorized();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  const results = context.store.ingestEvents(context.device, parsed.data.events);
  return NextResponse.json({ results });
}
