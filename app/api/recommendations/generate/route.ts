import { NextRequest, NextResponse } from "next/server";

import {
  compactAnswers,
  extractChatContent,
  isAbortError,
  parseAIResponse,
  requestChatCompletion,
  summarizeAiParseFailure,
} from "@/lib/ai";
import { graphProfessionByExternalId } from "@/lib/catalog-data";
import {
  saveClarificationAnswers,
  validateClarificationAnswers,
} from "@/lib/clarification";
import { isMissingSchemaError, pool, query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";
import {
  buildPathwayOptions,
  classifyOpportunity,
  type CatalogOpportunity,
  type PathwayType,
} from "@/lib/pathways";
import { generateRecommendationsSchema } from "@/lib/schemas";
import { requireExistingSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asOpportunity(row: {
  id: string;
  title: string;
  institution: string | null;
  level: string | null;
  url: string | null;
  organization_name: string | null;
  organization_type: string | null;
  website: string | null;
  contact_email: string | null;
  profession_ids: string[] | null;
}): CatalogOpportunity {
  return {
    id: row.id,
    title: row.title,
    institution: row.institution,
    level: row.level,
    url: row.url,
    organizationName: row.organization_name,
    organizationType: row.organization_type,
    website: row.website,
    contactEmail: row.contact_email,
    professionIds: row.profession_ids ?? [],
  };
}

function graphFallbacks(externalIds: string[]) {
  const result: Partial<Record<PathwayType, CatalogOpportunity | null>> = {};

  for (const externalId of externalIds) {
    const node = graphProfessionByExternalId(externalId);
    for (const program of node?.education_programs ?? []) {
      const opportunity: CatalogOpportunity = {
        id: program.program_id,
        title: program.name,
        institution: program.organization,
        level: program.level,
        url: null,
        organizationName: program.organization,
        organizationType: null,
        website: null,
        contactEmail: null,
        professionIds: [],
      };
      const type = classifyOpportunity(opportunity);
      if (type !== "other" && !result[type]) {
        result[type] = opportunity;
      }
    }
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireExistingSession(request);
    if ("error" in session) {
      return session.error;
    }
    const validSessionId = session.sessionId;

    let rawBody: unknown = {};
    try {
      const rawText = await request.text();
      rawBody = rawText.trim() ? JSON.parse(rawText) : {};
    } catch (error) {
      if (error instanceof SyntaxError) {
        return jsonError("Request body must be valid JSON");
      }
      throw error;
    }
    const parsedBody = generateRecommendationsSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return handleError(parsedBody.error);
    }

    const diagnostic = await query(
      `SELECT
         d.id,
         d.submitted_at,
         json_agg(
           json_build_object(
             'questionId', da.question_id,
             'answer', da.answer
           )
           ORDER BY da.created_at
         ) AS answers
       FROM diagnostics d
       JOIN diagnostic_answers da
         ON da.diagnostic_id = d.id
       WHERE d.session_id = $1
       GROUP BY d.id, d.submitted_at
       ORDER BY d.submitted_at DESC
       LIMIT 1`,
      [validSessionId]
    );

    if (diagnostic.rowCount === 0) {
      return jsonError(
        "Complete the diagnostic before generating recommendations",
        409
      );
    }

    if (parsedBody.data.clarificationAnswers) {
      const clarificationErrors = validateClarificationAnswers(
        parsedBody.data.clarificationAnswers
      );
      if (clarificationErrors.length > 0) {
        return jsonError("Invalid clarification answers", 422, clarificationErrors);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await saveClarificationAnswers(client, {
          sessionId: validSessionId,
          diagnosticId: diagnostic.rows[0].id as string,
          answers: parsedBody.data.clarificationAnswers,
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const baseUrl = process.env.AI_API_BASE_URL;
    const apiKey = process.env.AI_API_KEY;
    const model = process.env.AI_MODEL;
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 45_000);

    if (!baseUrl || !apiKey || !model) {
      console.error("AI gateway environment variables are missing");
      return jsonError("AI service is not configured", 503);
    }

    const clarification = await query(
      `SELECT
         json_agg(
           json_build_object(
             'questionId', ca.question_id,
             'answer', ca.answer
           )
           ORDER BY ca.created_at
         ) AS answers
       FROM clarifications c
       JOIN clarification_answers ca
         ON ca.clarification_id = c.id
       WHERE c.session_id = $1
       GROUP BY c.id, c.submitted_at
       ORDER BY c.submitted_at DESC
       LIMIT 1`,
      [validSessionId]
    );

    const profileResult = await query(
      `SELECT school_grade, municipality, preferences
       FROM profiles
       WHERE session_id = $1`,
      [validSessionId]
    );

    const profile = profileResult.rows[0] ?? {
      school_grade: null,
      municipality: "Екатеринбург",
      preferences: {},
    };

    const professionsResult = await query(
      `SELECT
         p.id,
         p.external_id,
         p.title,
         LEFT(COALESCE(p.description, ''), 280) AS description,
         i.name AS industry_name,
         p.riasec
       FROM professions p
       LEFT JOIN industries i
         ON p.industry_id = i.id
       WHERE p.is_active = TRUE
       ORDER BY p.title ASC
       LIMIT 40`
    );

    if (professionsResult.rowCount === 0) {
      return jsonError("Profession catalog is empty", 503);
    }

    const trialsResult = await query(
      `SELECT
         id,
         title,
         LEFT(COALESCE(description, ''), 220) AS description,
         format,
         duration_minutes,
         municipality,
         cost,
         profession_id,
         source_url
       FROM professional_trials
       WHERE is_active = TRUE
       ORDER BY title ASC
       LIMIT 30`
    );

    const programsResult = await query(
      `SELECT
         ep.id,
         ep.title,
         ep.institution,
         ep.level,
         ep.url,
         o.name AS organization_name,
         o.organization_type,
         o.website,
         o.contact_email,
         COALESCE(
           array_agg(pp.profession_id) FILTER (WHERE pp.profession_id IS NOT NULL),
           '{}'
         ) AS profession_ids
       FROM education_programs ep
       LEFT JOIN organizations o
         ON o.id = ep.organization_id
       LEFT JOIN program_professions pp
         ON pp.program_id = ep.id
       WHERE ep.is_active = TRUE
       GROUP BY
         ep.id, o.name, o.organization_type, o.website, o.contact_email
       ORDER BY ep.title ASC
       LIMIT 80`
    );

    const allowedProfessionIds = new Set(
      professionsResult.rows.map((item) => item.id as string)
    );
    const allowedTrialIds = new Set(
      trialsResult.rows.map((item) => item.id as string)
    );
    const opportunities = programsResult.rows.map((row) =>
      asOpportunity(
        row as {
          id: string;
          title: string;
          institution: string | null;
          level: string | null;
          url: string | null;
          organization_name: string | null;
          organization_type: string | null;
          website: string | null;
          contact_email: string | null;
          profession_ids: string[] | null;
        }
      )
    );
    const allowedProgramIds = new Set(opportunities.map((item) => item.id));

    const prompt = {
      note: "Это не векторный RAG: в модель передаётся ограниченный каталог и ответы ученика.",
      profile: {
        schoolGrade: profile.school_grade,
        municipality: profile.municipality,
      },
      diagnosticAnswers: compactAnswers(diagnostic.rows[0].answers),
      clarificationAnswers: compactAnswers(clarification.rows[0]?.answers),
      professions: professionsResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        industry: row.industry_name,
        catalogRiasecProfileNotStudentScores: row.riasec,
      })),
      educationPrograms: opportunities.map((item) => ({
        id: item.id,
        title: item.title,
        institution: item.institution,
        level: item.level,
        pathwayType: classifyOpportunity(item),
        hasVerifiedUrl: Boolean(item.url || item.website),
        professionIds: item.professionIds,
      })),
      professionalTrials: trialsResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        format: row.format,
      })),
      outputRules: {
        professionId: "только professions[].id — UUID с дефисами",
        trialIds: "массив UUID или []",
        pathwayIds: "UUID из educationPrograms[].id или JSON null, не пустая строка",
        format: "один JSON-объект camelCase без markdown",
      },
    };

    let aiResponse: Response;
    try {
      aiResponse = await requestChatCompletion({
        baseUrl,
        apiKey,
        model,
        userPayload: prompt,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 45_000,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return jsonError("AI service request timed out", 504);
      }
      throw error;
    }

    if (!aiResponse.ok) {
      console.error("AI gateway returned HTTP", aiResponse.status);
      return jsonError("AI service request failed", 502);
    }

    let completion: unknown;
    try {
      completion = await aiResponse.json();
    } catch {
      return jsonError("AI service returned an invalid response", 502);
    }
    const content = extractChatContent(completion) ?? completion;

    if (
      content == null ||
      (typeof content === "string" && !content.trim()) ||
      (Array.isArray(content) && content.length === 0)
    ) {
      return jsonError("AI service returned an empty response", 502);
    }

    const professionIdByExternalId = new Map<string, string>();
    const professionIdByTitle = new Map<string, string>();
    for (const row of professionsResult.rows) {
      const id = String(row.id);
      if (typeof row.external_id === "string" && row.external_id) {
        professionIdByExternalId.set(row.external_id.toLowerCase(), id);
      }
      if (typeof row.title === "string" && row.title.trim()) {
        professionIdByTitle.set(row.title.trim().toLowerCase(), id);
      }
    }

    let recommendation;
    try {
      recommendation = parseAIResponse(content, {
        professionIdByExternalId,
        professionIdByTitle,
      });
    } catch (error) {
      const report = summarizeAiParseFailure(error, content);
      console.error("AI response does not match the expected schema", report);
      return jsonError("AI service returned an invalid response", 502, {
        schemaIssues: report.schemaIssues,
        parseStage: report.stage,
      });
    }

    const professionById = new Map(
      professionsResult.rows.map((row) => [row.id as string, row])
    );
    const hypotheses = recommendation.hypotheses.flatMap((item) => {
      const profession = professionById.get(item.professionId);
      if (!profession || !allowedProfessionIds.has(item.professionId)) {
        return [];
      }

      return [
        {
          professionId: item.professionId,
          title: profession.title as string,
          reason: item.reason,
          fitScore: item.fitScore,
          scoreKind: "relative_ranking" as const,
        },
      ];
    });

    if (hypotheses.length === 0) {
      return jsonError(
        "AI could not match recommendations to the profession catalog",
        502
      );
    }

    const trialIds = recommendation.trialIds.filter((id) =>
      allowedTrialIds.has(id)
    );

    const preferredProgramIds = [
      recommendation.pathways?.clubProgramId,
      recommendation.pathways?.collegeProgramId,
      recommendation.pathways?.onlineCourseProgramId,
    ].filter((id): id is string => typeof id === "string" && allowedProgramIds.has(id));

    const selectedProfessionIds = hypotheses.map((item) => item.professionId);
    const selectedExternalIds = professionsResult.rows
      .filter((row) => selectedProfessionIds.includes(row.id as string))
      .map((row) => row.external_id as string)
      .filter(Boolean);

    const nextStepOptions = buildPathwayOptions({
      opportunities,
      preferredProgramIds,
      professionIds: selectedProfessionIds,
      graphFallbacks: graphFallbacks(selectedExternalIds),
    });

    const saved = await query(
      `INSERT INTO recommendations (
         session_id,
         summary,
         hypotheses,
         trial_ids,
         next_step,
         pathways,
         model_name
       )
       VALUES ($1, $2, $3::jsonb, $4::uuid[], $5, $6::jsonb, $7)
       RETURNING id, created_at`,
      [
        validSessionId,
        recommendation.summary,
        JSON.stringify(hypotheses),
        trialIds,
        recommendation.nextStep,
        JSON.stringify(nextStepOptions),
        model,
      ]
    );

    const result = saved.rows[0];

    return NextResponse.json(
      {
        status: "generated",
        recommendationId: result.id,
        sessionId: validSessionId,
        summary: recommendation.summary,
        hypotheses,
        trials: trialsResult.rows.filter((trial) =>
          trialIds.includes(trial.id as string)
        ),
        nextStep: recommendation.nextStep,
        nextStepOptions,
        model,
        createdAt: result.created_at,
      },
      { status: 201 }
    );
  } catch (error) {
    if (isAbortError(error)) {
      return jsonError("AI service request timed out", 504);
    }
    if (isMissingSchemaError(error)) {
      return jsonError(
        "Database schema is outdated. Run npm run db:migrate",
        503
      );
    }
    return handleError(error);
  }
}
