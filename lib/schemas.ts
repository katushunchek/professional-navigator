
import { z } from "zod";

export const trackSchema = z.object({
  sessionId: z.string().uuid(),
  trackType: z.enum(["explore", "interests", "known_direction"]),
});

const diagnosticAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(100),
  answer: z.union([
    z.string().trim().min(1).max(1000),
    z.number().finite(),
    z.boolean(),
    z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  ]),
});

export const diagnosticSchema = z.object({
  sessionId: z.string().uuid(),
  answers: z
    .array(diagnosticAnswerSchema)
    .min(1)
    .max(100)
    .superRefine((answers, ctx) => {
      const seen = new Set<string>();

      answers.forEach((item, index) => {
        if (seen.has(item.questionId)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "questionId"],
            message: "Duplicate questionId",
          });
        }

        seen.add(item.questionId);
      });
    }),
});

export const reflectionSchema = z.object({
  sessionId: z.string().uuid(),
  recommendationId: z.string().uuid().optional(),
  rating: z.enum(["useful", "unsure", "not_useful"]),
  comment: z.string().max(1000).optional(),
});
