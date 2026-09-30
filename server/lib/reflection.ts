import OpenAI from "openai";
import { trapsToRecheck, wordsDueForReview } from "./memoryStore.js";
import type { LessonReflection, LessonTurn, SessionMode, TutorMemory } from "./types.js";

const stringArray = { type: "array", items: { type: "string" } } as const;

const reflectionSchema = {
  name: "italian_lesson_reflection",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      strengths: stringArray,
      needsWork: stringArray,
      nextDrills: stringArray,
      cultureMoments: stringArray,
      vocabulary: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            italian: { type: "string" },
            english: { type: "string" },
            example: { type: "string" },
            strength: { type: "integer", minimum: 1, maximum: 5 },
            evidence: {
              type: "string",
              enum: ["used_unprompted", "used_with_help", "not_recalled", "heard_only"]
            }
          },
          required: ["italian", "english", "example", "strength", "evidence"]
        }
      },
      curriculum: {
        type: "object",
        additionalProperties: false,
        properties: {
          mastered: stringArray,
          workingOn: stringArray,
          strugglingWith: stringArray
        },
        required: ["mastered", "workingOn", "strugglingWith"]
      },
      journeyUpdate: { type: "string" },
      nextSessionPlan: {
        type: "object",
        additionalProperties: false,
        properties: {
          objective: { type: "string" },
          openerNote: { type: "string" },
          warmupVocabulary: stringArray,
          reinforce: { type: "string" },
          introduce: { type: "string" }
        },
        required: ["objective", "openerNote", "warmupVocabulary", "reinforce", "introduce"]
      },
      objectiveOutcome: {
        type: "object",
        additionalProperties: false,
        properties: {
          result: { type: "string", enum: ["won", "partly", "not_yet", "no_objective"] },
          evidence: { type: "string" }
        },
        required: ["result", "evidence"]
      },
      learningRecords: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["demonstrated", "prior_knowledge", "misconception_corrected", "mission_shift"]
            },
            title: { type: "string" },
            evidence: { type: "string" }
          },
          required: ["kind", "title", "evidence"]
        }
      },
      traps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            wrong: { type: "string" },
            right: { type: "string" },
            note: { type: "string" },
            fixedThisSession: { type: "boolean" }
          },
          required: ["wrong", "right", "note", "fixedThisSession"]
        }
      },
      trapsRechecked: stringArray,
      mission: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              why: { type: "string" },
              successLooksLike: stringArray,
              constraints: stringArray,
              outOfScope: stringArray
            },
            required: ["why", "successLooksLike", "constraints", "outOfScope"]
          },
          { type: "null" }
        ]
      },
      lessonAudit: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            rule: { type: "string" },
            followed: { type: "string", enum: ["yes", "no", "not_applicable"] },
            evidence: { type: "string" }
          },
          required: ["rule", "followed", "evidence"]
        }
      },
      updatedProfile: {
        type: "object",
        additionalProperties: false,
        properties: {
          levelEstimate: { type: "string" },
          confidence: { type: "string" },
          preferredTopics: stringArray,
          correctionPriorities: stringArray,
          nextSessionFocus: { type: "string" },
          tutorNotes: stringArray
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
      "objectiveOutcome",
      "learningRecords",
      "traps",
      "trapsRechecked",
      "mission",
      "lessonAudit",
      "updatedProfile"
    ]
  },
  strict: true
} as const;

// The /teach behaviours Lucia is graded on, per mode. Shown in the debug
// scorecard so live lessons can be checked against the method.
const AUDIT_RULES: Record<SessionMode, string[]> = {
  plan: [
    "Opened by name with a specific callback to the last lesson",
    "Ti ricordi: asked for review words and waited before giving answers",
    "Named one goal and steered back to it when the talk drifted",
    "Did not re-teach words or skills already marked as the learner's",
    "Quietly re-checked an old trap",
    "Corrected one thing at a time by recasting, not lecturing",
    "Kept Italian in small pieces the learner could follow",
    "Gave the learner a chance to use the goal unprompted"
  ],
  topic: [
    "Opened by name with a specific callback to the last lesson",
    "Ti ricordi: asked for review words and waited before giving answers",
    "Named one goal and steered back to it when the talk drifted",
    "Did not re-teach words or skills already marked as the learner's",
    "Corrected one thing at a time by recasting, not lecturing",
    "Kept Italian in small pieces the learner could follow",
    "Gave the learner a chance to use the goal unprompted"
  ],
  chat: [
    "Kept it a real conversation: no quiz, no lesson agenda",
    "Followed the learner's topics",
    "Corrected one thing at a time by recasting, not lecturing",
    "Kept Italian in small pieces the learner could follow"
  ],
  mission: [
    "Asked why the learner wants Italian and pushed past vague answers",
    "Asked what success looks like in concrete situations",
    "Asked about constraints and what is out of scope",
    "Said the mission back at the end and checked it"
  ]
};

// Lowercase, no accents or punctuation, single spaces: for matching words in
// imperfect live transcripts.
function normalizeSpeech(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The model judges evidence generously, so it is re-derived from the transcript:
// a word counts as used only if the learner actually said it, and as
// unprompted only if the tutor's turn just before did not say it or hint at it
// (a hint = the first ~60% of the phrase and always past its first word, e.g.
// "mi chia..." for "mi chiamo"; "sono Marco" is not a hint for "sono di").
// Only "not_recalled" (asked but not retrieved) is left to the model's judgement.
export function verifyVocabularyEvidence(
  vocabulary: LessonReflection["vocabulary"],
  turns: LessonTurn[]
): LessonReflection["vocabulary"] {
  return vocabulary.map((item) => {
    const word = normalizeSpeech(item.italian);
    if (!word) return item;
    const firstWordLength = word.split(" ")[0].length;
    const hint = word.slice(0, Math.max(Math.ceil(word.length * 0.6), firstWordLength + 2));

    let usedWithHelp = false;
    let usedUnprompted = false;
    turns.forEach((current, index) => {
      if (current.speaker !== "you" || !normalizeSpeech(current.text).includes(word)) return;
      const previous = turns
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.speaker === "tutor");
      if (previous && normalizeSpeech(previous.text).includes(hint)) usedWithHelp = true;
      else usedUnprompted = true;
    });

    const evidence = usedUnprompted
      ? "used_unprompted"
      : usedWithHelp
        ? "used_with_help"
        : item.evidence === "not_recalled"
          ? "not_recalled"
          : "heard_only";
    return { ...item, evidence };
  });
}

function buildTranscriptSnippet(turns: LessonTurn[]) {
  return turns
    .slice(-60)
    .map((turn) => `${turn.speaker === "you" ? "Learner" : "Tutor"}: ${turn.text}`)
    .join("\n");
}

function fallbackReflection(
  memory: TutorMemory,
  focus: string,
  mode: SessionMode,
  objective?: string
): LessonReflection {
  const nextObjective = objective ?? memory.profile.nextSessionPlan?.objective ?? focus;
  return {
    title: "Short speaking checkpoint",
    summary:
      "A brief Italian speaking session was captured. The next lesson should revisit the same goal with one slightly longer answer.",
    strengths: ["Showed up and produced spoken Italian in context."],
    needsWork: ["Build slightly longer answers with less hesitation."],
    nextDrills: [`Repeat the ${focus.toLowerCase()} scene with two-sentence answers.`],
    cultureMoments: [],
    vocabulary: [],
    curriculum: memory.profile.curriculum,
    journeyUpdate: "",
    nextSessionPlan: {
      objective: nextObjective,
      openerNote:
        memory.profile.nextSessionPlan?.openerNote ??
        "Pick up warmly and revisit the last goal with slightly longer answers.",
      warmupVocabulary: memory.recentVocabulary.slice(0, 3).map((item) => item.italian),
      reinforce: nextObjective,
      introduce: memory.profile.nextSessionPlan?.introduce ?? "One new easy follow-up question."
    },
    objectiveOutcome: {
      result: mode === "chat" || mode === "mission" ? "no_objective" : "not_yet",
      evidence: "The session was too short to judge."
    },
    learningRecords: [],
    traps: [],
    trapsRechecked: [],
    mission: null,
    lessonAudit: [],
    updatedProfile: {
      levelEstimate: memory.profile.levelEstimate,
      confidence: memory.profile.confidence,
      preferredTopics: memory.profile.preferredTopics,
      correctionPriorities: memory.profile.correctionPriorities,
      nextSessionFocus: memory.profile.nextSessionFocus,
      tutorNotes: memory.profile.tutorNotes
    }
  };
}

const SYSTEM_PROMPT = [
  "You are the memory of an ongoing one-on-one Italian tutoring relationship between a learner and their tutor, Lucia. After each live speaking session you update the long-term record so the NEXT session continues seamlessly.",
  "Guiding rule: COVERAGE IS NOT LEARNING. Something the tutor said, or the learner repeated straight after her, is not evidence the learner owns it. Only what the learner produced on their own counts. Do not overstate progress.",
  "",
  "VOCABULARY: list every Italian word or phrase that came up for the learner THIS session (never items that did not appear in this transcript), including known ones. Use reusable words or chunks as the learner would reuse them (\"sono di...\", \"come stai?\"), not whole personal sentences; reuse the exact spelling of a known item when it is the same phrase. For each, set evidence honestly from the transcript:",
  "- used_unprompted: the learner produced it correctly without the tutor saying it first in that exchange.",
  "- used_with_help: the learner said it only after a hint, a model, or by repeating the tutor.",
  "- not_recalled: the tutor asked for it (e.g. \"ti ricordi...?\") and the learner could not retrieve it.",
  "- heard_only: the tutor used it but the learner never said it.",
  "Also rate strength 1-5 (1 shaky, 3 usable with prompting, 5 automatic).",
  "",
  "OBJECTIVE: judge the session's one goal against the transcript: won (learner did it unprompted), partly (only with help), not_yet, or no_objective (just-chat or mission sessions). Quote or paraphrase the moment as evidence.",
  "LEARNING RECORDS: write one only when there is evidence: demonstrated (learner showed real understanding of something non-trivial), prior_knowledge (learner revealed they already knew something), misconception_corrected (a wrong belief was fixed), mission_shift (their reason for learning changed). Each needs a short title and the evidence. Most sessions produce 0-2. Never write one for mere exposure. A mission conversation produces none unless the mission changed.",
  "TRAPS: list EVERY mistake the learner made that the tutor corrected or recast, one entry each. wrong/right are the short general pattern, not the whole sentence (\"soy\" -> \"sono\", \"io sono bene\" -> \"sto bene\"); reuse the exact wording of a known trap when it is the same mistake. note says why in a few words. Mark fixedThisSession if the learner later got it right on their own. trapsRechecked: copy the \"wrong\" text of any KNOWN trap (listed below) that the tutor deliberately gave a chance to reoccur this session; leave it empty if none are listed.",
  "MISSION: only in a mission conversation, fill why / successLooksLike / constraints / outOfScope in the learner's own terms. Otherwise null.",
  "LESSON AUDIT: for each rule listed for this session, say whether the tutor followed it (yes / no / not_applicable) with a short quote or paraphrase as evidence. Be strict; this is how the teaching method gets checked.",
  "",
  "CURRICULUM: maintain mastered / workingOn / strugglingWith as the single source of truth. Carry existing items forward and move them only on evidence. Keep items short (a skill or pattern).",
  "PROFILE LISTS: correctionPriorities and tutorNotes REPLACE the old lists. Return the complete consolidated list: merge items that say the same thing, drop stale ones, at most 5 each.",
  "JOURNEY UPDATE: 1-3 sentences continuing the learner's story.",
  "NEXT SESSION PLAN: objective is the ONE thing the next lesson should win: a single concrete, observable thing the learner will be able to SAY, under 15 words, e.g. \"Order a coffee and ask how much it is\". Never a list, never \"practice X and Y\". Size it to the learner's zone of proximal development (just past what they can do alone) and tie it to their mission when one exists. If this session's goal was won, the next goal must be the next step beyond it, never the same thing again. openerNote: one concrete sentence on how Lucia should open, referencing something specific from this session. warmupVocabulary: 3-4 items. reinforce: what to consolidate. introduce: the single new thing (usually the objective itself).",
  "Keep everything practical and specific."
].join("\n");

export async function reflectLessonWithAI(input: {
  client: OpenAI;
  memory: TutorMemory;
  focus: string;
  presetLabel: string;
  mode: SessionMode;
  objective?: string;
  turns: LessonTurn[];
}) {
  if (input.turns.length < 2) {
    return fallbackReflection(input.memory, input.focus, input.mode, input.objective);
  }

  try {
    const { memory } = input;
    const knownVocabulary = memory.recentVocabulary.map((item) => ({
      italian: item.italian,
      english: item.english,
      stage: item.stage,
      strength: item.strength
    }));
    const lastSession = memory.sessions[0];
    const dueWords = wordsDueForReview(memory).map((item) => item.italian);
    const knownTraps = trapsToRecheck(memory, 6).map((trap) => ({ wrong: trap.wrong, right: trap.right }));

    const response = await input.client.responses.create({
      model: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-4.1-mini",
      max_output_tokens: 3500,
      text: { format: { type: "json_schema", ...reflectionSchema } },
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Session type: ${input.mode} (preset "${input.presetLabel}")`,
                input.objective
                  ? `The session's one goal: ${input.objective}`
                  : "This session had no lesson goal.",
                `Lesson audit rules for this session: ${JSON.stringify(AUDIT_RULES[input.mode])}`,
                `Review words that were due ("ti ricordi?"): ${JSON.stringify(dueWords)}`,
                `Known traps: ${JSON.stringify(knownTraps)}`,
                `Current mission: ${JSON.stringify(memory.profile.mission)}`,
                `Current learner profile: ${JSON.stringify({
                  levelEstimate: memory.profile.levelEstimate,
                  confidence: memory.profile.confidence,
                  goals: memory.profile.goals,
                  preferredTopics: memory.profile.preferredTopics,
                  correctionPriorities: memory.profile.correctionPriorities,
                  tutorNotes: memory.profile.tutorNotes,
                  curriculum: memory.profile.curriculum,
                  nextSessionFocus: memory.profile.nextSessionFocus
                })}`,
                `Known vocabulary: ${JSON.stringify(knownVocabulary)}`,
                lastSession
                  ? `Previous session (${lastSession.dateIso.slice(0, 10)}): ${lastSession.summary}`
                  : "This was the learner's first recorded session.",
                "Transcript:",
                buildTranscriptSnippet(input.turns)
              ].join("\n\n")
            }
          ]
        }
      ]
    });

    const reflection = JSON.parse(response.output_text) as LessonReflection;
    reflection.vocabulary = verifyVocabularyEvidence(reflection.vocabulary, input.turns);
    // A mission conversation is about goals, not Italian: only a changed
    // mission is worth a learning record.
    if (input.mode === "mission") {
      reflection.learningRecords = reflection.learningRecords.filter(
        (record) => record.kind === "mission_shift"
      );
    }
    // With no known traps there was nothing to re-check, whatever the model says.
    if (knownTraps.length === 0) {
      reflection.trapsRechecked = [];
      reflection.lessonAudit = reflection.lessonAudit.map((item) =>
        /re-checked an old trap/i.test(item.rule)
          ? { ...item, followed: "not_applicable", evidence: "No known traps yet." }
          : item
      );
    }
    return reflection;
  } catch (error) {
    console.error("[reflection] Falling back after error:", error);
    return fallbackReflection(input.memory, input.focus, input.mode, input.objective);
  }
}
