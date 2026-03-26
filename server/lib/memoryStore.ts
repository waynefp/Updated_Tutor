import { promises as fs } from "node:fs";
import path from "node:path";
import type { LessonReflection, TutorMemory } from "./types.js";

const memoryPath = path.resolve(process.cwd(), "server", "data", "default-user.json");

const fallbackSeed: TutorMemory = {
  userId: process.env.DEFAULT_USER_ID ?? "wayne",
  learnerName: "Wayne",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  profile: {
    targetLanguage: "Italian",
    nativeLanguage: "English",
    levelEstimate: "A0-A1 emerging speaker",
    confidence: "Building confidence with short replies",
    goals: [
      "Hold short everyday conversations in Italian",
      "Get comfortable responding without mentally translating every word",
      "Grow listening confidence in real speaking speed"
    ],
    preferredTopics: ["Travel days", "Food and cafes", "Creative work", "Weekend plans"],
    cultureInterests: ["Design", "Train travel", "Contemporary city life", "Regional food"],
    correctionPriorities: [
      "Correct one high-impact issue at a time",
      "Favor spoken recasts over grammar lectures",
      "Keep explanations brief and usable"
    ],
    nextSessionFocus: "Simple self-introductions and easy follow-up questions",
    tutorNotes: [
      "Start gentle, keep the pace calm, and reward attempts quickly.",
      "Use mostly Italian with short English rescue lines only when needed."
    ]
  },
  recentVocabulary: [],
  sessions: []
};

function dedupe(items: string[], limit: number) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function dedupeVocabulary(memoryItems: TutorMemory["recentVocabulary"]) {
  const seen = new Set<string>();
  const result: TutorMemory["recentVocabulary"] = [];

  for (const item of memoryItems) {
    const key = item.italian.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
    if (result.length >= 12) {
      break;
    }
  }

  return result;
}

async function ensureFile() {
  try {
    await fs.access(memoryPath);
  } catch {
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.writeFile(memoryPath, JSON.stringify(fallbackSeed, null, 2), "utf8");
  }
}

export async function loadMemory(): Promise<TutorMemory> {
  await ensureFile();
  const file = await fs.readFile(memoryPath, "utf8");
  return JSON.parse(file) as TutorMemory;
}

export async function saveMemory(memory: TutorMemory) {
  memory.updatedAt = new Date().toISOString();
  await fs.writeFile(memoryPath, JSON.stringify(memory, null, 2), "utf8");
  return memory;
}

export async function applyReflection(input: {
  reflection: LessonReflection;
  focus: string;
  presetLabel: string;
  startedAt: string;
  endedAt: string;
}) {
  const memory = await loadMemory();
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  const durationMinutes = Math.max(
    1,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 60000)
  );

  memory.profile.levelEstimate = input.reflection.updatedProfile.levelEstimate;
  memory.profile.confidence = input.reflection.updatedProfile.confidence;
  memory.profile.preferredTopics = dedupe(
    [
      ...input.reflection.updatedProfile.preferredTopics,
      ...memory.profile.preferredTopics
    ],
    8
  );
  memory.profile.correctionPriorities = dedupe(
    [
      ...input.reflection.updatedProfile.correctionPriorities,
      ...memory.profile.correctionPriorities
    ],
    6
  );
  memory.profile.nextSessionFocus = input.reflection.updatedProfile.nextSessionFocus;
  memory.profile.tutorNotes = dedupe(
    [...input.reflection.updatedProfile.tutorNotes, ...memory.profile.tutorNotes],
    6
  );

  memory.recentVocabulary = dedupeVocabulary([
    ...input.reflection.vocabulary,
    ...memory.recentVocabulary
  ]);

  memory.sessions = [
    {
      id: crypto.randomUUID(),
      title: input.reflection.title,
      focus: input.focus,
      presetLabel: input.presetLabel,
      dateIso: input.endedAt,
      durationMinutes,
      summary: input.reflection.summary,
      strengths: input.reflection.strengths,
      needsWork: input.reflection.needsWork,
      nextDrills: input.reflection.nextDrills,
      cultureMoments: input.reflection.cultureMoments,
      vocabulary: input.reflection.vocabulary
    },
    ...memory.sessions
  ].slice(0, 8);

  await saveMemory(memory);
  return memory;
}

export function toClientProfile(memory: TutorMemory) {
  return {
    learnerName: memory.learnerName,
    levelEstimate: memory.profile.levelEstimate,
    confidence: memory.profile.confidence,
    goals: memory.profile.goals,
    preferredTopics: memory.profile.preferredTopics,
    cultureInterests: memory.profile.cultureInterests,
    correctionPriorities: memory.profile.correctionPriorities,
    nextSessionFocus: memory.profile.nextSessionFocus,
    tutorNotes: memory.profile.tutorNotes,
    recentVocabulary: memory.recentVocabulary,
    recentSessions: memory.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      focus: session.focus,
      dateIso: session.dateIso,
      durationMinutes: session.durationMinutes,
      summary: session.summary,
      strengths: session.strengths,
      nextDrills: session.nextDrills
    }))
  };
}
