import { head, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonReflection, SavedVocabulary, TutorMemory } from "./types.js";

const seedMemoryPath = path.resolve(process.cwd(), "server", "data", "default-user.json");
const tmpMemoryPath = path.join(os.tmpdir(), "parola-viva-memory.json");
const localMemoryPath = process.env.VERCEL ? tmpMemoryPath : seedMemoryPath;

const BLOB_PATHNAME = "parola-viva/memory.json";
const MAX_VOCABULARY = 60;
const MAX_SESSIONS = 20;
const MAX_JOURNEY_ENTRIES = 24;

// Bridges Blob CDN cache staleness within a warm serverless instance:
// the most recently written memory always wins over a cached read.
let memoryCache: TutorMemory | null = null;

// Two auth modes: classic static BLOB_READ_WRITE_TOKEN (works anywhere), or
// OIDC (default for stores connected since mid-2026). Deployed functions get
// the OIDC token via request context — not an env var — so the presence of
// BLOB_STORE_ID on Vercel is the signal that the SDK can authenticate.
function useBlob() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID &&
        (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN))
  );
}

export async function getStorageStatus() {
  if (!useBlob()) {
    return { mode: "ephemeral" as const };
  }
  try {
    const info = await head(BLOB_PATHNAME);
    return {
      mode: "blob" as const,
      seeded: true,
      sizeBytes: info.size,
      lastWrittenAt: info.uploadedAt
    };
  } catch (error) {
    if (error instanceof Error && error.name === "BlobNotFoundError") {
      return { mode: "blob" as const, seeded: false };
    }
    return {
      mode: "blob-error" as const,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    };
  }
}

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
    ],
    curriculum: { mastered: [], workingOn: [], strugglingWith: [] },
    journey: [],
    nextSessionPlan: null
  },
  recentVocabulary: [],
  sessions: []
};

// Older memory files predate curriculum/journey/nextSessionPlan and vocabulary
// strength — fill the gaps so every caller sees the full shape.
function normalizeMemory(raw: TutorMemory): TutorMemory {
  raw.profile.curriculum ??= { mastered: [], workingOn: [], strugglingWith: [] };
  raw.profile.curriculum.mastered ??= [];
  raw.profile.curriculum.workingOn ??= [];
  raw.profile.curriculum.strugglingWith ??= [];
  raw.profile.journey ??= [];
  raw.profile.nextSessionPlan ??= null;
  raw.recentVocabulary = (raw.recentVocabulary ?? []).map((item) => ({
    ...item,
    strength: item.strength ?? 2,
    lastPracticedAt: item.lastPracticedAt ?? raw.updatedAt
  }));
  raw.sessions ??= [];
  return raw;
}

function newerOf(a: TutorMemory | null, b: TutorMemory | null): TutorMemory | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a.updatedAt).getTime() >= new Date(b.updatedAt).getTime() ? a : b;
}

async function readSeed(): Promise<TutorMemory> {
  try {
    const seed = await fs.readFile(seedMemoryPath, "utf8");
    return JSON.parse(seed) as TutorMemory;
  } catch {
    return structuredClone(fallbackSeed);
  }
}

async function loadFromBlob(): Promise<TutorMemory | null> {
  try {
    const info = await head(BLOB_PATHNAME);
    const response = await fetch(info.downloadUrl);
    if (!response.ok) return null;
    return (await response.json()) as TutorMemory;
  } catch {
    // Blob missing (first run) or transient failure — caller falls back to seed.
    return null;
  }
}

async function saveToBlob(memory: TutorMemory) {
  await put(BLOB_PATHNAME, JSON.stringify(memory, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json"
  });
}

async function loadFromFile(): Promise<TutorMemory | null> {
  try {
    const file = await fs.readFile(localMemoryPath, "utf8");
    return JSON.parse(file) as TutorMemory;
  } catch {
    return null;
  }
}

export async function loadMemory(): Promise<TutorMemory> {
  if (useBlob()) {
    const stored = newerOf(await loadFromBlob(), memoryCache);
    if (stored) {
      return normalizeMemory(stored);
    }
    const seed = normalizeMemory(await readSeed());
    await saveMemory(seed);
    return seed;
  }

  const fromFile = await loadFromFile();
  if (fromFile) {
    return normalizeMemory(fromFile);
  }
  const seed = normalizeMemory(await readSeed());
  await fs.mkdir(path.dirname(localMemoryPath), { recursive: true });
  await fs.writeFile(localMemoryPath, JSON.stringify(seed, null, 2), "utf8");
  return seed;
}

export async function saveMemory(memory: TutorMemory) {
  memory.updatedAt = new Date().toISOString();
  if (useBlob()) {
    memoryCache = memory;
    try {
      await saveToBlob(memory);
      return memory;
    } catch (error) {
      // Degrade to the local/tmp file rather than failing the request; the
      // in-memory cache keeps this instance consistent either way.
      console.error("[memoryStore] Blob write failed, falling back to file:", error);
    }
  }
  await fs.mkdir(path.dirname(localMemoryPath), { recursive: true });
  await fs.writeFile(localMemoryPath, JSON.stringify(memory, null, 2), "utf8");
  return memory;
}

function dedupe(items: string[], limit: number) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

// New reflections update existing entries in place (strength, freshness) instead
// of duplicating them; brand-new words go to the front.
function mergeVocabulary(
  existing: SavedVocabulary[],
  incoming: SavedVocabulary[],
  practicedAt: string
): SavedVocabulary[] {
  const byItalian = new Map(
    existing.map((item) => [item.italian.trim().toLowerCase(), item])
  );
  const fresh: SavedVocabulary[] = [];

  for (const item of incoming) {
    const key = item.italian.trim().toLowerCase();
    if (!key) continue;
    const known = byItalian.get(key);
    if (known) {
      known.english = item.english || known.english;
      known.example = item.example || known.example;
      known.strength = item.strength ?? known.strength;
      known.lastPracticedAt = practicedAt;
    } else {
      byItalian.set(key, item);
      fresh.push({
        ...item,
        strength: item.strength ?? 1,
        lastPracticedAt: practicedAt
      });
    }
  }

  return [...fresh, ...existing].slice(0, MAX_VOCABULARY);
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

  memory.profile.curriculum = {
    mastered: dedupe(input.reflection.curriculum.mastered, 10),
    workingOn: dedupe(input.reflection.curriculum.workingOn, 8),
    strugglingWith: dedupe(input.reflection.curriculum.strugglingWith, 6)
  };

  const journeyEntry = input.reflection.journeyUpdate.trim();
  if (journeyEntry) {
    const dateLabel = input.endedAt.slice(0, 10);
    memory.profile.journey = [
      ...memory.profile.journey,
      `${dateLabel}: ${journeyEntry}`
    ].slice(-MAX_JOURNEY_ENTRIES);
  }

  memory.profile.nextSessionPlan = input.reflection.nextSessionPlan;

  memory.recentVocabulary = mergeVocabulary(
    memory.recentVocabulary,
    input.reflection.vocabulary,
    input.endedAt
  );

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
  ].slice(0, MAX_SESSIONS);

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
    recentVocabulary: memory.recentVocabulary.slice(0, 12),
    recentSessions: memory.sessions.slice(0, 8).map((session) => ({
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
