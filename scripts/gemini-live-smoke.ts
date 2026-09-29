// Smoke test for Gemini Live models over the same raw WebSocket the app uses.
// Usage: npx tsx scripts/gemini-live-smoke.ts [speech.mp3] [--models=a,b] [--trials=3]
// For each model it checks:
//   1. setup is accepted
//   2. "speak first": a clientContent opener right after setupComplete
//   3. spoken turns: streams the recording in real time, then silence, and
//      measures end-of-speech -> first reply audio (includes VAD wait).
// Reply audio is saved as WAV under scripts/.smoke-output/ for listening.
import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadMemory } from "../server/lib/memoryStore.js";
import { buildTutorInstructions } from "../server/lib/prompts.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

const WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const OUTPUT_DIR = path.resolve("scripts/.smoke-output");
const CHUNK_MS = 100;
const BYTES_PER_CHUNK = (16000 * 2 * CHUNK_MS) / 1000;

const args = process.argv.slice(2);
const speechFile = args.find((arg) => !arg.startsWith("--")) ?? "Record (online-voice-recorder.com).mp3";
const models = (args.find((arg) => arg.startsWith("--models="))?.split("=")[1] ??
  "gemini-3.1-flash-live-preview,gemini-3.8-live").split(",");
const trials = Number(args.find((arg) => arg.startsWith("--trials="))?.split("=")[1] ?? 3);

const apiKey = process.env.GEMINI_API_KEY;
const voice = process.env.GEMINI_LIVE_VOICE ?? "Callirrhoe";
if (!apiKey) throw new Error("GEMINI_API_KEY is missing from .env");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadSpeechPcm(file: string) {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.toString()}`);
  return result.stdout as Buffer;
}

function writeWav(file: string, pcm: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

type Turn = { firstAudioAt: number | null; audio: Buffer[]; tutorText: string; userText: string; complete: boolean };

class LiveConnection {
  ws: WebSocket;
  openedAt = Date.now();
  setupAt: number | null = null;
  closed: { code: number; reason: string } | null = null;
  turn: Turn = LiveConnection.emptyTurn();

  static emptyTurn(): Turn {
    return { firstAudioAt: null, audio: [], tutorText: "", userText: "", complete: false };
  }

  constructor(model: string, systemInstruction: string) {
    this.ws = new WebSocket(`${WS_URL}?key=${apiKey}`);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      this.ws.send(
        JSON.stringify({
          setup: {
            model: `models/${model}`,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {}
          }
        })
      );
    };
    this.ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      const message = JSON.parse(raw);
      if (message.setupComplete) this.setupAt = Date.now();
      const content = message.serverContent;
      if (!content) return;
      if (content.inputTranscription?.text) this.turn.userText += content.inputTranscription.text;
      if (content.outputTranscription?.text) this.turn.tutorText += content.outputTranscription.text;
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          this.turn.firstAudioAt ??= Date.now();
          this.turn.audio.push(Buffer.from(part.inlineData.data, "base64"));
        }
      }
      if (content.turnComplete) this.turn.complete = true;
    };
    this.ws.onclose = (event) => {
      this.closed = { code: event.code, reason: event.reason };
    };
  }

  async waitFor(predicate: () => boolean, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (this.closed || Date.now() > deadline) return false;
      await sleep(20);
    }
    return true;
  }

  sendAudio(chunk: Buffer) {
    this.ws.send(
      JSON.stringify({
        realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: chunk.toString("base64") } }
      })
    );
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }
}

function saveTurnAudio(model: string, label: string, turn: Turn) {
  if (!turn.audio.length) return null;
  const file = path.join(OUTPUT_DIR, `${model}-${label}.wav`);
  writeWav(file, Buffer.concat(turn.audio), 24000);
  return path.relative(process.cwd(), file);
}

async function testSpeakFirst(model: string, instructions: string) {
  const live = new LiveConnection(model, instructions);
  const ready = await live.waitFor(() => live.setupAt !== null, 15000);
  if (!ready) {
    live.close();
    return { ok: false, detail: `setup failed: ${JSON.stringify(live.closed)}` };
  }
  const setupMs = live.setupAt! - live.openedAt;
  const sentAt = Date.now();
  live.ws.send(
    JSON.stringify({
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: "The lesson is starting now. Open it the way your instructions describe. Keep it short." }]
          }
        ],
        turnComplete: true
      }
    })
  );
  await live.waitFor(() => live.turn.complete, 25000);
  const turn = live.turn;
  live.close();
  if (!turn.firstAudioAt) {
    return { ok: false, setupMs, detail: `no reply audio; close=${JSON.stringify(live.closed)}` };
  }
  return {
    ok: true,
    setupMs,
    firstAudioMs: turn.firstAudioAt - sentAt,
    text: turn.tutorText.trim(),
    wav: saveTurnAudio(model, "opener", turn)
  };
}

async function testSpokenTurns(model: string, instructions: string, speech: Buffer) {
  const live = new LiveConnection(model, instructions);
  if (!(await live.waitFor(() => live.setupAt !== null, 15000))) {
    live.close();
    return { ok: false, detail: `setup failed: ${JSON.stringify(live.closed)}`, results: [], memoryAnswer: "" };
  }
  const silence = Buffer.alloc(BYTES_PER_CHUNK);
  const results: Array<{ latencyMs: number | null; heard: string; text: string; wav: string | null }> = [];

  for (let trial = 1; trial <= trials; trial += 1) {
    live.turn = LiveConnection.emptyTurn();
    for (let offset = 0; offset < speech.length; offset += BYTES_PER_CHUNK) {
      live.sendAudio(speech.subarray(offset, offset + BYTES_PER_CHUNK));
      await sleep(CHUNK_MS);
    }
    const speechEndedAt = Date.now();
    // Keep the mic "open" with silence, as the real app does, until a reply starts.
    while (!live.turn.firstAudioAt && !live.closed && Date.now() - speechEndedAt < 12000) {
      live.sendAudio(silence);
      await sleep(CHUNK_MS);
    }
    const streamSilence = (async () => {
      while (!live.turn.complete && !live.closed && Date.now() - speechEndedAt < 30000) {
        live.sendAudio(silence);
        await sleep(CHUNK_MS);
      }
    })();
    await live.waitFor(() => live.turn.complete, 30000);
    await streamSilence;
    results.push({
      latencyMs: live.turn.firstAudioAt ? live.turn.firstAudioAt - speechEndedAt : null,
      heard: live.turn.userText.trim(),
      text: live.turn.tutorText.trim(),
      wav: saveTurnAudio(model, `turn${trial}`, live.turn)
    });
    if (live.closed) break;
    await sleep(1500);
  }

  // Memory check: does the model still know what was said earlier in this connection?
  let memoryAnswer = "";
  if (!live.closed) {
    live.turn = LiveConnection.emptyTurn();
    live.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [{ text: `Quick check, answer in English in one sentence: how many times have I spoken to you so far in this conversation, and what did I say?` }]
            }
          ],
          turnComplete: true
        }
      })
    );
    await live.waitFor(() => live.turn.complete, 20000);
    memoryAnswer = live.turn.tutorText.trim();
  }

  const closed = live.closed;
  live.close();
  return {
    ok: results.some((result) => result.latencyMs !== null),
    detail: closed ? `closed=${JSON.stringify(closed)}` : "",
    results,
    memoryAnswer
  };
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const speech = loadSpeechPcm(speechFile);
  const memory = await loadMemory();
  const instructions = buildTutorInstructions(memory, {
    focus: "Practice introductions, names, where you are from, and one or two easy follow-up questions.",
    presetLabel: "Soft landing",
    engine: "gemini"
  });
  console.log(`Speech: ${speechFile} (${(speech.length / 32000).toFixed(1)}s) · voice ${voice} · ${trials} trial(s)\n`);

  for (const model of models) {
    console.log(`=== ${model} ===`);
    const opener = await testSpeakFirst(model, instructions);
    console.log(`speak-first: ${opener.ok ? "OK" : "FAILED"}${"setupMs" in opener && opener.setupMs ? ` · setup ${opener.setupMs}ms` : ""}`);
    if (opener.ok) {
      console.log(`  first audio ${opener.firstAudioMs}ms after opener · ${opener.wav}`);
      console.log(`  said: ${opener.text}`);
    } else {
      console.log(`  ${opener.detail}`);
    }

    const spoken = await testSpokenTurns(model, instructions, speech);
    const latencies = spoken.results.flatMap((result) => (result.latencyMs === null ? [] : [result.latencyMs]));
    console.log(`spoken turns: ${spoken.ok ? "OK" : "FAILED"} · median reply ${median(latencies) ?? "n/a"}ms · all [${latencies.join(", ")}] ${spoken.detail}`);
    spoken.results.forEach((result, index) => {
      console.log(`  #${index + 1} heard: "${result.heard}"`);
      console.log(`     replied (${result.latencyMs ?? "none"}ms): ${result.text}`);
    });
    if ("memoryAnswer" in spoken) console.log(`memory check: ${spoken.memoryAnswer || "(no answer)"}`);
    console.log("");
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
