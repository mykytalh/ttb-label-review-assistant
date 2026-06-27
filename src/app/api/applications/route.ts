/**
 * GET /api/applications — the review queue (the read side of the simulated COLA
 * service; see `cola-store.ts`). Decisions are kept client-side (localStorage),
 * so this returns just the application records.
 */
import { NextResponse } from "next/server";
import { listApplications } from "@/lib/cola-store";

export async function GET() {
  const applications = await listApplications();
  return NextResponse.json({ applications });
}
