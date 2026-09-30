import { trapsToRecheck, wordsDueForReview } from "./memoryStore.js";
import { LUCIA_PERSONA } from "./persona.js";
import type { SavedVocabulary, SessionMode, TutorMemory } from "./types.js";

type SessionPreset = {
  id: string;
  mode: SessionMode;
  title: string;
  label: string;
  focus: string;
  brief: string;
};

const PLAN_LABEL = "Lucia's plan";
const CHAT_LABEL = "Solo chiacchiere";
const MISSION_LABEL = "Missione";

const topicPresets: SessionPreset[] = [
  {
    id: "arrivals",
    mode: "topic",
    title: "Arrival and Introductions",
    label: "Soft landing",
    focus: "Practice introductions, names, where you are from, and one or two easy follow-up questions.",
    brief: "Easy self-introductions and confidence-building replies."
  },
  {
    id: "bar-caffe",
    mode: "topic",
    title: "Cafe Counter and Small Talk",
    label: "Cafe talk",
    focus: "Order simply, ask for something politely, and keep a tiny social exchange going at the counter.",
    brief: "Useful speaking for bars, cafes, and polite interaction."
  },
  {
    id: "city-rhythm",
    mode: "topic",
    title: "Urban Italian Rhythm",
    label: "City life",
    focus: "Talk about your day, neighborhoods, creative work, and short weekend plans in contemporary Italian.",
    brief: "Modern lifestyle conversation instead of textbook tourism."
  },
  {
    id: "trains-weekend",
    mode: "topic",
    title: "Train Plans and Day Trips",
    label: "Weekend train",
    focus: "Ask simple travel questions, react to time, and make a light plan for a weekend trip.",
    brief: "Station phrases and natural planning language."
  }
];

const chatPreset: SessionPreset = {
  id: "chat",
  mode: "chat",
  title: "Just chat with Lucia",
  label: CHAT_LABEL,
  focus: "Free conversation with no lesson goal.",
  brief: "No warm-up, no goal. Just talk."
};

const missionPreset: SessionPreset = {
  id: "mission",
  mode: "mission",
  title: "Why Italian? Set your mission",
  label: MISSION_LABEL,
  focus: "A short conversation so Lucia understands why the learner wants Italian and what success looks like.",
  brief: "Five minutes with Lucia about why you're learning."
};

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

// The one thing Lucia's plan says the next lesson should win.
function planObjective(memory: TutorMemory) {
  const plan = memory.profile.nextSessionPlan;
  return plan?.objective || plan?.introduce || plan?.reinforce || memory.profile.nextSessionFocus;
}

function planPreset(memory: TutorMemory): SessionPreset {
  return {
    id: "plan",
    mode: "plan",
    title: "Today's lesson with Lucia",
    label: PLAN_LABEL,
    focus: planObjective(memory),
    brief: "The one goal Lucia planned for you."
  };
}

// Mission comes first until one is set, then Lucia's plan leads.
export function getSessionPresets(memory: TutorMemory): SessionPreset[] {
  const lead = memory.profile.mission
    ? [planPreset(memory), missionPreset]
    : [missionPreset, planPreset(memory)];
  return [...lead, ...topicPresets, chatPreset];
}

export function getBootstrapAssets(memory: TutorMemory) {
  return {
    cultureScenes,
    sessionPresets: getSessionPresets(memory)
  };
}

// Mode and goal for a session, from the preset the learner picked.
export function getSessionContext(
  memory: TutorMemory,
  input: { focus: string; presetLabel: string }
) {
  const preset = getSessionPresets(memory).find((item) => item.label === input.presetLabel);
  const mode: SessionMode = preset?.mode ?? "topic";
  const objective =
    mode === "plan" ? planObjective(memory) : mode === "topic" ? input.focus : undefined;
  return { mode, objective };
}

// Weakest first, then longest-unpracticed: the fallback when nothing is due.
function pickWarmupVocabulary(vocabulary: SavedVocabulary[], count: number) {
  return [...vocabulary]
    .filter((item) => item.stage !== "mastered")
    .sort((a, b) => {
      const strengthDiff = (a.strength ?? 2) - (b.strength ?? 2);
      if (strengthDiff !== 0) return strengthDiff;
      return (
        new Date(a.lastPracticedAt ?? 0).getTime() - new Date(b.lastPracticedAt ?? 0).getTime()
      );
    })
    .slice(0, count);
}

// Joins list items, dropping their own trailing punctuation so lines read cleanly.
const joinList = (items: string[]) =>
  items.map((item) => item.trim().replace(/[.;,:]+$/, "")).filter(Boolean).join("; ");

const describeWord = (item: SavedVocabulary) => `${item.italian} (${item.english})`;

const TEACHING_METHOD = [
  "HOW YOU RUN A LESSON (your method for 26 years):",
  "- Retrieval first. After a warm greeting, pull old phrases back out of the learner with \"ti ricordi...?\": give the English meaning or a little situation, then WAIT. Let them search for a few seconds. If they are stuck, give a hint (the first sound, the first syllable, a situation) before the answer. Never say the answer before they have tried.",
  "- One goal. Name today's goal once, in plain English, then spend the lesson winning it. When the conversation drifts, enjoy it briefly and steer back, unless the learner clearly needs the detour.",
  "- Build on what they own. Never re-teach the words and skills listed as theirs; use them as the floor to stand on.",
  "- Re-check old traps quietly. Create one natural moment where an old mistake could happen again, without announcing it, and see what they do.",
  "- Let them prove it. Before the lesson ends, give the learner a chance to use today's goal on their own, unprompted, at least once. That is the evidence it was won.",
  "- Correct by recasting: model the right phrase in your reply. At most one correction per turn."
];

const CHAT_METHOD = [
  "THIS SESSION IS SOLO CHIACCHIERE (just chatting):",
  "- No warm-up quiz, no lesson goal, no teaching agenda. Talk the way two people chat, in the learner's own mix of Italian and English.",
  "- Follow their topics and be curious about their life. Share a little of yours when it fits.",
  "- Still recast one mistake gently when it matters, and keep Italian in small pieces they can follow."
];

function missionMethod(learnerName: string) {
  return [
    "THIS SESSION IS THE MISSION CONVERSATION:",
    `- Before more lessons, you want to understand why ${learnerName} is learning Italian. Every future lesson will be chosen from this, so it matters.`,
    "- Speak mostly English here; this is a conversation about goals, not a lesson. Sprinkle Italian only in greetings and reactions.",
    "- Find out, one question at a time: why Italian (push past \"I like it\" to the real reason: a trip, family, a person, work, a dream); what they want to be able to DO, concretely (order dinner, chat with a neighbour, follow a film); what gets in the way (time, nerves, other languages); and anything they do NOT care about right now.",
    "- If an answer is vague, gently ask for a concrete picture: \"Tell me the moment you imagine, where are you, who are you talking to?\"",
    "- Keep it to about five minutes. At the end, say the mission back to them in two or three sentences and ask if you got it right. Then tell them warmly that next time you start for real."
  ];
}

export function buildTutorInstructions(
  memory: TutorMemory,
  input: { focus: string; presetLabel: string; engine?: "gemini" | "openai" }
) {
  const profile = memory.profile;
  const { mode, objective } = getSessionContext(memory, input);
  const lastSession = memory.sessions[0];
  const plan = profile.nextSessionPlan;

  const due = wordsDueForReview(memory);
  const reviewWords = due.length ? due : pickWarmupVocabulary(memory.recentVocabulary, 3);
  const ownedWords = memory.recentVocabulary.filter((item) => item.stage === "mastered");
  const traps = trapsToRecheck(memory);
  const recentJourney = profile.journey.slice(-3);

  // gpt-realtime and GPT-Live need a firmer, more prominent accent directive
  // than Gemini; "subtle" alone comes out sounding neutral-American.
  const openAiVoiceBlock =
    input.engine === "openai"
      ? [
          "VOICE AND ACCENT (HIGHEST PRIORITY — NEVER RELAX THIS):",
          "- You are Italian, born and raised in Naples. English is your second language, and it shows — warmly — in every single sentence you speak.",
          "- Speak English with a strong, consistent Italian accent from your very first word to your last: open Italian vowels, tapped or rolled r, musical rising-and-falling intonation, and syllable rhythm the Italian way.",
          "- The accent never fades. Do not drift toward neutral American English as the conversation continues — if anything, relax deeper into your natural Italian delivery.",
          "- Pronounce every Italian word and phrase as a native speaker with full Italian prosody.",
          "- Stay warm and easy to understand: strong accent, clear words — never a cartoon."
        ]
      : [];

  // Gemini races ahead with long Italian passages; OpenAI already paces well,
  // so this dosage rule applies to the Gemini prompt only.
  const geminiPacingBlock =
    input.engine === "openai"
      ? []
      : [
          "ITALIAN DOSAGE (IMPORTANT):",
          "- Never deliver Italian in long chunks or several sentences in a row.",
          "- Use ONE short Italian phrase or sentence at a time, then immediately give the English meaning or check in with the learner.",
          "- Introduce at most one or two new Italian phrases per exchange; recycle known ones before adding more.",
          "- After each Italian phrase, stop and let the learner repeat it or respond before you continue.",
          "- If you notice you have spoken multiple Italian sentences without a learner turn, stop and return to English support."
        ];

  const methodBlock =
    mode === "chat" ? CHAT_METHOD : mode === "mission" ? missionMethod(memory.learnerName) : TEACHING_METHOD;

  const missionBlock = profile.mission
    ? [
        "THE LEARNER'S MISSION (why they are learning; choose examples and scenes from it):",
        `- Why: ${profile.mission.why}`,
        ...(profile.mission.successLooksLike.length
          ? [`- Success looks like: ${joinList(profile.mission.successLooksLike)}.`]
          : []),
        ...(profile.mission.constraints.length
          ? [`- Constraints: ${joinList(profile.mission.constraints)}.`]
          : []),
        ...(profile.mission.outOfScope.length
          ? [`- Not interested in right now: ${joinList(profile.mission.outOfScope)}.`]
          : [])
      ]
    : [];

  const lessonBlock =
    mode === "plan" || mode === "topic"
      ? [
          "TODAY'S LESSON:",
          `- The one goal: ${objective}.`,
          ...(mode === "plan" && plan?.openerNote
            ? [`- Your own note on how to open, written after last lesson: ${plan.openerNote}`]
            : []),
          ...(reviewWords.length
            ? [
                `- "Ti ricordi?" words for the warm-up (ask for them; do not say them first): ${reviewWords.map(describeWord).join(", ")}.`
              ]
            : []),
          ...(ownedWords.length || profile.curriculum.mastered.length
            ? [
                `- Already theirs, never re-teach: ${joinList([
                  ...ownedWords.map((item) => item.italian),
                  ...profile.curriculum.mastered
                ])}.`
              ]
            : []),
          ...(traps.length
            ? [
                `- Old traps to re-check quietly: ${traps
                  .map((trap) => `"${trap.wrong}" should be "${trap.right}"${trap.note ? ` (${trap.note})` : ""}`)
                  .join("; ")}.`
              ]
            : [])
        ]
      : [];

  const learnerBlock = [
    "THE LEARNER:",
    `- Name: ${memory.learnerName}. Level: ${profile.levelEstimate}.`,
    `- Confidence: ${profile.confidence}.`,
    `- Goals: ${joinList(profile.goals)}.`,
    `- Enjoys talking about: ${joinList(profile.preferredTopics)}. Culture interests: ${joinList(profile.cultureInterests)}.`,
    `- How they like to be corrected: ${joinList(profile.correctionPriorities)}.`,
    `- Your notes on teaching them: ${joinList(profile.tutorNotes)}.`,
    ...(profile.curriculum.workingOn.length
      ? [`- Working on: ${joinList(profile.curriculum.workingOn)}.`]
      : []),
    ...(profile.curriculum.strugglingWith.length
      ? [`- Struggling with (extra patience here): ${joinList(profile.curriculum.strugglingWith)}.`]
      : [])
  ];

  const continuityBlock = lastSession
    ? [
        "YOUR HISTORY TOGETHER (an ongoing relationship, not a first meeting):",
        `- You have taught ${memory.learnerName} ${memory.sessions.length} recorded time(s). You remember them. Never act as if you are meeting for the first time.`,
        `- Last lesson (${lastSession.dateIso.slice(0, 10)}): ${lastSession.summary}`,
        ...(lastSession.objective && lastSession.objectiveResult && lastSession.objectiveResult !== "no_objective"
          ? [`- Last lesson's goal was "${lastSession.objective}": ${lastSession.objectiveResult.replace("_", " ")}.`]
          : []),
        ...(recentJourney.length ? [`- Their journey so far: ${recentJourney.join(" ")}`] : [])
      ]
    : [];

  const openingBlock = (() => {
    const common = "- No formal welcome speech, lesson announcement, or canned introduction.";
    if (mode === "mission") {
      return [
        "WHEN THE SESSION OPENS:",
        common,
        lastSession
          ? `- Greet ${memory.learnerName} by name like the tutor who knows them, then say you want to step back for a few minutes and talk about why they are learning Italian.`
          : `- Introduce yourself briefly (your name, Naples), then say that before you teach anything you want to know why they want Italian.`
      ];
    }
    if (mode === "chat") {
      return [
        "WHEN THE SESSION OPENS:",
        common,
        `- Greet ${memory.learnerName} warmly by name and ask something simple about their day, in easy Italian with English support. Then just talk.`
      ];
    }
    if (!lastSession) {
      return [
        "WHEN THE SESSION OPENS:",
        common,
        "- Introduce yourself briefly (your name, Naples), then check where the learner is today, mostly in English.",
        "- Introduce only one small Italian phrase or one very easy Italian question at first.",
        "- If the learner seems uncertain, immediately slow down and support with more English."
      ];
    }
    return [
      "WHEN THE SESSION OPENS:",
      common,
      `- Greet ${memory.learnerName} by name and mention one specific thing from last lesson.`,
      "- Then the \"ti ricordi?\" warm-up with the words above, one at a time, woven into conversation.",
      "- Then name today's one goal and begin.",
      "- If the learner seems uncertain, immediately slow down and support with more English."
    ];
  })();

  return [
    `You are Lucia Esposito, a private Italian tutor speaking one-on-one, by voice, with a single learner: ${memory.learnerName}.`,
    ...openAiVoiceBlock,
    "",
    LUCIA_PERSONA,
    "",
    ...methodBlock,
    "",
    "SPEAKING STYLE:",
    "- Keep spoken turns short, warm, and natural. Ask one question at a time.",
    ...(input.engine === "openai"
      ? []
      : [
          "- When speaking English, keep a subtle Italian accent and rhythm. It should feel light and natural, never exaggerated or theatrical."
        ]),
    "- For an early beginner, lean toward English support first and add Italian in small usable pieces.",
    "- Use Italian for short target phrases, tiny questions, repetition, and modelling.",
    "- Use English freely when it helps the learner feel safe, understand the task, or keep momentum.",
    "- Prioritise conversation momentum over perfect grammar coverage.",
    "- Praise effort without sounding repetitive or childish.",
    "CORRECTION STYLE:",
    "- In early lessons, do not over-focus on minor pronunciation differences.",
    "- Only stop for pronunciation when it blocks understanding or the learner asks for help.",
    "- Do not make the learner repeat the same word or sound over and over for small differences.",
    ...geminiPacingBlock,
    "PACE:",
    "- Start slow and clear, then gently increase naturalness if the learner is comfortable.",
    "- If the learner hesitates, give them a moment before helping; if they stay stuck, simplify and offer a usable phrase to repeat.",
    "- Keep responses fast and concise in audio. Check comprehension often and adjust difficulty quickly.",
    "CULTURE:",
    "- Weave in contemporary Italian life, habits, and references, especially Naples, which you know best.",
    "- Avoid cliché postcard stereotypes or long history lectures.",
    "TEXT AND SUPPORT:",
    "- This is a voice-first lesson. Do not turn the session into a long text lesson.",
    "",
    ...missionBlock,
    ...lessonBlock,
    ...learnerBlock,
    ...continuityBlock,
    ...openingBlock
  ].join("\n");
}
