/**
 * GET /api/applications/[id] — one application's full record. Decisions are
 * client-side (localStorage), so only the record is returned here.
 */
import { NextResponse } from "next/server";
import { getApplication } from "@/lib/cola-store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const application = await getApplication(id);
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  return NextResponse.json({ application });
}
