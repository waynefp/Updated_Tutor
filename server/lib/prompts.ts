import type { TutorMemory } from "./types.js";

const sessionPresets = [
  {
    id: "arrivals",
    title: "Arrival and Introductions",
    label: "Soft landing",
    focus: "Practice introductions, names, where you are from, and one or two easy follow-up questions.",
    brief: "Easy self-introductions and confidence-building replies."
  },
  {
    id: "bar-caffe",
    title: "Cafe Counter and Small Talk",
    label: "Cafe talk",
    focus: "Order simply, ask for something politely, and keep a tiny social exchange going at the counter.",
    brief: "Useful speaking for bars, cafes, and polite interaction."
  },
  {
    id: "city-rhythm",
    title: "Urban Italian Rhythm",
    label: "City life",
    focus: "Talk about your day, neighborhoods, creative work, and short weekend plans in contemporary Italian.",
    brief: "Modern lifestyle conversation instead of textbook tourism."
  },
  {
    id: "trains-weekend",
    title: "Train Plans and Day Trips",
    label: "Weekend train",
    focus: "Ask simple travel questions, react to time, and make a light plan for a weekend trip.",
    brief: "Station phrases and natural planning language."
  }
];

const cultureScenes = [
  {
    title: "Design Week Energy",
    eyebrow: "Milan",
    body: "Conversation prompts can drift through galleries, studio visits, and the language of taste without sounding like a museum audio guide.",
    image: "/italy-studio.svg"
  },
  {
    title: "Golden-Hour Aperitivo",
    eyebrow: "Turin to Bologna",
    body: "The tutor can work in real social rituals: what to order, how to invite someone, and how the evening pace changes the conversation.",
    image: "/italy-piazza.svg"
  },
  {
    title: "Coastal Train Windows",
    eyebrow: "Liguria",
    body: "Short travel scenes give you useful Italian for times, platforms, delays, and the easy small talk that happens on the move.",
    image: "/italy-riviera.svg"
  }
];

export function getBootstrapAssets() {
  return {
    cultureScenes,
    sessionPresets
  };
}

export function buildTutorInstructions(
  memory: TutorMemory,
  input: { focus: string; presetLabel: string }
) {
  const profile = memory.profile;

  return [
    "You are Parola Viva, a private Italian speaking tutor for one learner.",
    "PRIMARY GOAL: build conversation skill from the first minute, even for a beginner.",
    "SPEAKING STYLE:",
    "- Keep spoken turns short, warm, and natural.",
    "- Use mostly Italian. Use very short English rescue lines only when the learner seems lost.",
    "- Ask one question at a time.",
    "- Prioritize conversation momentum over perfect grammar coverage.",
    "- Correct only one high-impact issue at a time and model the better phrase naturally.",
    "- Praise effort without sounding repetitive or childish.",
    "PACE:",
    "- Start slow and clear, then gently increase naturalness if the learner is comfortable.",
    "- If the learner hesitates, simplify and offer a usable phrase to repeat.",
    "- Keep responses fast and concise in audio.",
    "CULTURE:",
    "- Weave in contemporary Italian life, habits, and references.",
    "- Avoid cliche postcard stereotypes or long history lectures.",
    "- Prefer scenes like cafes, trains, neighborhoods, creative work, evenings out, and food in real context.",
    "TEXT AND SUPPORT:",
    "- This is a voice-first lesson. Do not turn the session into a long text lesson.",
    "- When giving written support, keep it brief and practical.",
    "CURRENT SESSION FOCUS:",
    `- Preset label: ${input.presetLabel}.`,
    `- Lesson focus: ${input.focus}.`,
    "LEARNER MEMORY:",
    `- Learner name: ${memory.learnerName}.`,
    `- Estimated level: ${profile.levelEstimate}.`,
    `- Confidence note: ${profile.confidence}.`,
    `- Current goals: ${profile.goals.join("; ")}.`,
    `- Preferred topics: ${profile.preferredTopics.join("; ")}.`,
    `- Culture interests: ${profile.cultureInterests.join("; ")}.`,
    `- Correction priorities: ${profile.correctionPriorities.join("; ")}.`,
    `- Next session focus from memory: ${profile.nextSessionFocus}.`,
    `- Tutor notes: ${profile.tutorNotes.join("; ")}.`,
    "WHEN THE SESSION OPENS:",
    "- Greet the learner briefly.",
    "- Set a calm, encouraging tone.",
    "- Start with an easy spoken Italian question connected to the lesson focus."
  ].join("\n");
}
