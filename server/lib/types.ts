export type SavedVocabulary = {
  italian: string;
  english: string;
  example: string;
  strength?: number; // 1 = brand new / shaky, 5 = solid and automatic
  lastPracticedAt?: string;
};

export type Curriculum = {
  mastered: string[];
  workingOn: string[];
  strugglingWith: string[];
};

export type NextSessionPlan = {
  openerNote: string;
  warmupVocabulary: string[];
  reinforce: string;
  introduce: string;
};

export type SessionRecord = {
  id: string;
  title: string;
  focus: string;
  presetLabel: string;
  dateIso: string;
  durationMinutes: number;
  summary: string;
  strengths: string[];
  needsWork: string[];
  nextDrills: string[];
  cultureMoments: string[];
  vocabulary: SavedVocabulary[];
};

export type TutorMemory = {
  userId: string;
  learnerName: string;
  createdAt: string;
  updatedAt: string;
  profile: {
    targetLanguage: string;
    nativeLanguage: string;
    levelEstimate: string;
    confidence: string;
    goals: string[];
    preferredTopics: string[];
    cultureInterests: string[];
    correctionPriorities: string[];
    nextSessionFocus: string;
    tutorNotes: string[];
    curriculum: Curriculum;
    journey: string[];
    nextSessionPlan: NextSessionPlan | null;
  };
  recentVocabulary: SavedVocabulary[];
  sessions: SessionRecord[];
};

export type LessonTurn = {
  speaker: "you" | "tutor";
  text: string;
  timestamp: string;
};

export type LessonReflection = {
  title: string;
  summary: string;
  strengths: string[];
  needsWork: string[];
  nextDrills: string[];
  cultureMoments: string[];
  vocabulary: SavedVocabulary[];
  curriculum: Curriculum;
  journeyUpdate: string;
  nextSessionPlan: NextSessionPlan;
  updatedProfile: {
    levelEstimate: string;
    confidence: string;
    preferredTopics: string[];
    correctionPriorities: string[];
    nextSessionFocus: string;
    tutorNotes: string[];
  };
};
