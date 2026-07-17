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
            example: { type: "string" },
            strength: { type: "integer", minimum: 1, maximum: 5 }
          },
          required: ["italian", "english", "example", "strength"]
        }
      },
      curriculum: {
        type: "object",
        additionalProperties: false,
        properties: {
          mastered: { type: "array", items: { type: "string" } },
          workingOn: { type: "array", items: { type: "string" } },
          strugglingWith: { type: "array", items: { type: "string" } }
        },
        required: ["mastered", "workingOn", "strugglingWith"]
      },
      journeyUpdate: { type: "string" },
      nextSessionPlan: {
        type: "object",
        additionalProperties: false,
        properties: {
          openerNote: { type: "string" },
          warmupVocabulary: {
            type: "array",
            items: { type: "string" }
          },
          reinforce: { type: "string" },
          introduce: { type: "string" }
        },
        required: ["openerNote", "warmupVocabulary", "reinforce", "introduce"]
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
      "curriculum",
      "journeyUpdate",
      "nextSessionPlan",
      "updatedProfile"
    ]
  },
  strict: true
} as const;

function buildTranscriptSnippet(turns: LessonTurn[]) {
  return turns
    .slice(-40)
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
    curriculum: memory.profile.curriculum,
    journeyUpdate: "",
    nextSessionPlan: memory.profile.nextSessionPlan ?? {
      openerNote: "Pick up warmly and revisit the last scene with slightly longer answers.",
      warmupVocabulary: memory.recentVocabulary.slice(0, 3).map((item) => item.italian),
      reinforce: focus,
      introduce: "One new easy follow-up question in the same scene."
    },
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
    const knownVocabulary = input.memory.recentVocabulary.map((item) => ({
      italian: item.italian,
      english: item.english,
      strength: item.strength ?? 2,
      lastPracticedAt: item.lastPracticedAt
    }));
    const lastSession = input.memory.sessions[0];

    const response = await input.client.responses.create({
      model: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-4.1-mini",
      max_output_tokens: 1400,
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
                "You are the memory of an ongoing one-on-one Italian tutoring relationship. After each live speaking session you update the tutor's long-term record so the NEXT session continues seamlessly — never starts from scratch.",
                "Keep everything practical, specific, and tuned for the next live spoken session.",
                "Do not overstate progress. Reward effort but stay concrete.",
                "VOCABULARY: report every Italian word or phrase the learner actually practiced this session (including known ones that came up again), each with a strength rating: 1 = brand new or shaky, 3 = usable with prompting, 5 = automatic. When a known word reappears, re-rate it honestly based on this session's evidence.",
                "CURRICULUM: maintain the three lists (mastered / workingOn / strugglingWith) as the single source of truth for where the learner stands. Carry forward existing items, move items between lists only on real evidence from this transcript, and keep each item short (a skill or pattern, not a paragraph).",
                "JOURNEY UPDATE: write 1-3 sentences continuing the learner's story — what happened this session and how it fits the longer arc. It will be appended to a running narrative.",
                "NEXT SESSION PLAN: plan the opening of the next session the way a human tutor would. openerNote: one concrete sentence telling the tutor how to open, referencing something specific from THIS session (a phrase used, a moment, a struggle). warmupVocabulary: 3-4 Italian items to recycle in the first minute, chosen from the weakest or most recently learned. reinforce: the one thing to consolidate. introduce: the one small new thing to add.",
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
                `Known vocabulary with current strengths: ${JSON.stringify(knownVocabulary)}`,
                lastSession
                  ? `Previous session (${lastSession.dateIso.slice(0, 10)}): ${lastSession.summary}`
                  : "This was the learner's first recorded session.",
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
