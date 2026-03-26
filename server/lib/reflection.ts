import OpenAI from "openai";
import type { LessonReflection, LessonTurn, TutorMemory } from "./types.js";

const reflectionSchema = {
  name: "italian_lesson_reflection",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      strengths: {
        type: "array",
        items: { type: "string" }
      },
      needsWork: {
        type: "array",
        items: { type: "string" }
      },
      nextDrills: {
        type: "array",
        items: { type: "string" }
      },
      cultureMoments: {
        type: "array",
        items: { type: "string" }
      },
      vocabulary: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            italian: { type: "string" },
            english: { type: "string" },
            example: { type: "string" }
          },
          required: ["italian", "english", "example"]
        }
      },
      updatedProfile: {
        type: "object",
        additionalProperties: false,
        properties: {
          levelEstimate: { type: "string" },
          confidence: { type: "string" },
          preferredTopics: {
            type: "array",
            items: { type: "string" }
          },
          correctionPriorities: {
            type: "array",
            items: { type: "string" }
          },
          nextSessionFocus: { type: "string" },
          tutorNotes: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: [
          "levelEstimate",
          "confidence",
          "preferredTopics",
          "correctionPriorities",
          "nextSessionFocus",
          "tutorNotes"
        ]
      }
    },
    required: [
      "title",
      "summary",
      "strengths",
      "needsWork",
      "nextDrills",
      "cultureMoments",
      "vocabulary",
      "updatedProfile"
    ]
  },
  strict: true
} as const;

function buildTranscriptSnippet(turns: LessonTurn[]) {
  return turns
    .slice(-16)
    .map((turn) => `${turn.speaker === "you" ? "Learner" : "Tutor"}: ${turn.text}`)
    .join("\n");
}

function fallbackReflection(memory: TutorMemory, focus: string): LessonReflection {
  return {
    title: "Short speaking checkpoint",
    summary:
      "A brief Italian speaking session was captured. The next lesson should revisit the same scene with one slightly longer answer.",
    strengths: ["Showed up and produced spoken Italian in context."],
    needsWork: ["Build slightly longer answers with less hesitation."],
    nextDrills: [`Repeat the ${focus.toLowerCase()} scene with two-sentence answers.`],
    cultureMoments: ["Keep the next lesson anchored in a real, modern Italian daily-life setting."],
    vocabulary: [],
    updatedProfile: {
      levelEstimate: memory.profile.levelEstimate,
      confidence: "Confidence grows with repeat live speaking turns.",
      preferredTopics: memory.profile.preferredTopics,
      correctionPriorities: memory.profile.correctionPriorities,
      nextSessionFocus: focus,
      tutorNotes: memory.profile.tutorNotes
    }
  };
}

export async function reflectLessonWithAI(input: {
  client: OpenAI;
  memory: TutorMemory;
  focus: string;
  presetLabel: string;
  turns: LessonTurn[];
}) {
  if (input.turns.length < 2) {
    return fallbackReflection(input.memory, input.focus);
  }

  try {
    const response = await input.client.responses.create({
      model: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-4.1-mini",
      max_output_tokens: 900,
      text: {
        format: {
          type: "json_schema",
          ...reflectionSchema
        }
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You summarize Italian speaking lessons and update tutor memory.",
                "Keep the reflection practical, specific, and tuned for the next live speaking session.",
                "Do not overstate progress. Reward effort but stay concrete.",
                "Assume one learner only.",
                "Prefer next-step drills that can be spoken aloud in under three minutes each."
              ].join("\n")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Session preset: ${input.presetLabel}`,
                `Session focus: ${input.focus}`,
                `Current learner profile: ${JSON.stringify(input.memory.profile)}`,
                "Transcript excerpt:",
                buildTranscriptSnippet(input.turns)
              ].join("\n\n")
            }
          ]
        }
      ]
    });

    return JSON.parse(response.output_text) as LessonReflection;
  } catch {
    return fallbackReflection(input.memory, input.focus);
  }
}
