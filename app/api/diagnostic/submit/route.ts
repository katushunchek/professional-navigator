import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";
import { diagnosticSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const parsed = diagnosticSchema.safeParse(await request.json());
    if (!parsed.success) return handleError(parsed.error);
    const { sessionId, answers } = parsed.data;
    const session = await query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
    if (session.rowCount === 0) return jsonError("Session not found. Select a track first.", 404);

    const client = await (await import("@/lib/db")).pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "INSERT INTO diagnostics (session_id, submitted_at) VALUES ($1, now()) RETURNING id",
        [sessionId]
      );
      const diagnosticId = result.rows[0].id as string;
      for (const item of answers) {
        await client.query(
          `INSERT INTO diagnostic_answers (diagnostic_id, question_id, answer)
           VALUES ($1, $2, $3::jsonb)`,
          [diagnosticId, item.questionId, JSON.stringify(item.answer)]
        );
      }
      await client.query("COMMIT");
      return NextResponse.json({ diagnosticId, savedAnswers: answers.length, status: "submitted" }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError("Request body must be valid JSON");
    return handleError(error);
  }
}
