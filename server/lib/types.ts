// Word stages follow the /teach rule "coverage is not learning": a word moves
// up only on evidence that the learner produced it on their own.
export type VocabularyStage = "new" | "practicing" | "mastered";

export type SavedVocabulary = {
  italian: string;
  english: string;
  example: string;
  strength?: number; // 1 = brand new / shaky, 5 = solid and automatic
  lastPracticedAt?: string;
  stage?: VocabularyStage;
  // Sessions in which the learner used the word without being given it.
  unpromptedUses?: number;
  // Index into the spaced-review intervals (1, 3, 7, 14, 30 days).
  reviewStep?: number;
  nextReviewAt?: string;
};

// What the learner did with a word in one session, as judged by reflection.
// Stage and review scheduling are computed from this in code, not by the model.
export type VocabularyEvidence =
  | "used_unprompted"
  | "used_with_help"
  | "not_recalled"
  | "heard_only";

export type Curriculum = {
  mastered: string[];
  workingOn: string[];
  strugglingWith: string[];
};

export type NextSessionPlan = {
  // The ONE thing the next lesson exists to win.
  objective?: string;
  openerNote: string;
  warmupVocabulary: string[];
  reinforce: string;
  introduce: string;
};

export type Mission = {
  why: string;
  successLooksLike: string[];
  constraints: string[];
  outOfScope: string[];
  setAt: string;
};

export type LearningRecordKind =
  | "demonstrated"
  | "prior_knowledge"
  | "misconception_corrected"
  | "mission_shift";

// The teaching equivalent of an ADR: something now known, and the evidence.
export type LearningRecord = {
  id: string;
  dateIso: string;
  kind: LearningRecordKind;
  title: string;
  evidence: string;
};

// A recurring mistake Lucia quietly re-checks in later lessons.
export type Trap = {
  id: string;
  wrong: string;
  right: string;
  note: string;
  status: "active" | "resolved";
  timesSeen: number;
  // Re-checks the learner got right; two in a row resolve the trap.
  cleanChecks: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt?: string;
};

export type SessionMode = "plan" | "topic" | "chat" | "mission";

export type ObjectiveResult = "won" | "partly" | "not_yet" | "no_objective";

// One line of the "how Lucia taught" scorecard produced by reflection.
export type LessonAuditItem = {
  rule: string;
  followed: "yes" | "no" | "not_applicable";
  evidence: string;
};

export type SessionRecord = {
  id: string;
  title: string;
  focus: string;
  presetLabel: string;
  mode?: SessionMode;
  objective?: string;
  objectiveResult?: ObjectiveResult;
  objectiveEvidence?: string;
  dateIso: string;
  durationMinutes: number;
  summary: string;
  strengths: string[];
  needsWork: string[];
  nextDrills: string[];
  cultureMoments: string[];
  vocabulary: SavedVocabulary[];
  lessonAudit?: LessonAuditItem[];
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
    mission: Mission | null;
    learningRecords: LearningRecord[];
    traps: Trap[];
  };
  recentVocabulary: SavedVocabulary[];
  sessions: SessionRecord[];
};

export type LessonTurn = {
  speaker: "you" | "tutor";
  text: string;
  timestamp: string;
};

export type ReflectedVocabulary = {
  italian: string;
  english: string;
  example: string;
  strength: number;
  evidence: VocabularyEvidence;
};

export type LessonReflection = {
  title: string;
  summary: string;
  strengths: string[];
  needsWork: string[];
  nextDrills: string[];
  cultureMoments: string[];
  vocabulary: ReflectedVocabulary[];
  curriculum: Curriculum;
  journeyUpdate: string;
  nextSessionPlan: NextSessionPlan & { objective: string };
  objectiveOutcome: {
    result: ObjectiveResult;
    evidence: string;
  };
  learningRecords: Array<{
    kind: LearningRecordKind;
    title: string;
    evidence: string;
  }>;
  traps: Array<{
    wrong: string;
    right: string;
    note: string;
    fixedThisSession: boolean;
  }>;
  // Traps from memory that Lucia re-checked this session (matched by "wrong").
  trapsRechecked: string[];
  mission: {
    why: string;
    successLooksLike: string[];
    constraints: string[];
    outOfScope: string[];
  } | null;
  lessonAudit: LessonAuditItem[];
  updatedProfile: {
    levelEstimate: string;
    confidence: string;
    preferredTopics: string[];
    correctionPriorities: string[];
    nextSessionFocus: string;
    tutorNotes: string[];
  };
};
