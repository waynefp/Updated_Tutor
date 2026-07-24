export type LessonTurn = {
  id: string;
  speaker: "you" | "tutor";
  text: string;
  timestamp: string;
};

export type SavedVocabulary = {
  italian: string;
  english: string;
  example: string;
};

export type RecentSession = {
  id: string;
  title: string;
  focus: string;
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
  recentVocabulary: SavedVocabulary[];
  recentSessions: RecentSession[];
};

export type SessionPreset = {
  id: string;
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

export type VoiceEngine = "gemini" | "openai";

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
