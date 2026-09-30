// Smoke test for OpenAI GPT-Live (gpt-live-1) over its WebSocket transport.
// Usage: npx tsx scripts/gpt-live-smoke.ts [speech.mp3] [--voice=marin] [--trials=3]
// Checks: session starts with the real tutor prompt and no delegation,
// "speak first" via session.instructions.append, spoken turns with reply
// timing, transcripts, and every event type the server sends (to learn the
// protocol before building the browser hook). Reply audio is saved as WAV.
import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { loadMemory } from "../server/lib/memoryStore.js";
import { buildTutorInstructions } from "../server/lib/prompts.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

const WS_URL = "wss://api.openai.com/v1/live/sessions";
const OUTPUT_DIR = path.resolve("scripts/.smoke-output");
const RATE = 24000;
const CHUNK_MS = 100;
const BYTES_PER_CHUNK = (RATE * 2 * CHUNK_MS) / 1000;
// GPT-Live has no "response done" event: a reply ends after this much audio silence.
const REPLY_GAP_MS = 1500;

const args = process.argv.slice(2);
const speechFile = args.find((arg) => !arg.startsWith("--")) ?? "Record (online-voice-recorder.com).mp3";
const voice = args.find((arg) => arg.startsWith("--voice="))?.split("=")[1] ?? "marin";
const trials = Number(args.find((arg) => arg.startsWith("--trials="))?.split("=")[1] ?? 3);
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is missing from .env");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadSpeechPcm(file: string) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(RATE), "-"], {
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.toString()}`);
  return result.stdout as Buffer;
}

function writeWav(file: string, pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

// RMS of a PCM16 chunk above ~1% of full scale counts as speech.
function isVoiced(chunk: Buffer) {
  let sumSquares = 0;
  const samples = Math.floor(chunk.length / 2);
  for (let index = 0; index < samples; index += 1) {
    const value = chunk.readInt16LE(index * 2);
    sumSquares += value * value;
  }
  return samples > 0 && Math.sqrt(sumSquares / samples) > 330;
}

type Reply = { firstAudioAt: number | null; lastAudioAt: number | null; audio: Buffer[]; tutorText: string; userText: string };
const emptyReply = (): Reply => ({ firstAudioAt: null, lastAudioAt: null, audio: [], tutorText: "", userText: "" });

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const speech = loadSpeechPcm(speechFile);
  const memory = await loadMemory();
  const instructions = buildTutorInstructions(memory, {
    focus: "Practice introductions, names, where you are from, and one or two easy follow-up questions.",
    presetLabel: "Soft landing",
    engine: "openai"
  });
  console.log(`Speech: ${speechFile} (${(speech.length / (RATE * 2)).toFixed(1)}s) · voice ${voice} · prompt ${instructions.length} chars\n`);

  const eventCounts = new Map<string, number>();
  const samples = new Map<string, string>();
  let started: { at: number; id?: string } | null = null;
  let closed: { at: number; detail: string } | null = null;
  let reply = emptyReply();
  const errors: string[] = [];

  const openedAt = Date.now();
  const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });

  ws.on("unexpected-response", (_request, response) => {
    let body = "";
    response.on("data", (chunk: Buffer) => (body += chunk));
    response.on("end", () => {
      closed = { at: Date.now(), detail: `HTTP ${response.statusCode}: ${body}` };
    });
  });
  ws.on("error", (error) => errors.push(`socket: ${error.message}`));
  ws.on("close", (code, reason) => {
    closed ??= { at: Date.now(), detail: `close ${code} ${reason.toString()}` };
  });
  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "session.start",
        event_id: "event_start",
        session: {
          model: "gpt-live-1",
          instructions,
          audio: { format: { type: "audio/pcm", rate: RATE }, output: { voice } }
        }
      })
    );
  });
  ws.on("message", (data) => {
    const event = JSON.parse(data.toString());
    eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
    if (!samples.has(event.type)) {
      const sample = { ...event };
      if (typeof sample.delta === "string" && sample.delta.length > 80) sample.delta = `<${sample.delta.length} chars>`;
      if (typeof sample.audio === "string") sample.audio = `<${sample.audio.length} chars>`;
      samples.set(event.type, JSON.stringify(sample).slice(0, 400));
    }
    switch (event.type) {
      case "session.started":
        started = { at: Date.now(), id: event.session?.id };
        break;
      case "session.output_audio.delta": {
        // Output is a continuous stream (silence between replies), so only
        // chunks with real voice energy count as the tutor speaking.
        const chunk = Buffer.from(event.delta, "base64");
        if (isVoiced(chunk)) {
          const now = Date.now();
          reply.firstAudioAt ??= now;
          reply.lastAudioAt = now;
        }
        if (reply.firstAudioAt !== null) reply.audio.push(chunk);
        break;
      }
      case "session.output_transcript.delta":
        reply.tutorText += event.delta ?? "";
        break;
      case "session.input_transcript.delta":
        reply.userText += event.delta ?? "";
        break;
      case "session.closed":
        closed = { at: Date.now(), detail: `session.closed reason=${event.reason} usage=${JSON.stringify(event.usage)}` };
        break;
      case "error":
        errors.push(JSON.stringify(event.error));
        break;
    }
  });

  const waitFor = async (predicate: () => boolean, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (closed || Date.now() > deadline) return false;
      await sleep(20);
    }
    return true;
  };
  const replyFinished = () =>
    reply.lastAudioAt !== null && Date.now() - reply.lastAudioAt > REPLY_GAP_MS;
  const silence = Buffer.alloc(BYTES_PER_CHUNK);
  const sendAudio = (chunk: Buffer) =>
    ws.readyState === WebSocket.OPEN &&
    ws.send(JSON.stringify({ type: "session.input_audio.append", audio: chunk.toString("base64") }));
  // GPT-Live expects a continuous mic stream: silence flows except while "speaking".
  let speaking = false;
  let finished = false;
  const silencePump = (async () => {
    await waitFor(() => started !== null, 20000);
    while (!closed && !finished) {
      if (!speaking) sendAudio(silence);
      await sleep(CHUNK_MS);
    }
  })();

  if (!(await waitFor(() => started !== null, 20000))) {
    console.log(`session.start FAILED: ${closed ? (closed as { detail: string }).detail : "timeout"}`);
    console.log(`errors: ${errors.join(" | ") || "none"}`);
    ws.close();
    process.exit(1);
  }
  console.log(`session.started in ${started!.at - openedAt}ms (id ${started!.id ?? "?"})`);

  // Speak first.
  reply = emptyReply();
  const openerSentAt = Date.now();
  ws.send(
    JSON.stringify({
      type: "session.instructions.append",
      event_id: "event_opener",
      delegation_id: null,
      content: "The lesson is starting now. Speak first: open the lesson the way your instructions describe, keep it short, then listen."
    })
  );
  await waitFor(() => reply.firstAudioAt !== null, 15000);
  await waitFor(replyFinished, 30000);
  console.log(
    `speak-first: ${reply.firstAudioAt ? `OK, first audio ${reply.firstAudioAt - openerSentAt}ms` : "NO AUDIO"}`
  );
  console.log(`  said: ${reply.tutorText.trim()}`);
  if (reply.audio.length) writeWav(path.join(OUTPUT_DIR, `gpt-live-1-${voice}-opener.wav`), Buffer.concat(reply.audio));

  // Spoken turns: speech replaces the silence stream in real time.
  const latencies: number[] = [];
  for (let trial = 1; trial <= trials && !closed; trial += 1) {
    await sleep(1500);
    reply = emptyReply();
    speaking = true;
    for (let offset = 0; offset < speech.length; offset += BYTES_PER_CHUNK) {
      sendAudio(speech.subarray(offset, offset + BYTES_PER_CHUNK));
      await sleep(CHUNK_MS);
    }
    speaking = false;
    const speechEndedAt = Date.now();
    const audioDuringSpeech = reply.firstAudioAt !== null;
    const replyStarted = () => reply.audio.length > 0 && reply.lastAudioAt! > speechEndedAt;
    await waitFor(replyStarted, 12000);
    // First audio chunk that arrived after speech ended.
    const firstAfter = audioDuringSpeech ? reply.lastAudioAt : reply.firstAudioAt;
    await waitFor(replyFinished, 30000);
    const latency = firstAfter !== null && firstAfter > speechEndedAt ? firstAfter - speechEndedAt : null;
    if (latency !== null) latencies.push(latency);
    console.log(`turn #${trial}: reply ${latency ?? "n/a"}ms${audioDuringSpeech ? " (model also spoke while audio was still streaming)" : ""}`);
    console.log(`  heard: ${reply.userText.trim()}`);
    console.log(`  said: ${reply.tutorText.trim()}`);
    if (reply.audio.length) writeWav(path.join(OUTPUT_DIR, `gpt-live-1-${voice}-turn${trial}.wav`), Buffer.concat(reply.audio));
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  console.log(`\nmedian reply: ${sorted.length ? sorted[Math.floor(sorted.length / 2)] : "n/a"}ms · all [${latencies.join(", ")}]`);

  finished = true;
  await silencePump;
  ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "session.close", event_id: "event_close" }));
  await waitFor(() => closed !== null, 10000);
  console.log(`closed: ${closed ? (closed as { detail: string }).detail : "no session.closed received"}`);
  console.log(`errors: ${errors.join(" | ") || "none"}`);
  console.log("\nEvent types seen (count · first sample):");
  for (const [type, count] of eventCounts) console.log(`  ${type} ×${count}  ${samples.get(type)}`);
  ws.close();
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
