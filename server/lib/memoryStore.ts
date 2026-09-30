import { head, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  LessonReflection,
  ReflectedVocabulary,
  SavedVocabulary,
  SessionMode,
  Trap,
  TutorMemory,
  VocabularyStage
} from "./types.js";

const seedMemoryPath = path.resolve(process.cwd(), "server", "data", "default-user.json");
const tmpMemoryPath = path.join(os.tmpdir(), "parola-viva-memory.json");
const localMemoryPath = process.env.VERCEL ? tmpMemoryPath : seedMemoryPath;

const BLOB_PATHNAME = "parola-viva/memory.json";
const MAX_VOCABULARY = 60;
const MAX_SESSIONS = 20;
const MAX_JOURNEY_ENTRIES = 24;
const MAX_LEARNING_RECORDS = 40;
const MAX_TRAPS = 12;
// Spaced review: each unprompted use pushes the next review further out.
const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30];
// Unprompted uses (counted once per session) needed for a word to become "yours".
const MASTERY_UNPROMPTED_USES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    const message = error instanceof Error ? error.message : String(error);
    if (
      (error instanceof Error && error.name === "BlobNotFoundError") ||
      message.includes("does not exist")
    ) {
      return { mode: "blob" as const, seeded: false };
    }
    return { mode: "blob-error" as const, detail: message };
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
    nextSessionPlan: null,
    mission: null,
    learningRecords: [],
    traps: []
  },
  recentVocabulary: [],
  sessions: []
};

function addDays(iso: string, days: number) {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

// Words saved before stages existed get one from their strength rating.
function stageFromStrength(strength: number): VocabularyStage {
  if (strength >= 5) return "mastered";
  if (strength >= 3) return "practicing";
  return "new";
}

// Older memory files predate curriculum/journey/plan, the /teach fields and
// word stages — fill the gaps so every caller sees the full shape.
function normalizeMemory(raw: TutorMemory): TutorMemory {
  raw.profile.curriculum ??= { mastered: [], workingOn: [], strugglingWith: [] };
  raw.profile.curriculum.mastered ??= [];
  raw.profile.curriculum.workingOn ??= [];
  raw.profile.curriculum.strugglingWith ??= [];
  raw.profile.journey ??= [];
  raw.profile.nextSessionPlan ??= null;
  raw.profile.mission ??= null;
  raw.profile.learningRecords ??= [];
  raw.profile.traps = (raw.profile.traps ?? []).map((trap) => ({
    ...trap,
    cleanChecks: trap.cleanChecks ?? 0
  }));
  raw.recentVocabulary = (raw.recentVocabulary ?? []).map((item) => {
    const strength = item.strength ?? 2;
    const lastPracticedAt = item.lastPracticedAt ?? raw.updatedAt;
    const reviewStep = item.reviewStep ?? 0;
    return {
      ...item,
      strength,
      lastPracticedAt,
      stage: item.stage ?? stageFromStrength(strength),
      unpromptedUses: item.unpromptedUses ?? 0,
      reviewStep,
      nextReviewAt: item.nextReviewAt ?? addDays(lastPracticedAt, REVIEW_INTERVAL_DAYS[reviewStep])
    };
  });
  raw.sessions ??= [];
  return raw;
}

// Words due for a "ti ricordi?" check, most overdue first. Words already
// mastered come last: they are the floor, not the lesson.
export function wordsDueForReview(memory: TutorMemory, now = new Date(), limit = 4) {
  const stageOrder: Record<VocabularyStage, number> = { practicing: 0, new: 1, mastered: 2 };
  return memory.recentVocabulary
    .filter((item) => item.nextReviewAt && new Date(item.nextReviewAt) <= now)
    .sort((a, b) => {
      const byStage = stageOrder[a.stage ?? "new"] - stageOrder[b.stage ?? "new"];
      if (byStage !== 0) return byStage;
      return new Date(a.nextReviewAt!).getTime() - new Date(b.nextReviewAt!).getTime();
    })
    .slice(0, limit);
}

// Active traps least recently checked first: the ones most worth re-checking.
export function trapsToRecheck(memory: TutorMemory, limit = 2) {
  return memory.profile.traps
    .filter((trap) => trap.status === "active")
    .sort(
      (a, b) =>
        new Date(a.lastCheckedAt ?? a.firstSeenAt).getTime() -
        new Date(b.lastCheckedAt ?? b.firstSeenAt).getTime()
    )
    .slice(0, limit);
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

const normalizeKey = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.!?¿¡,;:"'“”‘’…]/g, "")
    .replace(/\s+/g, " ");

// Applies one session's evidence to a word: stage and spaced review are decided
// here, from the evidence, never by the model's say-so.
function scheduleWord(
  word: SavedVocabulary,
  evidence: ReflectedVocabulary["evidence"],
  at: string,
  isNew: boolean
): SavedVocabulary {
  const next = { ...word };
  let step = next.reviewStep ?? 0;
  let stage: VocabularyStage = next.stage ?? "new";

  switch (evidence) {
    case "used_unprompted":
      next.unpromptedUses = (next.unpromptedUses ?? 0) + 1;
      step = Math.min(step + 1, REVIEW_INTERVAL_DAYS.length - 1);
      if (stage === "new") stage = "practicing";
      if (stage === "practicing" && next.unpromptedUses >= MASTERY_UNPROMPTED_USES) {
        stage = "mastered";
      }
      break;
    case "used_with_help":
      // Practised, but retrieval still needed a push: same interval again.
      break;
    case "not_recalled":
      step = 0;
      if (stage === "mastered") stage = "practicing";
      break;
    case "heard_only":
      // Hearing a word is coverage, not learning. Only brand-new words get a
      // first review date; known words keep their schedule untouched.
      if (!isNew) return next;
      step = 0;
      break;
  }

  next.stage = stage;
  next.reviewStep = step;
  next.lastPracticedAt = at;
  next.nextReviewAt = addDays(at, REVIEW_INTERVAL_DAYS[step]);
  return next;
}

function mergeVocabulary(
  existing: SavedVocabulary[],
  incoming: ReflectedVocabulary[],
  at: string
): SavedVocabulary[] {
  const byKey = new Map(existing.map((item) => [normalizeKey(item.italian), item]));
  const updated = new Map<string, SavedVocabulary>();
  const fresh: SavedVocabulary[] = [];

  for (const item of incoming) {
    const key = normalizeKey(item.italian);
    if (!key || updated.has(key)) continue;
    const known = byKey.get(key);
    if (known) {
      updated.set(
        key,
        scheduleWord(
          {
            ...known,
            english: item.english || known.english,
            example: item.example || known.example,
            strength: item.strength ?? known.strength
          },
          item.evidence,
          at,
          false
        )
      );
    } else {
      const word = scheduleWord(
        {
          italian: item.italian.trim(),
          english: item.english,
          example: item.example,
          strength: item.strength ?? 1,
          stage: "new",
          unpromptedUses: 0,
          reviewStep: 0
        },
        item.evidence,
        at,
        true
      );
      updated.set(key, word);
      fresh.push(word);
    }
  }

  const merged = existing.map((item) => updated.get(normalizeKey(item.italian)) ?? item);
  return [...fresh, ...merged].slice(0, MAX_VOCABULARY);
}

function mergeTraps(existing: Trap[], reflection: LessonReflection, at: string): Trap[] {
  const traps = existing.map((trap) => ({ ...trap }));
  const byKey = new Map(traps.map((trap) => [normalizeKey(trap.wrong), trap]));
  const seenThisSession = new Set<string>();

  for (const item of reflection.traps) {
    const key = normalizeKey(item.wrong);
    if (!key) continue;
    seenThisSession.add(key);
    const known = byKey.get(key);
    if (known) {
      known.timesSeen += 1;
      known.lastSeenAt = at;
      known.right = item.right || known.right;
      known.note = item.note || known.note;
      known.status = "active";
      known.cleanChecks = 0;
    } else {
      const trap: Trap = {
        id: crypto.randomUUID(),
        wrong: item.wrong.trim(),
        right: item.right.trim(),
        note: item.note.trim(),
        status: "active",
        timesSeen: 1,
        cleanChecks: 0,
        firstSeenAt: at,
        lastSeenAt: at
      };
      traps.unshift(trap);
      byKey.set(key, trap);
    }
  }

  // A re-checked trap the learner did not fall into counts as a clean check.
  for (const wrong of reflection.trapsRechecked) {
    const key = normalizeKey(wrong);
    const trap = byKey.get(key);
    if (!trap) continue;
    trap.lastCheckedAt = at;
    if (!seenThisSession.has(key)) {
      trap.cleanChecks += 1;
      if (trap.cleanChecks >= 2) trap.status = "resolved";
    }
  }

  return traps.slice(0, MAX_TRAPS);
}

// Pure: returns the updated memory without saving, so it can be tested on a copy.
export function mergeReflection(
  current: TutorMemory,
  input: {
    reflection: LessonReflection;
    focus: string;
    presetLabel: string;
    mode: SessionMode;
    objective?: string;
    startedAt: string;
    endedAt: string;
  }
): TutorMemory {
  const memory = structuredClone(current);
  const { reflection, endedAt } = input;
  const durationMinutes = Math.max(
    1,
    Math.round((new Date(endedAt).getTime() - new Date(input.startedAt).getTime()) / 60000)
  );

  memory.profile.levelEstimate = reflection.updatedProfile.levelEstimate;
  memory.profile.confidence = reflection.updatedProfile.confidence;
  memory.profile.preferredTopics = dedupe(
    [...reflection.updatedProfile.preferredTopics, ...memory.profile.preferredTopics],
    8
  );
  // Reflection returns these lists already consolidated, so they replace the
  // old ones; appending is what produced near-duplicate lines before.
  memory.profile.correctionPriorities = dedupe(reflection.updatedProfile.correctionPriorities, 5);
  memory.profile.tutorNotes = dedupe(reflection.updatedProfile.tutorNotes, 6);
  memory.profile.nextSessionFocus = reflection.updatedProfile.nextSessionFocus;

  memory.profile.curriculum = {
    mastered: dedupe(reflection.curriculum.mastered, 10),
    workingOn: dedupe(reflection.curriculum.workingOn, 8),
    strugglingWith: dedupe(reflection.curriculum.strugglingWith, 6)
  };

  const journeyEntry = reflection.journeyUpdate.trim();
  if (journeyEntry) {
    memory.profile.journey = [
      ...memory.profile.journey,
      `${endedAt.slice(0, 10)}: ${journeyEntry}`
    ].slice(-MAX_JOURNEY_ENTRIES);
  }

  memory.profile.nextSessionPlan = reflection.nextSessionPlan;

  if (reflection.mission && (input.mode === "mission" || !memory.profile.mission)) {
    memory.profile.mission = {
      why: reflection.mission.why,
      successLooksLike: dedupe(reflection.mission.successLooksLike, 6),
      constraints: dedupe(reflection.mission.constraints, 6),
      outOfScope: dedupe(reflection.mission.outOfScope, 6),
      setAt: endedAt
    };
  }

  memory.profile.learningRecords = [
    ...memory.profile.learningRecords,
    ...reflection.learningRecords
      .filter((record) => record.title.trim() && record.evidence.trim())
      .map((record) => ({
        id: crypto.randomUUID(),
        dateIso: endedAt,
        kind: record.kind,
        title: record.title.trim(),
        evidence: record.evidence.trim()
      }))
  ].slice(-MAX_LEARNING_RECORDS);

  memory.profile.traps = mergeTraps(memory.profile.traps, reflection, endedAt);

  memory.recentVocabulary = mergeVocabulary(memory.recentVocabulary, reflection.vocabulary, endedAt);

  memory.sessions = [
    {
      id: crypto.randomUUID(),
      title: reflection.title,
      focus: input.focus,
      presetLabel: input.presetLabel,
      mode: input.mode,
      objective: input.objective,
      objectiveResult: reflection.objectiveOutcome.result,
      objectiveEvidence: reflection.objectiveOutcome.evidence,
      dateIso: endedAt,
      durationMinutes,
      summary: reflection.summary,
      strengths: reflection.strengths,
      needsWork: reflection.needsWork,
      nextDrills: reflection.nextDrills,
      cultureMoments: reflection.cultureMoments,
      vocabulary: reflection.vocabulary.map(({ italian, english, example, strength }) => ({
        italian,
        english,
        example,
        strength
      })),
      lessonAudit: reflection.lessonAudit
    },
    ...memory.sessions
  ].slice(0, MAX_SESSIONS);

  return memory;
}

export async function applyReflection(input: Parameters<typeof mergeReflection>[1]) {
  const memory = mergeReflection(await loadMemory(), input);
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
    curriculum: memory.profile.curriculum,
    journey: memory.profile.journey.slice(-6),
    nextSessionPlan: memory.profile.nextSessionPlan,
    mission: memory.profile.mission,
    traps: memory.profile.traps.filter((trap) => trap.status === "active"),
    learningRecords: memory.profile.learningRecords.slice(-10).reverse(),
    reviewDue: wordsDueForReview(memory).map((item) => item.italian),
    recentVocabulary: memory.recentVocabulary,
    recentSessions: memory.sessions.slice(0, 8).map((session) => ({
      id: session.id,
      title: session.title,
      focus: session.focus,
      mode: session.mode,
      objective: session.objective,
      objectiveResult: session.objectiveResult,
      dateIso: session.dateIso,
      durationMinutes: session.durationMinutes,
      summary: session.summary,
      strengths: session.strengths,
      nextDrills: session.nextDrills
    }))
  };
}
