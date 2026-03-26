import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import path from "node:path";
import { applyReflection, loadMemory, toClientProfile } from "./lib/memoryStore.js";
import { buildTutorInstructions, getBootstrapAssets } from "./lib/prompts.js";
import { reflectLessonWithAI } from "./lib/reflection.js";
import type { LessonTurn } from "./lib/types.js";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
  override: true
});

const app = express();
const port = Number(process.env.PORT ?? 8787);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/api/bootstrap", async (_request, response) => {
  const memory = await loadMemory();
  const assets = getBootstrapAssets();

  response.json({
    app: {
      name: "Parola Viva",
      voice: process.env.OPENAI_VOICE ?? "marin"
    },
    profile: toClientProfile(memory),
    cultureScenes: assets.cultureScenes,
    sessionPresets: assets.sessionPresets
  });
});

app.post("/api/realtime/session", async (request, response) => {
  if (!process.env.OPENAI_API_KEY) {
    response.status(500).send("OPENAI_API_KEY is missing.");
    return;
  }

  const { focus, offerSdp, presetLabel } = request.body as {
    focus?: string;
    offerSdp?: string;
    presetLabel?: string;
  };

  if (!offerSdp || !focus || !presetLabel) {
    response.status(400).send("focus, presetLabel, and offerSdp are required.");
    return;
  }

  const memory = await loadMemory();
  const formData = new FormData();

  formData.set("sdp", offerSdp);
  formData.set(
    "session",
    JSON.stringify({
      type: "realtime",
      model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
      output_modalities: ["audio"],
      instructions: buildTutorInstructions(memory, { focus, presetLabel }),
      audio: {
        input: {
          turn_detection: {
            type: "semantic_vad",
            eagerness: "low",
            create_response: true,
            interrupt_response: true
          },
          transcription: {
            model: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe",
            prompt:
              "This is a beginner-friendly Italian tutoring conversation with occasional English support. Preserve Italian words accurately."
          }
        },
        output: {
          voice: process.env.OPENAI_VOICE ?? "marin"
        }
      }
    })
  );

  const realtimeResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: formData
  });

  if (!realtimeResponse.ok) {
    const errorText = await realtimeResponse.text();
    response.status(realtimeResponse.status).send(errorText);
    return;
  }

  response.status(200).type("application/sdp").send(await realtimeResponse.text());
});

app.post("/api/lessons/reflect", async (request, response) => {
  if (!process.env.OPENAI_API_KEY) {
    response.status(500).send("OPENAI_API_KEY is missing.");
    return;
  }

  const { capture, focus, presetLabel } = request.body as {
    focus?: string;
    presetLabel?: string;
    capture?: {
      startedAt?: string;
      endedAt?: string;
      turns?: LessonTurn[];
    };
  };

  if (!capture?.startedAt || !capture?.endedAt || !capture.turns || !focus || !presetLabel) {
    response.status(400).send("capture, focus, and presetLabel are required.");
    return;
  }

  const memory = await loadMemory();
  const reflection = await reflectLessonWithAI({
    client: openai,
    memory,
    focus,
    presetLabel,
    turns: capture.turns
  });

  const updatedMemory = await applyReflection({
    reflection,
    focus,
    presetLabel,
    startedAt: capture.startedAt,
    endedAt: capture.endedAt
  });

  response.json({
    reflection,
    profile: toClientProfile(updatedMemory)
  });
});

const distPath = path.resolve(process.cwd(), "dist");
app.use(express.static(distPath));
app.get("*", (_request, response) => {
  response.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Parola Viva server listening on http://localhost:${port}`);
});
