import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { handleError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get("region") ?? "Екатеринбург";
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20), 1), 100);
    const result = await query(
      `SELECT t.id, t.title, t.description, t.format, t.age_min, t.age_max,
              t.organization_id, o.name AS organization_name, t.region_id, r.name AS region_name,
              t.source_id, t.verified_at
       FROM professional_trials t
       LEFT JOIN organizations o ON o.id = t.organization_id
       LEFT JOIN regions r ON r.id = t.region_id
       WHERE t.is_active = true AND (r.name = $1 OR $1 = '')
       ORDER BY t.title LIMIT $2`,
      [region, limit]
    );
    return NextResponse.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    return handleError(error);
  }
}
