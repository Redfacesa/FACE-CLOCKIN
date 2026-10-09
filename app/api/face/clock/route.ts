import { NextResponse } from "next/server";
import { z } from "zod";
import { DomainError } from "@/lib/domain/model";
import { clockByFace } from "@/lib/face/memory";
import { faceRequestIsLocal, rejectRemoteFaceRequest } from "@/lib/face/same-device";

const bodySchema = z.object({
  eventType: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  frames: z.tuple([z.string().min(1000), z.string().min(1000)]),
});

export async function POST(request: Request) {
  if (!faceRequestIsLocal(request)) return rejectRemoteFaceRequest();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The camera did not send two frames." }, { status: 400 });
  try {
    const result = await clockByFace(parsed.data.eventType, parsed.data.frames);
    const action = parsed.data.eventType === "CLOCK_IN" ? "clocked in" : "clocked out";
    return NextResponse.json({
      ok: true,
      message: `${result.name} ${action}. Match ${Math.round(result.score * 100)}%.`,
    });
  } catch (error) {
    const message = error instanceof DomainError ? error.message : "Face clock-in failed.";
    const status = error instanceof DomainError ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
