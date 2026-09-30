export type LessonTurn = {
  id: string;
  speaker: "you" | "tutor";
  text: string;
  timestamp: string;
};

export type VocabularyStage = "new" | "practicing" | "mastered";

export type SavedVocabulary = {
  italian: string;
  english: string;
  example: string;
  strength?: number;
  stage?: VocabularyStage;
  unpromptedUses?: number;
  lastPracticedAt?: string;
  nextReviewAt?: string;
};

export type SessionMode = "plan" | "topic" | "chat" | "mission";

export type Mission = {
  why: string;
  successLooksLike: string[];
  constraints: string[];
  outOfScope: string[];
  setAt: string;
};

export type Trap = {
  id: string;
  wrong: string;
  right: string;
  note: string;
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type LearningRecord = {
  id: string;
  dateIso: string;
  kind: "demonstrated" | "prior_knowledge" | "misconception_corrected" | "mission_shift";
  title: string;
  evidence: string;
};

export type NextSessionPlan = {
  objective?: string;
  openerNote: string;
  warmupVocabulary: string[];
  reinforce: string;
  introduce: string;
};

export type RecentSession = {
  id: string;
  title: string;
  focus: string;
  mode?: SessionMode;
  objective?: string;
  objectiveResult?: "won" | "partly" | "not_yet" | "no_objective";
  dateIso: string;
  durationMinutes: number;
  summary: string;
  strengths: string[];
  nextDrills: string[];
};

export type TutorProfile = {
  learnerName: string;
  levelEstimate: string;
  confidence: string;
  goals: string[];
  preferredTopics: string[];
  cultureInterests: string[];
  correctionPriorities: string[];
  nextSessionFocus: string;
  tutorNotes: string[];
  curriculum: { mastered: string[]; workingOn: string[]; strugglingWith: string[] };
  journey: string[];
  nextSessionPlan: NextSessionPlan | null;
  mission: Mission | null;
  traps: Trap[];
  learningRecords: LearningRecord[];
  // Italian items due for a "ti ricordi?" check, most overdue first.
  reviewDue: string[];
  recentVocabulary: SavedVocabulary[];
  recentSessions: RecentSession[];
};

export type SessionPreset = {
  id: string;
  mode: SessionMode;
  title: string;
  label: string;
  focus: string;
  brief: string;
};

export type CultureScene = {
  title: string;
  eyebrow: string;
  body: string;
  image: string;
};

export type BootstrapPayload = {
  app: {
    name: string;
    voice: string;
    geminiModels: Array<{ id: string; label: string }>;
    geminiDefaultModel: string;
  };
  profile: TutorProfile;
  sessionPresets: SessionPreset[];
  cultureScenes: CultureScene[];
};

export type LiveSessionPayload = {
  apiKey: string;
  model: string;
  systemInstruction: string;
  voice: string;
};

export type OpenAiLiveSessionPayload = {
  clientSecret: string;
  model: string;
  voice: string;
  expiresAt?: number;
};

export type GptLiveSessionPayload = {
  sessionId: string | null;
  sdp: string;
  model: string;
  voice: string;
};

export type VoiceEngine = "gemini" | "openai" | "gptlive";

export type LessonReflection = {
  title: string;
  summary: string;
  strengths: string[];
  needsWork: string[];
  nextDrills: string[];
  cultureMoments: string[];
  vocabulary: SavedVocabulary[];
  updatedProfile: {
    levelEstimate: string;
    confidence: string;
    preferredTopics: string[];
    correctionPriorities: string[];
    nextSessionFocus: string;
    tutorNotes: string[];
  };
};

export type ReflectionPayload = {
  reflection: LessonReflection;
  profile: TutorProfile;
};

export type SessionCapture = {
  startedAt: string;
  endedAt: string;
  turns: LessonTurn[];
};

export type SessionStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "speaking"
  | "error";

export type RealtimeEventLogItem = {
  id: string;
  type: string;
  detail: string;
  timestamp: string;
};

export type AudioInputDevice = {
  deviceId: string;
  label: string;
  isDefault: boolean;
};
