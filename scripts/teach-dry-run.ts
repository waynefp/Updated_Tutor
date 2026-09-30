// Dry run of the /teach reflection pipeline on synthetic transcripts.
// Calls the real reflection model, merges into a COPY of memory, prints what
// changed. Nothing is saved. Usage: npx tsx scripts/teach-dry-run.ts [plan|mission|both]
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "node:path";
import { loadMemory, mergeReflection, wordsDueForReview } from "../server/lib/memoryStore.js";
import { getSessionContext, getSessionPresets } from "../server/lib/prompts.js";
import { reflectLessonWithAI } from "../server/lib/reflection.js";
import type { LessonTurn, TutorMemory } from "../server/lib/types.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

const turn = (speaker: LessonTurn["speaker"], text: string): LessonTurn => ({
  speaker,
  text,
  timestamp: new Date().toISOString()
});

const planTranscript: LessonTurn[] = [
  turn("tutor", "Ciao Wayne! Last time you introduced yourself so nicely. Allora, ti ricordi... how do you ask someone how they are?"),
  turn("you", "Come stai?"),
  turn("tutor", "Perfetto! Bravissimo, straight out of your memory. And how do you say 'my name is'?"),
  turn("you", "Ehm... mi... mi..."),
  turn("tutor", "Mi chia..."),
  turn("you", "Mi chiamo Wayne."),
  turn("tutor", "Ecco! Today we win one thing: answering 'Di dove sei?', where are you from, in a full sentence. Di dove sei, Wayne?"),
  turn("you", "Soy de Chicago."),
  turn("tutor", "Ah, that's the Spanish sneaking in! In Italian: sono di Chicago. Sono di Chicago."),
  turn("you", "Sono di Chicago."),
  turn("tutor", "Perfetto. Anche io... I am from Naples: sono di Napoli. Come stai oggi?"),
  turn("you", "Io sono bene."),
  turn("tutor", "Sto bene! In Italian we say sto bene. And you ask back: e tu?"),
  turn("you", "Sto bene, e tu?"),
  turn("tutor", "Benissimo, grazie. Now imagine you meet someone at a bar in Rome. They say: Piacere, sono Marco. Di dove sei?"),
  turn("you", "Piacere Marco. Sono di Chicago. E tu, di dove sei?"),
  turn("tutor", "Bravissimo! You did it all on your own, and you asked it back. That's the goal won for today.")
];

const missionTranscript: LessonTurn[] = [
  turn("tutor", "Ciao Wayne! Before we go further, I want to step back. Why Italian? What's the real reason?"),
  turn("you", "I've always loved Italian design and I'm planning a trip to Milan and the lakes next spring."),
  turn("tutor", "Bello. Tell me the moment you imagine. Where are you, who are you talking to?"),
  turn("you", "Ordering dinner in a small trattoria without switching to English, and chatting with the owner a bit."),
  turn("tutor", "And what gets in the way?"),
  turn("you", "Time, mostly. Maybe fifteen minutes a day. And Spanish keeps coming out."),
  turn("tutor", "Anything you don't care about right now?"),
  turn("you", "Writing and grammar tables. I just want to talk."),
  turn("tutor", "Allora: you want to order and chat in a trattoria on your spring trip to Milan, about fifteen minutes a day, speaking only, no grammar tables. Did I get it?"),
  turn("you", "Yes, exactly.")
];

function printChanges(before: TutorMemory, after: TutorMemory) {
  const beforeWords = new Map(before.recentVocabulary.map((w) => [w.italian.toLowerCase(), w]));
  console.log("  words:");
  for (const word of after.recentVocabulary) {
    const old = beforeWords.get(word.italian.toLowerCase());
    const changed =
      !old ||
      old.stage !== word.stage ||
      old.nextReviewAt !== word.nextReviewAt ||
      old.unpromptedUses !== word.unpromptedUses;
    if (!changed) continue;
    console.log(
      `    ${word.italian.padEnd(18)} ${old ? old.stage : "(new)"} -> ${word.stage}  unprompted=${word.unpromptedUses}  next review ${word.nextReviewAt?.slice(0, 10)}`
    );
  }
  console.log("  traps:");
  for (const trap of after.profile.traps) {
    console.log(`    "${trap.wrong}" -> "${trap.right}" (${trap.status}, seen ${trap.timesSeen}x) ${trap.note}`);
  }
  const newRecords = after.profile.learningRecords.slice(before.profile.learningRecords.length);
  console.log("  learning records:");
  for (const record of newRecords) console.log(`    [${record.kind}] ${record.title} — ${record.evidence}`);
  const session = after.sessions[0];
  console.log(`  goal "${session.objective ?? "(none)"}": ${session.objectiveResult} — ${session.objectiveEvidence}`);
  console.log("  lesson audit:");
  for (const item of session.lessonAudit ?? []) console.log(`    ${item.followed.padEnd(14)} ${item.rule} — ${item.evidence}`);
  console.log(`  next objective: ${after.profile.nextSessionPlan?.objective}`);
  console.log(`  opener note: ${after.profile.nextSessionPlan?.openerNote}`);
  console.log(`  correction priorities: ${JSON.stringify(after.profile.correctionPriorities)}`);
  console.log(`  tutor notes: ${JSON.stringify(after.profile.tutorNotes)}`);
  if (after.profile.mission) console.log(`  mission: ${JSON.stringify(after.profile.mission)}`);
}

async function run(memory: TutorMemory, presetLabel: string, turns: LessonTurn[]) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const preset = getSessionPresets(memory).find((item) => item.label === presetLabel)!;
  const { mode, objective } = getSessionContext(memory, { focus: preset.focus, presetLabel });
  console.log(`\n=== ${presetLabel} (mode ${mode}) ===`);
  console.log(`  due for review before: ${wordsDueForReview(memory).map((w) => w.italian).join(", ")}`);
  const started = Date.now();
  const reflection = await reflectLessonWithAI({ client, memory, focus: preset.focus, presetLabel, mode, objective, turns });
  console.log(`  reflection took ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const endedAt = new Date().toISOString();
  const after = mergeReflection(memory, {
    reflection,
    focus: preset.focus,
    presetLabel,
    mode,
    objective,
    startedAt: new Date(Date.now() - 8 * 60000).toISOString(),
    endedAt
  });
  printChanges(memory, after);
  return after;
}

const which = process.argv[2] ?? "both";
let memory = await loadMemory();
if (which === "plan" || which === "both") memory = await run(memory, "Lucia's plan", planTranscript);
if (which === "mission" || which === "both") await run(memory, "Missione", missionTranscript);
console.log("\n(dry run: nothing was saved)");
