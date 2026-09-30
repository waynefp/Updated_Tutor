// Sample data for the design preview (?debug&preview=lesson|saving|summary|settings).
// Shows mid-flow screens without running a real lesson. Never saved anywhere.
import type { LessonReflection, LessonTurn } from "../types";

export type PreviewScreen = "lesson" | "saving" | "summary" | "settings";

export function readPreviewScreen(): PreviewScreen | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("debug")) return null;
  const screen = params.get("preview");
  return screen === "lesson" || screen === "saving" || screen === "summary" || screen === "settings"
    ? screen
    : null;
}

const turn = (speaker: LessonTurn["speaker"], text: string, index: number): LessonTurn => ({
  id: `preview-${index}`,
  speaker,
  text,
  timestamp: new Date().toISOString()
});

export const PREVIEW_TRANSCRIPT: LessonTurn[] = [
  turn("tutor", "Ciao Wayne! Allora, ti ricordi... how do you ask someone how they are?", 1),
  turn("you", "Come stai?", 2),
  turn("tutor", "Perfetto, straight out of your memory. Today we win one thing: answering 'Di dove sei?' in a full sentence.", 3),
  turn("you", "Sono... di Chicago?", 4)
];

export const PREVIEW_REFLECTION: LessonReflection = {
  title: "Introductions, round two",
  summary:
    "Wayne recalled 'Come stai?' on his own, then answered 'Di dove sei?' in a full sentence and asked it back in a short role-play.",
  strengths: ["Recalled a greeting without help"],
  needsWork: ["Spanish still slips in under pressure"],
  nextDrills: [],
  cultureMoments: [],
  vocabulary: [
    { italian: "Come stai?", english: "How are you?", example: "Come stai?", strength: 3, evidence: "used_unprompted" },
    { italian: "Sono di...", english: "I am from...", example: "Sono di Chicago.", strength: 3, evidence: "used_unprompted" },
    { italian: "Mi chiamo...", english: "My name is...", example: "Mi chiamo Wayne.", strength: 2, evidence: "used_with_help" },
    { italian: "Anche io", english: "Me too", example: "Anche io!", strength: 1, evidence: "heard_only" }
  ],
  nextSessionPlan: {
    objective: "Ask someone where they are from and react to their answer",
    openerNote: "Open with his win: 'Sono di Chicago', said on his own.",
    warmupVocabulary: ["Mi chiamo...", "Di dove sei?"],
    reinforce: "Sono di...",
    introduce: "Ask someone where they are from and react to their answer"
  },
  objectiveOutcome: {
    result: "won",
    evidence: "“Sono di Chicago”, twice, on your own, and you asked it back."
  },
  learningRecords: [],
  traps: [
    { wrong: "soy de...", right: "sono di...", note: "Spanish slipping in", fixedThisSession: true },
    { wrong: "io sono bene", right: "sto bene", note: "stare for how you are", fixedThisSession: false }
  ],
  mission: null,
  lessonAudit: [
    { rule: "Opened by name with a specific callback to the last lesson", followed: "yes", evidence: "“Ciao Wayne! Last time you introduced yourself so nicely.”" },
    { rule: "Ti ricordi: asked for review words and waited before giving answers", followed: "yes", evidence: "Asked for 'how are you' and waited." },
    { rule: "Quietly re-checked an old trap", followed: "not_applicable", evidence: "No known traps yet." },
    { rule: "Kept Italian in small pieces the learner could follow", followed: "no", evidence: "Three Italian sentences in a row during the role-play." }
  ],
  updatedProfile: {
    levelEstimate: "A1",
    confidence: "Growing",
    preferredTopics: [],
    correctionPriorities: [],
    nextSessionFocus: "",
    tutorNotes: []
  }
};
