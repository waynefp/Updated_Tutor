import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import path from "node:path";
import {
  applyReflection,
  getStorageStatus,
  loadMemory,
  toClientProfile
} from "./lib/memoryStore.js";
import { buildTutorInstructions, getBootstrapAssets } from "./lib/prompts.js";
import { reflectLessonWithAI } from "./lib/reflection.js";
import type { LessonTurn } from "./lib/types.js";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
  override: true
});

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    storage: await getStorageStatus(),
    models: {
      gemini: process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
      openai: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1"
    }
  });
});

app.get("/api/bootstrap", async (_request, response) => {
  const memory = await loadMemory();
  const assets = getBootstrapAssets();

  response.json({
    app: {
      name: "Parola Viva",
      voice: process.env.GEMINI_LIVE_VOICE ?? "Callirrhoe"
    },
    profile: toClientProfile(memory),
    cultureScenes: assets.cultureScenes,
    sessionPresets: assets.sessionPresets
  });
});

app.post("/api/live/session", async (request, response) => {
  if (!process.env.GEMINI_API_KEY) {
    response.status(500).send("GEMINI_API_KEY is missing.");
    return;
  }

  const { focus, presetLabel } = request.body as {
    focus?: string;
    presetLabel?: string;
  };

  if (!focus || !presetLabel) {
    response.status(400).send("focus and presetLabel are required.");
    return;
  }

  const memory = await loadMemory();
  const model = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";
  const voice = process.env.GEMINI_LIVE_VOICE ?? "Callirrhoe";

  response.json({
    apiKey: process.env.GEMINI_API_KEY,
    model: `models/${model}`,
    systemInstruction: buildTutorInstructions(memory, { focus, presetLabel }),
    voice
  });
});

app.post("/api/live/openai-session", async (request, response) => {
  if (!process.env.OPENAI_API_KEY) {
    response.status(500).send("OPENAI_API_KEY is missing.");
    return;
  }

  const { focus, presetLabel } = request.body as {
    focus?: string;
    presetLabel?: string;
  };

  if (!focus || !presetLabel) {
    response.status(400).send("focus and presetLabel are required.");
    return;
  }

  const memory = await loadMemory();
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";
  const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";

  const secretResponse = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          instructions: buildTutorInstructions(memory, {
            focus,
            presetLabel,
            engine: "openai"
          }),
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: { type: "semantic_vad" }
            },
            output: { voice }
          }
        }
      })
    }
  );

  if (!secretResponse.ok) {
    const detail = await secretResponse.text();
    response
      .status(502)
      .send(`OpenAI could not create a realtime session: ${detail}`);
    return;
  }

  const secret = (await secretResponse.json()) as {
    value?: string;
    expires_at?: number;
  };

  if (!secret.value) {
    response.status(502).send("OpenAI returned no client secret.");
    return;
  }

  response.json({
    clientSecret: secret.value,
    model,
    voice,
    expiresAt: secret.expires_at
  });
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

export default app;
