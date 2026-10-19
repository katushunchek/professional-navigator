import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export async function GET() {
  try {
    await query("SELECT 1");
    return NextResponse.json({ status: "ok", database: "connected", service: "professional-navigator-api" });
  } catch {
    return NextResponse.json({ status: "error", database: "disconnected" }, { status: 503 });
  }
}
